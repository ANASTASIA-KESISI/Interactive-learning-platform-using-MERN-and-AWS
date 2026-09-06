const mongoose = require('mongoose');

// Criteria types determine when GamificationService auto-awards this badge.
// Every one of them reads a counter on the User document — the award path
// never queries Dynamo — so adding a type means adding the counter that
// feeds it and the write that maintains it.
// - lessons_completed:   N lessons completed in total
// - streak_days:         streak reaches N consecutive days
// - xp_reached:          total XP reaches N
// - unaided_completions: N lessons completed without revealing a hint
// - quizzes_passed:      N quiz-type lessons passed
// - courses_completed:   N courses finished end to end
// - notes_written:       N notes saved
const CRITERIA_TYPES = Object.freeze([
  'lessons_completed',
  'streak_days',
  'xp_reached',
  'unaided_completions',
  'quizzes_passed',
  'courses_completed',
  'notes_written',
]);

const badgeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, required: true },
    icon: { type: String }, // URL to SVG/PNG stored in S3
    criteria: {
      type: { type: String, enum: CRITERIA_TYPES, required: true },
      threshold: { type: Number, required: true, min: 1 },
    },
    xpValue: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

const Badge = mongoose.model('Badge', badgeSchema);
module.exports = { Badge, CRITERIA_TYPES };
