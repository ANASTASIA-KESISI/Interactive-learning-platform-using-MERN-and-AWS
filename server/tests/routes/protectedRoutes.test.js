const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

// All protected routes must return 401 when no token is provided.
const protectedRoutes = [
  ['GET', '/api/courses'],
  ['GET', '/api/student/dashboard'],
  ['GET', '/api/student/progress'],
  ['POST', '/api/instructor/courses'],
  // Serves full lesson documents including expectedOutput and hint text — must
  // never be reachable unauthenticated (S5.5 B1).
  ['GET', '/api/instructor/lessons/000000000000000000000000'],
  ['GET', '/api/lessons/000000000000000000000000'],
  ['GET', '/api/admin/kpis'],
  ['GET', '/api/admin/users'],
];

describe('Protected routes — no token', () => {
  test.each(protectedRoutes)('%s %s → 401', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
  });
});
