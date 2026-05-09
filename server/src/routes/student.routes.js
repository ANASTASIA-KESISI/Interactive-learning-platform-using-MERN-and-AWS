const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const progressService = require('../services/progressService');
const courseService = require('../services/courseService');
const { Lesson } = require('../models/Lesson');

const router = express.Router();

const studentAuth = [requireAuth, requireRole('student'), attachUser];

// Sprint 1 exit-criteria demo endpoint
router.get('/ping', ...studentAuth, (req, res) => {
  res.json({ message: 'pong', user: req.dbUser.toSafeJSON() });
});

// GET /api/student/dashboard — aggregated view for the student dashboard screen
// Returns XP, streak, badges, enrolled courses with per-course progress summary,
// and the 5 most recent activity events. One round-trip for the entire dashboard.
router.get('/dashboard', ...studentAuth, async (req, res, next) => {
  try {
    const user = req.dbUser;

    // Enrolled courses with basic module info for progress bars
    const enrolledCourses = await Promise.all(
      user.enrolledCourses.map((id) =>
        courseService.getCourseById(id).catch(() => null),
      ),
    ).then((results) => results.filter(Boolean));

    // Progress records for all lessons the student has touched
    const progressRecords = await progressService.getStudentProgress(user._id.toString());

    const completedLessonIds = new Set(
      progressRecords.filter((r) => r.status === 'completed').map((r) => r.lessonId),
    );

    const courseSummaries = enrolledCourses.map((course) => {
      const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l._id.toString()));
      const completedInCourse = lessonIds.filter((id) => completedLessonIds.has(id)).length;
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

    const lessonsById = recent.length
      ? Object.fromEntries(
          (await Lesson.find({ _id: { $in: recent.map((r) => r.lessonId) } })
            .select('title')
            .lean()).map((l) => [l._id.toString(), l.title]),
        )
      : {};

    const recentActivity = recent.map((r) => ({
      lessonId: r.lessonId,
      lessonTitle: lessonsById[r.lessonId] || 'Untitled lesson',
      completedAt: r.completedAt,
    }));

    res.json({
      data: {
        xpPoints: user.xpPoints,
        streak: user.streak,
        badgeCount: user.badges.length,
        completionRate:
          progressRecords.length
            ? Math.round(
                (progressRecords.filter((r) => r.status === 'completed').length /
                  progressRecords.length) *
                  100,
              )
            : 0,
        enrolledCourses: courseSummaries,
        recentActivity,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
