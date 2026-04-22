const request = require('supertest');
const { createApp } = require('../../src/app');

describe('GET /health', () => {
  const app = createApp();

  test('returns ok status payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      mongo: expect.any(String),
    });
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('Unknown route', () => {
  const app = createApp();

  test('returns 404 json error envelope', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/Route not found/);
  });
});
