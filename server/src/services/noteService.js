const { Note, NOTE_SCOPES, NOTE_BODY_MAX } = require('../models/Note');
const { Lesson } = require('../models/Lesson');
const { Module } = require('../models/Module');
const { Course } = require('../models/Course');
const progressService = require('./progressService');
const gamificationService = require('./gamificationService');
const logger = require('../utils/logger');
const { badRequest, notFound } = require('../utils/httpError');

// Learner notes (S7 D5). Two invariants hold every function in this file
// together:
//
//   1. Every query is scoped by `userId`. A note is private user content and
//      the only identifier the client controls is the note/target id — so
//      ownership is part of the filter, never a check performed after a read.
//   2. `courseId`/`moduleId`/`lessonId` are derived here by walking
//      Lesson -> Module -> Course. They are denormalised onto the document so
//      the Notes page can render "Course · Module · Lesson" without a join per
//      row, which makes them exactly the kind of field a caller must not be
//      able to set (same mass-assignment class as S5.5 B3).
//
// Bodies are plain text end to end: stored verbatim, rendered in a textarea and
// in a pre-wrapped block, never through the Markdown pipeline.

const OBJECT_ID = /^[a-f\d]{24}$/i;

const asId = (value, field) => {
  const id = value === null || value === undefined ? value : String(value);
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw badRequest(`${field} must be a valid id`);
  return id;
};

const assertScope = (scope) => {
  if (!NOTE_SCOPES.includes(scope)) throw badRequest('scope must be "lesson" or "module"');
  return scope;
};

const idString = (value) => (value === null || value === undefined ? null : value.toString());

// The shape the panels and the modal read back. Ids leave as strings so the
// client never has to care that Mongo hands them over as ObjectIds.
const serialise = (note) => ({
  id: idString(note._id),
  scope: note.scope,
  targetId: idString(note.targetId),
  courseId: idString(note.courseId),
  moduleId: idString(note.moduleId),
  lessonId: idString(note.lessonId),
  body: note.body,
  createdAt: note.createdAt ?? null,
  updatedAt: note.updatedAt ?? null,
});

// Walks the content hierarchy for the note's placement. A target that does not
// exist is a 404 rather than a note pointing at nothing.
const resolveTarget = async (scope, targetId) => {
  if (scope === 'module') {
    const module = await Module.findById(targetId).select('_id title courseId').lean();
    if (!module) throw notFound('Module not found');
    return { courseId: module.courseId, moduleId: module._id, lessonId: undefined };
  }

  const lesson = await Lesson.findById(targetId).select('_id title moduleId').lean();
  if (!lesson) throw notFound('Lesson not found');

  const module = await Module.findById(lesson.moduleId).select('_id title courseId').lean();
  if (!module) throw notFound('Lesson not found');

  return { courseId: module.courseId, moduleId: module._id, lessonId: lesson._id };
};

const uniqueIds = (values) => {
  const seen = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    seen.set(value.toString(), value);
  }
  return [...seen.values()];
};

const byId = (docs) => new Map((docs || []).map((doc) => [doc._id.toString(), doc]));

// ── Read ──────────────────────────────────────────────────────────────────────

// GET /api/notes. Newest first, each row carrying the course/module/lesson
// titles the card needs. Three batched `$in` lookups rather than a populate per
// note: a learner working through a course accumulates one note per lesson, so
// the per-note version would be dozens of round-trips for a single page view.
const listForUser = async (userId) => {
  const owner = asId(userId, 'userId');
  const notes = await Note.find({ userId: owner }).sort({ updatedAt: -1 }).lean();
  if (!notes.length) return [];

  const lessonIds = uniqueIds(notes.map((note) => note.lessonId));
  const [courses, modules, lessons] = await Promise.all([
    Course.find({ _id: { $in: uniqueIds(notes.map((note) => note.courseId)) } })
      .select('_id title icon')
      .lean(),
    Module.find({ _id: { $in: uniqueIds(notes.map((note) => note.moduleId)) } })
      .select('_id title')
      .lean(),
    lessonIds.length
      ? Lesson.find({ _id: { $in: lessonIds } })
          .select('_id title')
          .lean()
      : Promise.resolve([]),
  ]);

  const courseById = byId(courses);
  const moduleById = byId(modules);
  const lessonById = byId(lessons);

  // A referenced course/module/lesson can be deleted out from under a note; the
  // card then degrades to "no context" rather than dropping the learner's text.
  return notes.map((note) => {
    const course = courseById.get(idString(note.courseId));
    const module = moduleById.get(idString(note.moduleId));
    const lesson = note.lessonId ? lessonById.get(idString(note.lessonId)) : null;

    return {
      ...serialise(note),
      course: course
        ? { id: course._id.toString(), title: course.title, icon: course.icon ?? null }
        : null,
      module: module ? { id: module._id.toString(), title: module.title } : null,
      lesson: lesson ? { id: lesson._id.toString(), title: lesson.title } : null,
    };
  });
};

// The autosaving panels call this on mount. `null` — not a 404 — is the normal
// "you have not written anything here yet" answer.
const getByTarget = async (userId, scope, targetId) => {
  const owner = asId(userId, 'userId');
  assertScope(scope);
  const target = asId(targetId, 'targetId');

  const note = await Note.findOne({ userId: owner, scope, targetId: target }).lean();
  return note ? serialise(note) : null;
};

// ── Write ─────────────────────────────────────────────────────────────────────

// `role` is supplied by the route from the authenticated user, never from the
// request body. Only students stamp DynamoDB: instructors and admins take notes
// while previewing their own lessons, and counting those as learner activity
// would pollute the engagement metrics the pilot evaluates (same rule as the
// preview-don't-record path in lessons.routes.js).
const upsert = async (userId, scope, targetId, body, { role } = {}) => {
  const owner = asId(userId, 'userId');
  assertScope(scope);
  const target = asId(targetId, 'targetId');

  if (typeof body !== 'string') throw badRequest('body must be a string');
  const text = body.trim();
  if (text.length > NOTE_BODY_MAX) {
    throw badRequest(`body must be ${NOTE_BODY_MAX} characters or fewer`, {
      length: text.length,
      max: NOTE_BODY_MAX,
    });
  }

  // Clearing the textarea means "I no longer need this note". Storing a blank
  // document instead would leave an empty card on the Notes page the learner
  // has no obvious way to remove. Keyed by (userId, scope, targetId), so this
  // path needs no hierarchy walk.
  if (!text) {
    const removed = await Note.findOneAndDelete({ userId: owner, scope, targetId: target }).lean();
    return { deleted: true, id: removed ? idString(removed._id) : null };
  }

  const placement = await resolveTarget(scope, target);

  // The filter's equality fields are what the unique index is built on, and
  // MongoDB copies them into the document it inserts — so the upsert needs to
  // set nothing but the body and the derived placement.
  const note = await Note.findOneAndUpdate(
    { userId: owner, scope, targetId: target },
    {
      $set: {
        body: text,
        courseId: placement.courseId,
        moduleId: placement.moduleId,
        ...(scope === 'lesson' ? { lessonId: placement.lessonId } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  if (role === 'student' && scope === 'lesson') {
    // Best effort: the note is the learner's data and is already durable in
    // Mongo. A Dynamo hiccup must not surface as a failed save (and must not
    // make the client re-send), so it is logged and swallowed.
    try {
      await progressService.recordNoteActivity(owner, target);
    } catch (err) {
      logger.warn('note activity stamp failed', {
        userId: owner,
        lessonId: target,
        error: err.message,
      });
    }
  }

  // The note badges award here rather than waiting for the next lesson pass.
  // A recount, not an increment: deleting notes must not leave the counter
  // stranded above the truth. Best effort for the same reason as the Dynamo
  // stamp above — the note is saved, and a badge that lands one save late is
  // a better failure than a save the learner is told did not happen.
  if (role === 'student') {
    try {
      const noteCount = await Note.countDocuments({ userId: owner });
      await gamificationService.onNotesChanged({ userId: owner, noteCount });
    } catch (err) {
      logger.warn('note badge evaluation failed', { userId: owner, error: err.message });
    }
  }

  return serialise(note);
};

// Ownership is in the filter: another learner's note id simply does not match,
// so the caller can neither delete it nor tell "not yours" from "gone".
const remove = async (userId, noteId) => {
  const owner = asId(userId, 'userId');
  const id = asId(noteId, 'noteId');

  const deleted = await Note.findOneAndDelete({ _id: id, userId: owner }).lean();
  if (!deleted) throw notFound('Note not found');
  return { deleted: true, id: idString(deleted._id) };
};

module.exports = {
  listForUser,
  getByTarget,
  upsert,
  remove,
  NOTE_BODY_MAX,
};
