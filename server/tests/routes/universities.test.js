// GET /api/universities is deliberately PUBLIC: the signup form needs the
// university/department tree before an account (and therefore a token) exists
// (S7 D4). This pins that — a stray `requireAuth` here would silently break
// signup, which no other test would catch.

jest.mock('../../src/models/University', () => ({ University: { find: jest.fn() } }));
jest.mock('../../src/models/Department', () => ({ Department: { find: jest.fn() } }));

const request = require('supertest');
const { University } = require('../../src/models/University');
const { Department } = require('../../src/models/Department');
const { createApp } = require('../../src/app');

const app = createApp();

// Mongoose query builders are chainable and thenable; this fakes the
// `.sort().lean()` chain the service uses.
const query = (result) => {
  const chain = {
    sort: () => chain,
    lean: () => Promise.resolve(result),
  };
  return chain;
};

describe('GET /api/universities', () => {
  test('serves the tree without a bearer token', async () => {
    University.find.mockReturnValue(
      query([{ _id: { toString: () => 'u1' }, name: 'University of Macedonia', code: 'UOM' }]),
    );
    Department.find.mockReturnValue(
      query([
        {
          _id: { toString: () => 'd1' },
          universityId: { toString: () => 'u1' },
          name: 'Applied Informatics',
          code: 'AI',
          semesterCount: 8,
        },
      ]),
    );

    const res = await request(app).get('/api/universities');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: 'u1',
        name: 'University of Macedonia',
        code: 'UOM',
        departments: [{ id: 'd1', name: 'Applied Informatics', code: 'AI', semesterCount: 8 }],
      },
    ]);
  });

  test('a university with no departments still lists', async () => {
    University.find.mockReturnValue(
      query([{ _id: { toString: () => 'u2' }, name: 'Empty U', code: 'EU' }]),
    );
    Department.find.mockReturnValue(query([]));

    const res = await request(app).get('/api/universities');

    expect(res.status).toBe(200);
    expect(res.body.data[0].departments).toEqual([]);
  });
});
