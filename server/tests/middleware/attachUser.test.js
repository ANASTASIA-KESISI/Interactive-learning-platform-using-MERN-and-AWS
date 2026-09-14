// Deactivation is immediate on the API because of this middleware, not because
// of Cognito: a token issued before AdminDisableUser stays valid until it
// expires, so the Mongo `isActive` mirror is checked on every request (S8 D3).

jest.mock('../../src/services/authService', () => ({ syncUserFromClaims: jest.fn() }));

const authService = require('../../src/services/authService');
const { attachUser, ACCOUNT_DEACTIVATED } = require('../../src/middleware/attachUser');

const runMiddleware = (req) =>
  new Promise((resolve) => {
    attachUser(req, {}, (err) => resolve(err));
  });

const authUser = { cognitoId: 'cog-1', email: 'sam@example.com', role: 'student', claims: {} };

beforeEach(() => jest.clearAllMocks());

describe('attachUser middleware', () => {
  test('401s without an authenticated user', async () => {
    const err = await runMiddleware({});

    expect(err.status).toBe(401);
    expect(authService.syncUserFromClaims).not.toHaveBeenCalled();
  });

  test('attaches the synced Mongo user', async () => {
    const dbUser = { _id: 'u1', isActive: true };
    authService.syncUserFromClaims.mockResolvedValue(dbUser);
    const req = { user: authUser };

    const err = await runMiddleware(req);

    expect(err).toBeUndefined();
    expect(req.dbUser).toBe(dbUser);
  });

  test('treats an account created before the flag existed as active', async () => {
    const dbUser = { _id: 'u1' };
    authService.syncUserFromClaims.mockResolvedValue(dbUser);
    const req = { user: authUser };

    const err = await runMiddleware(req);

    expect(err).toBeUndefined();
    expect(req.dbUser).toBe(dbUser);
  });

  test('rejects a deactivated account with 403 and the deactivation code', async () => {
    authService.syncUserFromClaims.mockResolvedValue({ _id: 'u1', isActive: false });
    const req = { user: authUser };

    const err = await runMiddleware(req);

    expect(err.status).toBe(403);
    expect(err.message).toBe('This account has been deactivated');
    expect(err.details).toEqual({ code: ACCOUNT_DEACTIVATED });
    expect(req.dbUser).toBeUndefined();
  });

  test('passes a sync failure to the error handler', async () => {
    authService.syncUserFromClaims.mockRejectedValue(new Error('mongo down'));

    const err = await runMiddleware({ user: authUser });

    expect(err.message).toBe('mongo down');
  });
});
