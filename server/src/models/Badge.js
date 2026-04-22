const mongoose = require('mongoose');

// Criteria types determine when GamificationService auto-awards this badge.
// - lessons_completed: awarded when user completes N lessons total
// - streak_days: awarded when user streak reaches N consecutive days
// - xp_reached: awarded when user's total XP reaches N
const CRITERIA_TYPES = Object.freeze(['lessons_completed', 'streak_days', 'xp_reached']);

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
