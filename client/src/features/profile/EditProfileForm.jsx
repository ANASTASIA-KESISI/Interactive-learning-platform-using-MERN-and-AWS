import { useEffect, useState } from 'react';

import { updateMe } from '../../services/me.js';
import { listUniversities } from '../../services/universities.js';

// Mirrors of the server-side caps in profileService. These exist for UX only —
// the server re-validates every one of them and is the authority (CLAUDE.md).
const BIO_MAX = 500;
const NAME_MAX = 100;
const AVATAR_MAX = 512;

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

// The institution pair is always submitted together: PATCH /api/me rejects a
// lone departmentId when the account has no stored university (400), and a
// department is only meaningful inside its university.
export const EditProfileForm = ({ profile, onSaved, onCancel }) => {
  const [form, setForm] = useState({
    firstName: profile?.firstName || '',
    lastName: profile?.lastName || '',
    bio: profile?.bio || '',
    avatar: profile?.avatar || '',
    universityId: profile?.university?.id || '',
    departmentId: profile?.department?.id || '',
  });
  const [universities, setUniversities] = useState([]);
  const [loadingUniversities, setLoadingUniversities] = useState(true);
  const [universitiesError, setUniversitiesError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listUniversities()
      .then((list) => {
        if (cancelled) return;
        setUniversities(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        // A missing list must not block a name change — the selects degrade to
        // a notice and the rest of the form still saves.
        if (!cancelled) setUniversitiesError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingUniversities(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const selectUniversity = (event) => {
    const universityId = event.target.value;
    // The stored department belongs to the old university, so it can never
    // survive the switch.
    setForm((prev) => ({ ...prev, universityId, departmentId: '' }));
  };

  const selectedUniversity = universities.find((u) => u.id === form.universityId) || null;
  const departments = selectedUniversity?.departments || [];

  const validate = () => {
    if (form.firstName.length > NAME_MAX) return `First name must be ${NAME_MAX} characters or fewer.`;
    if (form.lastName.length > NAME_MAX) return `Last name must be ${NAME_MAX} characters or fewer.`;
    if (form.bio.length > BIO_MAX) return `Bio must be ${BIO_MAX} characters or fewer.`;
    if (form.avatar.length > AVATAR_MAX) return `Avatar URL must be ${AVATAR_MAX} characters or fewer.`;
    if (form.departmentId && !form.universityId) return 'Choose a university for that department.';
    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await updateMe({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        bio: form.bio.trim(),
        avatar: form.avatar.trim(),
        universityId: form.universityId,
        departmentId: form.departmentId,
      });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
      return;
    }

    try {
      await onSaved?.();
    } catch {
      // The save landed; a failed refresh only means the page is a beat stale.
    }
    setSaving(false);
  };

  const bioLeft = BIO_MAX - form.bio.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-first-name" className="label">
            First name
          </label>
          <input
            id="profile-first-name"
            className="field"
            value={form.firstName}
            onChange={set('firstName')}
            maxLength={NAME_MAX}
            disabled={saving}
          />
        </div>
        <div>
          <label htmlFor="profile-last-name" className="label">
            Last name
          </label>
          <input
            id="profile-last-name"
            className="field"
            value={form.lastName}
            onChange={set('lastName')}
            maxLength={NAME_MAX}
            disabled={saving}
          />
        </div>
      </div>

      <div>
        <label htmlFor="profile-bio" className="label">
          Bio
        </label>
        <textarea
          id="profile-bio"
          className="field min-h-[6rem]"
          value={form.bio}
          onChange={set('bio')}
          maxLength={BIO_MAX}
          disabled={saving}
          aria-describedby="profile-bio-count"
        />
        <p
          id="profile-bio-count"
          className={`mt-1 text-xs ${bioLeft < 0 ? 'text-red-700' : 'text-slate-500'}`}
          aria-live="polite"
        >
          {form.bio.length} / {BIO_MAX} characters
        </p>
      </div>

      <div>
        <label htmlFor="profile-avatar" className="label">
          Avatar URL
        </label>
        <input
          id="profile-avatar"
          type="url"
          className="field"
          placeholder="https://…"
          value={form.avatar}
          onChange={set('avatar')}
          maxLength={AVATAR_MAX}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-slate-500">
          Leave empty to use your initials. Image uploads arrive in a later sprint.
        </p>
      </div>

      {universitiesError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          We could not load the list of universities ({universitiesError}). Your other details
          still save.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="profile-university" className="label">
              University
            </label>
            <select
              id="profile-university"
              className="field"
              value={form.universityId}
              onChange={selectUniversity}
              disabled={saving || loadingUniversities}
            >
              <option value="">
                {loadingUniversities ? 'Loading universities…' : 'Not set'}
              </option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="profile-department" className="label">
              Department
            </label>
            <select
              id="profile-department"
              className="field"
              value={form.departmentId}
              onChange={set('departmentId')}
              disabled={saving || loadingUniversities || !form.universityId}
              aria-describedby={!form.universityId ? 'profile-department-hint' : undefined}
            >
              <option value="">{form.universityId ? 'Not set' : 'Choose a university first'}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {!form.universityId && (
              <p id="profile-department-hint" className="mt-1 text-xs text-slate-500">
                Pick a university to see its departments.
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
};
