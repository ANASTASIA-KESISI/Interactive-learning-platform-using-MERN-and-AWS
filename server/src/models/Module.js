const mongoose = require('mongoose');

const moduleSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 0 },
    lessons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' }],
    // `quizId` used to live here, referencing a `Quiz` model that was never
    // written — populating it would have thrown MissingSchemaError. Quizzes are
    // now lessons with `type: 'quiz'` and a `questions[]` body, so a module's
    // quiz is simply one of its `lessons` and needs no separate reference.
  },
  { timestamps: true },
);

moduleSchema.index({ courseId: 1, order: 1 });

const Module = mongoose.model('Module', moduleSchema);
module.exports = { Module };
