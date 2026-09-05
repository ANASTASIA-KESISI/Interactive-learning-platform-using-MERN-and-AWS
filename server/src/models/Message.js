const mongoose = require('mongoose');

// Student ↔ instructor messaging (S7 D6): one thread per (student, course),
// identified by (courseId, studentId); `instructorId` is denormalised so the
// instructor inbox and unread count are single-index queries. Plain text only.
const SENDER_ROLES = Object.freeze(['student', 'instructor', 'admin']);
const MESSAGE_BODY_MAX = 4_000;

const messageSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: SENDER_ROLES, required: true },
    // Set when the message was sent from a lesson page; bumps `questionsAsked`
    // on that lesson's progress item (messageService, Phase 1-E).
    lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    body: { type: String, required: true, trim: true, maxlength: MESSAGE_BODY_MAX },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ courseId: 1, studentId: 1, createdAt: 1 });
messageSchema.index({ instructorId: 1, readAt: 1 });
messageSchema.index({ studentId: 1, readAt: 1 });

const Message = mongoose.model('Message', messageSchema);
module.exports = { Message, SENDER_ROLES, MESSAGE_BODY_MAX };
