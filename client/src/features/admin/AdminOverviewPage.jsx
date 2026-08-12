import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { getKpis } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

export const AdminOverviewPage = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getKpis(8)
      .then(setData)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;

  const roles = data.usersByRole || {};

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total users" value={data.totalUsers} />
        <KpiCard
          label="Active this week"
          value={data.weeklyActiveUsers}
          hint="Seen in the last 7 days"
        />
        <KpiCard
          label="Courses"
          value={data.totalCourses}
          hint={`${data.publishedCourses} published`}
        />
        <KpiCard
          label="Learners"
          value={roles.student ?? 0}
          hint={`${roles.instructor ?? 0} instructors · ${roles.admin ?? 0} admins`}
        />
      </div>

      <WeeklyActivityCard weeks={data.activeByWeek || []} />
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

const formatWeek = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Bars rather than a line: the API buckets each user by the week they were LAST
// seen, so the weeks are disjoint counts, not samples of a continuous quantity.
// A line would draw interpolation between weeks that does not exist.
//
// The single series carries no legend — the card title names it. The chart
// colour sits below 3:1 against the card surface, so exact values are always
// reachable through the tooltip and the toggleable data table rather than by
// reading the bars alone.
const WeeklyActivityCard = ({ weeks }) => {
  const [showTable, setShowTable] = useState(false);

  const chartData = weeks.map((w) => ({ name: formatWeek(w.weekStart), value: w.activeUsers }));
  const hasActivity = weeks.some((w) => w.activeUsers > 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Active users per week</h2>
          <p className="mt-1 text-xs text-slate-500">
            Users by the week they were last active. Each user counts once.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="btn-ghost shrink-0 text-sm"
          aria-expanded={showTable}
        >
          {showTable ? 'Hide data' : 'Show data'}
        </button>
      </div>

      {!hasActivity ? (
        <p className="mt-6 rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No recorded activity yet.
        </p>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} height={40} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Active users']} />
              <Bar dataKey="value" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showTable && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Active users per week</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Week beginning</th>
                <th scope="col" className="px-4 py-2 text-right">Active users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td className="px-4 py-2">{w.weekStart}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{w.activeUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
