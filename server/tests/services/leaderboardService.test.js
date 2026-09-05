// Course leaderboard (S7 D9). The service joins DynamoDB progress rows to Mongo
// users, so both sides are mocked: these assert the windowing, grouping,
// ranking, tiebreak and name formatting, not persistence.

jest.mock('../../src/models/User', () => ({ User: { find: jest.fn() } }));
jest.mock('../../src/services/courseService', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/dynamo/progressTable', () => ({ scanByLessonIds: jest.fn() }));

const { User } = require('../../src/models/User');
const courseService = require('../../src/services/courseService');
const progressTable = require('../../src/dynamo/progressTable');
const leaderboardService = require('../../src/services/leaderboardService');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

// Mongoose query builders are chainable and thenable; this fakes just enough of
// that surface for the `.select().lean()` chain the service uses.
const query = (result) => {
  const chain = {
    select: () => chain,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

const courseWithLessons = (lessonIds) => ({
  _id: 'course1',
  modules: [{ lessons: lessonIds.map((id) => ({ _id: id })) }],
});

const done = (userId, lessonId, completedAt) => ({
  userId,
  lessonId,
  status: 'completed',
  completedAt,
});

const mockUsers = (users) => User.find.mockReturnValue(query(users));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  courseService.getCourseById.mockResolvedValue(courseWithLessons(['l1', 'l2', 'l3']));
  mockUsers([]);
});

afterEach(() => jest.restoreAllMocks());

describe('windowing', () => {
  beforeEach(() => {
    progressTable.scanByLessonIds.mockResolvedValue([
      done('u1', 'l1', daysAgo(1)),
      done('u1', 'l2', daysAgo(10)),
      done('u1', 'l3', daysAgo(100)),
    ]);
  });

  test('7d counts only completions inside the last week', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });

    expect(board.window).toBe('7d');
    expect(board.top[0].completions).toBe(1);
  });

  test('30d widens the window', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '30d' });

    expect(board.top[0].completions).toBe(2);
  });

  test('all applies no cutoff', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: 'all' });

    expect(board.top[0].completions).toBe(3);
  });

  test('defaults to 7d', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1');

    expect(board.window).toBe('7d');
    expect(board.top[0].completions).toBe(1);
  });

  test('rejects an unsupported window', async () => {
    await expect(
      leaderboardService.getCourseLeaderboard('course1', { window: '90d' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('grouping', () => {
  test('counts completions per learner and ignores everything else', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      done('u1', 'l1', daysAgo(1)),
      done('u1', 'l2', daysAgo(2)),
      done('u2', 'l1', daysAgo(1)),
      { userId: 'u3', lessonId: 'l1', status: 'in_progress', attempts: 4 },
      // A completed row with no usable timestamp cannot be placed in a window.
      { userId: 'u4', lessonId: 'l2', status: 'completed' },
      { userId: 'u5', lessonId: 'l3', status: 'completed', completedAt: 'not-a-date' },
    ]);

    const board = await leaderboardService.getCourseLeaderboard('course1', { window: 'all' });

    expect(board.top.map((r) => [r.userId, r.completions])).toEqual([
      ['u1', 2],
      ['u2', 1],
    ]);
  });

  test('skips the Dynamo scan when the course has no lessons', async () => {
    courseService.getCourseById.mockResolvedValue({ _id: 'course1', modules: [] });

    const board = await leaderboardService.getCourseLeaderboard('course1', { viewerId: 'u1' });

    expect(progressTable.scanByLessonIds).not.toHaveBeenCalled();
    expect(board).toEqual({ window: '7d', top: [], me: { rank: null, completions: 0 } });
  });

  test('passes the resolved lesson ids to the scan', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([]);

    await leaderboardService.getCourseLeaderboard('course1');

    expect(progressTable.scanByLessonIds).toHaveBeenCalledWith(['l1', 'l2', 'l3']);
  });
});

describe('ranking', () => {
  test('orders by completions descending and ranks from 1', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      done('low', 'l1', daysAgo(1)),
      done('high', 'l1', daysAgo(1)),
      done('high', 'l2', daysAgo(1)),
      done('high', 'l3', daysAgo(2)),
      done('mid', 'l1', daysAgo(1)),
      done('mid', 'l2', daysAgo(1)),
    ]);

    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });

    expect(board.top.map((r) => [r.userId, r.rank])).toEqual([
      ['high', 1],
      ['mid', 2],
      ['low', 3],
    ]);
  });

  test('breaks a tie in favour of the earlier last completion', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      done('slow', 'l1', daysAgo(5)),
      done('slow', 'l2', daysAgo(1)),
      done('fast', 'l1', daysAgo(6)),
      done('fast', 'l2', daysAgo(3)),
    ]);

    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });

    expect(board.top.map((r) => r.userId)).toEqual(['fast', 'slow']);
  });

  test('returns at most five rows', async () => {
    progressTable.scanByLessonIds.mockResolvedValue(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].map((u, i) =>
        done(u, 'l1', daysAgo(i + 1)),
      ),
    );

    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '30d' });

    expect(board.top).toHaveLength(5);
    expect(board.top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('the viewer row', () => {
  const sevenLearners = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];

  test('is present with a real rank even when outside the top five', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      ...sevenLearners.flatMap((u, i) =>
        // u1 completes 7, u2 6 … u7 1, so the caller (u7) lands last.
        Array.from({ length: sevenLearners.length - i }, (_, k) =>
          done(u, `l${k}`, daysAgo(1)),
        ),
      ),
    ]);

    const board = await leaderboardService.getCourseLeaderboard('course1', {
      window: '7d',
      viewerId: 'u7',
    });

    expect(board.top.map((r) => r.userId)).not.toContain('u7');
    expect(board.me).toEqual({ rank: 7, completions: 1 });
  });

  test('reports a null rank for a learner with no completions in the window', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([done('u1', 'l1', daysAgo(1))]);

    const board = await leaderboardService.getCourseLeaderboard('course1', {
      window: '7d',
      viewerId: 'nobody',
    });

    expect(board.me).toEqual({ rank: null, completions: 0 });
  });

  test('looks up the viewer alongside the top five in a single query', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      ...sevenLearners.flatMap((u, i) =>
        Array.from({ length: sevenLearners.length - i }, (_, k) =>
          done(u, `l${k}`, daysAgo(1)),
        ),
      ),
    ]);

    await leaderboardService.getCourseLeaderboard('course1', { window: '7d', viewerId: 'u7' });

    expect(User.find).toHaveBeenCalledTimes(1);
    expect(User.find).toHaveBeenCalledWith({
      _id: { $in: ['u1', 'u2', 'u3', 'u4', 'u5', 'u7'] },
    });
  });
});

describe('display names', () => {
  beforeEach(() => {
    progressTable.scanByLessonIds.mockResolvedValue([
      done('full', 'l1', daysAgo(1)),
      done('firstOnly', 'l1', daysAgo(2)),
      done('emailOnly', 'l1', daysAgo(3)),
      done('blank', 'l1', daysAgo(4)),
      done('missing', 'l1', daysAgo(5)),
    ]);
    mockUsers([
      { _id: 'full', firstName: 'Ada', lastName: 'lovelace', avatar: 'a.png' },
      { _id: 'firstOnly', firstName: 'Grace', lastName: '  ' },
      { _id: 'emailOnly', email: 'alan.turing@uom.edu.gr' },
      { _id: 'blank', firstName: '', lastName: '', email: '' },
      // 'missing' has no user document at all (deleted account).
    ]);
  });

  test('formats a full name as "First L." and carries the avatar', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });
    const row = board.top.find((r) => r.userId === 'full');

    expect(row.displayName).toBe('Ada L.');
    expect(row.avatar).toBe('a.png');
  });

  test('falls back to the first name, then the email local part, then Learner', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });
    const byId = Object.fromEntries(board.top.map((r) => [r.userId, r.displayName]));

    expect(byId.firstOnly).toBe('Grace');
    expect(byId.emailOnly).toBe('alan.turing');
    expect(byId.blank).toBe('Learner');
    expect(byId.missing).toBe('Learner');
  });

  test('leaves the avatar null when the learner has none', async () => {
    const board = await leaderboardService.getCourseLeaderboard('course1', { window: '7d' });

    expect(board.top.find((r) => r.userId === 'firstOnly').avatar).toBeNull();
  });
});

describe('draft visibility', () => {
  test('passes the viewer through to the course lookup', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([]);

    await leaderboardService.getCourseLeaderboard('course1', {
      viewerId: 'owner1',
      viewerRole: 'instructor',
    });

    expect(courseService.getCourseById).toHaveBeenCalledWith('course1', {
      id: 'owner1',
      role: 'instructor',
    });
  });
});
