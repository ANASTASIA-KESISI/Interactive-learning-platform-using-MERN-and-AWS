// GET /api/admin/kpis (S8 C2/C3). The admin overview is where the two
// platform-wide thesis metrics land — badges awarded per week and average
// active session duration — so what matters here is the SHAPE the client
// renders: one bucket per requested week, oldest first, zero-filled, and the
// totals beside them. Models are mocked; `User.aggregate` answers both the
// role grouping the route already did and the new badge-award facet.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { cognitoId: 'cog-admin', email: 'admin@example.com', role: 'admin', claims: {} };
    next();
  },
}));

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    req.dbUser = { _id: { toString: () => 'admin1' }, role: 'admin' };
    next();
  },
}));

jest.mock('../../src/models/User', () => ({
  User: { countDocuments: jest.fn(), aggregate: jest.fn() },
  ROLES: ['student', 'instructor', 'admin'],
}));
jest.mock('../../src/models/Course', () => ({ Course: { countDocuments: jest.fn() } }));
// Session figures come from the DynamoDB progress table via the service.
jest.mock('../../src/services/progressService', () => ({ getSessionStats: jest.fn() }));

const request = require('supertest');
const { User } = require('../../src/models/User');
const { Course } = require('../../src/models/Course');
const progressService = require('../../src/services/progressService');
const { createApp } = require('../../src/app');

const app = createApp();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The route issues two aggregations: the role grouping first, then the badge
// facet. Tell them apart by their first stage rather than by call order, so a
// reordering in the route does not silently swap the answers.
const answerAggregates = ({ roles = [], badges = { total: [], byWeek: [] } } = {}) => {
  User.aggregate.mockImplementation(async (pipeline) => {
    if (pipeline[0].$unwind === '$badgeAwards') return [badges];
    return roles;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  User.countDocuments.mockResolvedValue(0);
  Course.countDocuments.mockResolvedValue(0);
  answerAggregates();
  progressService.getSessionStats.mockResolvedValue({
    sessions: 0,
    avgSessionDurationSec: 0,
    medianSessionDurationSec: 0,
  });
});

describe('GET /api/admin/kpis — sessions', () => {
  test('reports the session figures over the same window as the weekly series', async () => {
    progressService.getSessionStats.mockResolvedValue({
      sessions: 12,
      avgSessionDurationSec: 742,
      medianSessionDurationSec: 610,
    });
    const before = Date.now();

    const res = await request(app).get('/api/admin/kpis?weeks=4');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        sessions: 12,
        avgSessionDurationSec: 742,
        medianSessionDurationSec: 610,
      }),
    );
    // `since` is now − 4 weeks, computed a few ms after `before`.
    const [sinceIso] = progressService.getSessionStats.mock.calls[0];
    const since = Date.parse(sinceIso);
    expect(since).toBeGreaterThanOrEqual(before - 4 * WEEK_MS);
    expect(since).toBeLessThan(before - 4 * WEEK_MS + 5_000);
  });
});

describe('GET /api/admin/kpis — badges awarded', () => {
  test('reports the all-time total and one zero-filled bucket per week', async () => {
    answerAggregates({
      roles: [{ _id: 'student', count: 3 }],
      badges: { total: [{ count: 7 }], byWeek: [{ _id: 3, count: 5 }] },
    });

    const res = await request(app).get('/api/admin/kpis?weeks=4');

    expect(res.status).toBe(200);
    const { badgesAwardedTotal, badgesAwardedByWeek, usersByRole } = res.body.data;
    expect(badgesAwardedTotal).toBe(7);
    expect(usersByRole).toEqual({ student: 3 });
    expect(badgesAwardedByWeek).toHaveLength(4);
    expect(badgesAwardedByWeek.map((b) => b.badgesAwarded)).toEqual([0, 0, 0, 5]);
    // Buckets are contiguous weeks, oldest first.
    badgesAwardedByWeek.forEach((b, i) => {
      expect(b.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (i > 0) expect(b.weekStart > badgesAwardedByWeek[i - 1].weekStart).toBe(true);
    });
  });

  test('the badge facet is bounded to the requested window', async () => {
    const before = Date.now();
    await request(app).get('/api/admin/kpis?weeks=2');

    const facetPipeline = User.aggregate.mock.calls
      .map(([pipeline]) => pipeline)
      .find((pipeline) => pipeline[0].$unwind === '$badgeAwards');
    const match = facetPipeline[1].$facet.byWeek[0].$match['badgeAwards.awardedAt'];

    const windowMs = match.$lt.getTime() - match.$gte.getTime();
    expect(windowMs).toBe(2 * WEEK_MS);
    expect(match.$lt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test('an empty facet result yields zeros rather than a crash', async () => {
    // No user has any award yet: `$unwind` drops every document and the facet
    // returns empty arrays for both branches.
    answerAggregates({ badges: { total: [], byWeek: [] } });

    const res = await request(app).get('/api/admin/kpis?weeks=3');

    expect(res.status).toBe(200);
    expect(res.body.data.badgesAwardedTotal).toBe(0);
    expect(res.body.data.badgesAwardedByWeek.map((b) => b.badgesAwarded)).toEqual([0, 0, 0]);
  });

  test('the weekly-active buckets are untouched by the addition', async () => {
    const res = await request(app).get('/api/admin/kpis?weeks=3');

    expect(res.body.data.activeByWeek).toHaveLength(3);
    expect(res.body.data.activeByWeek.every((w) => w.activeUsers === 0)).toBe(true);
  });
});
