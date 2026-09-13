// Course lifecycle routes (S8 D1/D2): the admin publish toggle must refuse a
// course that fails the publish rule with the service's 409 message, and the
// two delete routes must pass the caller's identity and role through so the
// service can decide ownership. Models are mocked, so the real service runs
// underneath — these are the status codes a client actually sees.
//
// `requireAuth` / `attachUser` are mocked to skip JWKS and Mongo, the same
// shape as the rest of the route suites, but read the caller from two test
// headers so one app instance can play owner, intruder and admin.

jest.mock('../../src/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      cognitoId: 'cog-1',
      email: 'sam@example.com',
      role: req.headers['x-test-role'] || 'instructor',
      claims: {},
    };
    next();
  },
}));

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    const id = req.headers['x-test-user'] || 'owner1';
    req.dbUser = { _id: { toString: () => id }, role: req.user.role };
    next();
  },
}));

jest.mock('../../src/models/Course', () => ({
  Course: { findById: jest.fn(), deleteOne: jest.fn() },
}));
jest.mock('../../src/models/Module', () => ({
  Module: { find: jest.fn(), deleteMany: jest.fn() },
}));
jest.mock('../../src/models/Lesson', () => ({ Lesson: { deleteMany: jest.fn() } }));
jest.mock('../../src/models/User', () => ({
  User: { updateMany: jest.fn() },
  ROLES: ['student', 'instructor', 'admin'],
}));
jest.mock('../../src/models/Note', () => ({ Note: { deleteMany: jest.fn() } }));
jest.mock('../../src/models/Message', () => ({ Message: { deleteMany: jest.fn() } }));

const request = require('supertest');
const { Course } = require('../../src/models/Course');
const { Module } = require('../../src/models/Module');
const { Lesson } = require('../../src/models/Lesson');
const { User } = require('../../src/models/User');
const { Note } = require('../../src/models/Note');
const { Message } = require('../../src/models/Message');
const { createApp } = require('../../src/app');

const app = createApp();

// Mongoose query builders are chainable and thenable; this fakes just enough
// of that surface for the `.select().sort().lean()` and bare-await chains.
const query = (result) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

const course = (overrides = {}) => ({
  _id: 'course1',
  title: 'JS Basics',
  instructor: { toString: () => 'owner1' },
  isPublished: false,
  modules: ['m1'],
  save: jest.fn().mockImplementation(function save() {
    return Promise.resolve(this);
  }),
  ...overrides,
});

const as = (role, id) => ({ 'x-test-role': role, 'x-test-user': id });
const owner = as('instructor', 'owner1');
const intruder = as('instructor', 'someone-else');
const admin = as('admin', 'admin1');

const primeCascade = () => {
  Lesson.deleteMany.mockResolvedValue({ deletedCount: 3 });
  Module.deleteMany.mockResolvedValue({ deletedCount: 1 });
  Note.deleteMany.mockResolvedValue({ deletedCount: 2 });
  Message.deleteMany.mockResolvedValue({ deletedCount: 0 });
  User.updateMany.mockResolvedValue({ modifiedCount: 4 });
  Course.deleteOne.mockResolvedValue({ deletedCount: 1 });
};

beforeEach(() => jest.clearAllMocks());

describe('PATCH /api/admin/courses/:id/publish', () => {
  test('409 with the rule message when the course has no modules', async () => {
    Course.findById.mockReturnValue(query(course({ modules: [] })));

    const res = await request(app)
      .patch('/api/admin/courses/course1/publish')
      .set(admin)
      .send({ isPublished: true });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Add at least one module before publishing');
  });

  test('409 naming the empty module', async () => {
    Course.findById.mockReturnValue(query(course()));
    Module.find.mockReturnValue(query([{ _id: 'm1', title: 'Week 1', lessons: [] }]));

    const res = await request(app)
      .patch('/api/admin/courses/course1/publish')
      .set(admin)
      .send({ isPublished: true });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Every module needs at least one lesson/);
    expect(res.body.error.message).toContain('Week 1');
  });

  test('200 and published when the rule holds', async () => {
    Course.findById.mockReturnValue(query(course()));
    Module.find.mockReturnValue(query([{ _id: 'm1', title: 'Week 1', lessons: ['l1'] }]));

    const res = await request(app)
      .patch('/api/admin/courses/course1/publish')
      .set(admin)
      .send({ isPublished: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isPublished).toBe(true);
  });

  test('unpublishing needs no precondition', async () => {
    Course.findById.mockReturnValue(query(course({ isPublished: true, modules: [] })));

    const res = await request(app)
      .patch('/api/admin/courses/course1/publish')
      .set(admin)
      .send({ isPublished: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isPublished).toBe(false);
    expect(Module.find).not.toHaveBeenCalled();
  });

  test('403 for a non-admin', async () => {
    const res = await request(app)
      .patch('/api/admin/courses/course1/publish')
      .set(owner)
      .send({ isPublished: true });

    expect(res.status).toBe(403);
    expect(Course.findById).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/instructor/courses/:id', () => {
  test('403 for an instructor who does not own the course', async () => {
    Course.findById.mockReturnValue(query(course()));

    const res = await request(app).delete('/api/instructor/courses/course1').set(intruder);

    expect(res.status).toBe(403);
    expect(Course.deleteOne).not.toHaveBeenCalled();
  });

  test('409 while the course is published', async () => {
    Course.findById.mockReturnValue(query(course({ isPublished: true })));

    const res = await request(app).delete('/api/instructor/courses/course1').set(owner);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Unpublish the course before deleting it');
    expect(Course.deleteOne).not.toHaveBeenCalled();
  });

  test('200 with the cascade counts for the owner', async () => {
    Course.findById.mockReturnValue(query(course()));
    primeCascade();

    const res = await request(app).delete('/api/instructor/courses/course1').set(owner);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      deletedCourseId: 'course1',
      deletedModules: 1,
      deletedLessons: 3,
      deletedNotes: 2,
      deletedMessages: 0,
      unenrolledUsers: 4,
    });
    expect(User.updateMany).toHaveBeenCalledWith(
      { enrolledCourses: 'course1' },
      { $pull: { enrolledCourses: 'course1' } },
    );
  });

  test('404 for an unknown course', async () => {
    Course.findById.mockReturnValue(query(null));

    const res = await request(app).delete('/api/instructor/courses/nope').set(owner);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/courses/:id', () => {
  test('403 for a non-admin', async () => {
    const res = await request(app).delete('/api/admin/courses/course1').set(owner);

    expect(res.status).toBe(403);
    expect(Course.findById).not.toHaveBeenCalled();
  });

  test('409 while the course is published', async () => {
    Course.findById.mockReturnValue(query(course({ isPublished: true })));

    const res = await request(app).delete('/api/admin/courses/course1').set(admin);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Unpublish the course before deleting it');
  });

  test('200 with counts for a draft the admin does not own', async () => {
    Course.findById.mockReturnValue(query(course()));
    primeCascade();

    const res = await request(app).delete('/api/admin/courses/course1').set(admin);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedCourseId).toBe('course1');
    expect(res.body.data.deletedLessons).toBe(3);
    expect(Course.deleteOne).toHaveBeenCalledWith({ _id: 'course1' });
  });
});
