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
    enrolledCourses: this.enrolledCourses,
    badges: this.badges,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
