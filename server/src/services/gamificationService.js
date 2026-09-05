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

// ── Level & rank (S7 D8) ──────────────────────────────────────────────────────
//
// Pure functions of xpPoints, computed on read and never stored. Cumulative XP
// required to REACH level n: xpForLevel(n) = 50·(n−1)·n, so level 1 is 0 XP,
// level 2 is 100, 3 is 300, 4 is 600, 5 is 1000. Thresholds are deliberately
// low: pilot XP totals sit in the low hundreds and the bar has to move within
// a 2–4 week window.
const xpForLevel = (level) => 50 * (level - 1) * level;

const levelFromXp = (xp) => {
  const points = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  while (xpForLevel(level + 1) <= points) level += 1;
  const base = xpForLevel(level);
  return {
    level,
    xpIntoLevel: points - base,
    xpForNextLevel: xpForLevel(level + 1) - base,
  };
};

const RANK_TIERS = ['Bronze', 'Silver', 'Gold'];
const ROMAN = ['I', 'II', 'III'];

const rankForLevel = (level) => {
  const safe = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  if (safe >= 10) return 'Platinum';
  const tier = RANK_TIERS[Math.floor((safe - 1) / 3)];
  return `${tier} ${ROMAN[(safe - 1) % 3]}`;
};

// The gamification block attached to `/api/me`, the dashboard and the submit
// response, so every consumer shows the same numbers.
const gamificationSummary = (user) => {
  const xpPoints = user?.xpPoints ?? 0;
  const { level, xpIntoLevel, xpForNextLevel } = levelFromXp(xpPoints);
  return {
    xpPoints,
    level,
    xpIntoLevel,
    xpForNextLevel,
    rank: rankForLevel(level),
    streak: user?.streak ?? 0,
  };
};

module.exports = {
  onLessonCompleted,
  xpForLevel,
  levelFromXp,
  rankForLevel,
  gamificationSummary,
  // exported for unit tests; not part of the public service contract
  _internal: { applyHintDiscount, utcDayDiff, updateStreak, evaluateBadges },
};
