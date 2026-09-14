const express = require('express');
const messageService = require('../services/messageService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

// Mounted at /api/messages in app.js. One thread per (student, course), plain
// text, polled by the client (S7 D6). Handlers stay thin: every authorisation
// decision — including which student's thread the caller is actually allowed to
// address — is made in messageService.
const router = express.Router();

const messagingAuth = [requireAuth, requireRole(['student', 'instructor', 'admin']), attachUser];

// The viewer is built from the Mongo user the token resolved to, never from the
// request payload: a `role` or `studentId` sent by the client is ignored.
const viewerOf = (req) => ({ id: req.dbUser._id.toString(), role: req.dbUser.role });

// GET /api/messages/threads — the caller's conversations, most recent first.
router.get('/threads', ...messagingAuth, async (req, res, next) => {
  try {
    const viewer = viewerOf(req);
    res.json({ data: await messageService.listThreads(viewer.id, viewer.role) });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/courses/:courseId?studentId= — the thread itself.
// `studentId` is required for instructor/admin callers and ignored for a
// student, who only ever has one thread per course.
router.get('/courses/:courseId', ...messagingAuth, async (req, res, next) => {
  try {
    const thread = await messageService.getThread({
      courseId: req.params.courseId,
      studentId: req.query.studentId,
      viewer: viewerOf(req),
    });
    res.json({ data: thread });
  } catch (err) {
    next(err);
  }
});

// POST /api/messages/courses/:courseId — { body, lessonId?, studentId? }
router.post('/courses/:courseId', ...messagingAuth, async (req, res, next) => {
  try {
    const message = await messageService.send({
      courseId: req.params.courseId,
      studentId: req.body?.studentId,
      lessonId: req.body?.lessonId,
      body: req.body?.body,
      sender: viewerOf(req),
    });
    res.status(201).json({ data: message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
