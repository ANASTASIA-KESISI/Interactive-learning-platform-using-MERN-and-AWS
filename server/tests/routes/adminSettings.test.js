// Admin-managed instructor invite code (S9). The routes are thin — read and
// write through settingsService — so these pin the RBAC gate (a signed-in
// instructor must get 403, never the code), the body validation, and that the
// acting admin's id reaches the service for the audit stamp.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      cognitoId: 'cog-admin',
      email: 'admin@example.com',
      role: req.headers['x-test-role'] || 'admin',
      claims: {},
    };
    next();
  },
}));

jest.mock('../../src/services/authService', () => ({
  syncUserFromClaims: jest.fn(),
}));

jest.mock('../../src/services/settingsService', () => ({
  readInstructorInviteCode: jest.fn(),
  setInstructorInviteCode: jest.fn(),
}));

const request = require('supertest');
const authService = require('../../src/services/authService');
const settingsService = require('../../src/services/settingsService');
const { badRequest } = require('../../src/utils/httpError');
const { createApp } = require('../../src/app');

const app = createApp();
const PATH = '/api/admin/settings/instructor-invite-code';

const adminDoc = { _id: { toString: () => 'admin1' }, role: 'admin', isActive: true };
const stored = { code: 'saved-by-admin', source: 'database', updatedAt: null, updatedBy: null };

beforeEach(() => {
  jest.clearAllMocks();
  authService.syncUserFromClaims.mockResolvedValue(adminDoc);
  settingsService.readInstructorInviteCode.mockResolvedValue(stored);
  settingsService.setInstructorInviteCode.mockResolvedValue(stored);
});

describe('GET /api/admin/settings/instructor-invite-code', () => {
  test('returns the effective code and its source to an admin', async () => {
    const res = await request(app).get(PATH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(stored);
  });

  test('403 for an instructor, and the code never leaves the server', async () => {
    const res = await request(app).get(PATH).set('x-test-role', 'instructor');

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('saved-by-admin');
    expect(settingsService.readInstructorInviteCode).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/settings/instructor-invite-code', () => {
  test('saves the code with the acting admin id', async () => {
    const res = await request(app).put(PATH).send({ code: 'rotated-code-2026' });

    expect(res.status).toBe(200);
    expect(settingsService.setInstructorInviteCode).toHaveBeenCalledWith(
      'rotated-code-2026',
      adminDoc._id,
    );
    expect(res.body.data).toEqual(stored);
  });

  test('surfaces the service validation as 400', async () => {
    settingsService.setInstructorInviteCode.mockRejectedValue(
      badRequest('code must be at least 8 characters'),
    );

    const res = await request(app).put(PATH).send({ code: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least 8/);
  });

  test('403 for a student', async () => {
    const res = await request(app)
      .put(PATH)
      .set('x-test-role', 'student')
      .send({ code: 'whatever-1234' });

    expect(res.status).toBe(403);
    expect(settingsService.setInstructorInviteCode).not.toHaveBeenCalled();
  });
});
