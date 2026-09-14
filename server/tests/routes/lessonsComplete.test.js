// POST /api/lessons/:id/complete — the completion path for `type: 'tutorial'`
// lessons. Before it existed a tutorial could not be finished at all: no
// progress record, no XP, no contribution to module or course completion.
// What matters here is that it is really the same award path as /submit and
// /quiz (first completion only, students only) and that it cannot be used to
// claim an exercise's or a quiz's XP without passing it.

let mockViewer = null;
let mockDbUser = null;

jest.mock('../../src/middleware/requireAuth', () => {
  const actual = jest.requireActual('../../src/middleware/requireAuth');
  return {
    requireAuth: (req, res, next) => {
      if (!mockViewer) return actual.requireAuth(req, res, next);
      req.user = mockViewer;
      return next();
    },
  };
});

jest.mock('../../src/middleware/attachUser', () => ({
  attachUser: (req, _res, next) => {
    req.dbUser = mockDbUser;
    next();
  },
}));

jest.mock('../../src/services/courseService', () => ({
  getLessonById: jest.fn(),
  getLessonContext: jest.fn(),
}));

jest.mock('../../src/services/progressService', () => ({
  recordCompletion: jest.fn(),
  getStudentProgress: jest.fn(),
}));

jest.mock('../../src/services/gamificationService', () => {
  const actual = jest.requireActual('../../src/services/gamificationService');
  return {
    ...actual,
    onLessonCompleted: jest.fn(),
  };
});

jest.mock('../../src/services/authService', () => ({
  getByCognitoId: jest.fn(),
}));

const request = require('supertest');
const courseService = require('../../src/services/courseService');
const progressService = require('../../src/services/progressService');
const gamificationService = require('../../src/services/gamificationService');
const authService = require('../../src/services/authService');
const { createApp } = require('../../src/app');

const app = createApp();

const LESSON_ID = '000000000000000000000000';
const NEXT_ID = '000000000000000000000001';
const url = `/api/lessons/${LESSON_ID}/complete`;

const asRole = (role) => {
  mockViewer = { cognitoId: 'cog-1', email: 'sam@example.com', role, claims: {} };
  mockDbUser = { _id: { toString: () => 'user1' }, role, xpPoints: 0, streak: 0 };
};

beforeEach(() => {
  mockViewer = null;
  mockDbUser = null;
  jest.clearAllMocks();
  courseService.getLessonById.mockResolvedValue({
    _id: LESSON_ID,
    type: 'tutorial',
    xpReward: 15,
  });
  courseService.getLessonContext.mockResolvedValue({
    nextLessonId: NEXT_ID,
    moduleLessonIds: [LESSON_ID, NEXT_ID],
    courseLessonIds: [LESSON_ID, NEXT_ID],
  });
  progressService.recordCompletion.mockResolvedValue({
    attempts: 0,
    status: 'completed',
    firstCompletion: true,
    hintsUsed: 0,
  });
  progressService.getStudentProgress.mockResolvedValue([]);
  gamificationService.onLessonCompleted.mockResolvedValue({ xpDelta: 15, newBadges: [] });
  authService.getByCognitoId.mockResolvedValue({ xpPoints: 15, streak: 1 });
});

describe('POST /api/lessons/:id/complete', () => {
  test('401 without a token', async () => {
    const res = await request(app).post(url).send({});

    expect(res.status).toBe(401);
    expect(progressService.recordCompletion).not.toHaveBeenCalled();
  });

  test('a first completion records progress and awards the tutorial XP', async () => {
    asRole('student');

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(200);
    expect(progressService.recordCompletion).toHaveBeenCalledWith('user1', LESSON_ID);
    expect(gamificationService.onLessonCompleted).toHaveBeenCalledWith({
      userId: mockDbUser._id,
      xpReward: 15,
      hintsUsed: 0,
      lessonType: 'tutorial',
      courseCompleted: false,
    });
    expect(res.body.data.xpDelta).toBe(15);
    expect(res.body.data.progress.firstCompletion).toBe(true);
    expect(res.body.data.nextLessonId).toBe(NEXT_ID);
    // Summarised from the re-read user, not the stale one attachUser loaded.
    expect(res.body.data.gamification.xpPoints).toBe(15);
    expect(res.body.data.gamification.streak).toBe(1);
  });

  test('finishing the last lesson of a module and course flags both', async () => {
    asRole('student');
    progressService.getStudentProgress.mockResolvedValue([
      { lessonId: NEXT_ID, status: 'completed' },
    ]);

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.moduleCompleted).toBe(true);
    expect(gamificationService.onLessonCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ courseCompleted: true }),
    );
  });

  test('marking a tutorial complete a second time awards nothing', async () => {
    asRole('student');
    progressService.recordCompletion.mockResolvedValue({
      attempts: 0,
      status: 'completed',
      firstCompletion: false,
      hintsUsed: 0,
    });

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(200);
    expect(gamificationService.onLessonCompleted).not.toHaveBeenCalled();
    expect(res.body.data.xpDelta).toBe(0);
    expect(res.body.data.progress.firstCompletion).toBe(false);
    expect(res.body.data.gamification).toEqual(
      expect.objectContaining({ xpPoints: 0, level: 1 }),
    );
  });

  test.each(['exercise', 'quiz'])('400 for a %s — its XP needs a pass', async (type) => {
    asRole('student');
    courseService.getLessonById.mockResolvedValue({ _id: LESSON_ID, type, xpReward: 15 });

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(400);
    expect(progressService.recordCompletion).not.toHaveBeenCalled();
    expect(gamificationService.onLessonCompleted).not.toHaveBeenCalled();
  });

  test.each(['instructor', 'admin'])('an %s previewing records nothing', async (role) => {
    asRole(role);

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(200);
    expect(progressService.recordCompletion).not.toHaveBeenCalled();
    expect(gamificationService.onLessonCompleted).not.toHaveBeenCalled();
    expect(res.body.data.progress).toEqual({ previewMode: true });
    expect(res.body.data.gamification).toBeNull();
  });
});
