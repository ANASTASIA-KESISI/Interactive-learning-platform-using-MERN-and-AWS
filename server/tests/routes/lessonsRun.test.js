// POST /api/lessons/:id/run (S7 D10). "Run" is the experiment button: it
// executes the learner's code and shows stdout, but it does NOT validate, so
// the response must never carry `passed` or `expectedOutput` — a learner who
// could read the answer out of this endpoint would corrupt the pass-rate and
// hint-usage metrics the pilot evaluates (S5.5 B1). The other thing worth
// pinning is that the `runs` counter is telemetry: a Dynamo failure may not
// take the learner's output down with it.
//
// `requireAuth` is faked (a real token would need JWKS) but falls through to
// the real middleware when no viewer is set, so the 401 case still exercises
// the app's own rejection; `attachUser` is faked to skip Mongo, and the three
// services are mocked — the same shape as the other route suites.

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
}));

jest.mock('../../src/services/progressService', () => ({
  recordRun: jest.fn(),
}));

jest.mock('../../src/services/codeRunnerService', () => ({
  execute: jest.fn(),
}));

const request = require('supertest');
const courseService = require('../../src/services/courseService');
const progressService = require('../../src/services/progressService');
const codeRunnerService = require('../../src/services/codeRunnerService');
const { createApp } = require('../../src/app');

const app = createApp();

const LESSON_ID = '000000000000000000000000';
const url = `/api/lessons/${LESSON_ID}/run`;

const asRole = (role) => {
  mockViewer = { cognitoId: 'cog-1', email: 'sam@example.com', role, claims: {} };
  mockDbUser = { _id: { toString: () => 'user1' }, role };
};

beforeEach(() => {
  mockViewer = null;
  mockDbUser = null;
  courseService.getLessonById.mockResolvedValue({
    _id: LESSON_ID,
    language: 'javascript',
    expectedOutput: 'Hello, World!',
    xpReward: 10,
  });
  codeRunnerService.execute.mockResolvedValue({
    stdout: 'whatever the learner printed',
    error: null,
    durationMs: 12,
  });
  progressService.recordRun.mockResolvedValue({ runs: 1 });
});

describe('POST /api/lessons/:id/run', () => {
  test('401 without a token', async () => {
    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    expect(res.status).toBe(401);
    expect(codeRunnerService.execute).not.toHaveBeenCalled();
  });

  test('400 when code is missing', async () => {
    asRole('student');

    const res = await request(app).post(url).send({});

    expect(res.status).toBe(400);
    expect(codeRunnerService.execute).not.toHaveBeenCalled();
  });

  test('400 when code is not a string', async () => {
    asRole('student');

    const res = await request(app).post(url).send({ code: { toString: 'nope' } });

    expect(res.status).toBe(400);
    expect(codeRunnerService.execute).not.toHaveBeenCalled();
  });

  test('400 when code is an empty string', async () => {
    asRole('student');

    const res = await request(app).post(url).send({ code: '' });

    expect(res.status).toBe(400);
    expect(codeRunnerService.execute).not.toHaveBeenCalled();
  });

  test('a student run executes the code and bumps the runs counter', async () => {
    asRole('student');

    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    expect(res.status).toBe(200);
    expect(codeRunnerService.execute).toHaveBeenCalledWith('console.log(1);', 'javascript');
    expect(progressService.recordRun).toHaveBeenCalledWith('user1', LESSON_ID);
    expect(res.body.data.execution).toEqual({
      stdout: 'whatever the learner printed',
      error: null,
      durationMs: 12,
    });
  });

  test('an instructor previewing their own lesson records nothing', async () => {
    asRole('instructor');

    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    expect(res.status).toBe(200);
    expect(codeRunnerService.execute).toHaveBeenCalled();
    expect(progressService.recordRun).not.toHaveBeenCalled();
  });

  test('an admin previewing records nothing either', async () => {
    asRole('admin');

    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    expect(res.status).toBe(200);
    expect(progressService.recordRun).not.toHaveBeenCalled();
  });

  test('a failed runs write is swallowed — the learner still gets their output', async () => {
    asRole('student');
    progressService.recordRun.mockRejectedValue(new Error('DynamoDB unavailable'));

    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    expect(res.status).toBe(200);
    expect(res.body.data.execution.stdout).toBe('whatever the learner printed');
  });

  test('a runtime error is reported without a verdict', async () => {
    asRole('student');
    codeRunnerService.execute.mockResolvedValue({
      stdout: '',
      error: 'ReferenceError: x is not defined',
      durationMs: 4,
    });

    const res = await request(app).post(url).send({ code: 'x;' });

    expect(res.status).toBe(200);
    expect(res.body.data.execution.error).toMatch(/ReferenceError/);
    expect(res.body.data.execution).not.toHaveProperty('passed');
  });

  // The point of splitting run from submit: nothing here may hint at the answer.
  test('the response reveals neither a verdict nor the expected output', async () => {
    asRole('student');

    const res = await request(app).post(url).send({ code: 'console.log(1);' });

    const body = JSON.stringify(res.body);
    expect(res.body.data.execution).not.toHaveProperty('passed');
    expect(res.body.data).not.toHaveProperty('passed');
    expect(body).not.toMatch(/passed/);
    expect(body).not.toMatch(/expectedOutput/);
    expect(body).not.toMatch(/Hello, World!/);
  });

  test('the runner never sees the expected output', async () => {
    asRole('student');

    await request(app).post(url).send({ code: 'console.log(1);' });

    expect(codeRunnerService.execute).toHaveBeenCalledTimes(1);
    expect(codeRunnerService.execute.mock.calls[0]).toEqual(['console.log(1);', 'javascript']);
  });
});
