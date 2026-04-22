const { requireRole } = require('../../src/middleware/requireRole');

const runMiddleware = (mw, req) =>
  new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err));
  });

describe('requireRole middleware', () => {
  test('rejects requests without an authenticated user', async () => {
    const err = await runMiddleware(requireRole('student'), {});
    expect(err).toBeDefined();
    expect(err.status).toBe(401);
  });

  test('allows matching role', async () => {
    const req = { user: { role: 'student' } };
    const err = await runMiddleware(requireRole('student'), req);
    expect(err).toBeUndefined();
  });

  test('allows one of several allowed roles', async () => {
    const req = { user: { role: 'instructor' } };
    const err = await runMiddleware(requireRole(['instructor', 'admin']), req);
    expect(err).toBeUndefined();
  });

  test('forbids mismatched role with 403', async () => {
    const req = { user: { role: 'student' } };
    const err = await runMiddleware(requireRole('admin'), req);
    expect(err).toBeDefined();
    expect(err.status).toBe(403);
  });

  test('throws on unknown role in config', () => {
    expect(() => requireRole('superuser')).toThrow(/unknown roles/);
  });
});
