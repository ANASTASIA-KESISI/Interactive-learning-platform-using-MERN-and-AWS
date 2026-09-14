// `/api/me` write path. A department only means anything inside its university
// — the Courses page groups by `department.semesterCount` — so a mismatched
// pair must be refused rather than silently producing an empty course list.
// Models are mocked; this asserts the service's own validation, not Mongo's.

jest.mock('../../src/models/User', () => ({
  User: { findById: jest.fn() },
  ROLES: ['student', 'instructor', 'admin'],
}));
jest.mock('../../src/models/University', () => ({ University: { findById: jest.fn() } }));
jest.mock('../../src/models/Department', () => ({ Department: { findById: jest.fn() } }));

const { User } = require('../../src/models/User');
const { University } = require('../../src/models/University');
const { Department } = require('../../src/models/Department');
const profileService = require('../../src/services/profileService');

const UNI_A = '000000000000000000000a01';
const UNI_B = '000000000000000000000b01';
const DEPT_A = '000000000000000000000a02';
const DEPT_B = '000000000000000000000b02';

// Mongoose query builders are chainable and thenable; this fakes just enough
// of that surface for the `.lean()` calls the service makes.
const query = (result) => ({
  lean: () => Promise.resolve(result),
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
});

const makeUser = (overrides = {}) => ({
  _id: { toString: () => 'user1' },
  email: 'sam@example.com',
  firstName: 'Sam',
  lastName: 'Lee',
  role: 'student',
  xpPoints: 0,
  streak: 0,
  lessonsCompleted: 0,
  enrolledCourses: [],
  badges: [],
  universityId: null,
  departmentId: null,
  populate: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  University.findById.mockImplementation((id) =>
    query(id && id.toString() === UNI_A ? { _id: UNI_A, name: 'Uni A', code: 'UA' } : null),
  );
  Department.findById.mockImplementation((id) => {
    const key = id && id.toString();
    if (key === DEPT_A) {
      return query({ _id: DEPT_A, name: 'Dept A', code: 'DA', universityId: UNI_A });
    }
    if (key === DEPT_B) {
      return query({ _id: DEPT_B, name: 'Dept B', code: 'DB', universityId: UNI_B });
    }
    return query(null);
  });
});

describe('updateMe — university / department consistency', () => {
  test('accepts a department that belongs to the given university', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', { universityId: UNI_A, departmentId: DEPT_A });

    expect(user.universityId).toBe(UNI_A);
    expect(user.departmentId).toBe(DEPT_A);
    expect(user.save).toHaveBeenCalled();
  });

  test('rejects a department belonging to another university', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);

    await expect(
      profileService.updateMe('user1', { universityId: UNI_A, departmentId: DEPT_B }),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.save).not.toHaveBeenCalled();
  });

  test('validates a lone departmentId against the stored university', async () => {
    const user = makeUser({ universityId: UNI_A });
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', { departmentId: DEPT_A });
    expect(user.departmentId).toBe(DEPT_A);

    const other = makeUser({ universityId: UNI_A });
    User.findById.mockResolvedValue(other);
    await expect(
      profileService.updateMe('user1', { departmentId: DEPT_B }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('changing university clears a department that no longer matches', async () => {
    const user = makeUser({ universityId: UNI_B, departmentId: DEPT_B });
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', { universityId: UNI_A });

    expect(user.universityId).toBe(UNI_A);
    expect(user.departmentId).toBeNull();
  });

  test('keeps a still-valid department when the university is re-sent', async () => {
    const user = makeUser({ universityId: UNI_A, departmentId: DEPT_A });
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', { universityId: UNI_A });

    expect(user.departmentId).toBe(DEPT_A);
  });

  test('rejects an unknown university', async () => {
    User.findById.mockResolvedValue(makeUser());

    await expect(profileService.updateMe('user1', { universityId: UNI_B })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects a malformed id rather than letting Mongo cast-error into a 500', async () => {
    User.findById.mockResolvedValue(makeUser());

    await expect(
      profileService.updateMe('user1', { departmentId: 'not-an-id' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('clearing the university with null also clears the department', async () => {
    const user = makeUser({ universityId: UNI_A, departmentId: DEPT_A });
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', { universityId: null, departmentId: null });

    expect(user.universityId).toBeNull();
    expect(user.departmentId).toBeNull();
  });
});

describe('updateMe — allowlist and field validation', () => {
  test('ignores server-owned fields', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);

    await profileService.updateMe('user1', {
      firstName: 'Alex',
      role: 'admin',
      xpPoints: 99999,
      badges: ['forged'],
      enrolledCourses: ['forged'],
    });

    expect(user.firstName).toBe('Alex');
    expect(user.role).toBe('student');
    expect(user.xpPoints).toBe(0);
    expect(user.badges).toEqual([]);
    expect(user.enrolledCourses).toEqual([]);
  });

  test('rejects a bio over 500 characters', async () => {
    User.findById.mockResolvedValue(makeUser());

    await expect(profileService.updateMe('user1', { bio: 'x'.repeat(501) })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects a non-string name', async () => {
    User.findById.mockResolvedValue(makeUser());

    await expect(profileService.updateMe('user1', { firstName: 42 })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('404s for a user that no longer exists', async () => {
    User.findById.mockResolvedValue(null);

    await expect(profileService.updateMe('gone', { firstName: 'A' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('getMe', () => {
  test('returns the documented /api/me shape', async () => {
    const user = makeUser({
      xpPoints: 650,
      streak: 4,
      lessonsCompleted: 12,
      bio: 'Hello',
      avatar: null,
      badges: [{ toString: () => 'b1' }, { toString: () => 'b2' }],
      enrolledCourses: [{ toString: () => 'c1' }],
      universityId: { _id: { toString: () => UNI_A }, name: 'Uni A', code: 'UA' },
      departmentId: {
        _id: { toString: () => DEPT_A },
        name: 'Dept A',
        code: 'DA',
        semesterCount: 8,
      },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const me = await profileService.getMe(user);

    expect(me).toMatchObject({
      id: 'user1',
      email: 'sam@example.com',
      role: 'student',
      xpPoints: 650,
      streak: 4,
      lessonsCompleted: 12,
      level: 4,
      xpIntoLevel: 50,
      xpForNextLevel: 400,
      rank: 'Silver I',
      university: { id: UNI_A, name: 'Uni A', code: 'UA' },
      department: { id: DEPT_A, name: 'Dept A', code: 'DA', semesterCount: 8 },
      enrolledCourseIds: ['c1'],
      badgeCount: 2,
      unreadMessages: 0,
    });
  });

  test('nulls the institution block when the user has not chosen one', async () => {
    const me = await profileService.getMe(makeUser());
    expect(me.university).toBeNull();
    expect(me.department).toBeNull();
  });
});
