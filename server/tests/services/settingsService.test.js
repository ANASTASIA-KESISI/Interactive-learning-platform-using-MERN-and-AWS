// The instructor invite code moved from the environment into Mongo (S9) so
// an admin can rotate it from the panel. Worth pinning: the precedence
// (a saved document — even an empty one — beats the environment seed), the
// `source` the panel keys its explanation on, and the write-side validation
// that keeps a rotated code guess-resistant. The model is mocked; these are
// the service's own rules, not persistence.

jest.mock('../../src/models/Setting', () => ({
  Setting: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
  SETTING_KEYS: ['instructorInviteCode'],
}));
jest.mock('../../src/config/env', () => ({
  env: { instructorInviteCode: '' },
}));

const { Setting } = require('../../src/models/Setting');
const { env } = require('../../src/config/env');
const settingsService = require('../../src/services/settingsService');

const lean = (doc) => ({ lean: () => Promise.resolve(doc) });

beforeEach(() => {
  jest.clearAllMocks();
  env.instructorInviteCode = '';
  Setting.findOneAndUpdate.mockResolvedValue({});
});

describe('readInstructorInviteCode', () => {
  test('falls back to the environment seed when nothing has been saved', async () => {
    env.instructorInviteCode = 'seed-from-env';
    Setting.findOne.mockReturnValue(lean(null));

    await expect(settingsService.readInstructorInviteCode()).resolves.toMatchObject({
      code: 'seed-from-env',
      source: 'environment',
    });
  });

  test('reports "unset" when neither Mongo nor the environment has a code', async () => {
    Setting.findOne.mockReturnValue(lean(null));

    await expect(settingsService.readInstructorInviteCode()).resolves.toMatchObject({
      code: '',
      source: 'unset',
    });
  });

  test('a saved document wins over the environment', async () => {
    env.instructorInviteCode = 'seed-from-env';
    const updatedAt = new Date('2026-09-13T10:00:00Z');
    Setting.findOne.mockReturnValue(
      lean({ key: 'instructorInviteCode', value: 'saved-by-admin', updatedAt, updatedBy: 'admin1' }),
    );

    await expect(settingsService.readInstructorInviteCode()).resolves.toEqual({
      code: 'saved-by-admin',
      source: 'database',
      updatedAt,
      updatedBy: 'admin1',
    });
  });

  test('an admin-saved empty code disables self-signup even with an environment seed', async () => {
    env.instructorInviteCode = 'seed-from-env';
    Setting.findOne.mockReturnValue(lean({ key: 'instructorInviteCode', value: '' }));

    await expect(settingsService.getInstructorInviteCode()).resolves.toBe('');
  });
});

describe('setInstructorInviteCode', () => {
  test('trims and upserts a valid code, stamping the acting admin', async () => {
    Setting.findOne.mockReturnValue(lean({ key: 'instructorInviteCode', value: 'new-code-2026' }));

    const result = await settingsService.setInstructorInviteCode('  new-code-2026  ', 'admin1');

    expect(Setting.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'instructorInviteCode' },
      { $set: { value: 'new-code-2026', updatedBy: 'admin1' } },
      expect.objectContaining({ upsert: true }),
    );
    expect(result).toMatchObject({ code: 'new-code-2026', source: 'database' });
  });

  test('an empty (or whitespace-only) code is stored as a deliberate disable', async () => {
    Setting.findOne.mockReturnValue(lean({ key: 'instructorInviteCode', value: '' }));

    await settingsService.setInstructorInviteCode('   ', 'admin1');

    expect(Setting.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'instructorInviteCode' },
      { $set: { value: '', updatedBy: 'admin1' } },
      expect.anything(),
    );
  });

  test.each([
    ['too short', 'short'],
    ['too long', 'x'.repeat(settingsService.INVITE_CODE_MAX + 1)],
    ['contains whitespace', 'has a space in it'],
  ])('400 when the code is %s', async (_label, code) => {
    await expect(settingsService.setInstructorInviteCode(code, 'admin1')).rejects.toMatchObject({
      status: 400,
    });
    expect(Setting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('400 when the code is not a string', async () => {
    await expect(settingsService.setInstructorInviteCode(12345678, 'admin1')).rejects.toMatchObject({
      status: 400,
    });
    expect(Setting.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
