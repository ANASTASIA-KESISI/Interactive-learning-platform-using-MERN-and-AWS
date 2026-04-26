import { Link, NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth.js';

const navLinkClass = ({ isActive }) =>
  [
    'text-sm font-medium transition-colors',
    isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900',
  ].join(' ');

export const AppShell = () => {
  const { user, logout } = useAuth();
  const canAuthor = user?.role === 'instructor' || user?.role === 'admin';

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-lg font-semibold text-slate-900">
              LearnCode
            </Link>
            <nav className="hidden items-center gap-4 sm:flex">
              <NavLink to="/" end className={navLinkClass}>Dashboard</NavLink>
              <NavLink to="/courses" className={navLinkClass}>Courses</NavLink>
              {canAuthor && (
                <NavLink to="/instructor" className={navLinkClass}>Authoring</NavLink>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user?.firstName || user?.email}{' '}
              <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {user?.role}
              </span>
            </span>
            <button type="button" onClick={logout} className="btn-ghost">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
};
