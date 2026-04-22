const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

// All protected routes must return 401 when no token is provided.
const protectedRoutes = [
  ['GET', '/api/courses'],
  ['GET', '/api/student/dashboard'],
  ['GET', '/api/student/progress'],
  ['POST', '/api/instructor/courses'],
  ['GET', '/api/admin/kpis'],
  ['GET', '/api/admin/users'],
];

describe('Protected routes — no token', () => {
  test.each(protectedRoutes)('%s %s → 401', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
  });
});
