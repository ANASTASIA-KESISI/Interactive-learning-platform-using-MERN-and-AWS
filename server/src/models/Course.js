const mongoose = require('mongoose');

const DIFFICULTY_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, trim: true, index: true },
    difficulty: { type: String, enum: DIFFICULTY_LEVELS, default: 'beginner' },
    modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }],
    enrollmentCount: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

courseSchema.index({ isPublished: 1, category: 1 });

const Course = mongoose.model('Course', courseSchema);
module.exports = { Course, DIFFICULTY_LEVELS };
