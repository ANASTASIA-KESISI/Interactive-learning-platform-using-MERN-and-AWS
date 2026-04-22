import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signUp, confirmSignUp, resendConfirmationCode } from '../../services/cognito.js';

export const SignupPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState('details');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    code: '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
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
      navigate('/login', { replace: true });
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">
          {step === 'details' ? 'Create your account' : 'Confirm your email'}
        </h1>

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

            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} required className="field" />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={update('password')} required minLength={8} className="field" />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
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

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
      </div>
    </div>
  );
};
