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
    // Institutional placement (S7 D3). Optional: accounts created before S7
    // have neither and are prompted once on Home.
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'University' },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    bio: { type: String, trim: true, maxlength: 500 },
    enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    xpPoints: { type: Number, default: 0, min: 0 },
    badges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }],
    streak: { type: Number, default: 0, min: 0 },
    // Authoritative count of distinct lessons the user has completed (set on
    // first pass only). Used by gamification to evaluate `lessons_completed`
    // badge criteria — replaces the old xpPoints/xpReward heuristic, which
    // broke as soon as XP came from anywhere other than lesson completion.
    lessonsCompleted: { type: Number, default: 0, min: 0 },
    // Completions where the learner revealed no hint. The scaffolding
    // signal H1 is about, kept as its own counter rather than derived:
    // the hint count lives on the Dynamo progress item, which the award
    // path never reads back.
    unaidedCompletions: { type: Number, default: 0, min: 0 },
    // Lessons of `type: 'quiz'` passed. A quiz is an ordinary lesson, so it
    // already counts in `lessonsCompleted`; this narrows it to the quizzes.
    quizzesPassed: { type: Number, default: 0, min: 0 },
    // Incremented when a completion is the one that finishes a course.
    // A course can finish twice if an instructor adds a lesson to one the
    // learner had already cleared — rare, and the second finish is a real
    // achievement, so it is not guarded against.
    coursesCompleted: { type: Number, default: 0, min: 0 },
    // Recounted from the notes collection on every save rather than
    // incremented, so deleting notes cannot leave it drifting upward.
    // Badges already earned stay earned if the count later falls.
    notesWritten: { type: Number, default: 0, min: 0 },
    // Touched on every authenticated request — drives the admin weekly-active
    // users KPI. Deliberately NOT the streak input: it advances on mere logins,
    // which made the streak diff always 0 and pinned every streak at its
    // default (S5.5 finding A1).
    lastActiveAt: { type: Date },
    // Timestamp of the last lesson COMPLETION. Written only by
    // gamificationService — this is the authoritative streak input.
    lastCompletionAt: { type: Date },
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
    bio: this.bio,
    universityId: this.universityId,
    departmentId: this.departmentId,
    xpPoints: this.xpPoints,
    streak: this.streak,
    lessonsCompleted: this.lessonsCompleted,
    enrolledCourses: this.enrolledCourses,
    badges: this.badges,
    createdAt: this.createdAt,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
