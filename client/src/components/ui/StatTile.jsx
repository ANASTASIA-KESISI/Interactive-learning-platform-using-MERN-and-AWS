// One cell of the 2x2 stat grid on Home and Profile (Total XP, Rank, Badges,
// Day streak). `value` is pre-formatted by the caller — this only lays it out.
export const StatTile = ({ icon, label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </div>
    <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
  </div>
);
