const express = require('express');
const courseService = require('../services/courseService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const { forbidden } = require('../utils/httpError');

const router = express.Router();

const auth = [requireAuth, requireRole(['instructor', 'admin']), attachUser];

// GET /api/instructor/courses — every course owned by the caller (drafts + published)
router.get('/courses', ...auth, async (req, res, next) => {
  try {
    const courses = await courseService.listInstructorCourses(req.dbUser._id);
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/courses
router.post('/courses', ...auth, async (req, res, next) => {
  try {
    const course = await courseService.createCourse(req.dbUser._id, req.body);
    res.status(201).json({ data: course });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/instructor/courses/:id
router.patch('/courses/:id', ...auth, async (req, res, next) => {
  try {
    const course = await courseService.updateCourse(req.params.id, req.dbUser._id, req.body);
    res.json({ data: course });
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/courses/:id/publish
router.post('/courses/:id/publish', ...auth, async (req, res, next) => {
  try {
    const course = await courseService.publishCourse(req.params.id, req.dbUser._id);
    res.json({ data: course });
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/courses/:id/modules
router.post('/courses/:id/modules', ...auth, async (req, res, next) => {
  try {
    const module = await courseService.addModule(req.params.id, req.dbUser._id, req.body);
    res.status(201).json({ data: module });
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/modules/:id/lessons
router.post('/modules/:id/lessons', ...auth, async (req, res, next) => {
  try {
    const lesson = await courseService.addLesson(req.params.id, req.dbUser._id, req.body);
    res.status(201).json({ data: lesson });
  } catch (err) {
    next(err);
  }
});

// GET /api/instructor/lessons/:id — full lesson for authoring.
// The learner endpoint (GET /api/lessons/:id) withholds `expectedOutput` and
// hint text, so the editor reads through this ownership-gated route instead.
router.get('/lessons/:id', ...auth, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonForAuthor(
      req.params.id,
      req.dbUser._id,
      req.dbUser.role,
    );
    res.json({ data: lesson });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/instructor/lessons/:id
router.patch('/lessons/:id', ...auth, async (req, res, next) => {
  try {
    const lesson = await courseService.updateLesson(req.params.id, req.dbUser._id, req.body);
    res.json({ data: lesson });
  } catch (err) {
    next(err);
  }
});

// GET /api/instructor/courses/:id/analytics
// Per-lesson aggregates across all learners (pass rate, hint usage, time-on-task).
// Admins can view any course; instructors only their own.
router.get('/courses/:id/analytics', ...auth, async (req, res, next) => {
  try {
    const course = await courseService.getCourseById(req.params.id, {
      id: req.dbUser._id,
      role: req.dbUser.role,
    });
    if (
      req.dbUser.role !== 'admin' &&
      course.instructor._id.toString() !== req.dbUser._id.toString()
    ) {
      throw forbidden('Only the course instructor can view analytics');
    }

    const lessons = course.modules.flatMap((m) =>
      m.lessons.map((l) => ({
        lessonId: l._id.toString(),
        title: l.title,
        moduleTitle: m.title,
        type: l.type,
      })),
    );

    const aggregates = await progressService.getCourseAnalytics(
      lessons.map((l) => l.lessonId),
    );

    const lessonsAnalytics = lessons.map((meta, i) => ({ ...meta, ...aggregates[i] }));

    const totalLearners = course.enrollmentCount || 0;
    const totalCompletions = aggregates.reduce((s, a) => s + a.completions, 0);
    const totalPossible = totalLearners * lessons.length;
    const overallCompletionRate =
      totalPossible > 0 ? Math.round((totalCompletions / totalPossible) * 100) : 0;

    res.json({
      data: {
        courseId: course._id,
        courseTitle: course.title,
        totalLearners,
        totalLessons: lessons.length,
        overallCompletionRate,
        lessons: lessonsAnalytics,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
