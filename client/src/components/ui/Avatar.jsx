const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-2xl',
};

// Initials from "Ada Lovelace" / "ada@example.com" — the fallback matters more
// than the image: nobody in the pilot has uploaded an avatar (S3 upload is out
// of scope, D11), so this is what the header and profile cards actually show.
const initialsOf = (name = '') => {
  const parts = String(name).trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const Avatar = ({ src, name = '', size = 'md', className = '' }) => {
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
    SIZES[size] || SIZES.md
  } ${className}`.trim();

  if (src) {
    return <img src={src} alt={name} className={`${base} object-cover`} />;
  }

  return (
    <span
      className={`${base} bg-brand-100 font-semibold text-brand-700`}
      role="img"
      aria-label={name || 'User'}
    >
      {initialsOf(name)}
    </span>
  );
};
