import { useCallback, useEffect, useState } from 'react';

import { listUsers, setUserRole } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { useAuth } from '../../hooks/useAuth.js';

const ROLES = ['student', 'instructor', 'admin'];
const PAGE_SIZE = 20;

export const AdminUsersPage = () => {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE });
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return listUsers({ page, limit: PAGE_SIZE, ...(roleFilter ? { role: roleFilter } : {}) })
      .then(({ users: rows, meta: m }) => {
        setUsers(rows);
        setMeta(m);
      })
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [page, roleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRoleChange = async (userId, role) => {
    setSavingId(userId);
    setError(null);
    setNotice(null);
    try {
      await setUserRole(userId, role);
      setNotice(
        'Role updated in Cognito. It takes effect for that user the next time they sign in or their token refreshes.',
      );
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setSavingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Users</h2>
          <p className="mt-1 text-sm text-slate-600">
            {meta.total} account{meta.total === 1 ? '' : 's'}
          </p>
        </div>

        <div>
          <label htmlFor="roleFilter" className="label">Filter by role</label>
          <select
            id="roleFilter"
            value={roleFilter}
            onChange={(e) => {
              setPage(1);
              setRoleFilter(e.target.value);
            }}
            className="field w-44"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-800">{notice}</div>
      )}

      {!users ? (
        <Spinner />
      ) : users.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No users match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Name</th>
                <th scope="col" className="px-4 py-2">Email</th>
                <th scope="col" className="px-4 py-2 text-right">XP</th>
                <th scope="col" className="px-4 py-2">Last active</th>
                <th scope="col" className="px-4 py-2">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u._id === currentUser?.dbId;
                return (
                  <tr key={u._id}>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                      {isSelf && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{u.email}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.xpPoints ?? 0}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <label className="sr-only" htmlFor={`role-${u._id}`}>
                        Role for {u.email}
                      </label>
                      <select
                        id={`role-${u._id}`}
                        value={u.role}
                        disabled={isSelf || savingId === u._id}
                        onChange={(e) => handleRoleChange(u._id, e.target.value)}
                        className="field w-36"
                        title={isSelf ? 'You cannot change your own role' : undefined}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
};
