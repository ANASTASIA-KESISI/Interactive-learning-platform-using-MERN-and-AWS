// GET /api/student/activity (S7 §3, P1-F). The endpoint feeds the profile's
// learning-activity heatmap, so what matters is the SHAPE: exactly 365
// zero-filled UTC day buckets, so the client can lay out a dense grid without
// any gap logic, and a hard window boundary so an old completion cannot leak
// into the current year.
//
// `requireAuth` is mocked to skip JWKS verification and `attachUser` to skip
// Mongo, the same shape as the rest of the route suites; `progressService` is
// mocked because the source of truth here is DynamoDB.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { cognitoId: 'cog-1', email: 'sam@example.com', role: 'student', claims: {} };
    next();
  },
}));

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    req.dbUser = { _id: { toString: () => 'user1' } };
    next();
  },
}));

jest.mock('../../src/services/progressService', () => ({
  getStudentProgress: jest.fn(),
}));

const request = require('supertest');
const progressService = require('../../src/services/progressService');
const { createApp } = require('../../src/app');

const app = createApp();

const MS_PER_DAY = 86_400_000;
const WINDOW_DAYS = 365;

// The route buckets by UTC calendar day (consistent with the streak maths in
// gamificationService); mirror that here rather than assuming a fixed "today",
// which would make the suite go red on a different day.
const utcDayStart = (date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const today = () => utcDayStart(new Date());
const daysAgo = (n) => today() - n * MS_PER_DAY;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const completedOn = (lessonId, ms) => ({
  lessonId,
  status: 'completed',
  completedAt: new Date(ms).toISOString(),
});

const findDay = (days, ms) => days.find((d) => d.date === isoDay(ms));

beforeEach(() => {
  progressService.getStudentProgress.mockReset();
});

describe('GET /api/student/activity', () => {
  test('zero-fills the whole trailing year when nothing has been completed', async () => {
    progressService.getStudentProgress.mockResolvedValue([]);

    const res = await request(app).get('/api/student/activity');

    expect(res.status).toBe(200);
    const { from, to, days } = res.body.data;
    expect(days).toHaveLength(WINDOW_DAYS);
    expect(days[0].date).toBe(from);
    expect(days[days.length - 1].date).toBe(to);
    expect(days.every((d) => d.completions === 0)).toBe(true);
    // Every date in between is present exactly once and in ascending order.
    expect(new Set(days.map((d) => d.date)).size).toBe(WINDOW_DAYS);
    expect([...days].sort((a, b) => a.date.localeCompare(b.date))).toEqual(days);
  });

  test('buckets completions by UTC calendar day', async () => {
    progressService.getStudentProgress.mockResolvedValue([
      // Two lessons finished on the same UTC day, hours apart.
      completedOn('l1', daysAgo(2) + 60_000),
      completedOn('l2', daysAgo(2) + 23 * 3_600_000),
      completedOn('l3', daysAgo(10)),
    ]);

    const res = await request(app).get('/api/student/activity');

    expect(res.status).toBe(200);
    const { days } = res.body.data;
    expect(findDay(days, daysAgo(2)).completions).toBe(2);
    expect(findDay(days, daysAgo(10)).completions).toBe(1);
    expect(findDay(days, daysAgo(3)).completions).toBe(0);
    expect(days.reduce((sum, d) => sum + d.completions, 0)).toBe(3);
  });

  test('ignores records that were never completed', async () => {
    progressService.getStudentProgress.mockResolvedValue([
      { lessonId: 'l1', status: 'in_progress', attempts: 4 },
      { lessonId: 'l2', status: 'in_progress', completedAt: null },
      { lessonId: 'l3', status: 'completed', completedAt: 'not-a-date' },
      completedOn('l4', daysAgo(1)),
    ]);

    const res = await request(app).get('/api/student/activity');

    expect(res.status).toBe(200);
    const { days } = res.body.data;
    expect(days.reduce((sum, d) => sum + d.completions, 0)).toBe(1);
    expect(findDay(days, daysAgo(1)).completions).toBe(1);
  });

  test('the window is 365 inclusive days — the oldest day counts, the day before it does not', async () => {
    progressService.getStudentProgress.mockResolvedValue([
      completedOn('l1', daysAgo(WINDOW_DAYS - 1)),
      completedOn('l2', daysAgo(WINDOW_DAYS)),
      // A future-dated record (clock skew on a client) is outside the window too.
      completedOn('l3', daysAgo(-1)),
    ]);

    const res = await request(app).get('/api/student/activity');

    expect(res.status).toBe(200);
    const { from, days } = res.body.data;
    expect(from).toBe(isoDay(daysAgo(WINDOW_DAYS - 1)));
    expect(days[0].completions).toBe(1);
    expect(findDay(days, daysAgo(WINDOW_DAYS))).toBeUndefined();
    expect(days.reduce((sum, d) => sum + d.completions, 0)).toBe(1);
  });
});
