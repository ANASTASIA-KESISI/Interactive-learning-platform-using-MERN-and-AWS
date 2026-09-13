// POST /api/me/session (S8 D6). The session heartbeat is telemetry, so its
// contract is the one the time-on-task endpoint set: 202 either way, a student
// records, any other role gets `recorded: false` so an instructor's browsing
// never enters the pilot's session figures, and the id is validated because it
// becomes a DynamoDB sort key. `requireAuth` and `attachUser` are mocked to
// skip JWKS and Mongo and read the role from a test header; the service is
// mocked so nothing reaches DynamoDB.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      cognitoId: 'cog-1',
      email: 'sam@example.com',
      role: req.headers['x-test-role'] || 'student',
      claims: {},
    };
    next();
  },
}));

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    req.dbUser = { _id: { toString: () => 'user1' }, role: req.user.role };
    next();
  },
}));

jest.mock('../../src/services/progressService', () => ({
  recordSessionHeartbeat: jest.fn(),
}));

const request = require('supertest');
const progressService = require('../../src/services/progressService');
const { createApp } = require('../../src/app');

const app = createApp();

const SESSION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  jest.clearAllMocks();
  progressService.recordSessionHeartbeat.mockResolvedValue({ durationSec: 0 });
});

describe('POST /api/me/session', () => {
  test('a student records a heartbeat under their Mongo id', async () => {
    const res = await request(app).post('/api/me/session').send({ sessionId: SESSION_ID });

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ recorded: true });
    expect(progressService.recordSessionHeartbeat).toHaveBeenCalledWith('user1', SESSION_ID);
  });

  test.each(['instructor', 'admin'])('%s gets 202 recorded: false and writes nothing', async (role) => {
    const res = await request(app)
      .post('/api/me/session')
      .set('x-test-role', role)
      .send({ sessionId: SESSION_ID });

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ recorded: false });
    expect(progressService.recordSessionHeartbeat).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', undefined],
    ['a number', 12345678],
    ['too short', 'abc1234'],
    ['too long', 'x'.repeat(65)],
    ['carrying a reserved character', 'abcd#1234'],
    ['carrying whitespace', 'abcd 1234'],
  ])('400 when sessionId is %s', async (_label, sessionId) => {
    const res = await request(app)
      .post('/api/me/session')
      .send(sessionId === undefined ? {} : { sessionId });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/sessionId/);
    expect(progressService.recordSessionHeartbeat).not.toHaveBeenCalled();
  });

  test.each(['abcdefgh', 'x'.repeat(64), 'A-Z_a-z0-9'])('accepts %s', async (sessionId) => {
    const res = await request(app).post('/api/me/session').send({ sessionId });

    expect(res.status).toBe(202);
    expect(progressService.recordSessionHeartbeat).toHaveBeenCalledWith('user1', sessionId);
  });

  test('a DynamoDB failure is swallowed — the learner still gets 202', async () => {
    progressService.recordSessionHeartbeat.mockRejectedValue(new Error('throttled'));

    const res = await request(app).post('/api/me/session').send({ sessionId: SESSION_ID });

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ recorded: true });
  });
});
