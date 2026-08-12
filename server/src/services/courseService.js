const { Course } = require('../models/Course');
const { Module } = require('../models/Module');
const { Lesson } = require('../models/Lesson');
const { User } = require('../models/User');
const { notFound, forbidden } = require('../utils/httpError');

// Client-writable fields, per resource. Everything else on the document is
// server-owned: spreading `req.body` straight into create/Object.assign let an
// instructor reassign `instructor` (course hijack), forge `enrollmentCount`,
// flip `isPublished` past the publish flow, or re-parent a lesson by setting
// `moduleId` (S5.5 B3).
const COURSE_WRITABLE = ['title', 'description', 'category', 'difficulty'];
const MODULE_WRITABLE = ['title'];
const LESSON_WRITABLE = [
  'title',
  'type',
  'language',
  'content',
  'codeTemplate',
  'expectedOutput',
  'hints',
  'xpReward',
];

const pick = (source, allowed) =>
  Object.fromEntries(
    Object.entries(source || {}).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    ),
  );

// ── Course ────────────────────────────────────────────────────────────────────

const createCourse = async (instructorId, data) => {
  const course = await Course.create({
    ...pick(data, COURSE_WRITABLE),
    instructor: instructorId,
  });
  return course;
};

const listPublishedCourses = (filter = {}) =>
  Course.find({ isPublished: true, ...filter })
    .populate('instructor', 'firstName lastName email')
    .sort({ createdAt: -1 });

// Returns every course owned by an instructor, published or not. Used by the
// authoring dashboard where drafts must be visible alongside live courses.
const listInstructorCourses = (instructorId) =>
  Course.find({ instructor: instructorId })
    .sort({ createdAt: -1 });

// Course tree for browsing and authoring.
//
// The lesson projection is a security boundary, not an optimisation: without it
// every authenticated caller receives `expectedOutput` and hint text for every
// lesson in the course (S5.5 B1). It also keeps the payload small — the full
// documents carry Markdown bodies nobody on this screen renders (S5.5 C2).
//
// `viewer` ({ id, role }) gates unpublished drafts: only the owning instructor
// and admins can read them. Omitting it means "published only" (S5.5 B4).
const canViewDraft = (course, viewer) => {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  const ownerId = course.instructor?._id ?? course.instructor;
  return Boolean(ownerId) && ownerId.toString() === viewer.id.toString();
};

const getCourseById = async (courseId, viewer = null) => {
  const course = await Course.findById(courseId)
    .populate('instructor', 'firstName lastName email')
    .populate({
      path: 'modules',
      select: 'title order lessons',
      options: { sort: { order: 1 } },
      populate: {
        path: 'lessons',
        select: 'title type order xpReward language',
        options: { sort: { order: 1 } },
      },
    });
  if (!course) throw notFound('Course not found');

  if (!course.isPublished && !canViewDraft(course, viewer)) {
    // 404 rather than 403 so draft existence isn't probeable by ID.
    throw notFound('Course not found');
  }

  return course;
};

// Minimal projection for the student dashboard's progress bars: course card
// metadata plus the lesson IDs needed to compute completion. Replaces N calls
// to getCourseById, which dragged full lesson documents (Markdown bodies,
// templates, answers) across the wire only to count them (S5.5 C2).
const getEnrolledCourseSummaries = (courseIds) =>
  Course.find({ _id: { $in: courseIds } })
    .select('title category difficulty modules')
    .populate({
      path: 'modules',
      select: 'lessons',
      populate: { path: 'lessons', select: '_id' },
    })
    .lean();

const publishCourse = async (courseId, instructorId) => {
  const course = await Course.findById(courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can publish this course');
  course.isPublished = true;
  return course.save();
};

const updateCourse = async (courseId, instructorId, updates) => {
  const course = await Course.findById(courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can edit this course');
  Object.assign(course, pick(updates, COURSE_WRITABLE));
  return course.save();
};

// ── Module ────────────────────────────────────────────────────────────────────

const addModule = async (courseId, instructorId, data) => {
  const course = await Course.findById(courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can add modules');

  const order = course.modules.length;
  const module = await Module.create({ ...pick(data, MODULE_WRITABLE), courseId, order });
  course.modules.push(module._id);
  await course.save();
  return module;
};

const getModuleById = async (moduleId) => {
  const module = await Module.findById(moduleId).populate({
    path: 'lessons',
    options: { sort: { order: 1 } },
  });
  if (!module) throw notFound('Module not found');
  return module;
};

// Resolves a module together with its course, enforcing instructor ownership.
const loadOwnedModule = async (moduleId, instructorId) => {
  const module = await Module.findById(moduleId);
  if (!module) throw notFound('Module not found');

  const course = await Course.findById(module.courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can modify this course');

  return { module, course };
};

// `order` is derived from array length when appending, so a delete that leaves
// a gap would hand the next new item an order that collides with an existing
// one. Renumber the survivors to stay dense.
const renumber = (ids, Model) =>
  Promise.all(ids.map((id, order) => Model.updateOne({ _id: id }, { $set: { order } })));

const updateModule = async (moduleId, instructorId, updates) => {
  const { module } = await loadOwnedModule(moduleId, instructorId);
  Object.assign(module, pick(updates, MODULE_WRITABLE));
  return module.save();
};

// Deleting a module removes its lessons too. DynamoDB progress records for
// those lessons are deliberately left in place: they are the pilot's research
// record, and rewriting history to match a later content edit would falsify it.
const deleteModule = async (moduleId, instructorId) => {
  const { module, course } = await loadOwnedModule(moduleId, instructorId);

  await Lesson.deleteMany({ _id: { $in: module.lessons } });
  await Module.deleteOne({ _id: module._id });

  course.modules = course.modules.filter((id) => id.toString() !== moduleId.toString());
  await course.save();
  await renumber(course.modules, Module);

  return { deletedModuleId: moduleId, deletedLessons: module.lessons.length };
};

const deleteLesson = async (lessonId, instructorId) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  const { module } = await loadOwnedModule(lesson.moduleId, instructorId);

  await Lesson.deleteOne({ _id: lesson._id });
  module.lessons = module.lessons.filter((id) => id.toString() !== lessonId.toString());
  await module.save();
  await renumber(module.lessons, Lesson);

  return { deletedLessonId: lessonId };
};

// ── Lesson ────────────────────────────────────────────────────────────────────

const addLesson = async (moduleId, instructorId, data) => {
  const module = await Module.findById(moduleId).populate('courseId');
  if (!module) throw notFound('Module not found');

  const course = await Course.findById(module.courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can add lessons');

  const order = module.lessons.length;
  const lesson = await Lesson.create({ ...pick(data, LESSON_WRITABLE), moduleId, order });
  module.lessons.push(lesson._id);
  await module.save();
  return lesson;
};

const getLessonById = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');
  return lesson;
};

// Learner-facing lesson payload. `expectedOutput` and the hint TEXT are the
// answers to the exercise — shipping them to the browser lets a student read
// the solution out of the network tab and pass by echoing it, which corrupts
// the pass-rate and hint-usage metrics the pilot evaluates (S5.5 B1). So:
//   - `expectedOutput` never leaves the server; validation happens in the runner
//   - hints are exposed as a COUNT, with text arriving only from the reveal
//     endpoint (which logs the reveal)
//   - `revealedCount` (from the caller's progress record) re-serves hints the
//     learner has already unlocked, so a page refresh doesn't lose them
// Also resolves the parent courseId so the client can deep-link back to the
// course (e.g. from the lesson-complete celebration screen).
const getLessonForStudent = async (lessonId, revealedCount = 0) => {
  const lesson = await Lesson.findById(lessonId)
    .populate({
      path: 'moduleId',
      select: 'courseId',
      populate: { path: 'courseId', select: 'title' },
    })
    .lean();
  if (!lesson) throw notFound('Lesson not found');

  const { expectedOutput, hints = [], ...safe } = lesson;
  const module = lesson.moduleId;
  const course = module?.courseId;

  return {
    ...safe,
    hintCount: hints.length,
    revealedHints: hints.slice(0, Math.max(0, Math.min(revealedCount, hints.length))),
    moduleId: module?._id ?? null,
    courseId: course?._id ?? null,
    courseTitle: course?.title ?? null,
  };
};

// Authoring payload — the full document including `expectedOutput` and hint
// text. Gated on course ownership (admins may read any lesson).
const getLessonForAuthor = async (lessonId, userId, role) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  if (role !== 'admin') {
    const module = await Module.findById(lesson.moduleId);
    const course = module && (await Course.findById(module.courseId));
    if (!course || course.instructor.toString() !== userId.toString()) {
      throw forbidden('Only the course instructor can view this lesson');
    }
  }
  return lesson;
};

const updateLesson = async (lessonId, instructorId, updates) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  const module = await Module.findById(lesson.moduleId);
  const course = await Course.findById(module.courseId);
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can edit this lesson');

  Object.assign(lesson, pick(updates, LESSON_WRITABLE));
  return lesson.save();
};

// ── Enrolment ─────────────────────────────────────────────────────────────────

const enrollStudent = async (courseId, userId) => {
  const course = await Course.findOne({ _id: courseId, isPublished: true });
  if (!course) throw notFound('Course not found or not published');

  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');

  const alreadyEnrolled = user.enrolledCourses.some(
    (id) => id.toString() === courseId.toString(),
  );
  if (!alreadyEnrolled) {
    user.enrolledCourses.push(courseId);
    course.enrollmentCount += 1;
    await Promise.all([user.save(), course.save()]);
  }
  return { course, user };
};

module.exports = {
  createCourse,
  listPublishedCourses,
  listInstructorCourses,
  getCourseById,
  getEnrolledCourseSummaries,
  publishCourse,
  updateCourse,
  addModule,
  getModuleById,
  updateModule,
  deleteModule,
  deleteLesson,
  addLesson,
  getLessonById,
  getLessonForStudent,
  getLessonForAuthor,
  updateLesson,
  enrollStudent,
};
