import { useCallback, useEffect, useState } from 'react';

import { listUsers, setUserRole, setUserActive } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Modal } from '../../components/ui/index.js';
import { titleCase } from '../../lib/labels.js';
import { useAuth } from '../../hooks/useAuth.js';

const ROLES = ['student', 'instructor', 'admin'];
const PAGE_SIZE = 20;

const errorMessage = (err) => err.response?.data?.error?.message || err.message;
const displayName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

// Accounts created before S8 have no flag at all; absent means active.
const isActive = (u) => u.isActive !== false;

export const AdminUsersPage = () => {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE });
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingId, setSavingId] = useState(null);
  // The user awaiting a deactivate/reactivate confirmation (D9: Modal, not
  // window.confirm).
  const [confirm, setConfirm] = useState(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return listUsers({ page, limit: PAGE_SIZE, ...(roleFilter ? { role: roleFilter } : {}) })
      .then(({ users: rows, meta: m }) => {
        setUsers(rows);
        setMeta(m);
      })
      .catch((err) => setError(errorMessage(err)));
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
      setError(errorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  // Deactivation is immediate: the server disables the Cognito user, revokes
  // their refresh tokens and refuses their next API call (S8 D3). The button
  // is disabled on the admin's own row and the server refuses it regardless.
  const runToggleActive = async () => {
    if (!confirm) return;
    const nextActive = !isActive(confirm);
    setToggling(true);
    setError(null);
    setNotice(null);
    try {
      await setUserActive(confirm._id, nextActive);
      setConfirm(null);
      await load();
      setNotice(
        nextActive
          ? `Reactivated ${displayName(confirm)}. They can sign in again.`
          : `Deactivated ${displayName(confirm)}. They have been signed out and cannot sign in until reactivated.`,
      );
    } catch (err) {
      setError(errorMessage(err));
      setConfirm(null);
    } finally {
      setToggling(false);
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
            {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div role="status" className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice}
        </div>
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
                <th scope="col" className="px-4 py-2">Active</th>
                <th scope="col" className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u._id === currentUser?.dbId;
                const active = isActive(u);
                return (
                  <tr key={u._id} className={active ? undefined : 'bg-slate-50 text-slate-400'}>
                    <td className={`px-4 py-2 font-medium ${active ? 'text-slate-900' : ''}`}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                      {isSelf && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          you
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-2 ${active ? 'text-slate-600' : ''}`}>{u.email}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.xpPoints ?? 0}</td>
                    <td className={`px-4 py-2 ${active ? 'text-slate-600' : ''}`}>
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
                        {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {active ? (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Active
                        </span>
                      ) : (
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className={`btn-ghost text-sm ${active ? 'text-red-700 hover:bg-red-50' : ''}`}
                        disabled={isSelf || savingId === u._id}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                        onClick={() => setConfirm(u)}
                      >
                        {active ? 'Deactivate' : 'Reactivate'}
                      </button>
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

      {confirm && (
        <Modal
          title={`${isActive(confirm) ? 'Deactivate' : 'Reactivate'} ${displayName(confirm)}?`}
          onClose={() => setConfirm(null)}
        >
          <p className="text-sm text-slate-600">
            {isActive(confirm) ? (
              <>
                <span className="font-medium text-slate-900">{confirm.email}</span> will be
                signed out everywhere immediately and cannot sign in again until an
                administrator reactivates the account. Their progress, notes and messages are
                kept.
              </>
            ) : (
              <>
                <span className="font-medium text-slate-900">{confirm.email}</span> will be
                able to sign in again with their existing password.
              </>
            )}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirm(null)}
              disabled={toggling}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                isActive(confirm)
                  ? 'btn bg-red-600 text-white hover:bg-red-700'
                  : 'btn-primary'
              }
              onClick={runToggleActive}
              disabled={toggling}
            >
              {toggling
                ? 'Saving…'
                : isActive(confirm)
                  ? 'Deactivate'
                  : 'Reactivate'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};
