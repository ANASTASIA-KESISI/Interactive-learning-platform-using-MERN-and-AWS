const { Message, MESSAGE_BODY_MAX } = require('../models/Message');
const { Course } = require('../models/Course');
const { Module } = require('../models/Module');
const { Lesson } = require('../models/Lesson');
const { User } = require('../models/User');
const progressService = require('./progressService');
const logger = require('../utils/logger');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

// Student ↔ instructor messaging (S7 D6): one thread per (student, course),
// plain text, polled by the client. The thread's other end is ALWAYS derived
// from the course document — a caller-supplied `instructorId` is never read,
// and `studentId` is only honoured for instructor/admin callers, so a learner
// cannot address, read or forge a thread that is not their own.

const OBJECT_ID = /^[a-f\d]{24}$/i;

const idOf = (value) => {
  if (value === null || value === undefined) return '';
  const raw = value._id ?? value;
  return raw.toString();
};

const sameId = (a, b) => Boolean(idOf(a)) && idOf(a) === idOf(b);

const requireObjectId = (value, field) => {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (!raw) throw badRequest(`${field} is required`);
  const id = idOf(raw);
  if (!OBJECT_ID.test(id)) throw badRequest(`${field} must be a valid id`);
  return id;
};

// Learners are shown as `First L.` everywhere they appear next to someone
// else's data (leaderboard, instructor inbox); the email local part is the
// fallback for accounts that never filled a name in.
const learnerName = (user) => {
  if (!user) return 'Learner';
  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  if (first && last) return `${first} ${last[0].toUpperCase()}.`;
  if (first) return first;
  const email = (user.email || '').trim();
  if (email) return email.split('@')[0];
  return 'Learner';
};

// Course staff are named in full — the course page and the chat header already
// show the instructor's real name to every enrolled learner.
const staffName = (user) => {
  if (!user) return 'Instructor';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || (user.email ? user.email.split('@')[0] : 'Instructor');
};

const personSummary = (user, name) =>
  user
    ? {
        id: idOf(user._id),
        name,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        avatar: user.avatar ?? null,
      }
    : null;

const serialiseMessage = (message, viewerId) => ({
  id: idOf(message._id),
  courseId: idOf(message.courseId),
  studentId: idOf(message.studentId),
  senderId: idOf(message.senderId),
  senderRole: message.senderRole,
  lessonId: message.lessonId ? idOf(message.lessonId) : null,
  body: message.body,
  readAt: message.readAt ? new Date(message.readAt).toISOString() : null,
  createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
  // Whose side of the conversation this is, from the caller's point of view.
  mine: sameId(message.senderId, viewerId),
});

const isEnrolled = (student, courseId) =>
  (student.enrolledCourses || []).some((id) => sameId(id, courseId));

// The single authorisation gate for every read and write in this service.
//
// | viewer     | thread it may touch                                   |
// |------------|-------------------------------------------------------|
// | student    | studentId === own id AND enrolled in the course        |
// | instructor | course.instructor === own id                           |
// | admin      | any (observer; see `markRead` in getThread)            |
//
// `requireEnrolment` is set for writes: an instructor may still read the
// thread of a learner who has since unenrolled, but nobody starts a new
// conversation with someone who is not on the course.
const resolveThread = async ({ courseId, studentId, viewer, requireEnrolment = false }) => {
  if (!viewer || !viewer.id) throw forbidden();
  const courseKey = requireObjectId(courseId, 'courseId');

  const course = await Course.findById(courseKey)
    .select('title icon instructor isPublished')
    .lean();
  if (!course) throw notFound('Course not found');

  // A student's thread is always their own: whatever `studentId` arrived on
  // the request is discarded here rather than validated.
  const studentKey =
    viewer.role === 'student' ? idOf(viewer.id) : requireObjectId(studentId, 'studentId');

  const student = await User.findById(studentKey)
    .select('firstName lastName email avatar role enrolledCourses')
    .lean();
  if (!student || student.role !== 'student') throw notFound('Student not found');

  if (viewer.role === 'student') {
    if (!isEnrolled(student, courseKey)) {
      throw forbidden('You are not enrolled in this course');
    }
  } else if (viewer.role === 'instructor') {
    if (!sameId(course.instructor, viewer.id)) {
      throw forbidden('You do not teach this course');
    }
  } else if (viewer.role !== 'admin') {
    throw forbidden();
  }

  if (requireEnrolment && !isEnrolled(student, courseKey)) {
    throw forbidden('That learner is not enrolled in this course');
  }

  // Never from the payload: the instructor side of the thread is whoever owns
  // the course right now.
  const instructorId = idOf(course.instructor);
  const instructor = await User.findById(instructorId)
    .select('firstName lastName email avatar')
    .lean();

  return { course, courseId: courseKey, student, studentId: studentKey, instructorId, instructor };
};

// A `lessonId` on a message means "asked from this lesson page", and it is the
// key `recordQuestionAsked` writes under. Verifying it belongs to the course
// keeps junk partition keys out of the DynamoDB progress table.
const assertLessonInCourse = async (lessonId, courseId) => {
  const lesson = await Lesson.findById(lessonId).select('moduleId').lean();
  if (!lesson) throw badRequest('Unknown lessonId');
  const module = await Module.findById(lesson.moduleId).select('courseId').lean();
  if (!module || !sameId(module.courseId, courseId)) {
    throw badRequest('lessonId does not belong to this course');
  }
};

// ── Reads ─────────────────────────────────────────────────────────────────────

// GET /api/messages/courses/:courseId. Chronological, oldest first, and the
// other party's messages are stamped read for the viewer. An admin is an
// observer: they never clear somebody else's unread badge.
const getThread = async ({ courseId, studentId, viewer }) => {
  const resolved = await resolveThread({ courseId, studentId, viewer });
  const viewerId = idOf(viewer.id);

  const messages = await Message.find({
    courseId: resolved.courseId,
    studentId: resolved.studentId,
  })
    .sort({ createdAt: 1 })
    .lean();

  // Who clears an unread flag: whoever the message was actually addressed to.
  // Keying this on `role !== 'admin'` looked like the same thing, because an
  // admin is normally the observer here — but an admin who OWNS the course is
  // the instructor in the conversation, and this rule meant their own inbox
  // could never be marked read. Their bell counted mail they had already
  // answered, forever. Party-hood, not role, is the right test: an admin
  // reading somebody else's thread still observes without touching it.
  const isParty =
    sameId(resolved.studentId, viewerId) || sameId(resolved.instructorId, viewerId);
  const markRead = isParty;
  const readAt = new Date();
  const unreadFromOther = messages.filter(
    (message) => !message.readAt && !sameId(message.senderId, viewerId),
  );

  if (markRead && unreadFromOther.length > 0) {
    await Message.updateMany(
      {
        courseId: resolved.courseId,
        studentId: resolved.studentId,
        senderId: { $ne: viewerId },
        readAt: null,
      },
      { $set: { readAt } },
    );
    // Reflect the write locally so the response and the header bell agree.
    for (const message of unreadFromOther) message.readAt = readAt;
  }

  return {
    courseId: resolved.courseId,
    course: {
      id: resolved.courseId,
      title: resolved.course.title,
      icon: resolved.course.icon ?? null,
    },
    student: personSummary(resolved.student, learnerName(resolved.student)),
    instructor: resolved.instructor
      ? personSummary(resolved.instructor, staffName(resolved.instructor))
      : null,
    messages: messages.map((message) => serialiseMessage(message, viewerId)),
  };
};

// GET /api/messages/threads. One entry per (course, student) the caller is a
// party to, most recent activity first. Both roles get the same entry shape so
// the profile list and the instructor inbox render from one contract.
const listThreads = async (userId, role) => {
  const viewerId = idOf(userId);
  if (!OBJECT_ID.test(viewerId)) return [];

  // Indexed either way: (studentId, readAt) for a learner, (instructorId,
  // readAt) for course staff.
  const filter = role === 'student' ? { studentId: viewerId } : { instructorId: viewerId };
  const messages = await Message.find(filter).sort({ createdAt: -1 }).lean();
  if (messages.length === 0) return [];

  // Sorted newest first, so the first message seen for a key is its last
  // message and first-seen order is already "most recent activity first".
  const threads = new Map();
  for (const message of messages) {
    const key = `${idOf(message.courseId)}:${idOf(message.studentId)}`;
    let thread = threads.get(key);
    if (!thread) {
      thread = {
        key,
        courseId: idOf(message.courseId),
        studentId: idOf(message.studentId),
        instructorId: idOf(message.instructorId),
        lastMessage: serialiseMessage(message, viewerId),
        unread: 0,
      };
      threads.set(key, thread);
    }
    if (!message.readAt && !sameId(message.senderId, viewerId)) thread.unread += 1;
  }

  const entries = [...threads.values()];
  const courseIds = [...new Set(entries.map((entry) => entry.courseId))];
  const userIds = [
    ...new Set(entries.flatMap((entry) => [entry.studentId, entry.instructorId])),
  ];

  const [courses, people] = await Promise.all([
    Course.find({ _id: { $in: courseIds } }).select('title icon').lean(),
    User.find({ _id: { $in: userIds } }).select('firstName lastName email avatar').lean(),
  ]);

  const courseById = new Map(courses.map((course) => [idOf(course._id), course]));
  const userById = new Map(people.map((person) => [idOf(person._id), person]));

  return entries.map((entry) => {
    const course = courseById.get(entry.courseId);
    const student = userById.get(entry.studentId);
    const instructor = userById.get(entry.instructorId);

    return {
      id: entry.key,
      courseId: entry.courseId,
      // A thread is addressed by the (courseId, studentId) PAIR — `id` is
      // literally the two joined — and `GET /messages/courses/:courseId`
      // requires `studentId` from an instructor or admin. Exposing the learner
      // only as `student.id` left the inbox reading `thread.studentId`,
      // getting undefined, and asking for a thread without saying whose: the
      // reply pane could only ever answer "studentId is required". Carry the
      // flat id next to `courseId` so the pair that identifies a thread is
      // readable as a pair.
      studentId: entry.studentId,
      course: course
        ? { id: entry.courseId, title: course.title, icon: course.icon ?? null }
        : { id: entry.courseId, title: 'Course', icon: null },
      student: personSummary(student, learnerName(student)),
      instructor: personSummary(instructor, staffName(instructor)),
      lastMessage: entry.lastMessage,
      unread: entry.unread,
      updatedAt: entry.lastMessage.createdAt,
    };
  });
};

// Header bell. One indexed count per /api/me call — never a scan, and never a
// per-thread loop.
const countUnreadFor = async (userId, role) => {
  const viewerId = idOf(userId);
  // No caller: nothing to count. A malformed id is answered the same way
  // rather than letting Mongo's cast error turn /api/me into a 500.
  if (!OBJECT_ID.test(viewerId)) return 0;

  const filter =
    role === 'student'
      ? { studentId: viewerId, readAt: null, senderId: { $ne: viewerId } }
      : { instructorId: viewerId, readAt: null, senderId: { $ne: viewerId } };

  return Message.countDocuments(filter);
};

// ── Writes ────────────────────────────────────────────────────────────────────

// POST /api/messages/courses/:courseId. Plain text only — the body is stored
// verbatim and rendered as text, never Markdown or HTML.
const send = async ({ courseId, studentId, lessonId, body, sender }) => {
  if (typeof body !== 'string') throw badRequest('body must be a string');
  const text = body.trim();
  if (!text) throw badRequest('Message body is required');
  if (text.length > MESSAGE_BODY_MAX) {
    throw badRequest(`Message body must be ${MESSAGE_BODY_MAX} characters or fewer`);
  }

  const lessonKey =
    lessonId === undefined || lessonId === null || lessonId === ''
      ? null
      : requireObjectId(lessonId, 'lessonId');

  const resolved = await resolveThread({
    courseId,
    studentId,
    viewer: sender,
    requireEnrolment: true,
  });

  if (lessonKey) await assertLessonInCourse(lessonKey, resolved.courseId);

  const created = await Message.create({
    courseId: resolved.courseId,
    studentId: resolved.studentId,
    instructorId: resolved.instructorId,
    senderId: idOf(sender.id),
    senderRole: sender.role,
    ...(lessonKey ? { lessonId: lessonKey } : {}),
    body: text,
  });

  // Only a learner's question is a pedagogical event (H1): instructor and admin
  // traffic stays out of the progress table, matching the preview-mode rule in
  // lessons.routes.js. Analytics must never cost the learner their message.
  if (sender.role === 'student' && lessonKey) {
    try {
      await progressService.recordQuestionAsked(idOf(sender.id), lessonKey);
    } catch (err) {
      logger.error('Failed to record questionsAsked', {
        userId: idOf(sender.id),
        lessonId: lessonKey,
        error: err.message,
      });
    }
  }

  return serialiseMessage(created, idOf(sender.id));
};

module.exports = { listThreads, getThread, send, countUnreadFor };
