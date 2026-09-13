import { useState } from 'react';

// A labelled password input with a show/hide toggle. Typing a secret blind is
// the single biggest source of failed sign-ins on the pilot, so every masked
// field (password, instructor invite code) renders through this. The toggle is
// a real button — keyboard reachable, `aria-pressed` for screen readers — and
// sits inside the field so the input keeps the shared `.field` styling.
//
// Extra props (`autoComplete`, `minLength`, `required`, `aria-describedby`…)
// go straight to the <input>.

const EyeIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z" />
    <circle cx="10" cy="10" r="2.5" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l14 14" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.2 5.3A8.6 8.6 0 0 1 10 5c4.8 0 7.5 5 7.5 5a12.7 12.7 0 0 1-2.2 2.8M5.4 6.6A12.4 12.4 0 0 0 2.5 10s2.7 5 7.5 5c1 0 1.9-.2 2.7-.5"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5" />
  </svg>
);

export const PasswordField = ({ id, label, value, onChange, hint, className = '', ...inputProps }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          className="field pr-10"
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={visible ? 'Hide' : 'Show'}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint}
    </div>
  );
};
