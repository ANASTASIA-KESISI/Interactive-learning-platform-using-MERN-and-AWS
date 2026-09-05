const mongoose = require('mongoose');

const LESSON_TYPES = Object.freeze(['tutorial', 'exercise', 'quiz']);
// Adding a language is: extend this enum, deploy a new runner-<lang> Lambda,
// register it in the dispatcher, widen the IAM invoke policy.
//
// Python is supported by the platform but is deliberately NOT part of the pilot
// content: mixing languages across a 15–30 student cohort would confound the
// engagement metrics H1 and H2 are measured on. See CHALLENGES.md Challenge 14.
const LESSON_LANGUAGES = Object.freeze(['javascript', 'python']);

// Each hint string is revealed one at a time on the client — the index in
// this array IS the hint level (hint[0] is the least revealing, hint[n-1]
// is the most). The count of reveals is tracked in DynamoDB for analytics.
const lessonSchema = new mongoose.Schema(
  {
    moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: LESSON_TYPES, required: true },
    // Drives runner selection (lambda function name + Monaco syntax mode).
    language: { type: String, enum: LESSON_LANGUAGES, default: 'javascript' },
    // Instructional Markdown — rendered on the left pane of the split layout
    content: { type: String, default: '' },
    // "Your Task" Markdown — the concrete challenge statement, shown on the
    // Challenge tab of the exercise layout separately from the lesson text.
    task: { type: String, default: '' },
    // Starting code template shown in the editor when the student first opens the exercise
    codeTemplate: { type: String, default: '' },
    // Expected stdout string used by CodeRunnerService for pass/fail validation
    expectedOutput: { type: String, default: '' },
    // Scaffolded hints revealed progressively (index 0 = least, last = most helpful)
    hints: [{ type: String }],
    // Quiz body, used only when `type === 'quiz'`. Modelled on the lesson rather
    // than in a separate collection: a quiz IS a lesson in the course tree —
    // ordered among its siblings, carrying its own XP and hints — so a separate
    // `quizzes` collection would duplicate every one of those fields and split
    // the progress record that the pilot analyses per lesson.
    //
    // `correctIndex` and `explanation` are ANSWERS. They must never reach the
    // browser before grading, exactly like `expectedOutput` (S5.5 B1) — see
    // `courseService.getLessonForStudent`, which strips them.
    questions: [
      {
        prompt: { type: String, required: true, trim: true },
        options: {
          type: [String],
          validate: {
            validator: (v) => Array.isArray(v) && v.length >= 2 && v.length <= 6,
            message: 'A question needs between 2 and 6 options',
          },
        },
        correctIndex: { type: Number, required: true, min: 0 },
        explanation: { type: String, default: '', trim: true },
      },
    ],
    // Percentage of questions a learner must get right to pass a quiz.
    passMark: { type: Number, default: 70, min: 1, max: 100 },
    order: { type: Number, required: true, min: 0 },
    xpReward: { type: Number, default: 10, min: 0 },
  },
  { timestamps: true },
);

lessonSchema.index({ moduleId: 1, order: 1 });

const Lesson = mongoose.model('Lesson', lessonSchema);
module.exports = { Lesson, LESSON_TYPES, LESSON_LANGUAGES };
