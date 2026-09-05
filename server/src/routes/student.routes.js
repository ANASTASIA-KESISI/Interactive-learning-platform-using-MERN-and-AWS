const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const progressService = require('../services/progressService');
const courseService = require('../services/courseService');
const gamificationService = require('../services/gamificationService');
const { Course } = require('../models/Course');
const { Lesson } = require('../models/Lesson');
const { Badge } = require('../models/Badge');

const router = express.Router();

const studentAuth = [requireAuth, requireRole('student'), attachUser];

// Trailing window for the activity heatmap. 365 inclusive days: `from` is 364
// days before `to`, so the client always receives exactly 365 buckets.
const ACTIVITY_DAYS = 365;
const MS_PER_DAY = 86_400_000;

// Bucketing is by UTC calendar day, matching how gamificationService computes
// streaks (utcDayDiff). A learner completing a lesson at 23:00 local time must
// land in the same bucket the streak counted, or the heatmap and the streak
// tell two different stories about the same evening.
const utcDayStart = (date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Sprint 1 exit-criteria demo endpoint
router.get('/ping', ...studentAuth, (req, res) => {
  res.json({ message: 'pong', user: req.dbUser.toSafeJSON() });
});

// GET /api/student/dashboard — aggregated view for the Home screen.
// Returns XP/level/rank, streak, badges, the enrolled courses with their
// per-course progress summary, the active course with its next lesson, and the
// 5 most recent activity events. One round-trip for the entire screen.
router.get('/dashboard', ...studentAuth, async (req, res, next) => {
  try {
    const user = req.dbUser;

    // Enrolled courses, projected down to card metadata + lesson IDs — one
    // query for all of them, and no lesson bodies on the wire.
    const enrolledCourses = await courseService.getEnrolledCourseSummaries(
      user.enrolledCourses,
    );

    // Progress records for all lessons the student has touched
    const progressRecords = await progressService.getStudentProgress(user._id.toString());

    const completedLessonIds = new Set(
      progressRecords.filter((r) => r.status === 'completed').map((r) => r.lessonId),
    );

    // Lesson IDs in module-then-lesson order, kept alongside each summary so
    // "the next incomplete lesson" is a scan rather than a second query.
    const orderedLessonIds = new Map();

    const courseSummaries = enrolledCourses.map((course) => {
      const id = course._id.toString();
      const lessonIds = (course.modules || []).flatMap((m) =>
        (m.lessons || []).map((l) => l._id.toString()),
      );
      orderedLessonIds.set(id, lessonIds);
      const completedInCourse = lessonIds.filter((lid) => completedLessonIds.has(lid)).length;
      return {
        id: course._id,
        title: course.title,
        category: course.category,
        difficulty: course.difficulty,
        totalLessons: lessonIds.length,
        completedLessons: completedInCourse,
        completionRate: lessonIds.length
          ? Math.round((completedInCourse / lessonIds.length) * 100)
          : 0,
      };
    });

    const recent = progressRecords
      .filter((r) => r.completedAt)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 5);

    // ── Active course ─────────────────────────────────────────────────────────
    // The course the learner most recently made progress in; a brand-new
    // enrolment with no completions yet falls back to the newest enrolment
    // (enrolledCourses is push-ordered), so "Continue learning" is never empty
    // while the learner has a course to continue.
    const courseIdByLessonId = new Map();
    for (const [courseId, lessonIds] of orderedLessonIds) {
      for (const lessonId of lessonIds) courseIdByLessonId.set(lessonId, courseId);
    }

    let activeCourseId = null;
    let latestAt = 0;
    for (const record of progressRecords) {
      if (!record.completedAt) continue;
      const courseId = courseIdByLessonId.get(record.lessonId);
      if (!courseId) continue;
      const at = new Date(record.completedAt).getTime();
      if (Number.isNaN(at) || at <= latestAt) continue;
      latestAt = at;
      activeCourseId = courseId;
    }

    if (!activeCourseId && (user.enrolledCourses || []).length > 0) {
      const newest = user.enrolledCourses[user.enrolledCourses.length - 1].toString();
      if (orderedLessonIds.has(newest)) activeCourseId = newest;
    }

    const activeSummary = activeCourseId
      ? courseSummaries.find((c) => c.id.toString() === activeCourseId) || null
      : null;

    const nextLessonId = activeSummary
      ? (orderedLessonIds.get(activeCourseId) || []).find(
          (lessonId) => !completedLessonIds.has(lessonId),
        ) || null
      : null;

    // One lookup for every lesson title the response needs — the recent
    // activity feed plus the "continue" call to action.
    const titleLessonIds = [...new Set([...recent.map((r) => r.lessonId), nextLessonId])].filter(
      Boolean,
    );

    const lessonsById = titleLessonIds.length
      ? Object.fromEntries(
          (await Lesson.find({ _id: { $in: titleLessonIds } })
            .select('title')
            .lean()).map((l) => [l._id.toString(), l.title]),
        )
      : {};

    const recentActivity = recent.map((r) => ({
      lessonId: r.lessonId,
      lessonTitle: lessonsById[r.lessonId] || 'Untitled lesson',
      completedAt: r.completedAt,
    }));

    // `getEnrolledCourseSummaries` is owned by the course service and projects
    // card metadata only; the Home hero also shows the course icon, so read
    // that single field for the one course being surfaced.
    let activeCourse = null;
    if (activeSummary) {
      const iconDoc = await Course.findById(activeCourseId).select('icon').lean();
      activeCourse = {
        id: activeSummary.id,
        title: activeSummary.title,
        icon: iconDoc?.icon || null,
        completedLessons: activeSummary.completedLessons,
        totalLessons: activeSummary.totalLessons,
        completionRate: activeSummary.completionRate,
        nextLessonId,
        nextLessonTitle: nextLessonId ? lessonsById[nextLessonId] || 'Untitled lesson' : null,
      };
    }

    // Full badge gallery with earned/locked state — drives the profile's
    // gamification panel and the Home preview. Sorted so earned ones surface
    // first, then by ascending threshold so the next attainable badge is
    // visible.
    const allBadges = await Badge.find().lean();
    const earnedBadgeIds = new Set(user.badges.map((id) => id.toString()));
    const badges = allBadges
      .map((b) => ({
        id: b._id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        criteria: b.criteria,
        xpValue: b.xpValue,
        earned: earnedBadgeIds.has(b._id.toString()),
      }))
      .sort((a, b) => {
        if (a.earned !== b.earned) return a.earned ? -1 : 1;
        return a.criteria.threshold - b.criteria.threshold;
      });

    // Level, rank and the XP-into-level numbers are derived, never stored
    // (S7 D8) — the same helper the header and /api/me read, so every surface
    // shows one set of figures.
    const { level, xpIntoLevel, xpForNextLevel, rank } =
      gamificationService.gamificationSummary(user);

    res.json({
      data: {
        xpPoints: user.xpPoints,
        streak: user.streak,
        lessonsCompleted: user.lessonsCompleted,
        level,
        xpIntoLevel,
        xpForNextLevel,
        rank,
        badges,
        badgeCount: badges.filter((b) => b.earned).length,
        badgeTotal: badges.length,
        completionRate:
          progressRecords.length
            ? Math.round(
                (progressRecords.filter((r) => r.status === 'completed').length /
                  progressRecords.length) *
                  100,
              )
            : 0,
        activeCourse,
        enrolledCourses: courseSummaries,
        recentActivity,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/student/activity — completions per UTC day for the trailing year,
// zero-filled across the whole window so the heatmap can render a dense grid
// without any gap logic on the client.
router.get('/activity', ...studentAuth, async (req, res, next) => {
  try {
    const records = await progressService.getStudentProgress(req.dbUser._id.toString());

    const to = utcDayStart(new Date());
    const from = to - (ACTIVITY_DAYS - 1) * MS_PER_DAY;

    const counts = new Map();
    for (const record of records) {
      // Records without `completedAt` are lessons in progress — they are not
      // completions and must not colour a cell.
      if (!record.completedAt) continue;
      const at = new Date(record.completedAt);
      if (Number.isNaN(at.getTime())) continue;
      const day = utcDayStart(at);
      if (day < from || day > to) continue;
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const days = [];
    for (let day = from; day <= to; day += MS_PER_DAY) {
      days.push({ date: isoDay(day), completions: counts.get(day) || 0 });
    }

    res.json({ data: { from: isoDay(from), to: isoDay(to), days } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
