const express = require('express');
const courseService = require('../services/courseService');
const leaderboardService = require('../services/leaderboardService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const { badRequest, forbidden } = require('../utils/httpError');

const router = express.Router();

const OBJECT_ID = /^[a-f\d]{24}$/i;

// ── Public / student ──────────────────────────────────────────────────────────

// GET /api/courses?category=&departmentId=&semester= — list published courses.
// Query params are validated here and mapped onto an explicit filter so the
// service never sees a raw query object.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { category, departmentId, semester } = req.query;
    const filter = {};
    if (typeof category === 'string' && category) filter.category = category;
    if (departmentId !== undefined) {
      if (typeof departmentId !== 'string' || !OBJECT_ID.test(departmentId)) {
        throw badRequest('departmentId must be a valid id');
      }
      filter.departmentId = departmentId;
    }
    if (semester !== undefined) {
      const n = Number(semester);
      if (!Number.isInteger(n) || n < 1 || n > 12) {
        throw badRequest('semester must be an integer between 1 and 12');
      }
      filter.semester = n;
    }
    const courses = await courseService.listPublishedCourses(filter);
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/:id — course tree (modules + lesson metadata) plus the
// hero/instructor/institution blocks the course page renders.
// `attachUser` is needed to identify the viewer: unpublished drafts are visible
// only to the owning instructor and admins, and the instructor course editor
// reads its drafts through this route.
router.get('/:id', requireAuth, attachUser, async (req, res, next) => {
  try {
    const course = await courseService.getCourseDetail(req.params.id, {
      id: req.dbUser._id,
      role: req.dbUser.role,
      enrolledCourseIds: req.dbUser.enrolledCourses || [],
    });
    res.json({ data: course });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/:id/leaderboard?window=7d|30d|all — lessons completed per
// learner in this course (S7 D9). The board publishes one learner's activity to
// another, so it is deliberately narrow: enrolled students, the owning
// instructor and admins. Everyone else gets a 403 rather than an empty board.
router.get('/:id/leaderboard', requireAuth, attachUser, async (req, res, next) => {
  try {
    const window = req.query.window === undefined ? '7d' : req.query.window;
    if (!leaderboardService.WINDOWS.includes(window)) {
      throw badRequest(`window must be one of ${leaderboardService.WINDOWS.join(', ')}`);
    }
    if (!OBJECT_ID.test(req.params.id)) throw badRequest('Invalid course id');

    const { _id: viewerId, role } = req.dbUser;
    const enrolled = (req.dbUser.enrolledCourses || []).some(
      (id) => id.toString() === req.params.id,
    );
    const allowed =
      role === 'admin' ||
      enrolled ||
      (await courseService.isCourseInstructor(req.params.id, viewerId));
    if (!allowed) {
      throw forbidden('Only enrolled learners and the course instructor can view this leaderboard');
    }

    const data = await leaderboardService.getCourseLeaderboard(req.params.id, {
      window,
      viewerId: viewerId.toString(),
      viewerRole: role,
    });
    res.json({ data });
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
