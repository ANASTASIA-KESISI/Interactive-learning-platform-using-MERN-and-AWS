const { User } = require('../models/User');
const { Badge } = require('../models/Badge');

// Called after a student completes a lesson for the first time.
// Awards XP, checks all badge criteria, increments streak.
// Returns { xpDelta, newBadges } so the route can include them in the response.
const onLessonCompleted = async (dbUser, xpReward) => {
  const user = await User.findById(dbUser._id).populate('badges');
  if (!user) return { xpDelta: 0, newBadges: [] };

  user.xpPoints += xpReward;
  user.streak += 1;
  user.lastActiveAt = new Date();

  const earnedBadgeIds = new Set(user.badges.map((b) => b._id.toString()));
  const allBadges = await Badge.find({});

  const completedLessons = user.xpPoints / (xpReward || 10);

  const newBadges = [];
  for (const badge of allBadges) {
    if (earnedBadgeIds.has(badge._id.toString())) continue;

    let earned = false;
    const { type, threshold } = badge.criteria;

    if (type === 'xp_reached' && user.xpPoints >= threshold) earned = true;
    if (type === 'streak_days' && user.streak >= threshold) earned = true;
    if (type === 'lessons_completed' && completedLessons >= threshold) earned = true;

    if (earned) {
      user.badges.push(badge._id);
      user.xpPoints += badge.xpValue;
      newBadges.push({ id: badge._id, name: badge.name, icon: badge.icon });
    }
  }

  await user.save();

  return { xpDelta: xpReward, newBadges };
};

module.exports = { onLessonCompleted };
