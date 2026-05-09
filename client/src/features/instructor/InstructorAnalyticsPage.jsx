import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { getCourseAnalytics } from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

export const InstructorAnalyticsPage = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCourseAnalytics(id)
      .then(setData)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [id]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;

  const exerciseLessons = data.lessons.filter((l) => l.type === 'exercise');

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/instructor/courses/${id}`} className="text-sm text-brand-600 hover:text-brand-700">
          ← Back to course
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{data.courseTitle}</h1>
        <p className="mt-1 text-slate-600">Course analytics</p>
      </div>

      <KpiRow
        totalLearners={data.totalLearners}
        totalLessons={data.totalLessons}
        overallCompletionRate={data.overallCompletionRate}
      />

      {data.lessons.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          This course has no lessons yet.
        </p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Pass rate per lesson"
              hint="Share of learners who have completed each lesson"
              data={data.lessons}
              dataKey="passRate"
              fill="#0ea5e9"
              unit="%"
              domain={[0, 100]}
            />
            <ChartCard
              title="Avg hints used per learner"
              hint="Higher values may indicate the lesson needs scaffolding tweaks"
              data={exerciseLessons.length > 0 ? exerciseLessons : data.lessons}
              dataKey="avgHintsUsed"
              fill="#f59e0b"
            />
          </div>

          <LessonTable lessons={data.lessons} />
        </>
      )}
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

const KpiRow = ({ totalLearners, totalLessons, overallCompletionRate }) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <KpiCard label="Enrolled learners" value={totalLearners} />
    <KpiCard label="Lessons" value={totalLessons} />
    <KpiCard
      label="Overall completion"
      value={`${overallCompletionRate}%`}
      hint="Completed ÷ (learners × lessons)"
    />
  </div>
);

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const ChartCard = ({ title, hint, data, dataKey, fill, unit, domain }) => {
  const chartData = data.map((l) => ({
    name: truncate(l.title, 18),
    value: l[dataKey],
  }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 12 }} domain={domain} unit={unit} />
            <Tooltip formatter={(v) => (unit ? `${v}${unit}` : v)} />
            <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

const formatDuration = (seconds) => {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return `${m}m`;
};

const LessonTable = ({ lessons }) => (
  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <h2 className="border-b border-slate-200 p-4 text-lg font-semibold text-slate-900">
      Per-lesson breakdown
    </h2>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Lesson</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2 text-right">Learners</th>
            <th className="px-4 py-2 text-right">Attempts</th>
            <th className="px-4 py-2 text-right">Pass rate</th>
            <th className="px-4 py-2 text-right">Avg hints</th>
            <th className="px-4 py-2 text-right">Avg time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lessons.map((l) => (
            <tr key={l.lessonId}>
              <td className="px-4 py-2">
                <div className="font-medium text-slate-900">{l.title}</div>
                <div className="text-xs text-slate-500">{l.moduleTitle}</div>
              </td>
              <td className="px-4 py-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{l.type}</span>
              </td>
              <td className="px-4 py-2 text-right">{l.uniqueLearners}</td>
              <td className="px-4 py-2 text-right">{l.totalAttempts}</td>
              <td className="px-4 py-2 text-right">{l.passRate}%</td>
              <td className="px-4 py-2 text-right">{l.avgHintsUsed}</td>
              <td className="px-4 py-2 text-right">{formatDuration(l.avgTimeSpentSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
