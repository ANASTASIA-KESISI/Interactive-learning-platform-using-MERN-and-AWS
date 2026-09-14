// `onLessonCompleted` against mocked models: what each lesson type does to the
// per-user counters the badges read. The pure helpers it composes are covered
// in gamificationService.test.js.

jest.mock('../../src/models/User', () => ({ User: { findById: jest.fn() } }));
jest.mock('../../src/models/Badge', () => ({ Badge: { find: jest.fn() } }));

const { User } = require('../../src/models/User');
const { Badge } = require('../../src/models/Badge');
const { onLessonCompleted } = require('../../src/services/gamificationService');

const makeUser = () => ({
  xpPoints: 0,
  streak: 0,
  lastCompletionAt: null,
  badges: [],
  badgeAwards: [],
  lessonsCompleted: 0,
  unaidedCompletions: 0,
  quizzesPassed: 0,
  coursesCompleted: 0,
  save: jest.fn().mockResolvedValue(undefined),
});

describe('gamificationService.onLessonCompleted', () => {
  let user;

  beforeEach(() => {
    jest.clearAllMocks();
    user = makeUser();
    User.findById.mockResolvedValue(user);
    Badge.find.mockResolvedValue([]);
  });

  test('a tutorial awards its full XP and counts as a completed lesson', async () => {
    const result = await onLessonCompleted({
      userId: 'u1',
      xpReward: 15,
      hintsUsed: 0,
      lessonType: 'tutorial',
    });

    expect(result.xpDelta).toBe(15);
    expect(user.xpPoints).toBe(15);
    expect(user.lessonsCompleted).toBe(1);
    expect(user.streak).toBe(1);
    expect(user.save).toHaveBeenCalled();
  });

  test('a tutorial is not an unaided solve — there was nothing to be aided on', async () => {
    await onLessonCompleted({ userId: 'u1', xpReward: 15, hintsUsed: 0, lessonType: 'tutorial' });

    expect(user.unaidedCompletions).toBe(0);
  });

  test('an exercise passed without hints is an unaided solve', async () => {
    await onLessonCompleted({ userId: 'u1', xpReward: 20, hintsUsed: 0, lessonType: 'exercise' });

    expect(user.unaidedCompletions).toBe(1);
    expect(user.xpPoints).toBe(20);
  });

  test('an exercise passed after a hint is neither unaided nor full XP', async () => {
    const result = await onLessonCompleted({
      userId: 'u1',
      xpReward: 20,
      hintsUsed: 1,
      lessonType: 'exercise',
    });

    expect(result.xpDelta).toBe(10);
    expect(user.unaidedCompletions).toBe(0);
  });

  test("an exercise's own hint cost decides the discounted XP", async () => {
    const result = await onLessonCompleted({
      userId: 'u1',
      xpReward: 20,
      hintsUsed: 2,
      hintXp: { afterOne: 75, afterMore: 50 },
      lessonType: 'exercise',
    });

    expect(result.xpDelta).toBe(10);
    expect(user.xpPoints).toBe(10);
  });

  test('a quiz pass bumps quizzesPassed', async () => {
    await onLessonCompleted({ userId: 'u1', xpReward: 10, lessonType: 'quiz' });

    expect(user.quizzesPassed).toBe(1);
  });

  test('a completion that finishes the course bumps coursesCompleted', async () => {
    await onLessonCompleted({
      userId: 'u1',
      xpReward: 10,
      lessonType: 'tutorial',
      courseCompleted: true,
    });

    expect(user.coursesCompleted).toBe(1);
  });

  test('an unknown user awards nothing', async () => {
    User.findById.mockResolvedValue(null);

    const result = await onLessonCompleted({ userId: 'nope', xpReward: 10 });

    expect(result).toEqual({ xpDelta: 0, newBadges: [] });
  });
});
