const mongoose = require('mongoose');

const LESSON_TYPES = Object.freeze(['tutorial', 'exercise', 'quiz']);

// Each hint string is revealed one at a time on the client — the index in
// this array IS the hint level (hint[0] is the least revealing, hint[n-1]
// is the most). The count of reveals is tracked in DynamoDB for analytics.
const lessonSchema = new mongoose.Schema(
  {
    moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: LESSON_TYPES, required: true },
    // Instructional Markdown — rendered on the left pane of the split layout
    content: { type: String, default: '' },
    // Starting code template shown in the editor when the student first opens the exercise
    codeTemplate: { type: String, default: '' },
    // Expected stdout string used by CodeRunnerService for pass/fail validation
    expectedOutput: { type: String, default: '' },
    // Scaffolded hints revealed progressively (index 0 = least, last = most helpful)
    hints: [{ type: String }],
    order: { type: Number, required: true, min: 0 },
    xpReward: { type: Number, default: 10, min: 0 },
  },
  { timestamps: true },
);

lessonSchema.index({ moduleId: 1, order: 1 });

const Lesson = mongoose.model('Lesson', lessonSchema);
module.exports = { Lesson, LESSON_TYPES };
