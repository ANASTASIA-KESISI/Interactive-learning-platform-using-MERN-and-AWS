/* eslint-disable no-console */
// One-shot seeder for the starter badge set. Idempotent — re-running upserts
// by `name` so it's safe to use as part of bootstrap or after a Mongo reset.
//
// Usage (from /server):
//   node scripts/seedBadges.js
//
// Reads MONGODB_URI from server/.env via the same env loader as the app.

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { maskMongoUri } = require('../src/utils/maskUri');
const { Badge } = require('../src/models/Badge');

// Icons are paths into the client's own \`public/badges/\` directory, not S3
// URLs: they ship and cache with the app, need no upload step, and are visible
// in local dev. A value that is not a path is rendered as-is, so the emoji a
// badge carried before its artwork exists still displays.
//
// XP values climb with how hard a badge is to reach, with one deliberate
// exception: \`xp_reached\` badges are worth 0. They are awarded FOR having XP,
// so paying XP for them would let one award push the learner over the next
// threshold and cascade — gamificationService re-evaluates in a loop precisely
// because badges can trigger badges, and a zero value keeps that loop honest.
//
// The ladders are deliberately uneven. Early rungs sit close together so a new
// learner is rewarded within their first session (the pilot runs 2–4 weeks, so
// a badge nobody reaches is a badge that never enters the H2 data), and later
// ones spread out so the set does not exhaust itself in week one.
const STARTER_BADGES = [
  // ── Lessons completed ──────────────────────────────────────────────────────
  {
    name: 'First Steps',
    description: 'Completed your very first lesson.',
    icon: '/badges/first-steps.svg',
    criteria: { type: 'lessons_completed', threshold: 1 },
    xpValue: 25,
  },
  {
    name: 'Getting Started',
    description: 'Completed 5 lessons.',
    icon: '/badges/getting-started.svg',
    criteria: { type: 'lessons_completed', threshold: 5 },
    xpValue: 50,
  },
  {
    name: 'Finding Your Feet',
    description: 'Completed 10 lessons.',
    icon: '/badges/finding-your-feet.svg',
    criteria: { type: 'lessons_completed', threshold: 10 },
    xpValue: 75,
  },
  {
    name: 'Dedicated Learner',
    description: 'Completed 25 lessons.',
    icon: '/badges/dedicated-learner.svg',
    criteria: { type: 'lessons_completed', threshold: 25 },
    xpValue: 100,
  },
  {
    name: 'Half Century',
    description: 'Completed 50 lessons.',
    icon: '/badges/half-century.svg',
    criteria: { type: 'lessons_completed', threshold: 50 },
    xpValue: 200,
  },
  {
    name: 'Century',
    description: 'Completed 100 lessons.',
    icon: '/badges/century.svg',
    criteria: { type: 'lessons_completed', threshold: 100 },
    xpValue: 400,
  },

  // ── Streaks ────────────────────────────────────────────────────────────────
  {
    name: 'Back for More',
    description: 'Studied 3 days in a row.',
    icon: '/badges/back-for-more.svg',
    criteria: { type: 'streak_days', threshold: 3 },
    xpValue: 40,
  },
  {
    name: 'Week-long Streak',
    description: 'Stayed active for 7 consecutive days.',
    icon: '/badges/week-long-streak.svg',
    criteria: { type: 'streak_days', threshold: 7 },
    xpValue: 100,
  },
  {
    name: 'Fortnight Focus',
    description: 'Studied 14 days in a row.',
    icon: '/badges/fortnight-focus.svg',
    criteria: { type: 'streak_days', threshold: 14 },
    xpValue: 200,
  },
  {
    name: 'Monthly Momentum',
    description: 'Studied 30 days in a row.',
    icon: '/badges/monthly-momentum.svg',
    criteria: { type: 'streak_days', threshold: 30 },
    xpValue: 400,
  },

  // ── Total XP (xpValue 0 — see the cascade note above) ──────────────────────
  {
    name: 'Centurion',
    description: 'Earned 100 XP.',
    icon: '/badges/centurion.svg',
    criteria: { type: 'xp_reached', threshold: 100 },
    xpValue: 0,
  },
  {
    name: 'Five Hundred Club',
    description: 'Earned 500 XP.',
    icon: '/badges/five-hundred-club.svg',
    criteria: { type: 'xp_reached', threshold: 500 },
    xpValue: 0,
  },
  {
    name: 'Four Figures',
    description: 'Earned 1,000 XP.',
    icon: '/badges/four-figures.svg',
    criteria: { type: 'xp_reached', threshold: 1000 },
    xpValue: 0,
  },
  {
    name: 'Grandmaster',
    description: 'Earned 2,500 XP.',
    icon: '/badges/grandmaster.svg',
    criteria: { type: 'xp_reached', threshold: 2500 },
    xpValue: 0,
  },

  // ── Unaided completions (H1: scaffolding used sparingly) ───────────────────
  {
    name: 'On Your Own',
    description: 'Passed a lesson without revealing a single hint.',
    icon: '/badges/on-your-own.svg',
    criteria: { type: 'unaided_completions', threshold: 1 },
    xpValue: 30,
  },
  {
    name: 'Self-Starter',
    description: 'Passed 10 lessons without revealing a hint.',
    icon: '/badges/self-starter.svg',
    criteria: { type: 'unaided_completions', threshold: 10 },
    xpValue: 120,
  },
  {
    name: 'No Training Wheels',
    description: 'Passed 25 lessons without revealing a hint.',
    icon: '/badges/no-training-wheels.svg',
    criteria: { type: 'unaided_completions', threshold: 25 },
    xpValue: 250,
  },

  // ── Quizzes ────────────────────────────────────────────────────────────────
  {
    name: 'Quiz Taker',
    description: 'Passed your first quiz.',
    icon: '/badges/quiz-taker.svg',
    criteria: { type: 'quizzes_passed', threshold: 1 },
    xpValue: 30,
  },
  {
    name: 'Quiz Master',
    description: 'Passed 10 quizzes.',
    icon: '/badges/quiz-master.svg',
    criteria: { type: 'quizzes_passed', threshold: 10 },
    xpValue: 150,
  },

  // ── Courses finished end to end ────────────────────────────────────────────
  {
    name: 'Course Complete',
    description: 'Finished every lesson in a course.',
    icon: '/badges/course-complete.svg',
    criteria: { type: 'courses_completed', threshold: 1 },
    xpValue: 250,
  },
  {
    name: 'Polymath',
    description: 'Finished 3 courses end to end.',
    icon: '/badges/polymath.svg',
    criteria: { type: 'courses_completed', threshold: 3 },
    xpValue: 500,
  },

  // ── Notes (H2: self-regulated learning) ────────────────────────────────────
  {
    name: 'Note to Self',
    description: 'Saved your first note.',
    icon: '/badges/note-to-self.svg',
    criteria: { type: 'notes_written', threshold: 1 },
    xpValue: 20,
  },
  {
    name: 'Annotator',
    description: 'Saved notes on 10 lessons or modules.',
    icon: '/badges/annotator.svg',
    criteria: { type: 'notes_written', threshold: 10 },
    xpValue: 120,
  },
];

const seed = async () => {
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to ${maskMongoUri(env.mongoUri)}`);

  for (const b of STARTER_BADGES) {
    const result = await Badge.updateOne(
      { name: b.name },
      { $set: b },
      { upsert: true },
    );
    const action = result.upsertedCount ? 'created' : 'updated';
    console.log(`  ${action}: ${b.name}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
