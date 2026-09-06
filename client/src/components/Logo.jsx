// The LearnCode logo, served from `client/public` as a static asset rather than
// inlined into a component.
//
// It is a traced vector of the source artwork — 399 paths, ~230KB — so inlining
// it would put a quarter of a megabyte of path data in the JS bundle and repeat
// it at every render. As an <img> the browser fetches it once and caches it for
// every screen that shows it.
//
// Two crops of the same drawing live in `public/`:
//   logo.svg       the full lockup, illustration above the wordmark
//   logo-mark.svg  the illustration alone, for slots too short to set the
//                  wordmark legibly — the header, the loading state, the tab
//                  icon. The two groups are interleaved in the traced file's
//                  document order, so the crop is an explicit path-index set
//                  rather than a range; see the commit that added it.
//
// Both carry a viewBox, so size them by HEIGHT and leave the width auto.

/**
 * The illustration without the wordmark.
 *
 * @param {object} props
 * @param {string} [props.className] Height utility; the width should stay auto.
 * @param {boolean} [props.animated] Breathe gently — the loading state.
 * @param {string} [props.alt] Accessible name. Leave it empty wherever nearby
 *   text already names the thing, so it is not announced twice.
 */
export const LogoMark = ({ className = 'h-9 w-auto', animated = false, alt = '' }) => (
  <img src="/logo-mark.svg" alt={alt} className={`${animated ? 'logo-pulse ' : ''}${className}`} />
);

/** The full lockup: the illustration above the wordmark. */
export const Logo = ({ className = 'h-24 w-auto', alt = 'LearnCode' }) => (
  <img src="/logo.svg" alt={alt} className={className} />
);
