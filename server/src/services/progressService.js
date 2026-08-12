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
  const existing = (await progressTable.getProgress(userId, lessonId)) || {
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

module.exports = {
  recordLessonStart,
  recordSubmission,
  recordHintReveal,
  getLessonProgress,
  getStudentProgress,
  getCourseAnalytics,
};
