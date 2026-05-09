const progressTable = require('../dynamo/progressTable');

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

const recordSubmission = async (userId, lessonId, runResult) => {
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
  const newSubmissions = [
    ...(existing.codeSubmissions || []),
    {
      passed: runResult.passed,
      stdout: runResult.stdout,
      error: runResult.error || null,
      submittedAt: new Date().toISOString(),
    },
  ];

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
  };
};

const recordHintReveal = async (userId, lessonId) => {
  const existing = await progressTable.getProgress(userId, lessonId);
  const hintsUsed = ((existing && existing.hintsUsed) || 0) + 1;
  await progressTable.updateProgress(userId, lessonId, { hintsUsed });
  return { hintsUsed };
};

const getStudentProgress = async (userId) => {
  const records = await progressTable.queryByUser(userId);
  return records;
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
  getStudentProgress,
  getCourseAnalytics,
};
