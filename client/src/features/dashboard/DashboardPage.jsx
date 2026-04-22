import { useEffect, useState } from 'react';

import { api, unwrap } from '../../services/api.js';
import { useAuth } from '../../hooks/useAuth.js';

// Sprint-1 verification screen: hits the role-gated /api/student/ping endpoint
// to confirm the full auth chain (Cognito → JWT → requireAuth → requireRole → attachUser).
// Will be replaced by the real student dashboard in Sprint 4.
export const DashboardPage = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState({ state: 'idle', data: null, error: null });

  useEffect(() => {
    if (user?.role !== 'student') return;
    setStatus({ state: 'loading', data: null, error: null });
    api
      .get('/student/ping')
      .then((res) => setStatus({ state: 'ok', data: unwrap(res), error: null }))
      .catch((err) =>
        setStatus({
          state: 'error',
          data: null,
          error: err.response?.data?.error?.message || err.message,
        }),
      );
  }, [user?.role]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
        <p className="mt-1 text-slate-600">
          Signed in as <span className="font-medium">{user?.email}</span> · role{' '}
          <span className="font-medium">{user?.role}</span>
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">API connectivity</h2>

        {user?.role !== 'student' ? (
          <p className="text-sm text-slate-600">
            The <code>/api/student/ping</code> endpoint is student-only — switch to a student account
            to verify the end-to-end auth chain.
          </p>
        ) : status.state === 'loading' ? (
          <p className="text-sm text-slate-500">Pinging backend…</p>
        ) : status.state === 'ok' ? (
          <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-800">
            {JSON.stringify(status.data, null, 2)}
          </pre>
        ) : status.state === 'error' ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{status.error}</p>
        ) : null}
      </section>
    </div>
  );
};
