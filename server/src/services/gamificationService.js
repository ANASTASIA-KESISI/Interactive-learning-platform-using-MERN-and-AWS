const { User } = require('../models/User');
const { Badge } = require('../models/Badge');

// Hint-based XP discount (pilot rule, decided 2026-05-10):
//   0 hints → 100% XP
//   1 hint  →  50% XP
//   2+      →  20% XP
// Encourages self-attempt before scaffolding without zeroing the reward.
const applyHintDiscount = (xpReward, hintsUsed) => {
  if (hintsUsed <= 0) return xpReward;
  if (hintsUsed === 1) return Math.round(xpReward * 0.5);
  return Math.round(xpReward * 0.2);
};

// Calendar-day diff in UTC. Two events on the same UTC date return 0,
// consecutive UTC dates return 1. Pilot accepts UTC fuzz (no timezone-aware
// streaks) — the 2-4 week pilot window won't materially shift any user's
// streak boundary across days.
const utcDayDiff = (earlier, later) => {
  const a = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  const b = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  return Math.round((b - a) / 86_400_000);
};

// Streaks count consecutive days on which the learner COMPLETED a lesson, so
// the input is `lastCompletionAt` — not `lastActiveAt`, which `attachUser`
// stamps on every authenticated request and which therefore always read as
// "today", freezing every streak (S5.5 finding A1).
const updateStreak = (user, now) => {
  if (!user.lastCompletionAt) {
    user.streak = 1;
  } else {
    const days = utcDayDiff(user.lastCompletionAt, now);
    if (days <= 0) {
      // already completed a lesson today — leave streak alone
    } else if (days === 1) {
      user.streak += 1;
    } else {
      user.streak = 1;
    }
  }
  user.lastCompletionAt = now;
};

// Idempotent badge award. Loops because a badge's xpValue can cross the next
// badge's xp_reached threshold (cascade), and we want all earned badges
// surfaced in a single response.
const evaluateBadges = (user, allBadges) => {
  const earnedIds = new Set(user.badges.map((id) => id.toString()));
  const newlyAwarded = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const badge of allBadges) {
      const idStr = badge._id.toString();
      if (earnedIds.has(idStr)) continue;

      const { type, threshold } = badge.criteria;
      let earned = false;
      if (type === 'xp_reached' && user.xpPoints >= threshold) earned = true;
      else if (type === 'streak_days' && user.streak >= threshold) earned = true;
      else if (type === 'lessons_completed' && user.lessonsCompleted >= threshold) earned = true;

      if (earned) {
        earnedIds.add(idStr);
        user.badges.push(badge._id);
        user.xpPoints += badge.xpValue || 0;
        newlyAwarded.push({
          id: badge._id,
          name: badge.name,
          icon: badge.icon,
          description: badge.description,
        });
        changed = true;
      }
    }
  }
  return newlyAwarded;
};

// Called from the submit route when a student passes a lesson for the first
// time. `hintsUsed` is the count from the progress record at submit time.
// `now` is injectable for tests.
const onLessonCompleted = async ({ userId, xpReward, hintsUsed = 0, now = new Date() }) => {
  const user = await User.findById(userId);
  if (!user) return { xpDelta: 0, newBadges: [] };

  const xpDelta = applyHintDiscount(xpReward, hintsUsed);
  user.xpPoints += xpDelta;
  user.lessonsCompleted = (user.lessonsCompleted || 0) + 1;
  updateStreak(user, now);

  const allBadges = await Badge.find({});
  const newBadges = evaluateBadges(user, allBadges);

  await user.save();
  return { xpDelta, newBadges };
};

module.exports = {
  onLessonCompleted,
  // exported for unit tests; not part of the public service contract
  _internal: { applyHintDiscount, utcDayDiff, updateStreak, evaluateBadges },
};
