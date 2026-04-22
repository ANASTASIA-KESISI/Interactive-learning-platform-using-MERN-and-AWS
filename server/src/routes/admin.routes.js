const express = require('express');
const { User } = require('../models/User');
const { Course } = require('../models/Course');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const { badRequest, notFound } = require('../utils/httpError');
const { ROLES } = require('../models/User');

const router = express.Router();
const adminAuth = [requireAuth, requireRole('admin'), attachUser];

// GET /api/admin/kpis
router.get('/kpis', ...adminAuth, async (_req, res, next) => {
  try {
    const [totalUsers, totalCourses, publishedCourses] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments(),
      Course.countDocuments({ isPublished: true }),
    ]);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyActiveUsers = await User.countDocuments({ lastActiveAt: { $gte: weekAgo } });

    res.json({ data: { totalUsers, totalCourses, publishedCourses, weeklyActiveUsers } });
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
router.patch('/users/:id/role', ...adminAuth, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!ROLES.includes(role)) throw badRequest(`Invalid role: ${role}`);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { new: true },
    ).select('-__v');
    if (!user) throw notFound('User not found');

    res.json({ data: user });
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

module.exports = router;
