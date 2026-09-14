import { useEffect, useState } from 'react';

import { Card } from '../../components/ui/index.js';
import { listUniversities } from '../../services/universities.js';
import { updateMe } from '../../services/me.js';

// This module is the home of everything P1-A shares between the two signup
// forms, the login hand-off and the on-Home onboarding prompt. It lives here
// (rather than in a new shared file) because the university/department picker
// and the prompt are one feature: "tell us where you study".

// --- sessionStorage contract -------------------------------------------------
// Cognito signup happens before a Mongo user exists, so the institution choice
// and the instructor invite code are parked for the duration of the tab and
// applied by LoginPage on the first successful sign-in (S7 D4/D2).
//   learncode.pendingProfile        JSON { universityId: string, departmentId: string }
//   learncode.pendingInstructorCode string (the raw code, cleared after one try)
export const PENDING_PROFILE_KEY = 'learncode.pendingProfile';
export const PENDING_INSTRUCTOR_CODE_KEY = 'learncode.pendingInstructorCode';
const DISMISSED_KEY = 'learncode.departmentPromptDismissed';

// sessionStorage throws in some privacy modes; onboarding is a convenience, so
// every access degrades to "no stored value" rather than breaking signup.
const readItem = (key) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeItem = (key, value) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore — the user just re-picks their department from the Home prompt.
  }
};

export const clearPending = (key) => {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore.
  }
};

// Only writes when something was actually chosen — a signup that ran without
// the selects (the /api/universities call failed) must not park an empty patch.
export const savePendingProfile = ({ universityId, departmentId }) => {
  if (!universityId || !departmentId) {
    clearPending(PENDING_PROFILE_KEY);
    return;
  }
  writeItem(PENDING_PROFILE_KEY, JSON.stringify({ universityId, departmentId }));
};

export const readPendingProfile = () => {
  const raw = readItem(PENDING_PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.universityId || !parsed?.departmentId) return null;
    return { universityId: parsed.universityId, departmentId: parsed.departmentId };
  } catch {
    return null;
  }
};

export const savePendingInstructorCode = (code) => {
  if (!code) return;
  writeItem(PENDING_INSTRUCTOR_CODE_KEY, code);
};

export const readPendingInstructorCode = () => readItem(PENDING_INSTRUCTOR_CODE_KEY) || null;

export const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

// --- university/department data ---------------------------------------------

// `enabled` exists so DepartmentPrompt, which renders null for most viewers,
// does not fire a network request just to throw the answer away.
export const useUniversities = (enabled = true) => {
  const [universities, setUniversities] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    listUniversities()
      .then((list) => {
        if (cancelled) return;
        setUniversities(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { universities, loading, error };
};

// --- the shared picker -------------------------------------------------------

// Two dependent selects. `idPrefix` keeps every label/control association
// unique when more than one instance could share a page.
export const InstitutionFields = ({
  universities,
  universityId,
  departmentId,
  onUniversityChange,
  onDepartmentChange,
  loading = false,
  disabled = false,
  required = true,
  idPrefix = 'institution',
}) => {
  const selected = universities.find((u) => u.id === universityId) || null;
  const departments = selected?.departments || [];
  const universityFieldId = `${idPrefix}-university`;
  const departmentFieldId = `${idPrefix}-department`;
  const departmentLocked = disabled || loading || !universityId;

  return (
    <>
      <div>
        <label htmlFor={universityFieldId} className="label">
          University
        </label>
        <select
          id={universityFieldId}
          className="field"
          value={universityId}
          onChange={(e) => onUniversityChange(e.target.value)}
          required={required}
          disabled={disabled || loading}
        >
          <option value="">{loading ? 'Loading universities…' : 'Select your university'}</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={departmentFieldId} className="label">
          Department
        </label>
        <select
          id={departmentFieldId}
          className="field"
          value={departmentId}
          onChange={(e) => onDepartmentChange(e.target.value)}
          required={required}
          disabled={departmentLocked}
          aria-describedby={!universityId ? `${departmentFieldId}-hint` : undefined}
        >
          <option value="">
            {universityId ? 'Select your department' : 'Choose a university first'}
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {!universityId && (
          <p id={`${departmentFieldId}-hint`} className="mt-1 text-xs text-slate-500">
            Pick a university to see its departments.
          </p>
        )}
        {universityId && !loading && departments.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            This university has no departments yet — an administrator has to add one.
          </p>
        )}
      </div>
    </>
  );
};

// --- the onboarding prompt ---------------------------------------------------

// Contract relied on by Home (P1-F):
//   <DepartmentPrompt profile={profile} onDone={refreshProfile} />
// Renders NOTHING unless the viewer is a student with no department yet, so
// Home can mount it unconditionally.
export const DepartmentPrompt = ({ profile, onDone }) => {
  const [dismissed, setDismissed] = useState(() => readItem(DISMISSED_KEY) === '1');
  const [universityId, setUniversityId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const eligible =
    Boolean(profile) && profile.role === 'student' && !profile.department && !dismissed;

  const { universities, loading, error: loadError } = useUniversities(eligible);

  if (!eligible) return null;

  const handleUniversityChange = (value) => {
    setUniversityId(value);
    setDepartmentId('');
  };

  const handleDismiss = () => {
    writeItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!universityId || !departmentId) {
      setError('Choose both a university and a department.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateMe({ universityId, departmentId });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
      return;
    }
    try {
      await onDone?.();
    } catch {
      // The save landed; a failed refresh only means the page is a beat stale.
    }
    setSaving(false);
  };

  return (
    <Card title="Where do you study?">
      <p className="text-sm text-slate-600">
        Telling us your department lets LearnCode group courses by the semester you are in.
      </p>

      {loadError ? (
        <div className="mt-4 space-y-3">
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            We could not load the list of universities ({loadError}). You can set this later from
            your profile.
          </p>
          <button type="button" onClick={handleDismiss} className="btn-ghost">
            Dismiss
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <InstitutionFields
              idPrefix="onboarding"
              universities={universities}
              universityId={universityId}
              departmentId={departmentId}
              onUniversityChange={handleUniversityChange}
              onDepartmentChange={setDepartmentId}
              loading={loading}
              disabled={saving}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save department'}
            </button>
            <button type="button" onClick={handleDismiss} className="btn-ghost" disabled={saving}>
              Not now
            </button>
          </div>
        </form>
      )}
    </Card>
  );
};
