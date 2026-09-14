const express = require('express');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

const router = express.Router();

// GET /api/student/progress — full progress history for the authenticated student
router.get(
  '/progress',
  requireAuth,
  requireRole('student'),
  attachUser,
  async (req, res, next) => {
    try {
      const records = await progressService.getStudentProgress(req.dbUser._id.toString());
      res.json({ data: records });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
