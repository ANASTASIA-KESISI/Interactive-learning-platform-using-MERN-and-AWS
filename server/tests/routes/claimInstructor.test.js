// POST /api/auth/claim-instructor (S7 D2). Roles live in Cognito groups, so
// the endpoint's whole job is to authorise the promotion and hand off to
// authService — these assert the gate, not the Cognito call.
//
// `requireAuth` is mocked to skip JWKS verification and `attachUser` to skip
// Mongo, the same shape as the rest of the route suites. The invite code is
// read through settingsService (Mongo-backed since S9), mocked here so each
// test can pick the effective code without a database.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      cognitoId: 'cog-1',
      email: 'sam@example.com',
      role: 'student',
      claims: {},
    };
    next();
  },
}));

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    req.dbUser = { _id: 'user1', role: 'student' };
    next();
  },
}));

jest.mock('../../src/services/authService', () => ({
  syncUserFromClaims: jest.fn(),
  getByCognitoId: jest.fn(),
  setUserRole: jest.fn().mockResolvedValue({ _id: 'user1', role: 'instructor' }),
}));

jest.mock('../../src/services/settingsService', () => ({
  getInstructorInviteCode: jest.fn(),
}));

const request = require('supertest');
const authService = require('../../src/services/authService');
const settingsService = require('../../src/services/settingsService');
const { createApp } = require('../../src/app');

const app = createApp();
const INVITE_CODE = 'a-long-random-invite-code';

beforeEach(() => {
  jest.clearAllMocks();
});

// The endpoint is rate-limited to 5 requests / 15 min / IP, and supertest
// always presents 127.0.0.1 — keep this suite under that budget.
describe('POST /api/auth/claim-instructor', () => {
  test('503 when no invite code is configured for the deployment', async () => {
    settingsService.getInstructorInviteCode.mockResolvedValue('');

    const res = await request(app).post('/api/auth/claim-instructor').send({ code: 'anything' });

    expect(res.status).toBe(503);
    expect(authService.setUserRole).not.toHaveBeenCalled();
  });

  test('400 when the body carries no code', async () => {
    settingsService.getInstructorInviteCode.mockResolvedValue(INVITE_CODE);

    const res = await request(app).post('/api/auth/claim-instructor').send({});

    expect(res.status).toBe(400);
    expect(authService.setUserRole).not.toHaveBeenCalled();
  });

  test('403 on a wrong code, without saying why', async () => {
    settingsService.getInstructorInviteCode.mockResolvedValue(INVITE_CODE);

    const res = await request(app)
      .post('/api/auth/claim-instructor')
      .send({ code: 'a-long-random-invite-codX' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).not.toContain(INVITE_CODE);
    expect(authService.setUserRole).not.toHaveBeenCalled();
  });

  test('promotes the caller to instructor on the right code', async () => {
    settingsService.getInstructorInviteCode.mockResolvedValue(INVITE_CODE);

    const res = await request(app)
      .post('/api/auth/claim-instructor')
      .send({ code: INVITE_CODE });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('instructor');
    expect(res.body.data.note).toMatch(/refresh/i);
    expect(authService.setUserRole).toHaveBeenCalledWith('user1', 'instructor');
  });
});
