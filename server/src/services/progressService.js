const progressTable = require('../dynamo/progressTable');

// A DynamoDB item is hard-capped at 400KB. `codeSubmissions` grows by one entry
// per attempt, and a student printing in a loop can emit megabytes of stdout in
// a single run — without these bounds one learner can wedge their own progress
// record so every later write fails and analytics silently stop (S5.5 C1).
const MAX_STORED_STDOUT = 2000;
const MAX_STORED_ERROR = 1000;
// Submitted source is the one datum that cannot be reconstructed after the
// pilot, so it gets the most generous budget — pilot exercises are short and
// 4KB is far above any realistic solution. Worst case per item is still
// 20 × ~7KB, comfortably inside the 400KB ceiling.
const MAX_STORED_CODE = 4000;
const MAX_STORED_SUBMISSIONS = 20;

const truncate = (value, max) => {
  const str = value || '';
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…[truncated ${str.length - max} chars]`;
};

const recordLessonStart = async (userId, lessonId) => {
  const existing = await progressTable.getProgress(userId, lessonId);
  if (existing) return existing;

  const item = {
    userId,
    lessonId,
    status: 'in_progress',
    attempts: 0,
    score: 0,
    timeSpent: 0,
    hintsUsed: 0,
    codeSubmissions: [],
    startedAt: new Date().toISOString(),
  };

  await progressTable.putProgress(item);
  return item;
};

// `code` is the source the learner submitted. It is stored pseudonymously: the
// item's partition key is an opaque Mongo ObjectId, and no read surface pairs a
// submission with a name or email (see scripts/exportSubmissions.js, which
// emits `learner-NN` tokens and writes the re-identification key to a separate
// file). Retaining the per-learner linkage is deliberate — the hint-effectiveness
// analysis behind H1 needs to compare a learner's attempt before a hint reveal
// with the one after.
const recordSubmission = async (userId, lessonId, runResult, code = '') => {
  const stored = await progressTable.getProgress(userId, lessonId);
  const existing = stored || {
    userId,
    lessonId,
    status: 'in_progress',
    attempts: 0,
    score: 0,
    hintsUsed: 0,
    codeSubmissions: [],
    startedAt: new Date().toISOString(),
  };

  const wasCompleted = existing.status === 'completed';
  const newAttempts = (existing.attempts || 0) + 1;
  // `attempts` remains the true lifetime count; only the stored transcript is
  // windowed to the most recent submissions so the item stays well under 400KB.
  const newSubmissions = [
    ...(existing.codeSubmissions || []),
    {
      passed: runResult.passed,
      code: truncate(code, MAX_STORED_CODE),
      stdout: truncate(runResult.stdout, MAX_STORED_STDOUT),
      error: runResult.error ? truncate(runResult.error, MAX_STORED_ERROR) : null,
      hintsUsedAtSubmit: existing.hintsUsed || 0,
      submittedAt: new Date().toISOString(),
    },
  ].slice(-MAX_STORED_SUBMISSIONS);

  const updates = {
    attempts: newAttempts,
    codeSubmissions: newSubmissions,
  };

  // A first submission that FAILS used to create the item with only `attempts`
  // and `codeSubmissions`, because the seeded defaults above live in memory and
  // never reach the table — the row was written with no `status` at all. Those
  // rows then read back as `status: undefined`, which is neither
  // `in_progress` nor `completed`: the dashboard counted them in its completion
  // denominator while no screen could explain what they were. Persist the seed
  // on creation so a failed first attempt is a real in-progress record.
  if (!stored) {
    updates.status = existing.status;
    updates.score = existing.score;
    updates.hintsUsed = existing.hintsUsed;
    updates.startedAt = existing.startedAt;
  }

  if (runResult.passed && !wasCompleted) {
    updates.status = 'completed';
    updates.score = 100;
    updates.completedAt = new Date().toISOString();
  }

  await progressTable.updateProgress(userId, lessonId, updates);

  return {
    attempts: newAttempts,
    status: updates.status || existing.status,
    firstCompletion: runResult.passed && !wasCompleted,
    hintsUsed: existing.hintsUsed || 0,
  };
};

// `hintsUsed` is the count of DISTINCT hints revealed, derived from the highest
// index the learner has opened — not an increment per request. Hint state lives
// in client component state, so a page refresh replays reveals from index 0;
// incrementing counted those replays, inflating the analytics H1 depends on and
// pushing learners into a worse XP tier (S5.5 A2). max() makes replays free.
const recordHintReveal = async (userId, lessonId, hintIndex) => {
  const existing = await progressTable.getProgress(userId, lessonId);
  const hintsUsed = Math.max((existing && existing.hintsUsed) || 0, hintIndex + 1);
  await progressTable.updateProgress(userId, lessonId, { hintsUsed });
  return { hintsUsed };
};

const getLessonProgress = (userId, lessonId) =>
  progressTable.getProgress(userId, lessonId);

// Per-lesson status list for the learner's own screens (course tree ticks,
// dashboard rollups). The submission transcript is deliberately dropped: it is
// the bulkiest part of the record and now carries the learner's source code,
// none of which any consumer of this list renders.
const getStudentProgress = async (userId) => {
  const records = await progressTable.queryByUser(userId);
  return records.map(({ codeSubmissions, ...summary }) => summary);
};

// Aggregates DynamoDB progress records for a known set of lesson IDs into the
// per-lesson stats the instructor analytics view consumes. Returns one row per
// requested lessonId (zeros if no learner has touched it yet) so the client
// can render a complete table without holes.
const getCourseAnalytics = async (lessonIds) => {
  const records = await progressTable.scanByLessonIds(lessonIds);

  const seed = (id) => ({
    lessonId: id,
    uniqueLearners: 0,
    totalAttempts: 0,
    completions: 0,
    totalHintsUsed: 0,
    totalTimeSpent: 0,
  });

  const byLesson = Object.fromEntries(lessonIds.map((id) => [id, seed(id)]));

  for (const r of records) {
    const agg = byLesson[r.lessonId];
    if (!agg) continue;
    agg.uniqueLearners += 1;
    agg.totalAttempts += r.attempts || 0;
    if (r.status === 'completed') agg.completions += 1;
    agg.totalHintsUsed += r.hintsUsed || 0;
    agg.totalTimeSpent += r.timeSpent || 0;
  }

  return lessonIds.map((id) => {
    const a = byLesson[id];
    const learners = a.uniqueLearners;
    return {
      lessonId: id,
      uniqueLearners: learners,
      totalAttempts: a.totalAttempts,
      completions: a.completions,
      passRate: learners > 0 ? Math.round((a.completions / learners) * 100) : 0,
      avgHintsUsed: learners > 0 ? Number((a.totalHintsUsed / learners).toFixed(1)) : 0,
      avgTimeSpentSec: learners > 0 ? Math.round(a.totalTimeSpent / learners) : 0,
    };
  });
};

// ── S7 engagement signals ─────────────────────────────────────────────────────
// Three lightweight counters, each recording an interaction the pilot
// evaluation needs to see (a run without a submit, a note saved, a question
// asked to the instructor) without disturbing the metrics that already exist:
// none of them touch `attempts`, `status` on an existing item, or `score`.
//
// A learner can run code or take a note before ever submitting, so the item may
// not exist yet. DynamoDB's UpdateCommand creates one from the key alone, which
// would leave a record with no `status` — `getCourseAnalytics` counts every
// record as a learner, so that record would land in the pass-rate denominator
// as an unreadable blank. Seeding `status: 'in_progress'` on creation keeps a
// counter-created item indistinguishable from one `recordLessonStart` made.

const bumpCounter = async (userId, lessonId, field) => {
  const existing = await progressTable.getProgress(userId, lessonId);
  const updates = { [field]: ((existing && existing[field]) || 0) + 1 };
  if (!existing) updates.status = 'in_progress';
  await progressTable.updateProgress(userId, lessonId, updates);
  return { [field]: updates[field] };
};

// Unvalidated execution from the editor's Run button. Deliberately separate
// from `attempts`, which only a submit increments: experimenting in the editor
// must not dilute the pass-rate denominator, but the experimentation itself is
// an engagement signal worth keeping.
const recordRun = (userId, lessonId) => bumpCounter(userId, lessonId, 'runs');

// A question sent to the course instructor from this lesson. Feeds the "did the
// scaffolding leave this learner stuck" reading of H1.
const recordQuestionAsked = (userId, lessonId) =>
  bumpCounter(userId, lessonId, 'questionsAsked');

// Active time on the lesson page, in seconds, reported by the client in
// increments while the tab is visible.
//
// `timeSpent` has been on the item since S4 and in the instructor breakdown
// since then, but nothing ever wrote to it: it was seeded at 0 and the
// "Avg time" column has been reading a real zero as if it were a
// measurement. This is the missing write.
//
// The number is the client's, so it is not trusted: a report is clamped to
// MAX_TIME_REPORT_SEC. The client flushes far more often than that, so a
// larger figure means a clock jump, a replayed request or a tampered one —
// none of which should be able to inflate the engagement metric the pilot
// reports. Anything unusable is dropped rather than stored as garbage.
const MAX_TIME_REPORT_SEC = 300;

const recordTimeSpent = async (userId, lessonId, seconds) => {
  const reported = Math.floor(Number(seconds));
  if (!Number.isFinite(reported) || reported <= 0) return { timeSpent: null };

  const delta = Math.min(reported, MAX_TIME_REPORT_SEC);
  const existing = await progressTable.getProgress(userId, lessonId);
  const updates = { timeSpent: ((existing && existing.timeSpent) || 0) + delta };
  if (!existing) updates.status = 'in_progress';
  await progressTable.updateProgress(userId, lessonId, updates);
  return { timeSpent: updates.timeSpent };
};

// Note-taking is a self-regulated-learning behaviour (H2). Only the timestamp
// lives here; the note body is Mongo's (content vs events).
const recordNoteActivity = async (userId, lessonId, now = new Date()) => {
  const existing = await progressTable.getProgress(userId, lessonId);
  const updates = { noteUpdatedAt: now.toISOString() };
  if (!existing) updates.status = 'in_progress';
  await progressTable.updateProgress(userId, lessonId, updates);
  return { noteUpdatedAt: updates.noteUpdatedAt };
};

module.exports = {
  recordLessonStart,
  recordSubmission,
  recordHintReveal,
  recordRun,
  recordQuestionAsked,
  recordNoteActivity,
  recordTimeSpent,
  MAX_TIME_REPORT_SEC,
  getLessonProgress,
  getStudentProgress,
  getCourseAnalytics,
};
