const { User } = require('../models/User');
const courseService = require('./courseService');
const progressTable = require('../dynamo/progressTable');
const { badRequest } = require('../utils/httpError');

// Course leaderboard (S7 D9): lessons completed per learner inside the course,
// over a rolling window. It reads the DynamoDB progress table directly — a
// service may, a route may not (CLAUDE.md layering) — through the same
// `scanByLessonIds` path the instructor analytics view already uses. At pilot
// scale (≤30 learners, a few hundred items) the scan is acceptable; past that,
// the fix is a GSI on `lessonId`, not a different aggregation.

const WINDOW_DAYS = Object.freeze({ '7d': 7, '30d': 30, all: null });
const WINDOWS = Object.freeze(Object.keys(WINDOW_DAYS));
const TOP_N = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// Learners are shown as "First L." — enough for a classmate to recognise
// themselves and each other without publishing full names or email addresses
// next to a performance ranking (the board is visible to every enrolled
// student, so it is the one screen where one learner's data reaches another).
const displayNameFor = (user) => {
  if (!user) return 'Learner';
  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  if (first && last) return `${first} ${last[0].toUpperCase()}.`;
  if (first) return first;
  const local = (user.email || '').split('@')[0];
  return local || 'Learner';
};

const cutoffFor = (window, now) => {
  const days = WINDOW_DAYS[window];
  return days === null ? null : now - days * DAY_MS;
};

// `completedAt` is written by progressService as an ISO string, but items
// predating it (or hand-edited ones) may lack it entirely — an unparseable
// stamp must drop the row rather than land it in every window as NaN.
const completedWithin = (record, cutoff) => {
  if (record.status !== 'completed') return false;
  const at = Date.parse(record.completedAt);
  if (Number.isNaN(at)) return false;
  return cutoff === null || at >= cutoff;
};

/**
 * @param {string} courseId
 * @param {{ window?: '7d'|'30d'|'all', viewerId?: string|null, viewerRole?: string }} options
 *   `viewerRole` only gates draft visibility on the course lookup; the route
 *   has already decided whether this caller may see the board at all.
 * @returns {Promise<{
 *   window: string,
 *   top: Array<{ userId, displayName, avatar, completions, rank }>,
 *   me: { rank: number|null, completions: number },
 * }>}
 */
const getCourseLeaderboard = async (
  courseId,
  { window = '7d', viewerId = null, viewerRole = 'student' } = {},
) => {
  if (!WINDOWS.includes(window)) throw badRequest('Unsupported leaderboard window');

  const viewer = viewerId ? { id: viewerId, role: viewerRole } : null;
  const course = await courseService.getCourseById(courseId, viewer);
  const lessonIds = (course.modules || []).flatMap((module) =>
    (module.lessons || []).map((lesson) => lesson._id.toString()),
  );

  const viewerKey = viewerId ? viewerId.toString() : null;
  const empty = { window, top: [], me: { rank: null, completions: 0 } };
  if (lessonIds.length === 0) return empty;

  const records = await progressTable.scanByLessonIds(lessonIds);
  const cutoff = cutoffFor(window, Date.now());

  // userId → { completions, lastCompletionAt }. `lastCompletionAt` is the
  // tiebreak: on equal counts the learner who got there first ranks higher,
  // which also makes the ordering stable across requests (Array#sort is not
  // required to preserve input order for equal keys).
  const byUser = new Map();
  for (const record of records) {
    if (!completedWithin(record, cutoff)) continue;
    const key = String(record.userId);
    const at = Date.parse(record.completedAt);
    const entry = byUser.get(key) || { userId: key, completions: 0, lastCompletionAt: 0 };
    entry.completions += 1;
    if (at > entry.lastCompletionAt) entry.lastCompletionAt = at;
    byUser.set(key, entry);
  }

  const ranked = [...byUser.values()]
    .sort(
      (a, b) =>
        b.completions - a.completions ||
        a.lastCompletionAt - b.lastCompletionAt ||
        a.userId.localeCompare(b.userId),
    )
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  if (ranked.length === 0) return empty;

  const top = ranked.slice(0, TOP_N);
  const mine = viewerKey ? ranked.find((entry) => entry.userId === viewerKey) : null;

  // One lookup for the names on the board plus the viewer's own row, which may
  // sit outside the top N.
  const needed = [...new Set([...top.map((e) => e.userId), ...(mine ? [mine.userId] : [])])];
  const users = await User.find({ _id: { $in: needed } })
    .select('firstName lastName email avatar')
    .lean();
  const usersById = new Map(users.map((u) => [u._id.toString(), u]));

  return {
    window,
    top: top.map((entry) => ({
      userId: entry.userId,
      displayName: displayNameFor(usersById.get(entry.userId)),
      avatar: usersById.get(entry.userId)?.avatar ?? null,
      completions: entry.completions,
      rank: entry.rank,
    })),
    me: {
      rank: mine ? mine.rank : null,
      completions: mine ? mine.completions : 0,
    },
  };
};

module.exports = { getCourseLeaderboard, WINDOWS };
