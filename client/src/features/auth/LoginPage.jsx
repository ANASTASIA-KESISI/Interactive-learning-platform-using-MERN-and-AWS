import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../hooks/useAuth.js';
import { Logo } from '../../components/Logo.jsx';
import { claimInstructor } from '../../services/auth.js';
import { updateMe } from '../../services/me.js';
import {
  PENDING_INSTRUCTOR_CODE_KEY,
  PENDING_PROFILE_KEY,
  clearPending,
  errorMessage,
  readPendingInstructorCode,
  readPendingProfile,
} from '../onboarding/DepartmentPrompt.jsx';

export const LoginPage = () => {
  const { login, refreshProfile, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || '/';
  const notice = location.state?.notice || null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  // The first sign-in is the earliest moment a Mongo user exists, so it is the
  // only place the choices parked at signup can be applied (S7 D4 / D2). Each
  // step is isolated: a failure in one must neither skip the other nor block
  // the login that already succeeded.
  const applyPendingSignup = async () => {
    const collected = [];

    const pendingProfile = readPendingProfile();
    if (pendingProfile) {
      try {
        await updateMe(pendingProfile);
      } catch (err) {
        collected.push(
          `We could not save your university and department (${errorMessage(err)}). ` +
            'You can set them from your dashboard at any time.',
        );
      } finally {
        clearPending(PENDING_PROFILE_KEY);
      }
    }

    const pendingCode = readPendingInstructorCode();
    if (pendingCode) {
      try {
        await claimInstructor(pendingCode);
        // The role lives in a Cognito group, so the ID token has to be
        // reissued before the app sees the new claim.
        try {
          await refreshSession();
        } catch {
          collected.push(
            'Your instructor role was granted, but this browser is still using the old ' +
              'session. Sign out and back in to see the authoring tools.',
          );
        }
        try {
          await refreshProfile();
        } catch {
          // Cosmetic only — the shell re-reads /api/me on its next navigation.
        }
      } catch (err) {
        collected.push(
          `That instructor invite code was not accepted (${errorMessage(err)}). ` +
            'Your account is signed in as a student — an administrator can grant you the ' +
            'instructor role from the admin panel.',
        );
      } finally {
        // Cleared whether or not it worked: a wrong code must not be retried
        // silently on every future sign-in.
        clearPending(PENDING_INSTRUCTOR_CODE_KEY);
      }
    }

    return collected;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    setSubmitting(true);

    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed');
      setSubmitting(false);
      return;
    }

    setSettingUp(true);
    let collected = [];
    try {
      collected = await applyPendingSignup();
    } catch (err) {
      collected = [errorMessage(err)];
    }
    setSettingUp(false);
    setSubmitting(false);

    // Warnings are shown here rather than on the destination so they cannot be
    // lost: the pages behind /login belong to other packages and do not render
    // router state. "Continue" is the only thing left to do.
    if (collected.length > 0) {
      setWarnings(collected);
      return;
    }

    navigate(redirectTo, { replace: true });
  };

  let submitLabel = 'Sign in';
  if (settingUp) submitLabel = 'Setting up your account…';
  else if (submitting) submitLabel = 'Signing in…';

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <Logo className="mx-auto mb-6 h-24 w-auto" />
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Sign in</h1>

        {notice && (
          <p role="status" className="mb-4 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
            {notice}
          </p>
        )}

        {warnings.length > 0 ? (
          <div className="space-y-4">
            <div role="alert" className="space-y-2">
              {warnings.map((message) => (
                <p key={message} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {message}
                </p>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => navigate(redirectTo, { replace: true })}
            >
              Continue
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="field"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="field"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitLabel}
            </button>

            {settingUp && (
              <p role="status" className="text-center text-xs text-slate-500">
                Applying your department and role — this only happens once.
              </p>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          No account?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">
            Sign up
          </Link>
        </p>

        <p className="mt-2 text-center text-sm text-slate-600">
          Teaching a course?{' '}
          <Link to="/signup/instructor" className="font-medium text-brand-600 hover:text-brand-700">
            Sign up as an instructor
          </Link>
        </p>
      </div>
    </div>
  );
};
