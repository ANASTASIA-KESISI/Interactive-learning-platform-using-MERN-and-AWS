import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../hooks/useAuth.js';
import { Avatar } from '../../components/ui/index.js';
import { AskInstructorPanel } from './AskInstructorPanel.jsx';

// The instructor chat as a floating dock, anchored bottom-right of the lesson
// (demo_assets/lesson_page_lesson.png shows exactly this bubble).
//
// It used to sit inside the left panel's Lesson tab, which cost the learner
// twice: the conversation pushed the lesson text down the page, and reading a
// reply meant leaving whichever tab they were working in. A dock is reachable
// from every tab and from the editor, and it costs no layout when closed.
//
// The same component serves both breakpoints — on a narrow screen the open
// panel simply fills the viewport instead of floating in a corner, so a phone
// gets a full-screen conversation rather than a cramped card.

// Controlled when `open`/`onOpenChange` are supplied, so a "Ask your
// instructor" button elsewhere on the page can open it; otherwise it manages
// its own state.
export const ChatDock = ({ courseId, lessonId, instructor, open: openProp, onOpenChange }) => {
  const { user } = useAuth();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenState(value);
    onOpenChange?.(value);
  };
  const launcherRef = useRef(null);
  const panelRef = useRef(null);

  const isStudent = user?.role === 'student';

  // Esc closes and returns focus to the launcher, so the dock never traps a
  // keyboard user in a corner of the page.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector('textarea')?.focus();
  }, [open]);

  // Staff have the inbox; a learner with no course context has nobody to ask.
  if (!isStudent || !courseId) return null;

  const instructorName =
    instructor?.name ||
    [instructor?.firstName, instructor?.lastName].filter(Boolean).join(' ') ||
    'your instructor';

  return (
    <>
      {open && (
        <>
          {/* Below `sm` the panel is full-screen, so it needs a scrim to sit on
              and to swallow taps meant for "close". */}
          <button
            type="button"
            aria-label="Close chat"
            className="fixed inset-0 z-40 bg-slate-900/20 sm:hidden"
            onClick={() => setOpen(false)}
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Chat with ${instructorName}`}
            className="fixed inset-x-0 bottom-0 top-14 z-50 flex flex-col bg-white shadow-2xl sm:inset-auto sm:bottom-24 sm:right-6 sm:top-auto sm:h-[30rem] sm:w-96 sm:rounded-2xl sm:border sm:border-slate-200"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar src={instructor?.avatar} name={instructorName} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{instructorName}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Instructor</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  launcherRef.current?.focus();
                }}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close chat"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            {/* The panel renders its own card chrome; inside the dock it should
                fill the space instead, so it is handed the height and told to
                drop its border. */}
            <AskInstructorPanel
              courseId={courseId}
              lessonId={lessonId}
              instructor={instructor}
              className="min-h-0 flex-1"
              bare
            />
          </div>
        </>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Close chat with your instructor' : 'Ask your instructor'}
        className={`fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
          open ? 'bg-slate-800 text-white' : 'bg-white ring-1 ring-slate-200'
        }`}
      >
        {open ? (
          <span aria-hidden="true" className="text-lg">
            ✕
          </span>
        ) : (
          <>
            <Avatar src={instructor?.avatar} name={instructorName} size="md" />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] text-white ring-2 ring-white"
            >
              ?
            </span>
          </>
        )}
      </button>
    </>
  );
};
