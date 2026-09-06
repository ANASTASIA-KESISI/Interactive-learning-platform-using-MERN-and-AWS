const express = require('express');
const courseService = require('../services/courseService');
const progressService = require('../services/progressService');
const codeRunnerService = require('../services/codeRunnerService');
const authService = require('../services/authService');
const gamificationService = require('../services/gamificationService');
const quizService = require('../services/quizService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const logger = require('../utils/logger');

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

// Rejects anything that is not a non-empty string before it reaches the runner
// — the adapter contract is `{ code: string }` and a non-string would be a
// cast error inside the sandbox rather than a 400 here.
const readCode = (body) => {
  const code = body && body.code;
  return !code || typeof code !== 'string' ? null : code;
};

// POST /api/lessons/:id/run — execute without validating (S7 D10).
// The editor's Run button: the learner experiments, sees stdout, and burns no
// attempt. The response carries NO `passed` and no `expectedOutput` — a
// caller must not be able to discover the answer from an endpoint that never
// needed it (S5.5 B1); only /submit compares against it, server-side.
router.post('/:id/run', ...learnerOrPreview, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonById(req.params.id);
    const code = readCode(req.body);

    if (!code) {
      return res.status(400).json({ error: { message: 'code is required' } });
    }

    const execution = await codeRunnerService.execute(code, lesson.language);

    if (req.dbUser.role === 'student') {
      // Engagement telemetry, not part of the contract: a Dynamo hiccup must
      // not cost the learner the output they just waited for.
      try {
        await progressService.recordRun(req.dbUser._id.toString(), req.params.id);
      } catch (err) {
        logger.warn('failed to record run', {
          lessonId: req.params.id,
          error: err.message,
        });
      }
    }

    res.json({ data: { execution } });
  } catch (err) {
    next(err);
  }
});

// D7: "Module completed" is shown only when this submission closed the last
// open lesson in the module. Composed from two services the route already
// depends on — the module's lesson ids (Mongo) against the learner's completed
// records (Dynamo). The lesson just submitted is seeded into the set because
// the query that reads it back is only eventually consistent.
// One read answers both questions a pass raises: did this finish the module
// (the overlay's module-complete state, D7) and did it finish the course (the
// `courses_completed` badge criterion). Asking them separately would read the
// learner's whole progress history twice on every pass.
const completionFlags = async (userId, lessonId, context) => {
  const moduleIds = context?.moduleLessonIds ?? [];
  const courseIds = context?.courseLessonIds ?? [];
  if (moduleIds.length === 0 && courseIds.length === 0) {
    return { moduleCompleted: false, courseCompleted: false };
  }

  const records = await progressService.getStudentProgress(userId);
  const completed = new Set(
    records.filter((r) => r.status === 'completed').map((r) => String(r.lessonId)),
  );
  completed.add(String(lessonId));

  const allDone = (ids) => ids.length > 0 && ids.every((id) => completed.has(String(id)));
  return { moduleCompleted: allDone(moduleIds), courseCompleted: allDone(courseIds) };
};

// POST /api/lessons/:id/submit — execute code, record progress, apply gamification
// This is the primary learner interaction endpoint. Response is intentionally
// aggregated so the client updates in one round-trip (user-centric API design).
router.post('/:id/submit', ...learnerOrPreview, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonById(req.params.id);
    const code = readCode(req.body);

    if (!code) {
      return res.status(400).json({ error: { message: 'code is required' } });
    }

    const runResult = await codeRunnerService.run(code, lesson.expectedOutput, lesson.language);
    const context = await courseService.getLessonContext(req.params.id);

    let progressUpdate = { previewMode: true };
    let gamificationResult = { xpDelta: 0, newBadges: [] };
    // Preview keeps every learner-derived field inert: an instructor testing
    // their own lesson must neither read nor write progress (SUS/Dynamo metric
    // integrity), so no gamification block and no module completion for them.
    let gamification = null;
    let moduleCompleted = false;

    if (req.dbUser.role === 'student') {
      progressUpdate = await progressService.recordSubmission(
        req.dbUser._id.toString(),
        req.params.id,
        runResult,
        code,
      );

      let user = req.dbUser;
      if (runResult.passed && progressUpdate.firstCompletion) {
        // Resolved before the award, not after: whether this pass finished the
        // course is an input to it.
        const flags = await completionFlags(
          req.dbUser._id.toString(),
          req.params.id,
          context,
        );
        moduleCompleted = flags.moduleCompleted;

        gamificationResult = await gamificationService.onLessonCompleted({
          userId: req.dbUser._id,
          xpReward: lesson.xpReward,
          hintsUsed: progressUpdate.hintsUsed,
          lessonType: lesson.type,
          courseCompleted: flags.courseCompleted,
        });
        // `onLessonCompleted` saves its own copy of the document, so the one
        // `attachUser` loaded is now stale on xp, streak and badges — re-read
        // before summarising or the overlay shows the pre-award numbers.
        user = (await authService.getByCognitoId(req.user.cognitoId)) || req.dbUser;
      }

      gamification = gamificationService.gamificationSummary(user);
    }

    res.json({
      data: {
        execution: runResult,
        progress: progressUpdate,
        xpDelta: gamificationResult.xpDelta,
        newBadges: gamificationResult.newBadges,
        gamification,
        moduleCompleted,
        nextLessonId: context.nextLessonId,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lessons/:id/quiz — grade an answer sheet for a `type: 'quiz'` lesson.
//
// Deliberately a sibling of /submit rather than a branch inside it: the two
// share every downstream effect (progress, gamification, module completion,
// the celebration payload) but nothing of their input or grading. The response
// shape is kept identical apart from `quiz` replacing `execution`, so the
// client's completion overlay consumes one contract.
router.post('/:id/quiz', ...learnerOrPreview, async (req, res, next) => {
  try {
    const lesson = await courseService.getLessonById(req.params.id);
    if (lesson.type !== 'quiz') {
      return res.status(400).json({ error: { message: 'This lesson is not a quiz' } });
    }

    // Grading first: it validates the sheet and throws 400 on a malformed one,
    // so a bad request never reaches the progress table as an attempt.
    const quiz = quizService.grade(lesson, req.body?.answers);
    const context = await courseService.getLessonContext(req.params.id);

    let progressUpdate = { previewMode: true };
    let gamificationResult = { xpDelta: 0, newBadges: [] };
    let gamification = null;
    let moduleCompleted = false;

    if (req.dbUser.role === 'student') {
      // The learner's answer sheet is what they "submitted", so it takes the
      // place of source code in the transcript — the same per-attempt record
      // the pilot reads for coding exercises, in the shape a quiz has.
      progressUpdate = await progressService.recordSubmission(
        req.dbUser._id.toString(),
        req.params.id,
        {
          passed: quiz.passed,
          stdout: `${quiz.correctCount}/${quiz.total} correct (${quiz.score}%)`,
          error: null,
        },
        JSON.stringify(req.body?.answers ?? []),
      );

      let user = req.dbUser;
      if (quiz.passed && progressUpdate.firstCompletion) {
        const flags = await completionFlags(
          req.dbUser._id.toString(),
          req.params.id,
          context,
        );
        moduleCompleted = flags.moduleCompleted;

        gamificationResult = await gamificationService.onLessonCompleted({
          userId: req.dbUser._id,
          xpReward: lesson.xpReward,
          hintsUsed: progressUpdate.hintsUsed,
          lessonType: lesson.type,
          courseCompleted: flags.courseCompleted,
        });
        user = (await authService.getByCognitoId(req.user.cognitoId)) || req.dbUser;
      }

      gamification = gamificationService.gamificationSummary(user);
    }

    res.json({
      data: {
        quiz,
        progress: progressUpdate,
        xpDelta: gamificationResult.xpDelta,
        newBadges: gamificationResult.newBadges,
        gamification,
        moduleCompleted,
        nextLessonId: context.nextLessonId,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
