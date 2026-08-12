// Roles live in Cognito groups, not Mongo: requireAuth derives the role from
// the `cognito:groups` claim and syncUserFromClaims mirrors it back on every
// request, so a Mongo-only write survives exactly until the user's next call
// (S5.5 finding A3). These cover the group manipulation that makes it stick.

jest.mock('../../src/models/User', () => ({
  User: { findById: jest.fn(), findOneAndUpdate: jest.fn(), findOne: jest.fn() },
  ROLES: ['student', 'instructor', 'admin'],
}));

// `jest.mock` factories are hoisted above this file's other statements, so the
// spy has to carry the `mock` prefix Jest allows them to close over.
const mockSend = jest.fn();
jest.mock('../../src/config/aws', () => ({ getCognitoClient: () => ({ send: mockSend }) }));

jest.mock('../../src/config/env', () => ({
  env: {
    assertCognitoConfigured: jest.fn(),
    aws: { region: 'eu-west-1', cognito: { userPoolId: 'eu-west-1_test' } },
  },
}));

const { User } = require('../../src/models/User');
const authService = require('../../src/services/authService');

// Commands are plain objects carrying `input`; the constructor name identifies
// which API call was issued.
const callsOf = (name) =>
  mockSend.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd.constructor.name === name);

const mockUser = (overrides = {}) => ({
  _id: 'user1',
  cognitoId: 'cognito-sub-1',
  role: 'student',
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ Groups: [] });
});

describe('authService.setUserRole', () => {
  test('rejects a role outside the known set', async () => {
    await expect(authService.setUserRole('user1', 'superadmin')).rejects.toMatchObject({
      status: 400,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('404s when the user does not exist', async () => {
    User.findById.mockResolvedValue(null);

    await expect(authService.setUserRole('nope', 'admin')).rejects.toMatchObject({ status: 404 });
  });

  test('adds the user to the target Cognito group', async () => {
    User.findById.mockResolvedValue(mockUser());

    await authService.setUserRole('user1', 'instructor');

    const [add] = callsOf('AdminAddUserToGroupCommand');
    expect(add.input).toEqual({
      UserPoolId: 'eu-west-1_test',
      Username: 'cognito-sub-1',
      GroupName: 'instructor',
    });
  });

  // resolveRole picks the highest-privilege group a user holds, so leaving the
  // old group attached would make a demotion silently ineffective.
  test('removes the previous role group before adding the new one', async () => {
    User.findById.mockResolvedValue(mockUser({ role: 'admin' }));
    mockSend.mockResolvedValueOnce({ Groups: [{ GroupName: 'admin' }] });

    await authService.setUserRole('user1', 'student');

    const [remove] = callsOf('AdminRemoveUserFromGroupCommand');
    expect(remove.input.GroupName).toBe('admin');
    expect(callsOf('AdminAddUserToGroupCommand')[0].input.GroupName).toBe('student');
  });

  test('leaves non-role groups alone', async () => {
    User.findById.mockResolvedValue(mockUser({ role: 'student' }));
    mockSend.mockResolvedValueOnce({
      Groups: [{ GroupName: 'student' }, { GroupName: 'pilot-cohort-a' }],
    });

    await authService.setUserRole('user1', 'instructor');

    const removed = callsOf('AdminRemoveUserFromGroupCommand').map((c) => c.input.GroupName);
    expect(removed).toEqual(['student']);
  });

  test('mirrors the new role into Mongo', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);

    await authService.setUserRole('user1', 'admin');

    expect(user.role).toBe('admin');
    expect(user.save).toHaveBeenCalled();
  });

  test('is a no-op when the user already holds the role', async () => {
    const user = mockUser({ role: 'instructor' });
    User.findById.mockResolvedValue(user);

    await authService.setUserRole('user1', 'instructor');

    expect(mockSend).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });
});
