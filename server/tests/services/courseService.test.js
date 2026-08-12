// Regression coverage for the S5.5 hardening findings in the course/lesson
// service: B1 (answers must not reach the learner), B3 (mass assignment) and
// B4 (draft visibility). Mongoose models are mocked — these assert the service's
// own filtering logic, not persistence.

jest.mock('../../src/models/Course', () => ({
  Course: { findById: jest.fn(), create: jest.fn(), find: jest.fn() },
}));
jest.mock('../../src/models/Module', () => ({
  Module: { findById: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../../src/models/Lesson', () => ({
  Lesson: {
    findById: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    updateOne: jest.fn(),
  },
}));
jest.mock('../../src/models/User', () => ({ User: { findById: jest.fn() } }));

const { Course } = require('../../src/models/Course');
const { Module } = require('../../src/models/Module');
const { Lesson } = require('../../src/models/Lesson');
const courseService = require('../../src/services/courseService');

// Mongoose query builders are chainable and thenable; this fakes just enough of
// that surface for `.populate().populate()` / `.lean()` call chains.
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

beforeEach(() => jest.clearAllMocks());

describe('getLessonForStudent (B1 — answers stay server-side)', () => {
  const lessonDoc = {
    _id: 'lesson1',
    title: 'Print a greeting',
    type: 'exercise',
    content: '# Say hello',
    codeTemplate: 'console.log("")',
    expectedOutput: 'Hello, World!',
    hints: ['Use console.log', 'The text is "Hello, World!"'],
    xpReward: 10,
    moduleId: { _id: 'module1', courseId: { _id: 'course1', title: 'JS Basics' } },
  };

  test('omits expectedOutput entirely', async () => {
    Lesson.findById.mockReturnValue(query(lessonDoc));

    const result = await courseService.getLessonForStudent('lesson1');

    expect(result).not.toHaveProperty('expectedOutput');
  });

  test('replaces hint text with a count when nothing is revealed', async () => {
    Lesson.findById.mockReturnValue(query(lessonDoc));

    const result = await courseService.getLessonForStudent('lesson1');

    expect(result).not.toHaveProperty('hints');
    expect(result.hintCount).toBe(2);
    expect(result.revealedHints).toEqual([]);
  });

  test('replays only the hints the learner already unlocked', async () => {
    Lesson.findById.mockReturnValue(query(lessonDoc));

    const result = await courseService.getLessonForStudent('lesson1', 1);

    expect(result.revealedHints).toEqual(['Use console.log']);
    expect(result.hintCount).toBe(2);
  });

  test('clamps a revealed count beyond the available hints', async () => {
    Lesson.findById.mockReturnValue(query(lessonDoc));

    const result = await courseService.getLessonForStudent('lesson1', 99);

    expect(result.revealedHints).toHaveLength(2);
  });

  test('still resolves course context for deep links', async () => {
    Lesson.findById.mockReturnValue(query(lessonDoc));

    const result = await courseService.getLessonForStudent('lesson1');

    expect(result.courseId).toBe('course1');
    expect(result.courseTitle).toBe('JS Basics');
    expect(result.codeTemplate).toBe('console.log("")');
  });
});

describe('getCourseById (B4 — draft visibility)', () => {
  const draft = (instructorId) => ({
    _id: 'course1',
    isPublished: false,
    instructor: { _id: { toString: () => instructorId } },
  });

  test('hides an unpublished course from an unrelated viewer', async () => {
    Course.findById.mockReturnValue(query(draft('owner1')));

    await expect(
      courseService.getCourseById('course1', { id: 'someone-else', role: 'student' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('hides an unpublished course when no viewer is supplied', async () => {
    Course.findById.mockReturnValue(query(draft('owner1')));

    await expect(courseService.getCourseById('course1')).rejects.toMatchObject({ status: 404 });
  });

  test('shows the draft to its owning instructor', async () => {
    Course.findById.mockReturnValue(query(draft('owner1')));

    const result = await courseService.getCourseById('course1', {
      id: 'owner1',
      role: 'instructor',
    });

    expect(result._id).toBe('course1');
  });

  test('shows the draft to an admin', async () => {
    Course.findById.mockReturnValue(query(draft('owner1')));

    const result = await courseService.getCourseById('course1', {
      id: 'admin1',
      role: 'admin',
    });

    expect(result._id).toBe('course1');
  });

  test('published courses need no viewer', async () => {
    Course.findById.mockReturnValue(
      query({ _id: 'course1', isPublished: true, instructor: { _id: { toString: () => 'o' } } }),
    );

    const result = await courseService.getCourseById('course1');

    expect(result._id).toBe('course1');
  });
});

describe('mass assignment (B3 — server-owned fields are not client-writable)', () => {
  test('createCourse ignores instructor, isPublished and enrollmentCount', async () => {
    Course.create.mockResolvedValue({});

    await courseService.createCourse('realInstructor', {
      title: 'Course',
      description: 'Desc',
      instructor: 'attacker',
      isPublished: true,
      enrollmentCount: 9999,
    });

    expect(Course.create).toHaveBeenCalledWith({
      title: 'Course',
      description: 'Desc',
      instructor: 'realInstructor',
    });
  });

  test('updateCourse applies only whitelisted metadata', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const course = {
      instructor: { toString: () => 'owner1' },
      isPublished: false,
      enrollmentCount: 3,
      save,
    };
    Course.findById.mockReturnValue(query(course));

    await courseService.updateCourse('course1', 'owner1', {
      title: 'New title',
      isPublished: true,
      enrollmentCount: 9999,
    });

    expect(course.title).toBe('New title');
    expect(course.isPublished).toBe(false);
    expect(course.enrollmentCount).toBe(3);
    expect(save).toHaveBeenCalled();
  });

  test('updateLesson cannot re-parent a lesson to another module', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const lesson = { moduleId: 'module1', title: 'Old', save };
    Lesson.findById.mockReturnValue(query(lesson));
    Module.findById.mockReturnValue(query({ _id: 'module1', courseId: 'course1' }));
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );

    await courseService.updateLesson('lesson1', 'owner1', {
      title: 'New',
      moduleId: 'someone-elses-module',
      expectedOutput: 'ok',
    });

    expect(lesson.title).toBe('New');
    expect(lesson.moduleId).toBe('module1');
    expect(lesson.expectedOutput).toBe('ok'); // authoring field, legitimately writable
  });

  test('updateModule applies only whitelisted fields', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const module = { _id: 'module1', courseId: 'course1', title: 'Old', order: 3, save };
    Module.findById.mockReturnValue(query(module));
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );

    await courseService.updateModule('module1', 'owner1', {
      title: 'New',
      order: 99,
      courseId: 'elsewhere',
    });

    expect(module.title).toBe('New');
    expect(module.order).toBe(3);
    expect(module.courseId).toBe('course1');
  });

  test('module mutations are refused for a non-owner', async () => {
    Module.findById.mockReturnValue(query({ _id: 'module1', courseId: 'course1' }));
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );

    await expect(
      courseService.updateModule('module1', 'someone-else', { title: 'Hijack' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('addLesson keeps server-computed order and moduleId', async () => {
    Module.findById.mockReturnValue(
      query({ _id: 'module1', courseId: 'course1', lessons: [{}, {}], save: jest.fn() }),
    );
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );
    Lesson.create.mockResolvedValue({ _id: 'newLesson' });

    await courseService.addLesson('module1', 'owner1', {
      title: 'Lesson',
      type: 'exercise',
      order: 0,
      moduleId: 'elsewhere',
    });

    expect(Lesson.create).toHaveBeenCalledWith({
      title: 'Lesson',
      type: 'exercise',
      moduleId: 'module1',
      order: 2,
    });
  });
});

// `order` is derived from array length when appending, so a delete that leaves
// a gap would hand the next new item a colliding order. Deletions must renumber.
describe('deletion (S6 — deferred CRUD)', () => {
  test('deleteModule removes its lessons and detaches it from the course', async () => {
    const courseSave = jest.fn().mockResolvedValue(true);
    const course = {
      _id: 'course1',
      instructor: { toString: () => 'owner1' },
      modules: [
        { toString: () => 'module0' },
        { toString: () => 'module1' },
        { toString: () => 'module2' },
      ],
      save: courseSave,
    };
    Module.findById.mockReturnValue(
      query({ _id: 'module1', courseId: 'course1', lessons: ['l1', 'l2'] }),
    );
    Course.findById.mockReturnValue(query(course));

    const result = await courseService.deleteModule('module1', 'owner1');

    expect(Lesson.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['l1', 'l2'] } });
    expect(Module.deleteOne).toHaveBeenCalledWith({ _id: 'module1' });
    expect(course.modules.map((m) => m.toString())).toEqual(['module0', 'module2']);
    expect(result.deletedLessons).toBe(2);
  });

  test('deleteModule renumbers the surviving modules densely', async () => {
    const course = {
      _id: 'course1',
      instructor: { toString: () => 'owner1' },
      modules: [
        { toString: () => 'module0' },
        { toString: () => 'module1' },
        { toString: () => 'module2' },
      ],
      save: jest.fn().mockResolvedValue(true),
    };
    Module.findById.mockReturnValue(query({ _id: 'module1', courseId: 'course1', lessons: [] }));
    Course.findById.mockReturnValue(query(course));

    await courseService.deleteModule('module1', 'owner1');

    const orders = Module.updateOne.mock.calls.map(([filter, update]) => [
      filter._id.toString(),
      update.$set.order,
    ]);
    expect(orders).toEqual([
      ['module0', 0],
      ['module2', 1],
    ]);
  });

  test('deleteLesson detaches from its module and renumbers the rest', async () => {
    const moduleSave = jest.fn().mockResolvedValue(true);
    const module = {
      _id: 'module1',
      courseId: 'course1',
      lessons: [
        { toString: () => 'lessonA' },
        { toString: () => 'lessonB' },
        { toString: () => 'lessonC' },
      ],
      save: moduleSave,
    };
    Lesson.findById.mockReturnValue(query({ _id: 'lessonB', moduleId: 'module1' }));
    Module.findById.mockReturnValue(query(module));
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );

    await courseService.deleteLesson('lessonB', 'owner1');

    expect(Lesson.deleteOne).toHaveBeenCalledWith({ _id: 'lessonB' });
    expect(module.lessons.map((l) => l.toString())).toEqual(['lessonA', 'lessonC']);
    const orders = Lesson.updateOne.mock.calls.map(([filter, update]) => [
      filter._id.toString(),
      update.$set.order,
    ]);
    expect(orders).toEqual([
      ['lessonA', 0],
      ['lessonC', 1],
    ]);
  });

  test('deleteLesson is refused for a non-owner', async () => {
    Lesson.findById.mockReturnValue(query({ _id: 'lessonB', moduleId: 'module1' }));
    Module.findById.mockReturnValue(query({ _id: 'module1', courseId: 'course1', lessons: [] }));
    Course.findById.mockReturnValue(
      query({ _id: 'course1', instructor: { toString: () => 'owner1' } }),
    );

    await expect(courseService.deleteLesson('lessonB', 'intruder')).rejects.toMatchObject({
      status: 403,
    });
    expect(Lesson.deleteOne).not.toHaveBeenCalled();
  });
});
