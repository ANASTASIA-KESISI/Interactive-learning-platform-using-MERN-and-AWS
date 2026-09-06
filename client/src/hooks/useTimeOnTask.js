import { useEffect, useRef } from 'react';

import { reportTimeOnTask } from '../services/lessons.js';

// Time-on-task for the lesson page.
//
// `timeSpent` has been on the progress item and in the instructor breakdown
// since S4, but nothing ever wrote to it — the "Avg time" column has been
// showing a real zero as though it were a measurement. This hook is the
// missing input.
//
// What it counts is ACTIVE time: the clock runs only while the document is
// visible, so a tab left open over lunch adds nothing. That is the difference
// between time-on-task, which is what the thesis claims to measure, and
// wall-clock elapsed, which would be trivially inflated by an idle tab.
//
// Reports accumulate locally and flush on an interval, on the tab going
// hidden, and on unmount. The server clamps each report, so a flush that is
// somehow enormous is truncated rather than trusted.

const FLUSH_EVERY_MS = 30_000;
// Below this a report is noise — a learner bouncing off the page, or a
// re-render — and not worth a request.
const MIN_REPORT_SEC = 5;

export const useTimeOnTask = (lessonId, { enabled = true } = {}) => {
  // Refs throughout: this must never trigger a render. The visible page is the
  // learner's; a timer that re-rendered the editor while they typed would be a
  // worse bug than the missing metric.
  const activeSinceRef = useRef(null);
  const pendingMsRef = useRef(0);

  useEffect(() => {
    if (!enabled || !lessonId) return undefined;

    const isVisible = () => document.visibilityState === 'visible';

    // Fold the currently-running interval into the pending total and restart
    // the clock. Called before every flush and on every visibility change, so
    // the two never double-count the same milliseconds.
    const settle = () => {
      if (activeSinceRef.current !== null) {
        pendingMsRef.current += Date.now() - activeSinceRef.current;
        activeSinceRef.current = null;
      }
    };

    const start = () => {
      if (activeSinceRef.current === null) activeSinceRef.current = Date.now();
    };

    const flush = () => {
      settle();
      const seconds = Math.floor(pendingMsRef.current / 1000);
      if (seconds < MIN_REPORT_SEC) {
        if (isVisible()) start();
        return;
      }
      // Deduct what is being sent rather than zeroing, so the sub-second
      // remainder survives to the next flush instead of being rounded away on
      // every single one.
      pendingMsRef.current -= seconds * 1000;
      // Fire and forget: an instructor previewing gets a no-op, and a learner
      // must never see a telemetry failure.
      reportTimeOnTask(lessonId, seconds).catch(() => {});
      if (isVisible()) start();
    };

    const onVisibilityChange = () => {
      if (isVisible()) start();
      else flush();
    };

    if (isVisible()) start();
    const timer = setInterval(flush, FLUSH_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Navigating away inside the SPA is the common case and unmount is the
      // only signal for it, so the last partial interval is flushed here.
      flush();
    };
  }, [lessonId, enabled]);
};
