// Account deactivation routes (S8 D3): the admin toggle must be admin-only,
// validate its boolean, and pass the acting admin's id through so the service
// can refuse self-deactivation; and a deactivated account must be refused by
// the real `attachUser` on ANY protected route with the code the client keys
// on. `requireAuth` is mocked to skip JWKS and reads the caller from test
// headers; the service is mocked so no Cognito or Mongo is touched.

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
  setUserActive: jest.fn(),
  setUserRole: jest.fn(),
}));

const request = require('supertest');
const authService = require('../../src/services/authService');
const { badRequest } = require('../../src/utils/httpError');
const { createApp } = require('../../src/app');

const app = createApp();

const adminDoc = { _id: { toString: () => 'admin1' }, role: 'admin', isActive: true };

beforeEach(() => {
  jest.clearAllMocks();
  authService.syncUserFromClaims.mockResolvedValue(adminDoc);
});

describe('PATCH /api/admin/users/:id/active', () => {
  test('403 for a non-admin', async () => {
    authService.syncUserFromClaims.mockResolvedValue({ ...adminDoc, role: 'instructor' });

    const res = await request(app)
      .patch('/api/admin/users/user1/active')
      .set('x-test-role', 'instructor')
      .send({ isActive: false });

    expect(res.status).toBe(403);
    expect(authService.setUserActive).not.toHaveBeenCalled();
  });

  test.each([
    ['a string', 'false'],
    ['a number', 0],
    ['missing', undefined],
  ])('400 when isActive is %s', async (_label, isActive) => {
    const res = await request(app)
      .patch('/api/admin/users/user1/active')
      .send(isActive === undefined ? {} : { isActive });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('isActive must be a boolean');
    expect(authService.setUserActive).not.toHaveBeenCalled();
  });

  test('calls the service with the target, the flag and the acting admin id', async () => {
    authService.setUserActive.mockResolvedValue({ _id: 'user1', isActive: false });

    const res = await request(app)
      .patch('/api/admin/users/user1/active')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ _id: 'user1', isActive: false });
    expect(authService.setUserActive).toHaveBeenCalledWith('user1', false, adminDoc._id);
  });

  test('surfaces the service refusal of self-deactivation', async () => {
    authService.setUserActive.mockRejectedValue(
      badRequest('You cannot deactivate your own account'),
    );

    const res = await request(app)
      .patch('/api/admin/users/admin1/active')
      .send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('You cannot deactivate your own account');
  });
});

describe('a deactivated account', () => {
  test('is refused on any protected route with 403 and the ACCOUNT_DEACTIVATED code', async () => {
    authService.syncUserFromClaims.mockResolvedValue({
      _id: { toString: () => 'user1' },
      role: 'admin',
      isActive: false,
    });

    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      message: 'This account has been deactivated',
      details: { code: 'ACCOUNT_DEACTIVATED' },
    });
  });
});
