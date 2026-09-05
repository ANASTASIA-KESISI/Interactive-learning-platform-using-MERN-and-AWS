const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
};

// Small status pill — lesson type, difficulty, rank, "Draft". Tone carries the
// meaning, so it is never the only signal: the text always says it too.
export const Chip = ({ tone = 'neutral', className = '', children }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      TONES[tone] || TONES.neutral
    } ${className}`.trim()}
  >
    {children}
  </span>
);
