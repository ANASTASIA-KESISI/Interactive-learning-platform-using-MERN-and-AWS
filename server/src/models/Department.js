const mongoose = require('mongoose');

// Semesters are integers 1..semesterCount, not documents (S7 D3): the Courses
// page groups by `course.semester` and needs nothing more than the count.
const departmentSchema = new mongoose.Schema(
  {
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'University',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    semesterCount: { type: Number, default: 8, min: 1, max: 12 },
  },
  { timestamps: true },
);

departmentSchema.index({ universityId: 1, code: 1 }, { unique: true });
departmentSchema.index({ universityId: 1, name: 1 });

const Department = mongoose.model('Department', departmentSchema);
module.exports = { Department };
