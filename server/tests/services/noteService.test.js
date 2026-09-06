// Notes are private user content (S7 P1-C). The properties worth regression
// cover are ownership scoping (one learner must never read or delete another's
// note), the empty-body delete, the 20 000-character cap, the server-side
// derivation of course/module/lesson placement, and the student-only DynamoDB
// stamp being best-effort. Mongoose models are mocked — these assert the
// service's own logic, not persistence, following courseService.test.js.

jest.mock('../../src/models/Note', () => ({
  Note: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    countDocuments: jest.fn(),
  },
  NOTE_SCOPES: ['lesson', 'module'],
  NOTE_BODY_MAX: 20_000,
}));
jest.mock('../../src/models/Lesson', () => ({ Lesson: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/Module', () => ({ Module: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/Course', () => ({ Course: { find: jest.fn() } }));
jest.mock('../../src/services/progressService', () => ({ recordNoteActivity: jest.fn() }));
jest.mock('../../src/services/gamificationService', () => ({ onNotesChanged: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { Note } = require('../../src/models/Note');
const gamificationService = require('../../src/services/gamificationService');
const { Lesson } = require('../../src/models/Lesson');
const { Module } = require('../../src/models/Module');
const { Course } = require('../../src/models/Course');
const progressService = require('../../src/services/progressService');
const logger = require('../../src/utils/logger');
const noteService = require('../../src/services/noteService');

// Same chainable/thenable stand-in for a Mongoose query builder as the course
// service tests use.
const query = (result) => {
  const chain = {
    populate: () => chain,
    select: () => chain,
    sort: () => chain,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

// The service validates id shape before it queries, so fixtures must look like
// real ObjectIds.
const id = (char) => char.repeat(24);
const ALICE = id('a');
const BOB = id('b');
const LESSON = id('c');
const MODULE = id('d');
const COURSE = id('e');
const NOTE_ID = id('f');

const lessonDoc = { _id: LESSON, title: 'The console & console.log', moduleId: MODULE };
const moduleDoc = { _id: MODULE, title: 'Getting Started', courseId: COURSE };

const storedNote = (overrides = {}) => ({
  _id: NOTE_ID,
  userId: ALICE,
  scope: 'lesson',
  targetId: LESSON,
  courseId: COURSE,
  moduleId: MODULE,
  lessonId: LESSON,
  body: 'remember that console.log does not need ;',
  createdAt: '2026-09-05T10:00:00.000Z',
  updatedAt: '2026-09-05T10:00:00.000Z',
  ...overrides,
});

// The happy path for a lesson upsert: the hierarchy resolves and the write
// returns the stored document.
const mockLessonChain = () => {
  Lesson.findById.mockReturnValue(query(lessonDoc));
  Module.findById.mockReturnValue(query(moduleDoc));
  Note.findOneAndUpdate.mockReturnValue(query(storedNote()));
};

beforeEach(() => jest.clearAllMocks());

describe('cross-user isolation', () => {
  test('getByTarget filters on the caller, not just the target', async () => {
    Note.findOne.mockReturnValue(query(null));

    const result = await noteService.getByTarget(BOB, 'lesson', LESSON);

    expect(result).toBeNull();
    expect(Note.findOne).toHaveBeenCalledWith({ userId: BOB, scope: 'lesson', targetId: LESSON });
  });

  test('getByTarget never reads a note without the userId in the filter', async () => {
    Note.findOne.mockReturnValue(query(storedNote()));

    await noteService.getByTarget(ALICE, 'lesson', LESSON);

    const [filter] = Note.findOne.mock.calls[0];
    expect(filter.userId).toBe(ALICE);
  });

  test('remove scopes the delete by userId', async () => {
    Note.findOneAndDelete.mockReturnValue(query(storedNote()));

    await noteService.remove(ALICE, NOTE_ID);

    expect(Note.findOneAndDelete).toHaveBeenCalledWith({ _id: NOTE_ID, userId: ALICE });
  });

  test("deleting someone else's note id is a 404, not a delete", async () => {
    // The filter includes Bob's id, so Alice's note does not match and Mongo
    // returns nothing — the service must not fall back to an unscoped delete.
    Note.findOneAndDelete.mockReturnValue(query(null));

    await expect(noteService.remove(BOB, NOTE_ID)).rejects.toMatchObject({ status: 404 });
    expect(Note.findOneAndDelete).toHaveBeenCalledTimes(1);
    expect(Note.findOneAndDelete).toHaveBeenCalledWith({ _id: NOTE_ID, userId: BOB });
  });

  test('listForUser only ever asks for the caller’s notes', async () => {
    Note.find.mockReturnValue(query([]));

    await noteService.listForUser(BOB);

    expect(Note.find).toHaveBeenCalledWith({ userId: BOB });
  });
});

describe('upsert — empty body deletes', () => {
  test('a whitespace-only body removes the note and says so', async () => {
    Note.findOneAndDelete.mockReturnValue(query(storedNote()));

    const result = await noteService.upsert(ALICE, 'lesson', LESSON, '   \n  ');

    expect(result).toEqual({ deleted: true, id: NOTE_ID });
    expect(Note.findOneAndDelete).toHaveBeenCalledWith({
      userId: ALICE,
      scope: 'lesson',
      targetId: LESSON,
    });
    expect(Note.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('clearing a note that was never saved is not an error', async () => {
    Note.findOneAndDelete.mockReturnValue(query(null));

    await expect(noteService.upsert(ALICE, 'lesson', LESSON, '')).resolves.toEqual({
      deleted: true,
      id: null,
    });
  });

  test('an empty body does not stamp progress', async () => {
    Note.findOneAndDelete.mockReturnValue(query(null));

    await noteService.upsert(ALICE, 'lesson', LESSON, '', { role: 'student' });

    expect(progressService.recordNoteActivity).not.toHaveBeenCalled();
  });
});

describe('upsert — validation', () => {
  test('rejects a body over the 20 000-character cap with a 400', async () => {
    await expect(
      noteService.upsert(ALICE, 'lesson', LESSON, 'x'.repeat(20_001)),
    ).rejects.toMatchObject({ status: 400 });
    expect(Note.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('accepts a body exactly at the cap', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'x'.repeat(20_000));

    expect(Note.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('rejects a non-string body', async () => {
    await expect(noteService.upsert(ALICE, 'lesson', LESSON, { evil: true })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects an unknown scope', async () => {
    await expect(noteService.upsert(ALICE, 'course', LESSON, 'hi')).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects a malformed target id before it reaches Mongo', async () => {
    await expect(noteService.upsert(ALICE, 'lesson', 'not-an-id', 'hi')).rejects.toMatchObject({
      status: 400,
    });
    expect(Lesson.findById).not.toHaveBeenCalled();
  });

  test('a lesson that does not exist is a 404', async () => {
    Lesson.findById.mockReturnValue(query(null));

    await expect(noteService.upsert(ALICE, 'lesson', LESSON, 'hi')).rejects.toMatchObject({
      status: 404,
    });
  });

  test('a module that does not exist is a 404', async () => {
    Module.findById.mockReturnValue(query(null));

    await expect(noteService.upsert(ALICE, 'module', MODULE, 'hi')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('upsert — placement is derived server-side', () => {
  test('walks Lesson -> Module -> Course for the denormalised refs', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text');

    const [filter, update] = Note.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: ALICE, scope: 'lesson', targetId: LESSON });
    expect(update.$set).toMatchObject({
      body: 'note text',
      courseId: COURSE,
      moduleId: MODULE,
      lessonId: LESSON,
    });
  });

  test('a module note carries no lessonId', async () => {
    Module.findById.mockReturnValue(query(moduleDoc));
    Note.findOneAndUpdate.mockReturnValue(
      query(storedNote({ scope: 'module', targetId: MODULE, lessonId: undefined })),
    );

    await noteService.upsert(ALICE, 'module', MODULE, 'module note');

    const [, update] = Note.findOneAndUpdate.mock.calls[0];
    expect(update.$set).not.toHaveProperty('lessonId');
    expect(update.$set.courseId).toBe(COURSE);
  });

  test('ignores course/module/lesson ids the caller tries to smuggle in', async () => {
    mockLessonChain();

    // The signature takes only (userId, scope, targetId, body): a caller who
    // posts `{ body, courseId: <someone else's course> }` has nowhere to put it,
    // and the route never forwards it. Anything stored comes from the walk.
    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', {
      role: 'student',
      courseId: id('1'),
      moduleId: id('2'),
    });

    const [, update] = Note.findOneAndUpdate.mock.calls[0];
    expect(update.$set.courseId).toBe(COURSE);
    expect(update.$set.moduleId).toBe(MODULE);
    expect(JSON.stringify(update)).not.toContain(id('1'));
  });

  test('trims the stored body', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, '  spaced out  ');

    expect(Note.findOneAndUpdate.mock.calls[0][1].$set.body).toBe('spaced out');
  });
});

describe('upsert — DynamoDB stamp (students only, best effort)', () => {
  test('stamps noteUpdatedAt for a student lesson note', async () => {
    mockLessonChain();
    progressService.recordNoteActivity.mockResolvedValue({ noteUpdatedAt: 'now' });

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', { role: 'student' });

    expect(progressService.recordNoteActivity).toHaveBeenCalledWith(ALICE, LESSON);
  });

  test('does not stamp for an instructor previewing their own lesson', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', { role: 'instructor' });

    expect(progressService.recordNoteActivity).not.toHaveBeenCalled();
  });

  test('does not stamp for an admin', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', { role: 'admin' });

    expect(progressService.recordNoteActivity).not.toHaveBeenCalled();
  });

  test('does not stamp a module note', async () => {
    Module.findById.mockReturnValue(query(moduleDoc));
    Note.findOneAndUpdate.mockReturnValue(query(storedNote({ scope: 'module', targetId: MODULE })));

    await noteService.upsert(ALICE, 'module', MODULE, 'module note', { role: 'student' });

    expect(progressService.recordNoteActivity).not.toHaveBeenCalled();
  });

  test('a Dynamo failure is logged and swallowed — the note still saves', async () => {
    mockLessonChain();
    progressService.recordNoteActivity.mockRejectedValue(new Error('throttled'));

    const result = await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', {
      role: 'student',
    });

    expect(result.body).toBe(storedNote().body);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('upsert — note badges (students only, best effort)', () => {
  beforeEach(() => {
    Note.countDocuments.mockResolvedValue(4);
  });

  test('reports the recounted total so a delete cannot leave it drifting', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', { role: 'student' });

    expect(Note.countDocuments).toHaveBeenCalledWith({ userId: ALICE });
    expect(gamificationService.onNotesChanged).toHaveBeenCalledWith({
      userId: ALICE,
      noteCount: 4,
    });
  });

  test('counts a module note too — the criterion is notes, not lessons', async () => {
    Module.findById.mockReturnValue(query(moduleDoc));
    Note.findOneAndUpdate.mockReturnValue(query(storedNote({ scope: 'module', targetId: MODULE })));

    await noteService.upsert(ALICE, 'module', MODULE, 'module note', { role: 'student' });

    expect(gamificationService.onNotesChanged).toHaveBeenCalled();
  });

  test('does not award for an instructor previewing their own lesson', async () => {
    mockLessonChain();

    await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', { role: 'instructor' });

    expect(gamificationService.onNotesChanged).not.toHaveBeenCalled();
  });

  test('an award failure is logged and swallowed — the note still saves', async () => {
    mockLessonChain();
    gamificationService.onNotesChanged.mockRejectedValue(new Error('mongo down'));

    const result = await noteService.upsert(ALICE, 'lesson', LESSON, 'note text', {
      role: 'student',
    });

    expect(result.body).toBe(storedNote().body);
    expect(logger.warn).toHaveBeenCalled();
  });
});
describe('listForUser', () => {
  const otherLesson = id('9');
  const otherModule = id('8');

  test('returns newest first with batched context and no per-note queries', async () => {
    const notes = [
      storedNote({ _id: id('1'), updatedAt: '2026-09-05T12:00:00.000Z' }),
      storedNote({
        _id: id('2'),
        scope: 'module',
        targetId: otherModule,
        moduleId: otherModule,
        lessonId: undefined,
        updatedAt: '2026-09-04T12:00:00.000Z',
      }),
      storedNote({ _id: id('3'), targetId: otherLesson, lessonId: otherLesson }),
    ];
    Note.find.mockReturnValue(query(notes));
    Course.find.mockReturnValue(query([{ _id: COURSE, title: 'JavaScript Basics', icon: 'JS' }]));
    Module.find.mockReturnValue(
      query([
        { _id: MODULE, title: 'Getting Started' },
        { _id: otherModule, title: 'Functions' },
      ]),
    );
    Lesson.find.mockReturnValue(
      query([
        { _id: LESSON, title: 'The console & console.log' },
        { _id: otherLesson, title: 'Arrow functions' },
      ]),
    );

    const result = await noteService.listForUser(ALICE);

    expect(Note.find).toHaveBeenCalledWith({ userId: ALICE });
    // One lookup per collection regardless of how many notes came back.
    expect(Course.find).toHaveBeenCalledTimes(1);
    expect(Module.find).toHaveBeenCalledTimes(1);
    expect(Lesson.find).toHaveBeenCalledTimes(1);
    // Deduplicated: three notes, one course, two modules, two lessons.
    expect(Course.find.mock.calls[0][0]._id.$in).toEqual([COURSE]);
    expect(Lesson.find.mock.calls[0][0]._id.$in).toEqual([LESSON, otherLesson]);

    expect(result).toHaveLength(3);
    expect(result[0].course).toEqual({ id: COURSE, title: 'JavaScript Basics', icon: 'JS' });
    expect(result[0].lesson).toEqual({ id: LESSON, title: 'The console & console.log' });
    expect(result[1].lesson).toBeNull();
    expect(result[1].module).toEqual({ id: otherModule, title: 'Functions' });
  });

  test('skips the lesson lookup when every note is module-scoped', async () => {
    Note.find.mockReturnValue(
      query([storedNote({ scope: 'module', targetId: MODULE, lessonId: undefined })]),
    );
    Course.find.mockReturnValue(query([]));
    Module.find.mockReturnValue(query([]));

    const result = await noteService.listForUser(ALICE);

    expect(Lesson.find).not.toHaveBeenCalled();
    expect(result[0].course).toBeNull();
    expect(result[0].lesson).toBeNull();
  });

  test('short-circuits with no notes', async () => {
    Note.find.mockReturnValue(query([]));

    await expect(noteService.listForUser(ALICE)).resolves.toEqual([]);
    expect(Course.find).not.toHaveBeenCalled();
  });
});
