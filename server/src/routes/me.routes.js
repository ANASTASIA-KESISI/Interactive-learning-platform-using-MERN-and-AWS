const express = require('express');
const profileService = require('../services/profileService');
const progressService = require('../services/progressService');
const logger = require('../utils/logger');
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

// The client mints the id (`crypto.randomUUID()`, 36 chars); the bounds leave
// room for another generator without letting a caller pick the sort key.
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

// POST /api/me/session — body { sessionId }. A session heartbeat (S8 D6): the
// client posts one on load, every 60 s while the tab is visible, and once as
// it goes hidden. Pure telemetry, so it mirrors the time-on-task endpoint —
// 202 with nothing worth reading, and only a student records; any other role
// gets `recorded: false` so an instructor's own browsing never enters the
// pilot's session figures. It sits under the global rate limit; a beat a
// minute per tab does not need another.
router.post('/session', ...meAuth, async (req, res, next) => {
  try {
    if (req.dbUser.role !== 'student') return res.status(202).json({ data: { recorded: false } });

    const sessionId = req.body?.sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      return res.status(400).json({
        error: { message: 'sessionId must be 8–64 characters of A-Z, a-z, 0-9, _ or -' },
      });
    }

    // A Dynamo hiccup must not surface to a learner who did nothing but have
    // a tab open, so this fails quiet like the other counters.
    try {
      await progressService.recordSessionHeartbeat(req.dbUser._id.toString(), sessionId);
    } catch (err) {
      logger.warn('failed to record session heartbeat', { error: err.message });
    }

    return res.status(202).json({ data: { recorded: true } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
