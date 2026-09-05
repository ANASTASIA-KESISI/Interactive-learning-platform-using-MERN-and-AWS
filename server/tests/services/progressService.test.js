jest.mock('../../src/dynamo/progressTable', () => ({
  scanByLessonIds: jest.fn(),
  getProgress: jest.fn(),
  putProgress: jest.fn(),
  updateProgress: jest.fn(),
  queryByUser: jest.fn(),
}));

const progressTable = require('../../src/dynamo/progressTable');
const progressService = require('../../src/services/progressService');

// Regression for S5.5 finding A2. Hint reveal state lives in client component
// state, so a page refresh replays reveals from index 0. The old implementation
// incremented per call, inflating `hintsUsed` and pushing the learner into a
// worse XP tier for hints they only saw once.
describe('progressService.recordHintReveal', () => {
  beforeEach(() => jest.clearAllMocks());

  test('first reveal of hint 0 records one hint used', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    const result = await progressService.recordHintReveal('u1', 'l1', 0);

    expect(result.hintsUsed).toBe(1);
    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', { hintsUsed: 1 });
  });

  test('re-revealing an already-seen hint does not inflate the count', async () => {
    progressTable.getProgress.mockResolvedValue({ hintsUsed: 2 });

    const result = await progressService.recordHintReveal('u1', 'l1', 0);

    expect(result.hintsUsed).toBe(2);
    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', { hintsUsed: 2 });
  });

  test('revealing a deeper hint raises the count to that index + 1', async () => {
    progressTable.getProgress.mockResolvedValue({ hintsUsed: 1 });

    const result = await progressService.recordHintReveal('u1', 'l1', 2);

    expect(result.hintsUsed).toBe(3);
  });

  test('replaying the whole ladder after a refresh lands on the true count', async () => {
    let stored = 0;
    progressTable.getProgress.mockImplementation(async () => ({ hintsUsed: stored }));
    progressTable.updateProgress.mockImplementation(async (_u, _l, updates) => {
      stored = updates.hintsUsed;
    });

    for (const index of [0, 1, 2]) {
      await progressService.recordHintReveal('u1', 'l1', index);
    }
    // refresh → client replays from 0
    for (const index of [0, 1, 2]) {
      await progressService.recordHintReveal('u1', 'l1', index);
    }

    expect(stored).toBe(3);
  });
});

// Regression for S5.5 finding C1. A DynamoDB item is capped at 400KB; an
// unbounded submission log with untruncated stdout lets one learner wedge their
// own progress record so every later write fails.
describe('progressService.recordSubmission size bounds', () => {
  beforeEach(() => jest.clearAllMocks());

  const lastWrite = () =>
    progressTable.updateProgress.mock.calls[progressTable.updateProgress.mock.calls.length - 1][2];

  test('truncates oversized stdout before storing', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission('u1', 'l1', {
      passed: false,
      stdout: 'x'.repeat(50_000),
    });

    const stored = lastWrite().codeSubmissions[0].stdout;
    expect(stored.length).toBeLessThan(2_500);
    expect(stored).toMatch(/truncated/);
  });

  test('caps the stored submission log while attempts keeps counting', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({
      passed: false,
      stdout: `run ${i}`,
      error: null,
      submittedAt: '2026-08-01T00:00:00.000Z',
    }));
    progressTable.getProgress.mockResolvedValue({
      status: 'in_progress',
      attempts: 20,
      hintsUsed: 0,
      codeSubmissions: existing,
    });

    const result = await progressService.recordSubmission('u1', 'l1', {
      passed: true,
      stdout: 'final run',
    });

    const submissions = lastWrite().codeSubmissions;
    expect(submissions).toHaveLength(20);
    expect(submissions[submissions.length - 1].stdout).toBe('final run');
    expect(submissions[0].stdout).toBe('run 1'); // oldest dropped
    expect(result.attempts).toBe(21);
  });

  test('short output is stored verbatim', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission('u1', 'l1', { passed: true, stdout: 'Hello, World!' });

    expect(lastWrite().codeSubmissions[0].stdout).toBe('Hello, World!');
  });

  test('truncates oversized submitted code', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission(
      'u1',
      'l1',
      { passed: false, stdout: '' },
      'x'.repeat(50_000),
    );

    const stored = lastWrite().codeSubmissions[0].code;
    expect(stored.length).toBeLessThan(4_500);
    expect(stored).toMatch(/truncated/);
  });
});

// The submitted source is the one datum that cannot be reconstructed after the
// pilot. It is retained pseudonymously — the partition key is an opaque
// ObjectId and no read surface pairs code with a name (scripts/exportSubmissions
// swaps in `learner-NN` tokens).
describe('progressService submitted-code capture', () => {
  beforeEach(() => jest.clearAllMocks());

  const lastWrite = () =>
    progressTable.updateProgress.mock.calls[progressTable.updateProgress.mock.calls.length - 1][2];

  test('stores the code the learner submitted', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission(
      'u1',
      'l1',
      { passed: true, stdout: 'Hello, World!' },
      'console.log("Hello, World!");',
    );

    expect(lastWrite().codeSubmissions[0].code).toBe('console.log("Hello, World!");');
  });

  // Pairing consecutive attempts by this field is what makes "did revealing a
  // hint change what they wrote next" answerable — the H1 scaffolding question.
  test('snapshots the hint count as it stood at submit time', async () => {
    progressTable.getProgress.mockResolvedValue({
      status: 'in_progress',
      attempts: 1,
      hintsUsed: 2,
      codeSubmissions: [],
    });

    await progressService.recordSubmission('u1', 'l1', { passed: false, stdout: '' }, 'attempt();');

    expect(lastWrite().codeSubmissions[0].hintsUsedAtSubmit).toBe(2);
  });

  test('records an empty string when no code is supplied', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission('u1', 'l1', { passed: false, stdout: '' });

    expect(lastWrite().codeSubmissions[0].code).toBe('');
  });

  test('getStudentProgress withholds the submission transcript', async () => {
    progressTable.queryByUser.mockResolvedValue([
      {
        userId: 'u1',
        lessonId: 'l1',
        status: 'completed',
        attempts: 3,
        codeSubmissions: [{ code: 'console.log(1)', stdout: '1' }],
      },
    ]);

    const [record] = await progressService.getStudentProgress('u1');

    expect(record).not.toHaveProperty('codeSubmissions');
    expect(record.status).toBe('completed');
    expect(record.attempts).toBe(3);
  });
});

describe('progressService.getCourseAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns zeroed rows for lessons with no progress records', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([]);

    const result = await progressService.getCourseAnalytics(['l1', 'l2']);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      lessonId: 'l1',
      uniqueLearners: 0,
      totalAttempts: 0,
      completions: 0,
      passRate: 0,
      avgHintsUsed: 0,
      avgTimeSpentSec: 0,
    });
  });

  test('aggregates pass rate, attempts, hints and time across multiple learners', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'completed', attempts: 3, hintsUsed: 1, timeSpent: 120 },
      { userId: 'u2', lessonId: 'l1', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 60 },
      { userId: 'u3', lessonId: 'l1', status: 'in_progress', attempts: 2, hintsUsed: 2, timeSpent: 180 },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson).toEqual({
      lessonId: 'l1',
      uniqueLearners: 3,
      totalAttempts: 6,
      completions: 2,
      passRate: 67,
      avgHintsUsed: 1,
      avgTimeSpentSec: 120,
    });
  });

  test('preserves order of requested lessonIds and ignores foreign records', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l2', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 30 },
      { userId: 'u2', lessonId: 'lx', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 30 },
    ]);

    const result = await progressService.getCourseAnalytics(['l1', 'l2', 'l3']);

    expect(result.map((r) => r.lessonId)).toEqual(['l1', 'l2', 'l3']);
    expect(result[0].uniqueLearners).toBe(0);
    expect(result[1].uniqueLearners).toBe(1);
    expect(result[2].uniqueLearners).toBe(0);
  });

  test('handles missing fields on records (treats as zero)', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'in_progress' },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson.totalAttempts).toBe(0);
    expect(lesson.avgHintsUsed).toBe(0);
    expect(lesson.avgTimeSpentSec).toBe(0);
    expect(lesson.passRate).toBe(0);
  });

  test('returns empty array when no lessonIds are provided', async () => {
    const result = await progressService.getCourseAnalytics([]);
    expect(result).toEqual([]);
  });
});

// Regression: a first submission that FAILED used to create the DynamoDB item
// with only `attempts` and `codeSubmissions`. The seeded defaults live in a
// local object that never reaches the table, so the row was written with no
// `status` at all and read back as `status: undefined` — counted in the
// dashboard's completion denominator while matching neither 'in_progress' nor
// 'completed'. Found in live data during local testing on 2026-09-05.
describe('progressService.recordSubmission item seeding', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a failed FIRST submission persists status in_progress', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordSubmission('u1', 'l1', { passed: false, stdout: 'nope' }, 'x');

    const [, , updates] = progressTable.updateProgress.mock.calls[0];
    expect(updates.status).toBe('in_progress');
    expect(updates.score).toBe(0);
    expect(updates.hintsUsed).toBe(0);
    expect(updates.startedAt).toEqual(expect.any(String));
    expect(updates.attempts).toBe(1);
  });

  test('a passing FIRST submission still lands as completed', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    const result = await progressService.recordSubmission(
      'u1',
      'l1',
      { passed: true, stdout: 'ok' },
      'x',
    );

    const [, , updates] = progressTable.updateProgress.mock.calls[0];
    expect(updates.status).toBe('completed');
    expect(updates.score).toBe(100);
    expect(updates.completedAt).toEqual(expect.any(String));
    expect(result.firstCompletion).toBe(true);
  });

  test('an existing item is not re-seeded, so its history is preserved', async () => {
    progressTable.getProgress.mockResolvedValue({
      status: 'in_progress',
      attempts: 4,
      score: 0,
      hintsUsed: 2,
      startedAt: '2026-01-01T00:00:00.000Z',
      codeSubmissions: [],
    });

    await progressService.recordSubmission('u1', 'l1', { passed: false, stdout: '' }, 'x');

    const [, , updates] = progressTable.updateProgress.mock.calls[0];
    expect(updates).not.toHaveProperty('status');
    expect(updates).not.toHaveProperty('startedAt');
    expect(updates.attempts).toBe(5);
  });
});
