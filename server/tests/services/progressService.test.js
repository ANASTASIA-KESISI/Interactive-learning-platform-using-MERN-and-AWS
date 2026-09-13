jest.mock('../../src/dynamo/progressTable', () => ({
  SESSION_PREFIX: 'session#',
  scanByLessonIds: jest.fn(),
  scanSessionsSince: jest.fn(),
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
      avgAttemptsPerLearner: 0,
      avgHintsUsed: 0,
      hintRevealRate: 0,
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
      avgAttemptsPerLearner: 2,
      avgHintsUsed: 1,
      hintRevealRate: 67,
      avgTimeSpentSec: 120,
    });
  });

  // S8 C1: the two metrics the thesis names that were only derivable before.
  // `avgAttemptsPerLearner` is the mean submissions per exercise; `hintRevealRate`
  // is the share of learners who opened at least one hint — reach, where
  // `avgHintsUsed` is depth.
  test('reports mean attempts per learner to one decimal', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'completed', attempts: 4 },
      { userId: 'u2', lessonId: 'l1', status: 'in_progress', attempts: 1 },
      { userId: 'u3', lessonId: 'l1', status: 'in_progress', attempts: 2 },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson.avgAttemptsPerLearner).toBe(2.3);
  });

  test('hint reveal rate counts learners, not hints', async () => {
    // One learner opened every hint; three never opened one. The mean hints
    // figure alone (1.25) would read as "moderate hint use" — the rate says 25%.
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'completed', attempts: 1, hintsUsed: 5 },
      { userId: 'u2', lessonId: 'l1', status: 'completed', attempts: 1, hintsUsed: 0 },
      { userId: 'u3', lessonId: 'l1', status: 'completed', attempts: 1 },
      { userId: 'u4', lessonId: 'l1', status: 'in_progress', attempts: 0, hintsUsed: 0 },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson.hintRevealRate).toBe(25);
    expect(lesson.avgHintsUsed).toBe(1.3);
  });

  test('both new metrics are zero, not NaN, for a lesson nobody has opened', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson.avgAttemptsPerLearner).toBe(0);
    expect(lesson.hintRevealRate).toBe(0);
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

// `timeSpent` shipped in S4 and has been rendered as "Avg time" in the
// instructor breakdown ever since, but nothing wrote to it — the column was
// reading a real zero as if it were a measurement. These cover the write, and
// in particular the clamp: the number arrives from the browser, so it is the
// one engagement metric a learner could otherwise inflate at will.
describe('progressService.recordTimeSpent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adds the reported seconds to the running total', async () => {
    progressTable.getProgress.mockResolvedValue({ status: 'in_progress', timeSpent: 90 });

    const result = await progressService.recordTimeSpent('u1', 'l1', 30);

    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', { timeSpent: 120 });
    expect(result).toEqual({ timeSpent: 120 });
  });

  test('seeds status on an item that does not exist yet', async () => {
    // A learner can read a lesson without ever submitting, so the report may be
    // the first thing that touches the item. Without a status it would land in
    // the pass-rate denominator as an unreadable blank.
    progressTable.getProgress.mockResolvedValue(null);

    await progressService.recordTimeSpent('u1', 'l1', 20);

    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', {
      timeSpent: 20,
      status: 'in_progress',
    });
  });

  test('treats a missing timeSpent on an existing item as zero', async () => {
    progressTable.getProgress.mockResolvedValue({ status: 'completed' });

    await progressService.recordTimeSpent('u1', 'l1', 45);

    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', { timeSpent: 45 });
  });

  test('clamps an implausible report rather than trusting it', async () => {
    progressTable.getProgress.mockResolvedValue({ timeSpent: 0 });

    await progressService.recordTimeSpent('u1', 'l1', 86_400);

    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', {
      timeSpent: progressService.MAX_TIME_REPORT_SEC,
    });
  });

  test.each([0, -5, NaN, 'abc', null, undefined])(
    'drops an unusable report (%s) without writing',
    async (seconds) => {
      await progressService.recordTimeSpent('u1', 'l1', seconds);

      expect(progressTable.updateProgress).not.toHaveBeenCalled();
    },
  );

  test('floors a fractional report so the stored total stays whole', async () => {
    progressTable.getProgress.mockResolvedValue({ timeSpent: 10 });

    await progressService.recordTimeSpent('u1', 'l1', 30.9);

    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'l1', { timeSpent: 40 });
  });
});

// ── Sessions (S8 D6) ─────────────────────────────────────────────────────────
// A session is an item in the progress table keyed `session#<id>`. Its
// `durationSec` is ACTIVE time: each heartbeat adds the gap since the last
// one, capped, so a hidden tab or a shut laptop adds nothing. Both the cap and
// the shared partition are what these tests pin down — the second because a
// session item leaking into the learner's lesson list would be counted as a
// lesson nobody can name.
describe('progressService.recordSessionHeartbeat', () => {
  beforeEach(() => jest.clearAllMocks());

  const t0 = new Date('2026-09-13T10:00:00.000Z');
  const at = (seconds) => new Date(t0.getTime() + seconds * 1000);

  test('the first heartbeat creates the item under the session# sort key', async () => {
    progressTable.getProgress.mockResolvedValue(null);

    const result = await progressService.recordSessionHeartbeat('u1', 'abc12345', t0);

    expect(progressTable.getProgress).toHaveBeenCalledWith('u1', 'session#abc12345');
    expect(progressTable.putProgress).toHaveBeenCalledWith({
      userId: 'u1',
      lessonId: 'session#abc12345',
      type: 'session',
      startedAt: t0.toISOString(),
      lastSeenAt: t0.toISOString(),
      durationSec: 0,
      heartbeats: 1,
    });
    expect(progressTable.updateProgress).not.toHaveBeenCalled();
    expect(result).toEqual({ durationSec: 0 });
  });

  test('a later heartbeat adds the gap since the previous one', async () => {
    progressTable.getProgress.mockResolvedValue({
      type: 'session',
      startedAt: t0.toISOString(),
      lastSeenAt: t0.toISOString(),
      durationSec: 0,
      heartbeats: 1,
    });

    const result = await progressService.recordSessionHeartbeat('u1', 'abc12345', at(60));

    expect(progressTable.putProgress).not.toHaveBeenCalled();
    expect(progressTable.updateProgress).toHaveBeenCalledWith('u1', 'session#abc12345', {
      durationSec: 60,
      lastSeenAt: at(60).toISOString(),
      heartbeats: 2,
    });
    expect(result).toEqual({ durationSec: 60 });
  });

  test('accumulates across heartbeats', async () => {
    progressTable.getProgress.mockResolvedValue({
      lastSeenAt: at(120).toISOString(),
      durationSec: 120,
      heartbeats: 3,
    });

    const result = await progressService.recordSessionHeartbeat('u1', 'abc12345', at(165));

    expect(result.durationSec).toBe(165);
    expect(progressTable.updateProgress.mock.calls[0][2].heartbeats).toBe(4);
  });

  test('caps a long gap at 120 s so a hidden tab adds nothing beyond it', async () => {
    // Last seen an hour ago: the tab was hidden or the laptop shut. Only the
    // cap is credited, not the hour.
    progressTable.getProgress.mockResolvedValue({
      lastSeenAt: t0.toISOString(),
      durationSec: 30,
      heartbeats: 2,
    });

    const result = await progressService.recordSessionHeartbeat('u1', 'abc12345', at(3600));

    expect(result.durationSec).toBe(30 + progressService.MAX_HEARTBEAT_GAP_SEC);
    expect(progressService.MAX_HEARTBEAT_GAP_SEC).toBe(120);
  });

  test('a clock that went backwards contributes nothing rather than a negative', async () => {
    progressTable.getProgress.mockResolvedValue({
      lastSeenAt: at(100).toISOString(),
      durationSec: 100,
      heartbeats: 2,
    });

    const result = await progressService.recordSessionHeartbeat('u1', 'abc12345', at(40));

    expect(result.durationSec).toBe(100);
  });
});

describe('progressService session items and the learner partition', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isSessionItem keys on the sort-key prefix', () => {
    expect(progressService.isSessionItem({ lessonId: 'session#abc' })).toBe(true);
    expect(progressService.isSessionItem({ lessonId: '64f0c0ffee' })).toBe(false);
    expect(progressService.isSessionItem({})).toBe(false);
  });

  test('getStudentProgress drops session items from the lesson list', async () => {
    progressTable.queryByUser.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'completed', attempts: 1 },
      { userId: 'u1', lessonId: 'session#abc12345', type: 'session', durationSec: 300 },
      { userId: 'u1', lessonId: 'l2', status: 'in_progress', attempts: 2 },
    ]);

    const records = await progressService.getStudentProgress('u1');

    expect(records.map((r) => r.lessonId)).toEqual(['l1', 'l2']);
  });
});

describe('progressService.getSessionStats', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes the window start through and reports count, mean and median', async () => {
    progressTable.scanSessionsSince.mockResolvedValue([
      { lessonId: 'session#a', durationSec: 100 },
      { lessonId: 'session#b', durationSec: 200 },
      { lessonId: 'session#c', durationSec: 900 },
    ]);

    const stats = await progressService.getSessionStats('2026-09-01T00:00:00.000Z');

    expect(progressTable.scanSessionsSince).toHaveBeenCalledWith('2026-09-01T00:00:00.000Z');
    expect(stats).toEqual({ sessions: 3, avgSessionDurationSec: 400, medianSessionDurationSec: 200 });
  });

  test('median of an even count is the mean of the middle pair', async () => {
    progressTable.scanSessionsSince.mockResolvedValue([
      { durationSec: 10 },
      { durationSec: 30 },
      { durationSec: 20 },
      { durationSec: 40 },
    ]);

    const stats = await progressService.getSessionStats('2026-09-01T00:00:00.000Z');

    expect(stats.medianSessionDurationSec).toBe(25);
  });

  test('zeros, not NaN, when no session fell in the window', async () => {
    progressTable.scanSessionsSince.mockResolvedValue([]);

    const stats = await progressService.getSessionStats('2026-09-01T00:00:00.000Z');

    expect(stats).toEqual({ sessions: 0, avgSessionDurationSec: 0, medianSessionDurationSec: 0 });
  });
});
