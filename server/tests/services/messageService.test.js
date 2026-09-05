// Authorisation is the whole of this service: one thread per (student, course),
// and the caller must never be able to widen their own reach by sending a
// `studentId`/`instructorId` in the payload (S7 D6, same class of defect as
// S5.5 B3). Mongoose models are mocked — these assert the service's own
// resolution and filtering logic, not persistence.

jest.mock('../../src/models/Message', () => ({
  Message: {
    find: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    countDocuments: jest.fn(),
  },
  MESSAGE_BODY_MAX: 4000,
}));
jest.mock('../../src/models/Course', () => ({ Course: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/User', () => ({ User: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/Module', () => ({ Module: { findById: jest.fn() } }));
jest.mock('../../src/models/Lesson', () => ({ Lesson: { findById: jest.fn() } }));
jest.mock('../../src/services/progressService', () => ({ recordQuestionAsked: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { Message } = require('../../src/models/Message');
const { Course } = require('../../src/models/Course');
const { User } = require('../../src/models/User');
const { Module } = require('../../src/models/Module');
const { Lesson } = require('../../src/models/Lesson');
const progressService = require('../../src/services/progressService');
const messageService = require('../../src/services/messageService');

// Mongoose query builders are chainable and thenable; this fakes just enough of
// that surface for the `.select().lean()` / `.sort().lean()` chains used here.
const query = (result) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    populate: () => chain,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

const COURSE = 'aaaaaaaaaaaaaaaaaaaaaa01';
const OTHER_COURSE = 'aaaaaaaaaaaaaaaaaaaaaa02';
const STUDENT = 'bbbbbbbbbbbbbbbbbbbbbb01';
const OTHER_STUDENT = 'bbbbbbbbbbbbbbbbbbbbbb02';
const INSTRUCTOR = 'cccccccccccccccccccccc01';
const OTHER_INSTRUCTOR = 'cccccccccccccccccccccc02';
const LESSON = 'dddddddddddddddddddddd01';
const MODULE = 'eeeeeeeeeeeeeeeeeeeeee01';

const studentViewer = { id: STUDENT, role: 'student' };
const instructorViewer = { id: INSTRUCTOR, role: 'instructor' };
const adminViewer = { id: 'ffffffffffffffffffffff01', role: 'admin' };

let courses;
let users;

beforeEach(() => {
  jest.clearAllMocks();

  courses = {
    [COURSE]: { _id: COURSE, title: 'JS Basics', icon: '🟨', instructor: INSTRUCTOR },
    [OTHER_COURSE]: { _id: OTHER_COURSE, title: 'Python', icon: null, instructor: OTHER_INSTRUCTOR },
  };
  users = {
    [STUDENT]: {
      _id: STUDENT,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: 'student',
      enrolledCourses: [COURSE],
    },
    [OTHER_STUDENT]: {
      _id: OTHER_STUDENT,
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      role: 'student',
      enrolledCourses: [COURSE],
    },
    [INSTRUCTOR]: {
      _id: INSTRUCTOR,
      firstName: 'Brad',
      lastName: 'Traversy',
      email: 'brad@example.com',
      role: 'instructor',
      enrolledCourses: [],
    },
  };

  Course.findById.mockImplementation((id) => query(courses[String(id)] || null));
  User.findById.mockImplementation((id) => query(users[String(id)] || null));
  Message.find.mockReturnValue(query([]));
  Message.updateMany.mockResolvedValue({ modifiedCount: 0 });
  Message.countDocuments.mockResolvedValue(0);
  Message.create.mockImplementation(async (doc) => ({
    _id: 'msg1',
    readAt: null,
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    ...doc,
  }));
  Lesson.findById.mockImplementation(() => query({ _id: LESSON, moduleId: MODULE }));
  Module.findById.mockImplementation(() => query({ _id: MODULE, courseId: COURSE }));
  progressService.recordQuestionAsked.mockResolvedValue({ questionsAsked: 1 });
});

const statusOf = (fn) => fn().then(() => null, (err) => err.status);

describe('getThread — who may read a thread', () => {
  test('a student may only ever read their own thread; a forged studentId is ignored', async () => {
    await messageService.getThread({
      courseId: COURSE,
      studentId: OTHER_STUDENT,
      viewer: studentViewer,
    });

    expect(User.findById).toHaveBeenCalledWith(STUDENT);
    expect(User.findById).not.toHaveBeenCalledWith(OTHER_STUDENT);
    expect(Message.find).toHaveBeenCalledWith({ courseId: COURSE, studentId: STUDENT });
  });

  test('a student who is not enrolled in the course is refused', async () => {
    users[STUDENT].enrolledCourses = [OTHER_COURSE];

    await expect(
      statusOf(() => messageService.getThread({ courseId: COURSE, viewer: studentViewer })),
    ).resolves.toBe(403);
  });

  test('an instructor cannot touch a course they do not own', async () => {
    await expect(
      statusOf(() =>
        messageService.getThread({
          courseId: OTHER_COURSE,
          studentId: STUDENT,
          viewer: instructorViewer,
        }),
      ),
    ).resolves.toBe(403);
  });

  test('an instructor must name the student whose thread they want', async () => {
    await expect(
      statusOf(() => messageService.getThread({ courseId: COURSE, viewer: instructorViewer })),
    ).resolves.toBe(400);
  });

  test('a missing course is a 404', async () => {
    delete courses[COURSE];
    await expect(
      statusOf(() => messageService.getThread({ courseId: COURSE, viewer: studentViewer })),
    ).resolves.toBe(404);
  });

  test('a studentId that is not a student is a 404', async () => {
    await expect(
      statusOf(() =>
        messageService.getThread({
          courseId: COURSE,
          studentId: INSTRUCTOR,
          viewer: instructorViewer,
        }),
      ),
    ).resolves.toBe(404);
  });

  test('a malformed courseId is rejected before it reaches Mongo', async () => {
    await expect(
      statusOf(() => messageService.getThread({ courseId: 'not-an-id', viewer: studentViewer })),
    ).resolves.toBe(400);
    expect(Course.findById).not.toHaveBeenCalled();
  });
});

describe('getThread — read receipts', () => {
  const thread = () => [
    {
      _id: 'm1',
      courseId: COURSE,
      studentId: STUDENT,
      senderId: STUDENT,
      senderRole: 'student',
      body: 'Why does this loop never end?',
      readAt: null,
      createdAt: new Date('2026-09-05T09:00:00.000Z'),
    },
    {
      _id: 'm2',
      courseId: COURSE,
      studentId: STUDENT,
      senderId: INSTRUCTOR,
      senderRole: 'instructor',
      body: 'Check the increment.',
      readAt: null,
      createdAt: new Date('2026-09-05T09:05:00.000Z'),
    },
  ];

  test("the student's read clears the instructor's messages only", async () => {
    Message.find.mockReturnValue(query(thread()));

    const result = await messageService.getThread({ courseId: COURSE, viewer: studentViewer });

    expect(Message.updateMany).toHaveBeenCalledTimes(1);
    const [filter] = Message.updateMany.mock.calls[0];
    expect(filter).toMatchObject({
      courseId: COURSE,
      studentId: STUDENT,
      senderId: { $ne: STUDENT },
      readAt: null,
    });
    expect(result.messages.map((m) => m.mine)).toEqual([true, false]);
    expect(result.messages[1].readAt).not.toBeNull();
  });

  test('an admin who is not a party reads as an observer and marks nothing read', async () => {
    Message.find.mockReturnValue(query(thread()));

    const result = await messageService.getThread({
      courseId: COURSE,
      studentId: STUDENT,
      viewer: adminViewer,
    });

    expect(Message.updateMany).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m) => m.readAt === null)).toBe(true);
  });

  // Regression: marking read used to be keyed on `role !== 'admin'`, so an
  // admin who OWNS the course — the instructor in that very conversation —
  // could never clear their own inbox. Their header bell counted mail they had
  // already read and answered, permanently. Party-hood is the real test.
  test('an admin who owns the course clears it like any instructor', async () => {
    Message.find.mockReturnValue(query(thread()));

    const owningAdmin = { id: INSTRUCTOR, role: 'admin' };
    const result = await messageService.getThread({
      courseId: COURSE,
      studentId: STUDENT,
      viewer: owningAdmin,
    });

    expect(Message.updateMany).toHaveBeenCalledTimes(1);
    const [filter] = Message.updateMany.mock.calls[0];
    expect(filter).toMatchObject({ senderId: { $ne: INSTRUCTOR }, readAt: null });
    // The student's question is cleared; the admin's own reply is untouched.
    expect(result.messages[0].readAt).not.toBeNull();
  });

  test('the thread names the learner as `First L.` and the instructor in full', async () => {
    Message.find.mockReturnValue(query([]));

    const result = await messageService.getThread({
      courseId: COURSE,
      studentId: STUDENT,
      viewer: instructorViewer,
    });

    expect(result.student.name).toBe('Ada L.');
    expect(result.instructor.name).toBe('Brad Traversy');
  });
});

describe('send — validation', () => {
  test('rejects a whitespace-only body', async () => {
    await expect(
      statusOf(() =>
        messageService.send({ courseId: COURSE, body: '   \n\t ', sender: studentViewer }),
      ),
    ).resolves.toBe(400);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('rejects a body over the 4 000 character cap', async () => {
    await expect(
      statusOf(() =>
        messageService.send({ courseId: COURSE, body: 'x'.repeat(4001), sender: studentViewer }),
      ),
    ).resolves.toBe(400);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('accepts a body exactly at the cap', async () => {
    await messageService.send({ courseId: COURSE, body: 'x'.repeat(4000), sender: studentViewer });

    expect(Message.create).toHaveBeenCalledTimes(1);
  });

  test('rejects a non-string body', async () => {
    await expect(
      statusOf(() =>
        messageService.send({ courseId: COURSE, body: { $ne: null }, sender: studentViewer }),
      ),
    ).resolves.toBe(400);
  });

  test('rejects a lessonId that belongs to another course', async () => {
    Module.findById.mockImplementation(() => query({ _id: MODULE, courseId: OTHER_COURSE }));

    await expect(
      statusOf(() =>
        messageService.send({
          courseId: COURSE,
          lessonId: LESSON,
          body: 'Help',
          sender: studentViewer,
        }),
      ),
    ).resolves.toBe(400);
    expect(Message.create).not.toHaveBeenCalled();
  });
});

describe('send — authorisation and derived ids', () => {
  test('a forged studentId/instructorId in the payload is ignored', async () => {
    const created = await messageService.send({
      courseId: COURSE,
      studentId: OTHER_STUDENT,
      instructorId: OTHER_INSTRUCTOR,
      body: 'Hello',
      sender: studentViewer,
    });

    const [doc] = Message.create.mock.calls[0];
    expect(doc.studentId).toBe(STUDENT);
    expect(doc.instructorId).toBe(INSTRUCTOR);
    expect(doc.senderRole).toBe('student');
    expect(created.mine).toBe(true);
  });

  test('an instructor cannot write into a course they do not own', async () => {
    await expect(
      statusOf(() =>
        messageService.send({
          courseId: OTHER_COURSE,
          studentId: STUDENT,
          body: 'Hi',
          sender: instructorViewer,
        }),
      ),
    ).resolves.toBe(403);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('nobody writes into the thread of a learner who is not enrolled', async () => {
    users[OTHER_STUDENT].enrolledCourses = [];

    await expect(
      statusOf(() =>
        messageService.send({
          courseId: COURSE,
          studentId: OTHER_STUDENT,
          body: 'Hi',
          sender: instructorViewer,
        }),
      ),
    ).resolves.toBe(403);
  });

  test('the instructor side is always resolved from the course document', async () => {
    courses[COURSE].instructor = OTHER_INSTRUCTOR;
    users[OTHER_INSTRUCTOR] = { _id: OTHER_INSTRUCTOR, firstName: 'New', role: 'instructor' };

    await messageService.send({ courseId: COURSE, body: 'Hello', sender: studentViewer });

    expect(Message.create.mock.calls[0][0].instructorId).toBe(OTHER_INSTRUCTOR);
  });
});

describe('send — analytics (H1 lineage)', () => {
  test('a student asking from a lesson bumps questionsAsked', async () => {
    await messageService.send({
      courseId: COURSE,
      lessonId: LESSON,
      body: 'Stuck on step 2',
      sender: studentViewer,
    });

    expect(progressService.recordQuestionAsked).toHaveBeenCalledWith(STUDENT, LESSON);
  });

  test('a student message without a lessonId records nothing', async () => {
    await messageService.send({ courseId: COURSE, body: 'General question', sender: studentViewer });

    expect(progressService.recordQuestionAsked).not.toHaveBeenCalled();
  });

  test('instructor replies never write to the progress table', async () => {
    await messageService.send({
      courseId: COURSE,
      studentId: STUDENT,
      lessonId: LESSON,
      body: 'See the hint',
      sender: instructorViewer,
    });

    expect(Message.create).toHaveBeenCalledTimes(1);
    expect(progressService.recordQuestionAsked).not.toHaveBeenCalled();
  });

  test('a DynamoDB failure does not cost the learner their message', async () => {
    progressService.recordQuestionAsked.mockRejectedValue(new Error('Dynamo unavailable'));

    const created = await messageService.send({
      courseId: COURSE,
      lessonId: LESSON,
      body: 'Stuck',
      sender: studentViewer,
    });

    expect(created.body).toBe('Stuck');
  });
});

describe('countUnreadFor', () => {
  test('a student counts inbound messages with one indexed query', async () => {
    Message.countDocuments.mockResolvedValue(3);

    await expect(messageService.countUnreadFor(STUDENT, 'student')).resolves.toBe(3);
    expect(Message.countDocuments).toHaveBeenCalledTimes(1);
    expect(Message.countDocuments).toHaveBeenCalledWith({
      studentId: STUDENT,
      readAt: null,
      senderId: { $ne: STUDENT },
    });
  });

  test('an instructor counts across the courses they own', async () => {
    await messageService.countUnreadFor(INSTRUCTOR, 'instructor');

    expect(Message.countDocuments).toHaveBeenCalledWith({
      instructorId: INSTRUCTOR,
      readAt: null,
      senderId: { $ne: INSTRUCTOR },
    });
  });

  test('an unauthenticated caller counts nothing', async () => {
    await expect(messageService.countUnreadFor(null, 'student')).resolves.toBe(0);
    expect(Message.countDocuments).not.toHaveBeenCalled();
  });
});

describe('listThreads', () => {
  const inbox = [
    {
      _id: 'm3',
      courseId: COURSE,
      studentId: OTHER_STUDENT,
      instructorId: INSTRUCTOR,
      senderId: OTHER_STUDENT,
      senderRole: 'student',
      body: 'Newest',
      readAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
    },
    {
      _id: 'm2',
      courseId: COURSE,
      studentId: STUDENT,
      instructorId: INSTRUCTOR,
      senderId: STUDENT,
      senderRole: 'student',
      body: 'Older question',
      readAt: null,
      createdAt: new Date('2026-09-05T11:00:00.000Z'),
    },
    {
      _id: 'm1',
      courseId: COURSE,
      studentId: STUDENT,
      instructorId: INSTRUCTOR,
      senderId: INSTRUCTOR,
      senderRole: 'instructor',
      body: 'My own reply',
      readAt: null,
      createdAt: new Date('2026-09-05T10:00:00.000Z'),
    },
  ];

  beforeEach(() => {
    Message.find.mockReturnValue(query(inbox));
    Course.find.mockReturnValue(query([courses[COURSE]]));
    User.find.mockReturnValue(query([users[STUDENT], users[OTHER_STUDENT], users[INSTRUCTOR]]));
  });

  test('the instructor inbox is one entry per (course, student), newest first', async () => {
    const threads = await messageService.listThreads(INSTRUCTOR, 'instructor');

    expect(Message.find).toHaveBeenCalledWith({ instructorId: INSTRUCTOR });
    expect(threads).toHaveLength(2);
    expect(threads[0].student.name).toBe('Grace H.');
    expect(threads[0].lastMessage.body).toBe('Newest');
    expect(threads[1].student.name).toBe('Ada L.');
    expect(threads[1].course.title).toBe('JS Basics');
  });

  test('unread counts only the other party’s messages', async () => {
    const threads = await messageService.listThreads(INSTRUCTOR, 'instructor');

    // Ada's thread holds one unread question and the instructor's own reply.
    expect(threads[1].unread).toBe(1);
  });

  test('a student queries their own threads by studentId', async () => {
    await messageService.listThreads(STUDENT, 'student');

    expect(Message.find).toHaveBeenCalledWith({ studentId: STUDENT });
  });

  test('an empty inbox costs one query', async () => {
    Message.find.mockReturnValue(query([]));

    await expect(messageService.listThreads(INSTRUCTOR, 'instructor')).resolves.toEqual([]);
    expect(Course.find).not.toHaveBeenCalled();
  });

  // Regression: a summary carried the learner only as `student.id`, so the
  // inbox's `thread.studentId` was undefined and its reply pane asked for a
  // thread without saying whose — the server could only answer "studentId is
  // required". Every field `getThread` needs to reopen a thread must be
  // readable straight off the summary.
  test('a summary carries the flat (courseId, studentId) pair getThread needs', async () => {
    const threads = await messageService.listThreads(INSTRUCTOR, 'instructor');

    threads.forEach((thread) => {
      expect(typeof thread.courseId).toBe('string');
      expect(typeof thread.studentId).toBe('string');
      // `id` is the two joined, so the parts must agree with it.
      expect(thread.id).toBe(`${thread.courseId}:${thread.studentId}`);
      expect(thread.studentId).toBe(thread.student.id);
    });
  });
});
