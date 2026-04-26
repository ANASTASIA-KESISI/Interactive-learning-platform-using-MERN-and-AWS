const { Course } = require('../models/Course');
const { Module } = require('../models/Module');
const { Lesson } = require('../models/Lesson');
const { User } = require('../models/User');
const { notFound, forbidden } = require('../utils/httpError');

// ── Course ────────────────────────────────────────────────────────────────────

const createCourse = async (instructorId, data) => {
  const course = await Course.create({ ...data, instructor: instructorId });
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

const getCourseById = async (courseId) => {
  const course = await Course.findById(courseId)
    .populate('instructor', 'firstName lastName email')
    .populate({
      path: 'modules',
      options: { sort: { order: 1 } },
      populate: { path: 'lessons', options: { sort: { order: 1 } } },
    });
  if (!course) throw notFound('Course not found');
  return course;
};

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
  Object.assign(course, updates);
  return course.save();
};

// ── Module ────────────────────────────────────────────────────────────────────

const addModule = async (courseId, instructorId, data) => {
  const course = await Course.findById(courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can add modules');

  const order = course.modules.length;
  const module = await Module.create({ ...data, courseId, order });
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

// ── Lesson ────────────────────────────────────────────────────────────────────

const addLesson = async (moduleId, instructorId, data) => {
  const module = await Module.findById(moduleId).populate('courseId');
  if (!module) throw notFound('Module not found');

  const course = await Course.findById(module.courseId);
  if (!course) throw notFound('Course not found');
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can add lessons');

  const order = module.lessons.length;
  const lesson = await Lesson.create({ ...data, moduleId, order });
  module.lessons.push(lesson._id);
  await module.save();
  return lesson;
};

const getLessonById = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');
  return lesson;
};

// Returns lesson without revealing all hint text — only hint count and
// whether each index has been revealed is managed on the client/progress layer.
const getLessonForStudent = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId).select('-__v');
  if (!lesson) throw notFound('Lesson not found');
  return lesson;
};

const updateLesson = async (lessonId, instructorId, updates) => {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  const module = await Module.findById(lesson.moduleId);
  const course = await Course.findById(module.courseId);
  if (course.instructor.toString() !== instructorId.toString())
    throw forbidden('Only the course instructor can edit this lesson');

  Object.assign(lesson, updates);
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
  publishCourse,
  updateCourse,
  addModule,
  getModuleById,
  addLesson,
  getLessonById,
  getLessonForStudent,
  updateLesson,
  enrollStudent,
};
