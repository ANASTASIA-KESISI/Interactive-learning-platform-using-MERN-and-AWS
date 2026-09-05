// `value` is a percentage 0-100 (the caller derives it — lib/gamification.js
// has levelProgressPct for the XP case). `label` renders above the track;
// `srLabel` names the bar for assistive tech when no visible label fits.
export const ProgressBar = ({ value = 0, label, srLabel, className = '' }) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          {label}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={srLabel || (typeof label === 'string' ? label : undefined)}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
