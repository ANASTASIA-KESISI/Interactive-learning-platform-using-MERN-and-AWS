import { useEffect, useRef } from 'react';

import { Chip, StatTile } from '../../components/ui/index.js';
import { BadgeUnlock } from './BadgeUnlock.jsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

// Checked at burst time, not baked in at build time: a learner who turns the
// preference on mid-session gets a quiet overlay on their very next completion.
// The whole animation is skipped — canvas-confetti has no honest "shorter"
// setting, and a vestibular trigger shortened is still a vestibular trigger
// (NFR5 / WCAG 2.1 AA, 2.3.3).
export const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The first-completion celebration (S7 D7, demo_assets/confetti.png).
 *
 * Props: { xpDelta, gamification, newBadges, moduleCompleted, onNextLesson, onClose }
 *
 * Shown ONLY on a first passing completion — re-passing a lesson the learner
 * has already finished awards nothing, so celebrating it again would be a lie
 * about their progress and would blunt the signal the real one carries.
 */
export const CompletionOverlay = ({
  xpDelta = 0,
  gamification = null,
  newBadges = [],
  moduleCompleted = false,
  onNextLesson,
  onClose,
}) => {
  const canvasRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let burst = null;
    let cancelled = false;

    // Loaded on demand so the confetti bundle is not part of the cost of
    // opening a lesson — it is only ever needed at this moment.
    import('canvas-confetti')
      .then(({ default: confetti }) => {
        if (cancelled) return;
        burst = confetti.create(canvas, { resize: true, useWorker: true });
        burst({
          particleCount: 140,
          spread: 78,
          startVelocity: 42,
          ticks: 220,
          origin: { y: 0.35 },
          disableForReducedMotion: true,
        });
      })
      .catch(() => {
        // A celebration that fails to load is not an error worth showing.
      });

    return () => {
      cancelled = true;
      burst?.reset();
    };
  }, []);

  // Modal behaviour (NFR5): focus lands inside, Tab stays inside, Esc closes.
  // Focus is returned to the editor by the lesson page, which owns it.
  useEffect(() => {
    const panel = panelRef.current;
    (panel?.querySelector(FOCUSABLE) || panel)?.focus();
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const nodes = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []).filter(
      (el) => el.offsetParent !== null,
    );
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const heading = moduleCompleted ? 'Module completed' : 'Lesson completed';
  const badges = Array.isArray(newBadges) ? newBadges : [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />

      {/* Decoration only: never in the accessibility tree, never in the way of
          a click meant for the card underneath it. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative flex min-h-full flex-col items-center px-4 py-8 focus:outline-none"
      >
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{heading}</h2>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-amber-600">
                <span aria-hidden="true">🪙</span>+{xpDelta} XP
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close celebration"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </header>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatTile icon="🏅" label="Rank" value={gamification?.rank ?? '—'} />
            <StatTile icon="🔥" label="Streak" value={`${gamification?.streak ?? 0}d`} />
            <StatTile icon="🎯" label="Level" value={gamification?.level ?? 1} />
          </div>

          {badges.length > 0 && (
            <div className="mt-3">
              <Chip tone="warning">
                <span aria-hidden="true">🎖️</span>
                {badges.length} new unlock{badges.length > 1 ? 's' : ''}
              </Chip>
            </div>
          )}

          {badges.length === 0 && (
            <button type="button" className="btn-primary mt-4 w-full" onClick={onNextLesson}>
              Next lesson →
            </button>
          )}
        </section>

        {badges.length > 0 && <BadgeUnlock badges={badges} onNextLesson={onNextLesson} />}
      </div>
    </div>
  );
};
