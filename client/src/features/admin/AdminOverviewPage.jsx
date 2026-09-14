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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <KpiCard
          label="Badges awarded"
          value={data.badgesAwardedTotal ?? 0}
          hint="Dated awards, all time"
        />
        <KpiCard
          label="Avg active session"
          value={formatMinutes(data.avgSessionDurationSec)}
          hint={sessionHint(data)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <WeeklySeriesCard
          title="Active users per week"
          hint="Users by the week they were last active. Each user counts once."
          emptyText="No recorded activity yet."
          weeks={data.activeByWeek || []}
          valueKey="activeUsers"
          valueLabel="Active users"
          fill="#0ea5e9"
        />
        <WeeklySeriesCard
          title="Badges awarded per week"
          hint="Awards by the week they were earned. Badges earned before awards were dated are not shown."
          emptyText="No badges awarded yet."
          weeks={data.badgesAwardedByWeek || []}
          valueKey="badgesAwarded"
          valueLabel="Badges awarded"
          fill="#f59e0b"
        />
      </div>
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

// `m:ss` — a session is minutes long, and the seconds column keeps a short
// pilot's numbers from all rounding to the same minute.
const formatMinutes = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// The count is the honesty check on the average, and the median says whether
// a few long sessions are carrying it. Both sit under the tile rather than
// beside it.
const sessionHint = ({ sessions = 0, medianSessionDurationSec = 0 }) => {
  if (!sessions) return 'No sessions in the last 8 weeks';
  const noun = sessions === 1 ? 'session' : 'sessions';
  return `${sessions} ${noun} in 8 weeks · median ${formatMinutes(medianSessionDurationSec)}`;
};

// Bars rather than a line: the API buckets each event by the week it fell in
// (a user by the week they were LAST seen, a badge by the week it was earned),
// so the weeks are disjoint counts, not samples of a continuous quantity. A
// line would draw interpolation between weeks that does not exist.
//
// The single series carries no legend — the card title names it. The chart
// colour sits below 3:1 against the card surface, so exact values are always
// reachable through the tooltip and the toggleable data table rather than by
// reading the bars alone.
const WeeklySeriesCard = ({ title, hint, emptyText, weeks, valueKey, valueLabel, fill }) => {
  const [showTable, setShowTable] = useState(false);

  const chartData = weeks.map((w) => ({ name: formatWeek(w.weekStart), value: w[valueKey] }));
  const hasActivity = weeks.some((w) => w[valueKey] > 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
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
          {emptyText}
        </p>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} height={40} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, valueLabel]} />
              <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showTable && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Week beginning</th>
                <th scope="col" className="px-4 py-2 text-right">{valueLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td className="px-4 py-2">{w.weekStart}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{w[valueKey]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
