const mongoose = require('mongoose');

const ROLES = Object.freeze(['student', 'instructor', 'admin']);

const userSchema = new mongoose.Schema(
  {
    cognitoId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    role: { type: String, enum: ROLES, default: 'student', index: true },
    avatar: { type: String },
    enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    xpPoints: { type: Number, default: 0, min: 0 },
    badges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }],
    streak: { type: Number, default: 0, min: 0 },
    // Authoritative count of distinct lessons the user has completed (set on
    // first pass only). Used by gamification to evaluate `lessons_completed`
    // badge criteria — replaces the old xpPoints/xpReward heuristic, which
    // broke as soon as XP came from anywhere other than lesson completion.
    lessonsCompleted: { type: Number, default: 0, min: 0 },
    lastActiveAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    firstName: this.firstName,
    lastName: this.lastName,
    role: this.role,
    avatar: this.avatar,
    xpPoints: this.xpPoints,
    streak: this.streak,
    lessonsCompleted: this.lessonsCompleted,
    enrolledCourses: this.enrolledCourses,
    badges: this.badges,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
