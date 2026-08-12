const express = require('express');
const courseService = require('../services/courseService');
const progressService = require('../services/progressService');
const codeRunnerService = require('../services/codeRunnerService');
const gamificationService = require('../services/gamificationService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

const router = express.Router();

// GET /api/lessons/:id — learner-facing lesson content.
// Never includes `expectedOutput` or unrevealed hint text (see
// courseService.getLessonForStudent). Hints the student has already unlocked
// are replayed from their progress record so a refresh doesn't lose them.
router.get(
  '/:id',
  requireAuth,
  requireRole(['student', 'instructor', 'admin']),
  attachUser,
  async (req, res, next) => {
    try {
      let revealedCount = 0;
      if (req.dbUser.role === 'student') {
        const progress = await progressService.getLessonProgress(
          req.dbUser._id.toString(),
          req.params.id,
        );
        revealedCount = progress?.hintsUsed || 0;
      }

      const lesson = await courseService.getLessonForStudent(req.params.id, revealedCount);
      res.json({ data: lesson });
    } catch (err) {
      next(err);
    }
  },
);

// Instructors and admins can call /submit and /hint to preview their own
// lessons end-to-end. Their interactions intentionally do NOT write to the
// progress table or trigger gamification — only `student` events count toward
// pedagogical analytics (preserves the SUS / DynamoDB metric integrity).
const learnerOrPreview = [
  requireAuth,
  requireRole(['student', 'instructor', 'admin']),
  attachUser,
];

// POST /api/lessons/:id/hint — reveal the next hint (analytics event for students)
router.post('/:id/hint', ...learnerOrPreview, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonById(req.params.id);
    const { hintIndex } = req.body;

    if (!Number.isInteger(hintIndex) || hintIndex < 0 || hintIndex >= lesson.hints.length) {
      return res.status(400).json({ error: { message: 'Invalid hintIndex' } });
    }

    if (req.dbUser.role === 'student') {
      await progressService.recordHintReveal(req.dbUser._id.toString(), req.params.id, hintIndex);
    }

    res.json({ data: { hint: lesson.hints[hintIndex] } });
  } catch (err) {
    next(err);
  }
});

// POST /api/lessons/:id/submit — execute code, record progress, apply gamification
// This is the primary learner interaction endpoint. Response is intentionally
// aggregated so the client updates in one round-trip (user-centric API design).
router.post('/:id/submit', ...learnerOrPreview, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonById(req.params.id);
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: { message: 'code is required' } });
    }

    const runResult = await codeRunnerService.run(code, lesson.expectedOutput, lesson.language);

    let progressUpdate = { previewMode: true };
    let gamificationResult = { xpDelta: 0, newBadges: [] };

    if (req.dbUser.role === 'student') {
      progressUpdate = await progressService.recordSubmission(
        req.dbUser._id.toString(),
        req.params.id,
        runResult,
        code,
      );
      if (runResult.passed && progressUpdate.firstCompletion) {
        gamificationResult = await gamificationService.onLessonCompleted({
          userId: req.dbUser._id,
          xpReward: lesson.xpReward,
          hintsUsed: progressUpdate.hintsUsed,
        });
      }
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
});

module.exports = router;
