import { useCallback, useEffect, useState } from 'react';

import {
  createDepartment,
  createUniversity,
  deleteDepartment,
  deleteUniversity,
} from '../../services/admin.js';
import { listUniversities } from '../../services/universities.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Card, Chip, EmptyState, Modal } from '../../components/ui/index.js';

const errorMessage = (err) => err.response?.data?.error?.message || err.message;

const SEMESTER_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// Adding a department per university. `semesterCount` is what the Courses page
// uses to lay out its "Semester 1 … N" sections, so it is a first-class field
// rather than something to fix up later.
const AddDepartmentForm = ({ universityId, onAdded, onError }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [semesterCount, setSemesterCount] = useState(8);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createDepartment(universityId, { name, code, semesterCount: Number(semesterCount) });
      setName('');
      setCode('');
      setSemesterCount(8);
      await onAdded();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_8rem_8rem_auto]">
      <div>
        <label className="label" htmlFor={`dept-name-${universityId}`}>
          Department name
        </label>
        <input
          id={`dept-name-${universityId}`}
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder="Applied Informatics"
        />
      </div>
      <div>
        <label className="label" htmlFor={`dept-code-${universityId}`}>
          Code
        </label>
        <input
          id={`dept-code-${universityId}`}
          className="field uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          maxLength={16}
          placeholder="AI"
        />
      </div>
      <div>
        <label className="label" htmlFor={`dept-sem-${universityId}`}>
          Semesters
        </label>
        <select
          id={`dept-sem-${universityId}`}
          className="field"
          value={semesterCount}
          onChange={(e) => setSemesterCount(e.target.value)}
        >
          {SEMESTER_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button type="submit" className="btn-ghost" disabled={saving}>
          {saving ? 'Adding…' : 'Add department'}
        </button>
      </div>
    </form>
  );
};

export const AdminUniversitiesPage = () => {
  const [universities, setUniversities] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    () =>
      listUniversities()
        .then(setUniversities)
        .catch((err) => setError(errorMessage(err))),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateUniversity = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createUniversity({ name: newName, code: newCode });
      setNewName('');
      setNewCode('');
      await load();
      setNotice('University created.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  // Both deletes are refused server-side (409) while anything still points at
  // the record, so the confirmation only has to explain the intent — the API
  // is what actually protects the data.
  const runDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (confirm.kind === 'university') {
        await deleteUniversity(confirm.id);
      } else {
        await deleteDepartment(confirm.id);
      }
      setConfirm(null);
      await load();
      setNotice(`Deleted ${confirm.name}.`);
    } catch (err) {
      setError(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Universities</h2>
        <p className="mt-1 text-sm text-slate-600">
          Students pick a university and department at signup; courses are grouped by the
          department&rsquo;s semesters.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-800">{notice}</div>
      )}

      <Card title="Add a university">
        <form onSubmit={handleCreateUniversity} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
          <div>
            <label className="label" htmlFor="uni-name">
              Name
            </label>
            <input
              id="uni-name"
              className="field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              maxLength={200}
              placeholder="University of Macedonia"
            />
          </div>
          <div>
            <label className="label" htmlFor="uni-code">
              Code
            </label>
            <input
              id="uni-code"
              className="field uppercase"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              required
              maxLength={16}
              placeholder="UOM"
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </Card>

      {!universities ? (
        <Spinner />
      ) : universities.length === 0 ? (
        <EmptyState
          icon="🏛️"
          title="No universities yet"
          description="Add one above, or run node scripts/seedUniversities.js on the server."
        />
      ) : (
        <div className="space-y-4">
          {universities.map((university) => (
            <Card
              key={university.id}
              title={
                <span className="flex items-center gap-2">
                  {university.name}
                  <Chip>{university.code}</Chip>
                </span>
              }
              action={
                <button
                  type="button"
                  className="text-sm text-red-700 hover:underline"
                  onClick={() =>
                    setConfirm({ kind: 'university', id: university.id, name: university.name })
                  }
                >
                  Delete
                </button>
              }
            >
              {university.departments.length === 0 ? (
                <p className="text-sm text-slate-500">No departments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {university.departments.map((department) => (
                    <li
                      key={department.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{department.name}</span>
                        <Chip>{department.code}</Chip>
                        <span className="text-xs text-slate-500">
                          {department.semesterCount} semesters
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-sm text-red-700 hover:underline"
                        onClick={() =>
                          setConfirm({
                            kind: 'department',
                            id: department.id,
                            name: department.name,
                          })
                        }
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <AddDepartmentForm
                universityId={university.id}
                onAdded={load}
                onError={setError}
              />
            </Card>
          ))}
        </div>
      )}

      {confirm && (
        <Modal title={`Delete ${confirm.name}?`} onClose={() => setConfirm(null)}>
          <p className="text-sm text-slate-600">
            {confirm.kind === 'university'
              ? 'A university can only be deleted once all of its departments are gone.'
              : 'A department can only be deleted while no user or course still references it.'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-red-600 text-white hover:bg-red-700"
              onClick={runDelete}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};
