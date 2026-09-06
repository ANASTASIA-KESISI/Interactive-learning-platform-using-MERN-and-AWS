import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth.js';
import { LogoMark } from '../components/Logo.jsx';
import { Avatar, Chip } from '../components/ui/index.js';
import { formatXp, levelProgressPct } from '../lib/gamification.js';

const navLinkClass = ({ isActive }) =>
  [
    'text-sm font-medium transition-colors',
    isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900',
  ].join(' ');

const mobileLinkClass = ({ isActive }) =>
  [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
  ].join(' ');

// XP + rank live side by side so the number and the tier it buys are read
// together; the sliver of progress bar under the rank is the only place in the
// shell that shows how close the next level is.
const LevelBadge = ({ profile }) => {
  const pct = levelProgressPct(profile);

  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-amber-800">
        {formatXp(profile.xpPoints)} XP
      </span>
      <div className="min-w-[5.5rem]">
        <Chip tone="brand">{profile.rank}</Chip>
        <div
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Level ${profile.level} progress: ${profile.xpIntoLevel} of ${profile.xpForNextLevel} XP`}
        >
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
};

export const AppShell = () => {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const canAuthor = user?.role === 'instructor' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const profile = user?.profile || null;
  const unread = profile?.unreadMessages || 0;
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';

  // Every role reads messages in the same inbox. Students used to be sent to
  // their profile, where the threads were a read-only list — clicking a bell
  // that announces unread mail and landing somewhere you cannot reply is not an
  // inbox.
  const bellTo = '/messages';

  const links = [
    { to: '/', label: 'Home', end: true },
    { to: '/courses', label: 'Courses' },
    { to: '/notes', label: 'Notes' },
    { to: '/profile', label: 'Profile' },
    ...(canAuthor ? [{ to: '/instructor', label: 'Authoring' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  // The lesson page goes full-bleed in Phase 2 (three panes + editor); every
  // other screen keeps the centred column.
  const isLesson = pathname.startsWith('/lessons/');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 sm:hidden"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">☰</span>
            </button>

            <Link to="/" className="shrink-0">
              <LogoMark className="h-9 w-auto" alt="LearnCode" />
            </Link>

            <nav className="hidden items-center gap-4 sm:flex">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {user?.role === 'student' && profile && <LevelBadge profile={profile} />}

            <Link
              to={bellTo}
              className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
              aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
            >
              <span aria-hidden="true">🔔</span>
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <Link to="/profile" className="flex items-center gap-2" title={displayName}>
              <Avatar src={user?.avatar} name={displayName} size="sm" />
              <span className="hidden text-slate-600 lg:inline">{displayName}</span>
            </Link>

            <button type="button" onClick={logout} className="btn-ghost">
              Sign out
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-slate-100 px-4 py-2 sm:hidden">
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={mobileLinkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main className={isLesson ? 'max-w-none px-0 py-8' : 'mx-auto max-w-6xl px-4 py-8'}>
        <Outlet />
      </main>
    </div>
  );
};
