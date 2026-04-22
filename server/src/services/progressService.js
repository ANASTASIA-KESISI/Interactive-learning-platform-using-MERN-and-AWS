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

module.exports = {
  recordLessonStart,
  recordSubmission,
  recordHintReveal,
  getStudentProgress,
};
