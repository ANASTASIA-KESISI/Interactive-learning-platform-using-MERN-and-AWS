const express = require('express');
const courseService = require('../services/courseService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

const router = express.Router();

// ── Public / student ──────────────────────────────────────────────────────────

// GET /api/courses — list all published courses
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { category } = req.query;
    const courses = await courseService.listPublishedCourses(category ? { category } : {});
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/:id — full course tree (modules + lessons)
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const course = await courseService.getCourseById(req.params.id);
    res.json({ data: course });
  } catch (err) {
    next(err);
  }
});

// POST /api/courses/:id/enroll
router.post(
  '/:id/enroll',
  requireAuth,
  requireRole('student'),
  attachUser,
  async (req, res, next) => {
    try {
      const { course } = await courseService.enrollStudent(req.params.id, req.dbUser._id);
      res.json({ data: { message: 'Enrolled successfully', courseId: course._id } });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
