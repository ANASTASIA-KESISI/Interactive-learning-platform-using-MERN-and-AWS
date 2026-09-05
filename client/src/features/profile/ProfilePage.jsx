import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../hooks/useAuth.js';
import {
  Avatar,
  Card,
  Chip,
  EmptyState,
  Modal,
  ProgressBar,
  StatTile,
} from '../../components/ui/index.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { levelProgressPct } from '../../lib/gamification.js';
import { getStudentActivity, getStudentDashboard } from '../../services/student.js';
import { listMyCourses } from '../../services/courses.js';
import { listThreads } from '../../services/messages.js';
import { ActivityHeatmap } from './ActivityHeatmap.jsx';
import { EditProfileForm } from './EditProfileForm.jsx';

// ── Shared with Home ──────────────────────────────────────────────────────────
// The left rail is the same identity block on both screens, so it lives here
// (with the rest of the profile feature) and Home imports it rather than
// keeping a second copy that can drift.

export const displayName = (profile, fallback) =>
  [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
  fallback ||
  profile?.email ||
  'Learner';

// The mockup shows the email local-part as a handle — it is the only
// identifier a learner recognises before they have set a display name.
export const emailHandle = (email) => {
  const local = String(email || '').split('@')[0];
  return local ? `@${local}` : '';
};

export const formatCriteria = (criteria) => {
  if (!criteria) return '';
  const { type, threshold } = criteria;
  if (type === 'lessons_completed')
    return `Complete ${threshold} lesson${threshold === 1 ? '' : 's'}`;
  if (type === 'streak_days') return `Reach a ${threshold}-day streak`;
  if (type === 'xp_reached') return `Earn ${threshold} XP`;
  return '';
};

const memberSince = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const IdentityCard = ({ profile, name, variant, onEdit }) => {
  const Heading = variant === 'profile' ? 'h1' : 'h2';
  const since = variant === 'profile' ? memberSince(profile?.createdAt) : null;

  return (
    <Card>
      <div className="flex flex-col items-center text-center">
        <Avatar src={profile?.avatar} name={name} size="xl" />
        <Heading className="mt-3 text-xl font-semibold text-slate-900">{name}</Heading>
        {profile?.email && (
          <p className="text-sm text-slate-500">{emailHandle(profile.email)}</p>
        )}
        {profile?.bio && <p className="mt-2 text-sm text-slate-600">{profile.bio}</p>}

        {variant === 'profile' ? (
          <button type="button" onClick={onEdit} className="btn-ghost mt-3 w-full border border-slate-200">
            ✎ Edit profile
          </button>
        ) : (
          <Link to="/profile" className="btn-ghost mt-3 w-full border border-slate-200">
            ✎ Edit profile
          </Link>
        )}

        {since && <p className="mt-3 text-xs text-slate-500">📅 Member since {since}</p>}

        {(profile?.university || profile?.department) && (
          <p className="mt-1 text-xs text-slate-500">
            {[profile?.department?.name, profile?.university?.name].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </Card>
  );
};

const LevelProgressCard = ({ stats }) => {
  const pct = levelProgressPct(stats);
  const remaining = Math.max(0, (stats?.xpForNextLevel || 0) - (stats?.xpIntoLevel || 0));

  return (
    <Card
      title="Level progress"
      action={<span className="text-sm font-semibold tabular-nums text-slate-700">{pct}%</span>}
    >
      <ProgressBar
        value={pct}
        srLabel={`Level ${stats?.level || 1} progress: ${stats?.xpIntoLevel || 0} of ${
          stats?.xpForNextLevel || 0
        } XP`}
      />
      <p className="mt-2 text-xs text-slate-500">
        {remaining} XP to level {(stats?.level || 1) + 1}
      </p>
    </Card>
  );
};

const StatsCard = ({ stats }) => (
  <Card title="Stats">
    <div className="grid grid-cols-2 gap-3">
      <StatTile icon="🪙" label="Total XP" value={(stats?.xpPoints || 0).toLocaleString()} />
      <StatTile icon="🛡️" label="Rank" value={stats?.rank || '—'} />
      <StatTile icon="🏅" label="Badges" value={stats?.badgeCount ?? 0} />
      <StatTile icon="🔥" label="Day streak" value={stats?.streak || 0} />
    </div>
  </Card>
);

const BadgePreviewCard = ({ badges = [], earnedCount, total }) => {
  const preview = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned)).slice(0, 8);

  return (
    <Card
      title="Badges"
      action={
        <div className="flex items-center gap-2">
          <Link to="/profile" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            View all →
          </Link>
          <Chip tone="neutral">
            {earnedCount}/{total}
          </Chip>
        </div>
      }
    >
      {preview.length === 0 ? (
        <p className="text-sm text-slate-500">Complete a lesson to unlock your first badge.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {preview.map((badge) => (
            <li key={badge.id}>
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${
                  badge.earned ? 'bg-amber-100' : 'bg-slate-100 opacity-60'
                }`}
                role="img"
                aria-label={`${badge.name} — ${badge.earned ? 'earned' : 'locked'}`}
                title={`${badge.name} — ${badge.earned ? 'earned' : 'locked'}`}
              >
                {badge.icon || '🏅'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// The full gallery: earned first, then the nearest thresholds, so the next
// attainable badge is always visible (self-regulated learning, H2).
const BadgeGalleryCard = ({ badges = [], earnedCount, total }) => (
  <Card
    title="Badges"
    action={
      <Chip tone="neutral">
        {earnedCount}/{total}
      </Chip>
    }
  >
    {badges.length === 0 ? (
      <p className="text-sm text-slate-500">No badges have been configured yet.</p>
    ) : (
      <ul className="space-y-3">
        {badges.map((badge) => (
          <li
            key={badge.id}
            className={`rounded-lg border p-3 ${
              badge.earned ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ${
                  badge.earned ? 'bg-amber-100' : 'bg-slate-100 opacity-60'
                }`}
              >
                {badge.icon || '🏅'}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{badge.name}</h3>
                  <Chip tone={badge.earned ? 'warning' : 'neutral'}>
                    {badge.earned ? 'Earned' : 'Locked'}
                  </Chip>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{badge.description}</p>
                {!badge.earned && (
                  <p className="mt-1 text-[11px] text-slate-500">{formatCriteria(badge.criteria)}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

// `variant`: 'home' renders the compact rail (name as an h2, badge preview);
// 'profile' renders the page's h1, "Member since" and the full gallery.
export const ProfileRail = ({
  profile,
  stats,
  badges = [],
  variant = 'profile',
  showBadges = true,
  onEdit,
}) => {
  const name = displayName(profile);
  const total = stats?.badgeTotal ?? badges.length;
  const earnedCount = stats?.badgeCount ?? badges.filter((b) => b.earned).length;

  return (
    <div className="space-y-4">
      <IdentityCard profile={profile} name={name} variant={variant} onEdit={onEdit} />
      <LevelProgressCard stats={stats} />
      <StatsCard stats={{ ...stats, badgeCount: earnedCount }} />
      {showBadges &&
        (variant === 'profile' ? (
          <BadgeGalleryCard badges={badges} earnedCount={earnedCount} total={total} />
        ) : (
          <BadgePreviewCard badges={badges} earnedCount={earnedCount} total={total} />
        ))}
    </div>
  );
};

// ── The page ──────────────────────────────────────────────────────────────────

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

const CourseProgressList = ({ courses }) => {
  if (!courses || courses.length === 0) {
    return <EmptyState icon="📚" title="No courses in progress yet." />;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {courses.map((course) => (
        <li key={course.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{course.title}</h3>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {course.completedLessons}/{course.totalLessons}
            </span>
          </div>
          <ProgressBar
            className="mt-3"
            value={course.completionRate}
            srLabel={`${course.title}: ${course.completionRate}% complete`}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>{course.completionRate}% complete</span>
            <Link to={`/courses/${course.id}`} className="text-brand-600 hover:text-brand-700">
              Continue →
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
};

const AuthoredCourseList = ({ courses }) => {
  if (!courses || courses.length === 0) {
    return (
      <EmptyState
        icon="✍️"
        title="No courses yet."
        description="Create your first course from the authoring area."
        action={
          <Link to="/instructor/courses/new" className="btn-primary">
            New course
          </Link>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {courses.map((course) => (
        <li
          key={course._id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{course.title}</h3>
              <Chip tone={course.isPublished ? 'success' : 'warning'}>
                {course.isPublished ? 'Published' : 'Draft'}
              </Chip>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {course.enrollmentCount || 0} enrolled
            </p>
          </div>
          <Link to={`/instructor/courses/${course._id}`} className="btn-ghost">
            Edit →
          </Link>
        </li>
      ))}
    </ul>
  );
};

// Threads come from P1-E; until that router is filled in the call 404s, so the
// card is hidden rather than shown broken.
const MessagesCard = ({ threads }) => {
  if (!threads || threads.length === 0) return null;

  return (
    <Card title="Messages">
      <ul className="divide-y divide-slate-100">
        {threads.map((thread, index) => {
          const courseId = thread.courseId || thread.course?.id || thread.id;
          const title = thread.course?.title || thread.courseTitle || 'Course';
          const preview = thread.lastMessage?.body || thread.lastMessageBody || '';
          const unread = Number(thread.unread) || 0;

          return (
            <li key={courseId || index} className="py-2 first:pt-0 last:pb-0">
              <Link
                to={courseId ? `/courses/${courseId}` : '/courses'}
                className="flex items-start justify-between gap-3 rounded-md px-1 py-1 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{title}</span>
                  {preview && (
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{preview}</span>
                  )}
                </span>
                {unread > 0 && <Chip tone="brand">{unread} unread</Chip>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export const ProfilePage = () => {
  const { user, refreshProfile } = useAuth();
  const profile = user?.profile || null;
  const role = user?.role;
  const isStudent = role === 'student';

  const [dashboard, setDashboard] = useState(null);
  const [activity, setActivity] = useState(null);
  const [authored, setAuthored] = useState(null);
  const [threads, setThreads] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (isStudent) {
      getStudentDashboard()
        .then((data) => !cancelled && setDashboard(data))
        .catch((err) => !cancelled && setError(errorMessage(err)));
      // The heatmap is decorative next to the rest of the page — a failure
      // leaves it in its empty state instead of blanking the profile.
      getStudentActivity()
        .then((data) => !cancelled && setActivity(data))
        .catch(() => !cancelled && setActivity({ days: [] }));
      listThreads()
        .then((list) => !cancelled && setThreads(Array.isArray(list) ? list : []))
        .catch(() => !cancelled && setThreads([]));
    } else {
      listMyCourses()
        .then((list) => !cancelled && setAuthored(Array.isArray(list) ? list : []))
        .catch((err) => !cancelled && setError(errorMessage(err)));
    }

    return () => {
      cancelled = true;
    };
  }, [isStudent]);

  const handleSaved = useCallback(async () => {
    await refreshProfile?.();
    setEditing(false);
  }, [refreshProfile]);

  if (!profile) return <Spinner />;

  // The dashboard payload is the fresher source for a student's XP (it is
  // rebuilt on every load); /api/me covers everyone else.
  const stats = isStudent && dashboard ? { ...profile, ...dashboard } : profile;
  const badges = dashboard?.badges || [];
  const totalCompletions = (activity?.days || []).reduce(
    (sum, day) => sum + (day.completions || 0),
    0,
  );

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ProfileRail
            profile={profile}
            stats={stats}
            badges={badges}
            variant="profile"
            showBadges={isStudent}
            onEdit={() => setEditing(true)}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          {isStudent && (
            <Card
              title="Learning activity"
              action={
                <span className="text-xs text-slate-500">
                  {totalCompletions} lesson{totalCompletions === 1 ? '' : 's'} completed in the
                  last year
                </span>
              }
            >
              <ActivityHeatmap days={activity?.days || []} />
            </Card>
          )}

          {isStudent ? (
            <Card title="Courses in progress">
              <CourseProgressList courses={dashboard?.enrolledCourses} />
            </Card>
          ) : (
            <Card
              title="Courses authored"
              action={
                <Link to="/instructor" className="text-xs font-medium text-brand-600">
                  Authoring →
                </Link>
              }
            >
              {authored === null ? <Spinner /> : <AuthoredCourseList courses={authored} />}
            </Card>
          )}

          {isStudent && <MessagesCard threads={threads} />}
        </div>
      </div>

      {editing && (
        <Modal title="Edit profile" onClose={() => setEditing(false)}>
          <EditProfileForm
            profile={profile}
            onSaved={handleSaved}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}
    </div>
  );
};
