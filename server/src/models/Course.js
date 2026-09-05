const mongoose = require('mongoose');

const DIFFICULTY_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, trim: true, index: true },
    difficulty: { type: String, enum: DIFFICULTY_LEVELS, default: 'beginner' },
    // Institutional placement (S7 D3). Both optional — a course without them
    // lands under "Other courses" on the student's Courses page.
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    semester: { type: Number, min: 1, max: 12 },
    // Long-form Markdown for the course page's About section.
    about: { type: String, default: '' },
    // Emoji or short label shown on cards / the course hero (S7 D11).
    icon: { type: String, trim: true, maxlength: 8 },
    modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }],
    enrollmentCount: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

courseSchema.index({ isPublished: 1, category: 1 });
courseSchema.index({ departmentId: 1, semester: 1 });

const Course = mongoose.model('Course', courseSchema);
module.exports = { Course, DIFFICULTY_LEVELS };
