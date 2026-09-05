const { Course } = require('../models/Course');
const { Module } = require('../models/Module');
const { Lesson } = require('../models/Lesson');
const { User } = require('../models/User');
const { badRequest, notFound, forbidden } = require('../utils/httpError');
const quizService = require('./quizService');

// Client-writable fields, per resource. Everything else on the document is
// server-owned: spreading `req.body` straight into create/Object.assign let an
// instructor reassign `instructor` (course hijack), forge `enrollmentCount`,
// flip `isPublished` past the publish flow, or re-parent a lesson by setting
// `moduleId` (S5.5 B3).
const COURSE_WRITABLE = [
  'title',
  'description',
  'category',
  'difficulty',
  'departmentId',
  'semester',
  'about',
  'icon',
];
const MODULE_WRITABLE = ['title'];
const LESSON_WRITABLE = [
  'title',
  'type',
  'language',
  'content',
  'task',
  'codeTemplate',
  'expectedOutput',
  'hints',
  'xpReward',
  'questions',
  'passMark',
];

const pick = (source, allowed) =>
  Object.fromEntries(
    Object.entries(source || {}).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    ),
  );

// Caps for the S7 authoring fields (plan §2). Mongoose enforces the enum and
// numeric bounds it knows about, but a cast failure surfaces as a 500 and the
// two Markdown fields have no schema limit at all — an unbounded `about` would
// be echoed to every visitor of the course page.
const MARKDOWN_MAX = 50000;
const ICON_MAX = 8;
const SEMESTER_MIN = 1;
const SEMESTER_MAX = 12;
const OBJECT_ID = /^[a-f\d]{24}$/i;

// '' and null both mean "clear this", matching the authoring form's empty select.
const cleanRef = (value, field) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw badRequest(`${field} must be a valid id`);
  }
  return value;
};

const cleanMarkdown = (value, field) => {
  if (value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  if (value.length > MARKDOWN_MAX) {
    throw badRequest(`${field} must be ${MARKDOWN_MAX} characters or fewer`);
  }
  return value;
};

// Validates only the keys the caller actually sent, so PATCH stays partial.
const cleanCourseInput = (updates) => {
  const clean = { ...updates };
  if ('departmentId' in clean) clean.departmentId = cleanRef(clean.departmentId, 'departmentId');
  if ('semester' in clean) {
    if (clean.semester === null || clean.semester === '') {
      clean.semester = null;
    } else {
      const n = Number(clean.semester);
      if (!Number.isInteger(n) || n < SEMESTER_MIN || n > SEMESTER_MAX) {
        throw badRequest(`semester must be an integer between ${SEMESTER_MIN} and ${SEMESTER_MAX}`);
      }
      clean.semester = n;
    }
  }
  if ('icon' in clean) {
    if (clean.icon === null) clean.icon = '';
    if (typeof clean.icon !== 'string') throw badRequest('icon must be a string');
    clean.icon = clean.icon.trim();
    if (clean.icon.length > ICON_MAX) {
      throw badRequest(`icon must be ${ICON_MAX} characters or fewer`);
    }
  }
  if ('about' in clean) clean.about = cleanMarkdown(clean.about, 'about');
  return clean;
};

const cleanLessonInput = (updates) => {
  const clean = { ...updates };
  if ('task' in clean) clean.task = cleanMarkdown(clean.task, 'task');
  // Quizzes are validated here rather than left to Mongoose: a `correctIndex`
  // pointing past the end of `options` passes every schema rule and produces a
  // quiz nobody can pass, which is only discovered by a learner failing it.
  if ('questions' in clean) clean.questions = quizService.normaliseQuestions(clean.questions);
  if ('passMark' in clean) {
    const n = Number(clean.passMark);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw badRequest('passMark must be an integer between 1 and 100');
    }
    clean.passMark = n;
  }
  return clean;
};

// ── Course ────────────────────────────────────────────────────────────────────

const createCourse = async (instructorId, data) => {
  const course = await Course.create({
    ...cleanCourseInput(pick(data, COURSE_WRITABLE)),
    instructor: instructorId,
  });
  return course;
};

// `filter` is a plain Mongo filter built by the route from an allowlist of
// query params (`category`, `departmentId`, `semester`). Institutional filters
// hit the `{ departmentId, semester }` index (S7 D3).
const listPublishedCourses = (filter = {}) =>
  Course.find({ isPublished: true, ...filter })
    .populate('instructor', 'firstName lastName email avatar')
    .sort({ createdAt: -1 });

// Returns every course owned by an instructor, published or not. Used by the
// authoring dashboard where drafts must be visible alongside live courses.
const listInstructorCourses = (instructorId) =>
  Course.find({ instructor: instructorId })
    // The authoring dashboard groups by semester and labels each course with its
    // department, so the name has to travel with the row — otherwise the page
    // has to fetch the whole university tree just to render a heading.
    .populate('departmentId', 'name code semesterCount')
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
    .populate('instructor', 'firstName lastName email avatar bio')
    .populate('departmentId', 'name code semesterCount universityId')
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

// Course-page payload (S7 §3): the same document `getCourseById` returns, plus
// the flattened institutional/instructor blocks the course hero renders and two
// derived numbers the client would otherwise recompute. Kept separate from
// `getCourseById` because the analytics route and the leaderboard consume the
// Mongoose document, not this shape.
//
// `viewer` may carry `enrolledCourseIds` (the route reads them off the attached
// user) so `viewerEnrolled` is answered without a second user lookup.
const getCourseDetail = async (courseId, viewer = null) => {
  const course = await getCourseById(courseId, viewer);
  const doc = typeof course.toObject === 'function' ? course.toObject() : course;

  // A populated ref whose target was deleted comes back as the bare ObjectId,
  // so only treat it as resolved once it carries a name.
  const dept = doc.departmentId && doc.departmentId.name ? doc.departmentId : null;
  const teacher = doc.instructor && doc.instructor._id ? doc.instructor : null;
  const lessonCount = (doc.modules || []).reduce(
    (sum, module) => sum + (module.lessons ? module.lessons.length : 0),
    0,
  );
  const enrolledIds = (viewer && viewer.enrolledCourseIds) || [];

  return {
    ...doc,
    // Flattened back to an id so the authoring form can round-trip the select.
    departmentId: dept ? dept._id.toString() : (doc.departmentId ?? null),
    department: dept
      ? {
          id: dept._id.toString(),
          name: dept.name,
          code: dept.code,
          semesterCount: dept.semesterCount,
        }
      : null,
    semester: doc.semester ?? null,
    about: doc.about ?? '',
    icon: doc.icon ?? '',
    // `_id` is retained alongside `id`: existing screens compare it against the
    // caller's `dbId` to decide whether to show the authoring affordance.
    instructor: teacher
      ? {
          id: teacher._id.toString(),
          _id: teacher._id,
          firstName: teacher.firstName ?? null,
          lastName: teacher.lastName ?? null,
          avatar: teacher.avatar ?? null,
          bio: teacher.bio ?? null,
        }
      : null,
    lessonCount,
    viewerEnrolled: enrolledIds.some((id) => id.toString() === doc._id.toString()),
  };
};

// Cheap ownership probe for access checks that do not need the whole tree.
const isCourseInstructor = async (courseId, userId) => {
  const course = await Course.findById(courseId).select('instructor').lean();
  if (!course) throw notFound('Course not found');
  return Boolean(userId) && course.instructor.toString() === userId.toString();
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
  Object.assign(course, cleanCourseInput(pick(updates, COURSE_WRITABLE)));
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
  const lesson = await Lesson.create({ ...cleanLessonInput(pick(data, LESSON_WRITABLE)), moduleId, order });
  module.lessons.push(lesson._id);
  await module.save();
  return lesson;
};

const getLessonById = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');
  return lesson;
};

// One deep read of the lesson's whole neighbourhood: its module, its course,
// the course instructor, and every module/lesson id in course order. The lesson
// page's prev/next links and the submit response's `nextLessonId` both read
// from this, so the two can never disagree about what "next" means.
const findLessonWithCourse = (lessonId) =>
  Lesson.findById(lessonId)
    .populate({
      path: 'moduleId',
      select: 'courseId title order',
      populate: {
        path: 'courseId',
        select: 'title instructor modules',
        populate: [
          { path: 'instructor', select: 'firstName lastName avatar' },
          {
            path: 'modules',
            select: 'title order lessons',
            options: { sort: { order: 1 } },
            populate: { path: 'lessons', select: 'order', options: { sort: { order: 1 } } },
          },
        ],
      },
    })
    .lean();

const idOf = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  return id ? id.toString() : null;
};

// Neighbours are resolved across the WHOLE course, module order then lesson
// order — the last lesson of module 1 links to the first of module 2 — so a
// learner can walk a course end to end without going back to the syllabus.
// `null` at either end; a module whose lessons did not populate contributes
// nothing rather than breaking the walk.
const lessonContextFrom = (lesson) => {
  const module = lesson.moduleId && lesson.moduleId._id ? lesson.moduleId : null;
  const course = module && module.courseId && module.courseId._id ? module.courseId : null;
  const teacher = course && course.instructor && course.instructor._id ? course.instructor : null;

  const modules = (course && Array.isArray(course.modules) ? course.modules : [])
    .filter((m) => m && m._id)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const lessonIdsIn = (target) =>
    (target && Array.isArray(target.lessons) ? target.lessons : [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(idOf)
      .filter(Boolean);

  const walk = modules.flatMap(lessonIdsIn);
  const here = walk.indexOf(idOf(lesson));
  const own = module ? modules.find((m) => idOf(m) === idOf(module)) : null;

  return {
    moduleId: module ? module._id : (lesson.moduleId ?? null),
    moduleTitle: module ? (module.title ?? null) : null,
    // The parent module's lessons, in order — the input to the "module
    // completed" check on submit (D7). Ids only, never lesson bodies.
    moduleLessonIds: lessonIdsIn(own),
    courseId: course ? course._id : null,
    courseTitle: course ? (course.title ?? null) : null,
    instructor: teacher
      ? {
          id: teacher._id.toString(),
          firstName: teacher.firstName ?? null,
          lastName: teacher.lastName ?? null,
          avatar: teacher.avatar ?? null,
        }
      : null,
    prevLessonId: here > 0 ? walk[here - 1] : null,
    nextLessonId: here >= 0 && here < walk.length - 1 ? walk[here + 1] : null,
  };
};

// The surrounding context on its own, for callers that already have the lesson
// document: the submit route needs `nextLessonId` and the module's lesson ids,
// not a second copy of the Markdown body.
const getLessonContext = async (lessonId) => {
  const lesson = await findLessonWithCourse(lessonId);
  if (!lesson) throw notFound('Lesson not found');
  return lessonContextFrom(lesson);
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
// Also resolves the surrounding course context: parent course, module title,
// the instructor (for the lesson page's Ask-instructor panel) and the prev/next
// links. `moduleLessonIds` is deliberately NOT forwarded — the client has no
// use for it and the payload stays as narrow as B1 requires.
const getLessonForStudent = async (lessonId, revealedCount = 0) => {
  const lesson = await findLessonWithCourse(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  // `questions` joins `expectedOutput` and hint text on the list of things a
  // learner must never receive: each entry carries `correctIndex` and an
  // `explanation`, so shipping the raw array would let anyone read the answer
  // key out of the network tab and score 100% — corrupting exactly the quiz
  // results the pilot evaluates. Only prompts and options go out; grading
  // happens server-side and the feedback travels on the way back.
  const { expectedOutput, hints = [], questions = [], ...safe } = lesson;
  const { moduleLessonIds, ...context } = lessonContextFrom(lesson);

  return {
    ...safe,
    hintCount: hints.length,
    revealedHints: hints.slice(0, Math.max(0, Math.min(revealedCount, hints.length))),
    questions: quizService.questionsForStudent(questions),
    questionCount: questions.length,
    ...context,
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

  Object.assign(lesson, cleanLessonInput(pick(updates, LESSON_WRITABLE)));
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
  getCourseDetail,
  isCourseInstructor,
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
  getLessonContext,
  getLessonForStudent,
  getLessonForAuthor,
  updateLesson,
  enrollStudent,
};
