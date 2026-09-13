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

// Deactivation is a Cognito disable plus a Mongo mirror (S8 D3). The Cognito
// calls have to happen, in order, BEFORE the flag is written: the mirror must
// never claim a state identity does not hold.
describe('authService.setUserActive', () => {
  const commandNames = () => mockSend.mock.calls.map(([cmd]) => cmd.constructor.name);

  test('refuses to deactivate the acting admin', async () => {
    await expect(authService.setUserActive('admin1', false, 'admin1')).rejects.toMatchObject({
      status: 400,
      message: 'You cannot deactivate your own account',
    });
    expect(User.findById).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('compares ids by value, not identity', async () => {
    const objectId = { toString: () => 'admin1' };

    await expect(authService.setUserActive('admin1', false, objectId)).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects a non-boolean flag', async () => {
    await expect(authService.setUserActive('user1', 'no', 'admin1')).rejects.toMatchObject({
      status: 400,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('404s when the user does not exist', async () => {
    User.findById.mockResolvedValue(null);

    await expect(authService.setUserActive('nope', false, 'admin1')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('deactivating disables in Cognito, then signs out globally, then saves the flag', async () => {
    const user = mockUser({ isActive: true });
    User.findById.mockResolvedValue(user);
    mockSend.mockResolvedValue({});

    await authService.setUserActive('user1', false, 'admin1');

    expect(commandNames()).toEqual(['AdminDisableUserCommand', 'AdminUserGlobalSignOutCommand']);
    expect(mockSend.mock.calls[0][0].input).toEqual({
      UserPoolId: 'eu-west-1_test',
      Username: 'cognito-sub-1',
    });
    expect(mockSend.mock.calls[1][0].input).toEqual({
      UserPoolId: 'eu-west-1_test',
      Username: 'cognito-sub-1',
    });
    expect(user.isActive).toBe(false);
    expect(user.save).toHaveBeenCalled();
    // Cognito before Mongo.
    expect(mockSend.mock.invocationCallOrder[1]).toBeLessThan(
      user.save.mock.invocationCallOrder[0],
    );
  });

  test('reactivating enables in Cognito, with no sign-out, then saves the flag', async () => {
    const user = mockUser({ isActive: false });
    User.findById.mockResolvedValue(user);
    mockSend.mockResolvedValue({});

    await authService.setUserActive('user1', true, 'admin1');

    expect(commandNames()).toEqual(['AdminEnableUserCommand']);
    expect(user.isActive).toBe(true);
    expect(user.save).toHaveBeenCalled();
  });

  test('is a no-op when the flag is unchanged', async () => {
    const user = mockUser({ isActive: false });
    User.findById.mockResolvedValue(user);

    await authService.setUserActive('user1', false, 'admin1');

    expect(mockSend).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('treats an account without the flag as active', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);

    await authService.setUserActive('user1', true, 'admin1');

    expect(mockSend).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('leaves Mongo untouched when Cognito fails', async () => {
    const user = mockUser({ isActive: true });
    User.findById.mockResolvedValue(user);
    mockSend.mockRejectedValue(Object.assign(new Error('boom'), { name: 'TooManyRequestsException' }));

    await expect(authService.setUserActive('user1', false, 'admin1')).rejects.toThrow('boom');

    expect(user.isActive).toBe(true);
    expect(user.save).not.toHaveBeenCalled();
  });

  // Same trap as the missing group (S6 A3): a Console test passes while the
  // API's identity lacks the action. The 503 has to say what to attach.
  test('maps AccessDeniedException to a 503 naming the three cognito-idp actions', async () => {
    User.findById.mockResolvedValue(mockUser({ isActive: true }));
    mockSend.mockRejectedValue(
      Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' }),
    );

    const err = await authService.setUserActive('user1', false, 'admin1').catch((e) => e);

    expect(err.status).toBe(503);
    expect(err.message).toContain('cognito-idp:AdminDisableUser');
    expect(err.message).toContain('cognito-idp:AdminEnableUser');
    expect(err.message).toContain('cognito-idp:AdminUserGlobalSignOut');
    expect(err.message).toContain('learncode-runtime');
    expect(err.message).toContain('eu-west-1_test');
  });
});
