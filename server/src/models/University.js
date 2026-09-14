const mongoose = require('mongoose');

// Institutions are content-shaped (read on every signup / course listing,
// written by an admin a handful of times) → Mongo, per CLAUDE.md's rule of
// thumb. `code` is the stable handle the seed script upserts on.
const universitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  },
  { timestamps: true },
);

const University = mongoose.model('University', universitySchema);
module.exports = { University };
