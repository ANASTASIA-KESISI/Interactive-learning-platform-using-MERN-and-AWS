import { NavLink, Outlet } from 'react-router-dom';

const SECTIONS = [
  { to: '/admin', end: true, label: 'Overview', hint: 'Platform KPIs' },
  { to: '/admin/users', label: 'Users', hint: 'Roles and accounts' },
  { to: '/admin/courses', label: 'Courses', hint: 'Publish and review' },
  { to: '/admin/universities', label: 'Universities', hint: 'Departments and semesters' },
];

const linkClass = ({ isActive }) =>
  [
    'block rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-brand-50 font-medium text-brand-700'
      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
  ].join(' ');

export const AdminLayout = () => (
  <div className="space-y-6">
    <header>
      <h1 className="text-3xl font-semibold text-slate-900">Administration</h1>
      <p className="mt-1 text-slate-600">Platform-wide settings and oversight.</p>
    </header>

    <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Admin sections" className="lg:sticky lg:top-6 lg:self-start">
        <ul className="space-y-1">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink to={s.to} end={s.end} className={linkClass}>
                <span className="block">{s.label}</span>
                <span className="block text-xs font-normal text-slate-400">{s.hint}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  </div>
);
