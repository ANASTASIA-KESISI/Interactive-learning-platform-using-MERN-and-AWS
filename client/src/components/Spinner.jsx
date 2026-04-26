export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center py-10 text-sm text-slate-500">{label}</div>
);

export const ErrorBanner = ({ message }) => (
  <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
);
