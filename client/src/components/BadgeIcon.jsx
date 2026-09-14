import { useState } from 'react';

// A badge's `icon` is whatever the seed put there, and the two forms are not
// interchangeable: artwork is a path (`/badges/first-steps.svg`) and has to be
// an <img>, while the emoji a badge carried before its artwork was drawn is
// text. Rendering a path as text prints the path; rendering an emoji as an
// <img> src fetches nothing and shows a broken image.
//
// So the shape of the value decides, and a path that 404s falls back to the
// medal rather than to a broken-image glyph. That fallback is what makes the
// seed safe to run before every SVG has been drawn: badges award and display,
// and the artwork fills in as files land.
const isArtwork = (icon) =>
  typeof icon === 'string' && (icon.startsWith('/') || /^https?:\/\//.test(icon));

export const BadgeIcon = ({ icon, name, className = 'h-7 w-7' }) => {
  const [failed, setFailed] = useState(false);

  if (!isArtwork(icon) || failed) return <span>{isArtwork(icon) ? '🏅' : icon || '🏅'}</span>;

  return (
    <img
      // Decorative: every caller already labels the surrounding element with the
      // badge's name and its earned/locked state, so an alt here would say it
      // twice.
      alt=""
      src={icon}
      title={name}
      onError={() => setFailed(true)}
      className={`${className} object-contain`}
    />
  );
};
