import { useEffect, useRef, useState } from 'react';

import { Chip } from '../../components/ui/index.js';

/**
 * The badge hero beneath the completion card (demo_assets/achievement_unlocked.png).
 *
 * Props: { badges, onNextLesson, nextLabel }
 *
 * Gamification only earns its place in the thesis (H2) if the award is
 * actually *seen* — so a badge gets the full width of the overlay, one at a
 * time, rather than a line item in a results list. When a submission awards
 * more than one, they page through: the primary button advances to the next
 * unlock until the last, where it becomes the "continue" action.
 */
export const BadgeUnlock = ({ badges = [], onNextLesson, nextLabel = 'Next lesson →' }) => {
  const [index, setIndex] = useState(0);
  const headingRef = useRef(null);

  // Paging swaps the whole hero; move the announcement with it so a screen
  // reader hears the new badge instead of silently changing the picture.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  const badge = badges[index];
  if (!badge) return null;

  const more = index < badges.length - 1;

  return (
    <section
      aria-label="Badge unlocked"
      className="mt-6 w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 text-center shadow-lg"
    >
      <div className="text-6xl" aria-hidden="true">
        {badge.icon || '🏅'}
      </div>

      <Chip tone="warning" className="mt-4 tracking-[0.2em]">
        BADGE UNLOCKED
      </Chip>

      <h3
        ref={headingRef}
        tabIndex={-1}
        className="mt-3 text-2xl font-semibold text-slate-900 focus:outline-none"
      >
        {badge.name}
      </h3>

      {badge.description && <p className="mt-1 text-sm text-slate-600">{badge.description}</p>}

      {badges.length > 1 && (
        <p className="mt-3 text-xs text-slate-500">
          Unlock {index + 1} of {badges.length}
        </p>
      )}

      <button
        type="button"
        className="btn-primary mt-5"
        onClick={() => (more ? setIndex((i) => i + 1) : onNextLesson?.())}
      >
        {more ? 'Next unlock →' : nextLabel}
      </button>
    </section>
  );
};
