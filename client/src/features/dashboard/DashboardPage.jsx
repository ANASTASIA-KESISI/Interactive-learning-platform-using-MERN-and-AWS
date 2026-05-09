import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { useAuth } from '../../hooks/useAuth.js';
import { getStudentDashboard } from '../../services/student.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

export const DashboardPage = () => {
  const { user } = useAuth();

  if (user?.role !== 'student') {
    return <NonStudentLanding role={user?.role} firstName={user?.firstName} />;
  }

  return <StudentDashboard firstName={user.firstName} />;
};

const StudentDashboard = ({ firstName }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getStudentDashboard()
      .then(setData)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">
          Welcome back{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-slate-600">
          Keep your streak going — every lesson counts.
        </p>
      </header>

      <KpiRow
        xpPoints={data.xpPoints}
        streak={data.streak}
        completionRate={data.completionRate}
        badgeCount={data.badgeCount}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <CourseProgressChart courses={data.enrolledCourses} />
        <RecentActivity items={data.recentActivity} />
      </div>

      <EnrolledCourses courses={data.enrolledCourses} />
    </div>
  );
};

const KpiCard = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </div>
);

const KpiRow = ({ xpPoints, streak, completionRate, badgeCount }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <KpiCard label="XP" value={xpPoints} hint="Earned across all lessons" />
    <KpiCard
      label="Streak"
      value={`${streak} day${streak === 1 ? '' : 's'}`}
      hint="Consecutive active days"
    />
    <KpiCard label="Completion" value={`${completionRate}%`} hint="Of lessons started" />
    <KpiCard label="Badges" value={badgeCount} hint="Achievements unlocked" />
  </div>
);

const CourseProgressChart = ({ courses }) => {
  if (!courses || courses.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Course progress</h2>
        <p className="text-sm text-slate-500">
          You haven&apos;t enrolled in any courses yet.{' '}
          <Link to="/courses" className="text-brand-600 hover:text-brand-700">
            Browse courses →
          </Link>
        </p>
      </section>
    );
  }

  const chartData = courses.map((c) => ({
    name: c.title.length > 24 ? `${c.title.slice(0, 22)}…` : c.title,
    completion: c.completionRate,
  }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">Course progress</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => `${value}%`} />
            <Bar dataKey="completion" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

const RecentActivity = ({ items }) => (
  <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-lg font-semibold text-slate-900">Recent activity</h2>
    {items.length === 0 ? (
      <p className="text-sm text-slate-500">Complete a lesson to see your activity here.</p>
    ) : (
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={`${item.lessonId}-${item.completedAt}`}
            className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
          >
            <Link
              to={`/lessons/${item.lessonId}`}
              className="font-medium text-slate-800 hover:text-brand-700"
            >
              {item.lessonTitle}
            </Link>
            <span className="text-xs text-slate-500">{formatRelative(item.completedAt)}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const EnrolledCourses = ({ courses }) => {
  if (!courses || courses.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Your courses</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses.map((c) => (
          <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{c.title}</h3>
              <span className="text-xs text-slate-500">
                {c.completedLessons}/{c.totalLessons}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {c.category} · {c.difficulty}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-brand-500" style={{ width: `${c.completionRate}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>{c.completionRate}% complete</span>
              <Link to={`/courses/${c.id}`} className="text-brand-600 hover:text-brand-700">
                Continue →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

const NonStudentLanding = ({ role, firstName }) => (
  <div className="space-y-4">
    <h1 className="text-3xl font-semibold text-slate-900">
      Welcome back{firstName ? `, ${firstName}` : ''}
    </h1>
    <p className="text-slate-600">
      You&apos;re signed in as <span className="font-medium">{role}</span>. The student
      dashboard shows learning analytics — switch to a student account to view it, or jump
      straight into authoring.
    </p>
    <div className="flex gap-2">
      <Link to="/instructor" className="btn-primary">Go to authoring</Link>
      <Link to="/courses" className="btn-ghost">Browse courses</Link>
    </div>
  </div>
);

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
