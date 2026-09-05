import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signUp, confirmSignUp, resendConfirmationCode } from '../../services/cognito.js';
import {
  InstitutionFields,
  savePendingInstructorCode,
  savePendingProfile,
  useUniversities,
} from '../onboarding/DepartmentPrompt.jsx';

// Self-service instructor signup (S7 D2). Cognito has no notion of "instructor"
// at signup time — the account is created exactly like a student's, and the
// invite code is redeemed against POST /api/auth/claim-instructor on the first
// sign-in, which is the earliest moment a bearer token exists. See CHALLENGES
// Challenge 15 for why an invite code and not an approval queue.
export const InstructorSignupPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState('details');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    inviteCode: '',
    code: '',
  });
  const [universityId, setUniversityId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { universities, loading: universitiesLoading, error: universitiesError } = useUniversities();

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleUniversityChange = (value) => {
    setUniversityId(value);
    setDepartmentId('');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      savePendingProfile({ universityId, departmentId });
      savePendingInstructorCode(form.inviteCode.trim());
      await signUp(form.email, form.password, form.firstName, form.lastName);
      setStep('confirm');
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmSignUp(form.email, form.code);
      navigate('/login', {
        replace: true,
        state: {
          notice:
            'Account confirmed. Sign in now — your instructor role is applied at first sign-in.',
        },
      });
    } catch (err) {
      setError(err.message || 'Confirmation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    try {
      await resendConfirmationCode(form.email);
    } catch (err) {
      setError(err.message || 'Could not resend code');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">
            {step === 'details' ? 'Create an instructor account' : 'Confirm your email'}
          </h1>
          {step === 'details' && (
            <p className="mt-1 text-sm text-slate-600">
              Teaching staff only — you will need the invite code your department issued.
            </p>
          )}
        </header>

        {step === 'details' ? (
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="label">First name</label>
                <input id="firstName" value={form.firstName} onChange={update('firstName')} required className="field" />
              </div>
              <div>
                <label htmlFor="lastName" className="label">Last name</label>
                <input id="lastName" value={form.lastName} onChange={update('lastName')} required className="field" />
              </div>
            </div>

            {universitiesError ? (
              <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                We could not load the university list ({universitiesError}). You can create your
                account now and set your department from your profile afterwards.
              </p>
            ) : (
              <InstitutionFields
                idPrefix="instructor-signup"
                universities={universities}
                universityId={universityId}
                departmentId={departmentId}
                onUniversityChange={handleUniversityChange}
                onDepartmentChange={setDepartmentId}
                loading={universitiesLoading}
                disabled={submitting}
              />
            )}

            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} required className="field" />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={update('password')} required minLength={8} className="field" />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
            </div>

            <div>
              <label htmlFor="inviteCode" className="label">Instructor invite code</label>
              <input
                id="inviteCode"
                type="password"
                autoComplete="off"
                value={form.inviteCode}
                onChange={update('inviteCode')}
                required
                className="field"
                aria-describedby="inviteCode-hint"
              />
              <p id="inviteCode-hint" className="mt-1 text-xs text-slate-500">
                Issued by your department. Without a valid code the account is created as a student
                and an administrator can grant the instructor role later.
              </p>
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create instructor account'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="space-y-4">
            <p className="text-sm text-slate-600">
              We sent a confirmation code to <span className="font-medium">{form.email}</span>.
            </p>

            <div>
              <label htmlFor="code" className="label">Confirmation code</label>
              <input id="code" value={form.code} onChange={update('code')} required className="field" />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Confirming…' : 'Confirm'}
            </button>

            <button type="button" onClick={handleResend} className="btn-ghost w-full">
              Resend code
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>

        <p className="mt-2 text-center text-sm text-slate-600">
          Here to learn instead?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">
            Create a student account
          </Link>
        </p>
      </div>
    </div>
  );
};
