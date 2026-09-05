const express = require('express');
const profileService = require('../services/profileService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

const router = express.Router();

// Every signed-in role has a profile — the shell calls this once per session to
// resolve the Mongo user id, level/rank and the unread bell count.
const meAuth = [requireAuth, requireRole(['student', 'instructor', 'admin']), attachUser];

// GET /api/me
router.get('/', ...meAuth, async (req, res, next) => {
  try {
    res.json({ data: await profileService.getMe(req.dbUser) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/me — self-service profile fields only; the service holds the
// allowlist and the university/department consistency check.
router.patch('/', ...meAuth, async (req, res, next) => {
  try {
    res.json({ data: await profileService.updateMe(req.dbUser._id, req.body) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
