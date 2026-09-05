const express = require('express');
const { User } = require('../models/User');
const { Course } = require('../models/Course');
const { Badge, CRITERIA_TYPES } = require('../models/Badge');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const { badRequest, notFound } = require('../utils/httpError');
const authService = require('../services/authService');
const universityService = require('../services/universityService');

const router = express.Router();
const adminAuth = [requireAuth, requireRole('admin'), attachUser];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Active users per week for the last `weeks` weeks, oldest first. `lastActiveAt`
// records only the most recent visit, so a user falls in exactly one bucket —
// these are "users last seen in week N", which is the honest reading of the
// data we keep, not a true rolling-active count.
const activeUsersByWeek = async (weeks) => {
  const now = Date.now();
  const buckets = [];

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(now - (i + 1) * WEEK_MS);
    const end = new Date(now - i * WEEK_MS);
    // eslint-disable-next-line no-await-in-loop
    const activeUsers = await User.countDocuments({
      lastActiveAt: { $gte: start, $lt: end },
    });
    buckets.push({
      weekStart: start.toISOString().slice(0, 10),
      activeUsers,
    });
  }

  return buckets;
};

// GET /api/admin/kpis?weeks=8
router.get('/kpis', ...adminAuth, async (req, res, next) => {
  try {
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);

    const [totalUsers, totalCourses, publishedCourses, usersByRole] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments(),
      Course.countDocuments({ isPublished: true }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ]);

    const weekAgo = new Date(Date.now() - WEEK_MS);
    const weeklyActiveUsers = await User.countDocuments({ lastActiveAt: { $gte: weekAgo } });
    const activeByWeek = await activeUsersByWeek(weeks);

    res.json({
      data: {
        totalUsers,
        totalCourses,
        publishedCourses,
        weeklyActiveUsers,
        usersByRole: Object.fromEntries(usersByRole.map((r) => [r._id, r.count])),
        activeByWeek,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users
router.get('/users', ...adminAuth, async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20 } = req.query;
    const filter = role ? { role } : {};
    const users = await User.find(filter)
      .select('-__v')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await User.countDocuments(filter);
    res.json({ data: users, meta: { total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/role
// Delegates to authService, which moves the user between Cognito groups —
// Cognito owns roles, and a Mongo-only write is overwritten by the next
// request's claim sync. Takes effect for the target user when their token
// next refreshes.
router.patch('/users/:id/role', ...adminAuth, async (req, res, next) => {
  try {
    if (req.params.id === req.dbUser._id.toString()) {
      throw badRequest('You cannot change your own role');
    }

    const user = await authService.setUserRole(req.params.id, req.body.role);
    res.json({
      data: user,
      meta: { note: 'Takes effect when the user next signs in or refreshes their token.' },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/courses
router.get('/courses', ...adminAuth, async (req, res, next) => {
  try {
    const courses = await Course.find()
      .populate('instructor', 'firstName lastName email')
      .sort({ createdAt: -1 });
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/badges — list every badge
router.get('/badges', ...adminAuth, async (_req, res, next) => {
  try {
    const badges = await Badge.find().sort({ 'criteria.threshold': 1 });
    res.json({ data: badges });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/badges — create a badge
router.post('/badges', ...adminAuth, async (req, res, next) => {
  try {
    const { name, description, icon, criteria, xpValue } = req.body;
    if (!name || !description) throw badRequest('name and description are required');
    if (!criteria || !CRITERIA_TYPES.includes(criteria.type)) {
      throw badRequest(`criteria.type must be one of ${CRITERIA_TYPES.join(', ')}`);
    }
    if (typeof criteria.threshold !== 'number' || criteria.threshold < 1) {
      throw badRequest('criteria.threshold must be a positive number');
    }

    const badge = await Badge.create({ name, description, icon, criteria, xpValue });
    res.status(201).json({ data: badge });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/courses/:id/publish
router.patch('/courses/:id/publish', ...adminAuth, async (req, res, next) => {
  try {
    const { isPublished } = req.body;
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { $set: { isPublished: Boolean(isPublished) } },
      { new: true },
    );
    if (!course) throw notFound('Course not found');
    res.json({ data: course });
  } catch (err) {
    next(err);
  }
});

// ── Universities & departments (S7 D3) ────────────────────────────────────────
//
// Reference data every student's signup and course listing depends on, so the
// service refuses deletes that would orphan a reference (409) rather than
// cascading. Validation and the writable-field allowlists live in the service.

// POST /api/admin/universities
router.post('/universities', ...adminAuth, async (req, res, next) => {
  try {
    const university = await universityService.createUniversity(req.body);
    res.status(201).json({ data: university });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/universities/:id
router.patch('/universities/:id', ...adminAuth, async (req, res, next) => {
  try {
    const university = await universityService.updateUniversity(req.params.id, req.body);
    res.json({ data: university });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/universities/:id — 409 while it still has departments
router.delete('/universities/:id', ...adminAuth, async (req, res, next) => {
  try {
    res.json({ data: await universityService.deleteUniversity(req.params.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/universities/:id/departments
router.post('/universities/:id/departments', ...adminAuth, async (req, res, next) => {
  try {
    const department = await universityService.createDepartment(req.params.id, req.body);
    res.status(201).json({ data: department });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/departments/:id
router.patch('/departments/:id', ...adminAuth, async (req, res, next) => {
  try {
    const department = await universityService.updateDepartment(req.params.id, req.body);
    res.json({ data: department });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/departments/:id — 409 while users or courses reference it
router.delete('/departments/:id', ...adminAuth, async (req, res, next) => {
  try {
    res.json({ data: await universityService.deleteDepartment(req.params.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
