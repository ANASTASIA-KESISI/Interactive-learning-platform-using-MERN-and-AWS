import { LogoMark } from './Logo.jsx';

// Loading states breathe the logo rather than spin a generic ring: it is the one
// moment every screen has in common, so it is worth being the platform.
// `role="status"` announces the label; the mark stays decorative (empty alt) so
// the same thing is not read out twice.
export const Spinner = ({ label = 'Loading…' }) => (
  <div
    role="status"
    className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-slate-500"
  >
    <LogoMark className="h-10 w-auto" animated />
    <span>{label}</span>
  </div>
);

export const ErrorBanner = ({ message }) => (
  <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
);
