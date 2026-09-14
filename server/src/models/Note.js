const mongoose = require('mongoose');

// Learner notes (S7 D5). One note per (user, lesson) and optionally one per
// (user, module) — `scope` + `targetId` carry that identity; the remaining refs
// are denormalised so the Notes page can render "Course · Module · Lesson"
// without a join per row. Student saves also stamp `noteUpdatedAt` on the
// DynamoDB progress item (done by noteService in Phase 1-C, not here).
const NOTE_SCOPES = Object.freeze(['lesson', 'module']);
const NOTE_BODY_MAX = 20_000;

const noteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scope: { type: String, enum: NOTE_SCOPES, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    body: { type: String, required: true, maxlength: NOTE_BODY_MAX },
  },
  { timestamps: true },
);

noteSchema.index({ userId: 1, scope: 1, targetId: 1 }, { unique: true });
noteSchema.index({ userId: 1, updatedAt: -1 });

const Note = mongoose.model('Note', noteSchema);
module.exports = { Note, NOTE_SCOPES, NOTE_BODY_MAX };
