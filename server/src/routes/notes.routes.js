const express = require('express');
const noteService = require('../services/noteService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');

// Mounted at /api/notes in app.js. Thin handlers: ownership scoping, the
// hierarchy walk that derives courseId/moduleId/lessonId, the 20 000-character
// cap and the empty-body delete all live in noteService.
const router = express.Router();

// Everyone signed in can take notes — instructors and admins annotate their own
// lessons while previewing them. Only students' saves stamp DynamoDB, which the
// service decides from the role attached here (never from the request body).
const noteAuth = [requireAuth, requireRole(['student', 'instructor', 'admin']), attachUser];

// The one field the client may send. Rejected here so a malformed request never
// reaches Mongo, and repeated because every write endpoint validates its own
// input (CLAUDE.md — server-side validation on every endpoint).
const readBody = (req, res) => {
  const { body } = req.body || {};
  if (typeof body !== 'string') {
    res.status(400).json({ error: { message: 'body must be a string' } });
    return null;
  }
  return body;
};

// GET /api/notes — my notes, newest first, with course/module/lesson context.
router.get('/', ...noteAuth, async (req, res, next) => {
  try {
    res.json({ data: await noteService.listForUser(req.dbUser._id) });
  } catch (err) {
    next(err);
  }
});

// GET /api/notes/lesson/:lessonId — `null` when nothing has been written yet.
router.get('/lesson/:lessonId', ...noteAuth, async (req, res, next) => {
  try {
    const note = await noteService.getByTarget(req.dbUser._id, 'lesson', req.params.lessonId);
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notes/lesson/:lessonId — upsert; an empty body deletes the note.
router.put('/lesson/:lessonId', ...noteAuth, async (req, res, next) => {
  try {
    const body = readBody(req, res);
    if (body === null) return;

    const note = await noteService.upsert(req.dbUser._id, 'lesson', req.params.lessonId, body, {
      role: req.dbUser.role,
    });
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
});

// GET /api/notes/module/:moduleId
router.get('/module/:moduleId', ...noteAuth, async (req, res, next) => {
  try {
    const note = await noteService.getByTarget(req.dbUser._id, 'module', req.params.moduleId);
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notes/module/:moduleId
router.put('/module/:moduleId', ...noteAuth, async (req, res, next) => {
  try {
    const body = readBody(req, res);
    if (body === null) return;

    const note = await noteService.upsert(req.dbUser._id, 'module', req.params.moduleId, body, {
      role: req.dbUser.role,
    });
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notes/:id — 404 for a note that is not mine, same as one that
// does not exist (the service scopes the delete by userId).
router.delete('/:id', ...noteAuth, async (req, res, next) => {
  try {
    res.json({ data: await noteService.remove(req.dbUser._id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
