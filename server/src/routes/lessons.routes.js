const express = require('express');
const courseService = require('../services/courseService');
const progressService = require('../services/progressService');
const codeRunnerService = require('../services/codeRunnerService');
const gamificationService = require('../services/gamificationService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

const router = express.Router();

// GET /api/lessons/:id — lesson content for student
router.get('/:id', requireAuth, requireRole(['student', 'instructor', 'admin']), async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonForStudent(req.params.id);
    res.json({ data: lesson });
  } catch (err) {
    next(err);
  }
});

// POST /api/lessons/:id/hint — reveal the next hint (analytics event)
router.post(
  '/:id/hint',
  requireAuth,
  requireRole('student'),
  attachUser,
  async (req, res, next) => {
    try {
      const lesson = await courseService.getLessonById(req.params.id);
      const { hintIndex } = req.body;

      if (hintIndex === undefined || hintIndex < 0 || hintIndex >= lesson.hints.length) {
        return res.status(400).json({ error: { message: 'Invalid hintIndex' } });
      }

      await progressService.recordHintReveal(req.dbUser._id.toString(), req.params.id);

      res.json({ data: { hint: lesson.hints[hintIndex] } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/lessons/:id/submit — execute code, record progress, apply gamification
// This is the primary learner interaction endpoint. Response is intentionally
// aggregated so the client updates in one round-trip (user-centric API design).
router.post(
  '/:id/submit',
  requireAuth,
  requireRole('student'),
  attachUser,
  async (req, res, next) => {
    try {
      const lesson = await courseService.getLessonById(req.params.id);
      const { code } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: { message: 'code is required' } });
      }

      const runResult = await codeRunnerService.run(code, lesson.expectedOutput);

      const progressUpdate = await progressService.recordSubmission(
        req.dbUser._id.toString(),
        req.params.id,
        runResult,
      );

      let gamificationResult = { xpDelta: 0, newBadges: [] };
      if (runResult.passed && progressUpdate.firstCompletion) {
        gamificationResult = await gamificationService.onLessonCompleted(
          req.dbUser,
          lesson.xpReward,
        );
      }

      res.json({
        data: {
          execution: runResult,
          progress: progressUpdate,
          xpDelta: gamificationResult.xpDelta,
          newBadges: gamificationResult.newBadges,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
