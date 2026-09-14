import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../hooks/useAuth.js';
import { getStudentDashboard } from '../../services/student.js';
import { listMyCourses } from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Card, Chip, EmptyState, ProgressBar, StatTile } from '../../components/ui/index.js';
import { DepartmentPrompt } from '../onboarding/DepartmentPrompt.jsx';
import { ProfileRail, displayName } from '../profile/ProfilePage.jsx';

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

// Home. Students get the learning screen from the mockup; instructors and
// admins get a landing that points at the work they actually do here.
export const DashboardPage = () => {
  const { user } = useAuth();

  if (user?.role !== 'student') {
    return <NonStudentLanding role={user?.role} firstName={user?.firstName} />;
  }

  return <StudentHome />;
};

const StudentHome = () => {
  const { user, refreshProfile } = useAuth();
  const profile = user?.profile || null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getStudentDashboard()
      .then((payload) => !cancelled && setData(payload))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Renders nothing unless the viewer is a student without a department, so it
  // is mounted unconditionally (P1-A contract).
  const prompt = <DepartmentPrompt profile={profile} onDone={refreshProfile} />;

  if (error) {
    return (
      <div className="space-y-6">
        {prompt}
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        {prompt}
        <Spinner />
      </div>
    );
  }

  const name = displayName(profile, user?.firstName);

  return (
    <div className="space-y-6">
      {prompt}

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Keep your streak going — every lesson counts.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ProfileRail
            profile={profile || { firstName: name }}
            stats={{ ...profile, ...data }}
            badges={data.badges || []}
            variant="home"
          />
        </div>

        <div className="lg:col-span-2">
          {data.activeCourse ? (
            <ContinueLearning course={data.activeCourse} />
          ) : (
            <NoActiveCourse />
          )}
        </div>
      </div>

      <EnrolledCourses courses={data.enrolledCourses} />

      <RecentActivity items={data.recentActivity} />
    </div>
  );
};

const ContinueLearning = ({ course }) => (
  <Card
    title="Continue learning"
    action={
      <Chip tone="brand">
        {course.completedLessons}/{course.totalLessons} lessons
      </Chip>
    }
  >
    <div className="flex items-start gap-3">
      {course.icon && (
        <span aria-hidden="true" className="text-3xl leading-none">
          {course.icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold text-slate-900">{course.title}</h3>
        <ProgressBar
          className="mt-3"
          value={course.completionRate}
          srLabel={`${course.title}: ${course.completionRate}% complete`}
        />
        <p className="mt-2 text-xs text-slate-500">{course.completionRate}% complete</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {course.nextLessonId ? (
            <Link to={`/lessons/${course.nextLessonId}`} className="btn-primary">
              Continue: {course.nextLessonTitle}
            </Link>
          ) : (
            <Link to={`/courses/${course.id}`} className="btn-primary">
              Review the course
            </Link>
          )}
          <Link to={`/courses/${course.id}`} className="text-sm text-brand-600 hover:text-brand-700">
            Course overview →
          </Link>
        </div>

        {!course.nextLessonId && (
          <p className="mt-3 text-sm text-slate-600">
            🎉 Every lesson in this course is complete.
          </p>
        )}
      </div>
    </div>
  </Card>
);

const NoActiveCourse = () => (
  <section className="space-y-4">
    <h2 className="text-2xl font-semibold text-slate-900">Choose your first course</h2>
    <EmptyState
      icon="📖"
      title="No active course yet"
      description="Pick a course to start building progress from this screen."
      action={
        <Link to="/courses" className="btn-primary">
          Browse courses
        </Link>
      }
    />
  </section>
);

const EnrolledCourses = ({ courses }) => {
  if (!courses || courses.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Your courses</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses.map((course) => (
          <li key={course.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{course.title}</h3>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {course.completedLessons}/{course.totalLessons}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {[course.category, course.difficulty].filter(Boolean).join(' · ')}
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
    </section>
  );
};

const RecentActivity = ({ items = [] }) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-slate-900">Recent activity</h2>
    {items.length === 0 ? (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
        Complete a lesson to see your activity here.
      </p>
    ) : (
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((item) => (
          <li
            key={`${item.lessonId}-${item.completedAt}`}
            className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
          >
            <Link
              to={`/lessons/${item.lessonId}`}
              className="font-medium text-slate-800 hover:text-brand-700"
            >
              {item.lessonTitle}
            </Link>
            <span className="shrink-0 text-xs text-slate-500">
              {formatRelative(item.completedAt)}
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

// Instructors and admins have no XP, streak or enrolments — the same shell, a
// different job. This keeps Home useful for them rather than showing an empty
// learner dashboard.
const NonStudentLanding = ({ role, firstName }) => {
  const [courses, setCourses] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listMyCourses()
      .then((list) => !cancelled && setCourses(Array.isArray(list) ? list : []))
      .catch(() => !cancelled && setCourses([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const published = (courses || []).filter((c) => c.isPublished).length;
  const learners = (courses || []).reduce((sum, c) => sum + (c.enrollmentCount || 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome back{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          You are signed in as <span className="font-medium">{role}</span>.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon="📚" label="Courses authored" value={courses === null ? '—' : courses.length} />
        <StatTile icon="✅" label="Published" value={courses === null ? '—' : published} />
        <StatTile icon="🧑‍🎓" label="Enrolled learners" value={courses === null ? '—' : learners} />
      </div>

      <Card title="Jump back in">
        <div className="flex flex-wrap gap-3">
          <Link to="/instructor" className="btn-primary">
            Go to authoring
          </Link>
          <Link to="/instructor/messages" className="btn-ghost border border-slate-200">
            Messages
          </Link>
          <Link to="/courses" className="btn-ghost border border-slate-200">
            Browse courses
          </Link>
          {role === 'admin' && (
            <>
              <Link to="/admin" className="btn-ghost border border-slate-200">
                Admin panel
              </Link>
              <Link to="/admin/universities" className="btn-ghost border border-slate-200">
                Universities
              </Link>
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

const formatRelative = (iso) => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
};
