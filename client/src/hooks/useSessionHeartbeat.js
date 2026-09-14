import { useEffect, useRef } from 'react';

import { sendSessionHeartbeat } from '../services/me.js';

// Session heartbeat for the signed-in shell (S8 D6).
//
// The thesis lists "average session duration" among its engagement metrics.
// Time on task per lesson exists (`useTimeOnTask`); a session — one visit to
// the app, across every page — was the unit nobody recorded. This hook is the
// client half: it mints one id per browser tab, posts a heartbeat straight
// away, then once a minute while the tab is visible, and once more as the tab
// goes hidden so the last visible minute is credited. The server adds the gap
// between consecutive beats, capped, so a hidden tab or a shut laptop adds
// nothing — the number is ACTIVE time, the same reading `useTimeOnTask` gives
// per lesson.
//
// `sessionStorage` is per tab and survives a reload, which is the right
// lifetime: a refresh continues the session, a new tab starts another.
//
// Refs only, no state: this must never trigger a render — it is mounted in the
// shell, above every page, and a telemetry timer that re-rendered the editor
// while a learner typed would be a worse bug than the missing metric.

const BEAT_EVERY_MS = 60_000;
const STORAGE_KEY = 'learncode.sessionId';

const readOrCreateSessionId = () => {
  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = window.crypto.randomUUID();
    window.sessionStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Storage disabled (private mode, policy): a per-mount id still gives a
    // session for this page load, which is better than none.
    return window.crypto.randomUUID();
  }
};

export const useSessionHeartbeat = ({ enabled = true } = {}) => {
  const sessionIdRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    if (sessionIdRef.current === null) sessionIdRef.current = readOrCreateSessionId();
    const sessionId = sessionIdRef.current;

    const isVisible = () => document.visibilityState === 'visible';

    // Fire and forget: a learner must never see a telemetry failure.
    const beat = () => {
      sendSessionHeartbeat(sessionId).catch(() => {});
    };

    const tick = () => {
      if (isVisible()) beat();
    };

    // One more beat as the tab goes hidden, so the minute since the last
    // interval beat is credited before the clock stops.
    const onVisibilityChange = () => {
      if (!isVisible()) beat();
    };

    tick();
    const timer = setInterval(tick, BEAT_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled]);
};
