import { LogoMark } from './Logo.jsx';

// Loading states breathe the logo rather than spin a generic ring: it is the one
// moment every screen has in common, so it is worth being the platform.
// `role="status"` announces the label; the mark stays decorative (empty alt) so
// the same thing is not read out twice.
//
// By default the spinner claims enough height to sit in the middle of the space
// it is standing in for, instead of clinging to the top of the content area
// while the rest of the page is blank. `compact` is for the few places where it
// stands in for one card's contents, where that height would blow the card open.
export const Spinner = ({ label = 'Loading…', compact = false }) => (
  <div
    role="status"
    className={`flex flex-col items-center justify-center gap-4 py-10 text-sm text-slate-500 ${
      compact ? '' : 'min-h-[60vh]'
    }`}
  >
    <LogoMark className={compact ? 'h-12 w-auto' : 'h-24 w-auto'} animated />
    <span>{label}</span>
  </div>
);

export const ErrorBanner = ({ message }) => (
  <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
);
