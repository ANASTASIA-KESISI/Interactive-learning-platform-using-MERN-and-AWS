const express = require('express');
const courseService = require('../services/courseService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

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

// PATCH /api/instructor/lessons/:id
router.patch('/lessons/:id', ...auth, async (req, res, next) => {
  try {
    const lesson = await courseService.updateLesson(req.params.id, req.dbUser._id, req.body);
    res.json({ data: lesson });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
