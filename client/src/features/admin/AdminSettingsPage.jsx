import { useEffect, useState } from 'react';

import { getInstructorInviteCode, setInstructorInviteCode } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Card } from '../../components/ui/index.js';

const errorMessage = (err) => err.response?.data?.error?.message || err.message;

// Same shape as DEPLOYMENT.md's suggested generator: 24 random bytes,
// base64url — long enough that the 5-per-15-minute budget on the claim
// endpoint makes guessing hopeless, short enough to paste into an email.
const generateCode = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const SOURCE_NOTE = {
  database: 'Set from this panel. Saving here replaces it immediately.',
  environment:
    'Read from the INSTRUCTOR_INVITE_CODE environment variable — nothing has been saved from ' +
    'this panel yet. Saving here takes precedence over the environment from then on.',
  unset:
    'No code is configured, so instructor self-signup is disabled: the invite form creates an ' +
    'ordinary student account. Save a code below to enable it.',
};

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;

export const AdminSettingsPage = () => {
  const [setting, setSetting] = useState(null);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    getInstructorInviteCode()
      .then((data) => {
        setSetting(data);
        setDraft(data.code || '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const dirty = setting !== null && draft.trim() !== (setting.code || '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(setting.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard — select the code and copy it by hand.');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const data = await setInstructorInviteCode(draft);
      setSetting(data);
      setDraft(data.code || '');
      setNotice(
        data.code
          ? 'Invite code saved. It is valid for new instructor sign-ups from now on; accounts already promoted keep their role.'
          : 'Invite code cleared. Instructor self-signup is disabled until a new code is saved.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (error && !setting) return <ErrorBanner message={error} />;
  if (!setting) return <Spinner />;

  const current = setting.code || '';

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-600">
          Platform-wide values an administrator can change without a redeploy.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <p role="status" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {notice}
        </p>
      )}

      <Card title="Instructor invite code">
        <div className="space-y-5">
          <p className="text-sm text-slate-600">
            Teaching staff enter this code on the instructor sign-up form to receive the{' '}
            <span className="font-medium">instructor</span> role automatically. Hand it out
            directly; anyone who has it can become an instructor.
          </p>

          <div>
            <p className="label">Current code</p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                data-testid="current-code"
                className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900"
              >
                {current ? (revealed ? current : '•'.repeat(Math.min(current.length, 32))) : (
                  <span className="text-slate-400">— not set —</span>
                )}
              </code>
              {current && (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-pressed={revealed}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? 'Hide' : 'Reveal'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={handleCopy}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {SOURCE_NOTE[setting.source] || SOURCE_NOTE.unset}
              {setting.source === 'database' && setting.updatedAt && (
                <> Last changed {formatDate(setting.updatedAt)}.</>
              )}
            </p>
          </div>

          <form onSubmit={handleSave} className="space-y-3 border-t border-slate-100 pt-5">
            <div>
              <label htmlFor="invite-code" className="label">
                New code
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="invite-code"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="field min-w-0 flex-1 font-mono"
                  aria-describedby="invite-code-hint"
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setDraft(generateCode())}
                  disabled={saving}
                >
                  Generate
                </button>
              </div>
              <p id="invite-code-hint" className="mt-1 text-xs text-slate-500">
                8–128 characters, no spaces. Clear the field and save to disable instructor
                self-signup.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button type="submit" className="btn-primary" disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save code'}
              </button>
              {dirty && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setDraft(current)}
                  disabled={saving}
                >
                  Discard
                </button>
              )}
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
};
