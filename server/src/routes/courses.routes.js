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

// GET /api/courses/:id — course tree (modules + lesson metadata).
// `attachUser` is needed to identify the viewer: unpublished drafts are visible
// only to the owning instructor and admins, and the instructor course editor
// reads its drafts through this route.
router.get('/:id', requireAuth, attachUser, async (req, res, next) => {
  try {
    const course = await courseService.getCourseById(req.params.id, {
      id: req.dbUser._id,
      role: req.dbUser.role,
    });
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
