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
const { Badge } = require('../src/models/Badge');

// xp_reached badges intentionally have xpValue=0 to keep cascade behaviour
// trivial — gamificationService re-evaluates on cascade, but zero-value
// avoids a self-triggering chain.
const STARTER_BADGES = [
  {
    name: 'First Steps',
    description: 'Completed your very first lesson.',
    icon: '🌱',
    criteria: { type: 'lessons_completed', threshold: 1 },
    xpValue: 25,
  },
  {
    name: 'Getting Started',
    description: 'Completed 5 lessons.',
    icon: '🚀',
    criteria: { type: 'lessons_completed', threshold: 5 },
    xpValue: 50,
  },
  {
    name: 'Dedicated Learner',
    description: 'Completed 25 lessons.',
    icon: '🎓',
    criteria: { type: 'lessons_completed', threshold: 25 },
    xpValue: 100,
  },
  {
    name: 'Week-long Streak',
    description: 'Stayed active for 7 consecutive days.',
    icon: '🔥',
    criteria: { type: 'streak_days', threshold: 7 },
    xpValue: 100,
  },
  {
    name: 'Centurion',
    description: 'Earned 100 XP.',
    icon: '💯',
    criteria: { type: 'xp_reached', threshold: 100 },
    xpValue: 0,
  },
];

const seed = async () => {
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to ${env.mongoUri}`);

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
