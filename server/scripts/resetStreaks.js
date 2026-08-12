/* eslint-disable no-console */
// One-shot migration for S5.5 finding A1 (streak tracking).
//
// Before S5.5 the streak was computed from `lastActiveAt`, which `attachUser`
// stamps on every authenticated request — so streaks never incremented and the
// values currently stored are meaningless (a mix of pre-S5 increment-on-every-
// completion values and post-S5 frozen ones). Streaks are now derived from the
// new `lastCompletionAt` field.
//
// This script clears that bad state so the pilot starts from a clean baseline:
// every user's streak resets to 0 with no `lastCompletionAt`, meaning the next
// lesson completion starts a fresh streak at 1.
//
// XP, badges and lessonsCompleted are deliberately left untouched — only the
// streak lineage was broken.
//
// Usage (from /server):
//   node scripts/resetStreaks.js           # apply
//   node scripts/resetStreaks.js --dry-run # report only
//
// Run once, after deploying the S5.5 changes and before the pilot begins.

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { User } = require('../src/models/User');

const dryRun = process.argv.includes('--dry-run');

const run = async () => {
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to ${env.mongoUri}`);

  const affected = await User.countDocuments({
    $or: [{ streak: { $gt: 0 } }, { lastCompletionAt: { $ne: null } }],
  });
  const total = await User.countDocuments();

  console.log(`${total} user(s) total; ${affected} with a non-zero streak to clear.`);

  if (dryRun) {
    console.log('--dry-run: no changes written.');
  } else {
    const result = await User.updateMany(
      {},
      { $set: { streak: 0 }, $unset: { lastCompletionAt: '' } },
    );
    console.log(`Reset ${result.modifiedCount} user document(s).`);
  }

  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
