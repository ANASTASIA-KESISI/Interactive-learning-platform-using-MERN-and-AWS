import { useCallback, useEffect, useRef, useState } from 'react';

// Shared machinery behind the three places a note is edited: the lesson tab,
// the module panel on the course page, and the detail modal. Kept here so all
// three autosave identically.

export const AUTOSAVE_DELAY_MS = 800;

const errorMessage = (err) => err?.response?.data?.error?.message || err?.message || 'Unknown error';

const STATUS_LABELS = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Couldn’t save',
};

/**
 * Autosaving text state for one note.
 *
 * `load` and `save` must be stable callbacks (useCallback keyed on the target
 * id): `load` is re-run whenever it changes, which is how switching lesson
 * swaps the note.
 *
 * The two refs are the whole design. `typed` is what the learner has in front
 * of them and `persisted` is what the server acknowledged; a save writes a
 * snapshot and, on completion, compares the two again. Keystrokes that land
 * while a request is in flight are therefore never lost — they simply make the
 * next comparison unequal and trigger another save.
 */
export const useNoteAutosave = ({ load, save, delay = AUTOSAVE_DELAY_MS }) => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('idle');

  const typed = useRef('');
  const persisted = useRef('');
  const timer = useRef(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  // State updates are dropped after unmount; the save itself is not (see the
  // flush in the cleanup below) — losing a request would lose the learner's
  // text, losing a status update loses nothing.
  const setIfAlive = (setter, next) => {
    if (alive.current) setter(next);
  };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (busy.current) return; // the in-flight save re-checks when it finishes
    const pending = typed.current;
    if (pending === persisted.current) return;

    busy.current = true;
    setIfAlive(setStatus, 'saving');
    try {
      await saveRef.current(pending);
      persisted.current = pending;
      setIfAlive(setStatus, typed.current === pending ? 'saved' : 'saving');
    } catch {
      // Leave `persisted` behind so the next keystroke (or blur) retries; the
      // text stays in the textarea either way.
      setIfAlive(setStatus, 'error');
      busy.current = false;
      return;
    }
    busy.current = false;
    if (typed.current !== persisted.current) await flush();
  }, []);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    setLoading(true);
    setLoadError('');
    setStatus('idle');

    Promise.resolve()
      .then(load)
      .then((note) => {
        if (cancelled) return;
        const body = note?.body || '';
        typed.current = body;
        persisted.current = body;
        setValue(body);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load]);

  // Unmount: the debounce timer may still be holding unsaved text (closing the
  // modal or switching tabs a moment after typing). Fire the save anyway — it
  // is the learner's data, and there is nothing left to report a result to.
  useEffect(
    () => () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (!busy.current && typed.current !== persisted.current) {
        const pending = typed.current;
        persisted.current = pending;
        Promise.resolve()
          .then(() => saveRef.current(pending))
          .catch(() => {});
      }
    },
    [],
  );

  const onChange = (next) => {
    typed.current = next;
    setValue(next);
    if (next !== persisted.current) setStatus('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  return {
    value,
    loading,
    loadError,
    status,
    statusLabel: STATUS_LABELS[status] || '',
    onChange,
    // Blur is the second trigger: a learner who types and immediately clicks
    // "Run" should not wait out the debounce.
    onBlur: flush,
    flush,
  };
};

/**
 * The textarea itself. No chrome by design (see demo_assets/lesson_notes.png) —
 * a label for screen readers, a roomy plain-text field, and one quiet status
 * line underneath.
 */
export const NoteEditor = ({
  id,
  label,
  placeholder = 'Write a note…',
  editor,
  rows = 12,
  className = '',
  textareaClassName = '',
  maxLength = 20000,
}) => {
  const { value, loading, loadError, status, statusLabel, onChange, onBlur } = editor;

  return (
    <div className={`flex min-h-0 flex-col ${className}`.trim()}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`w-full flex-1 resize-none rounded-md border border-transparent bg-transparent px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-slate-200 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 ${textareaClassName}`.trim()}
        rows={rows}
        value={value}
        placeholder={loading ? 'Loading your note…' : placeholder}
        disabled={loading || Boolean(loadError)}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-describedby={`${id}-status`}
      />
      <p
        id={`${id}-status`}
        role="status"
        aria-live="polite"
        className={`mt-1 min-h-[1.25rem] px-3 text-xs ${
          status === 'error' ? 'text-red-600' : 'text-slate-400'
        }`}
      >
        {loadError ? `Couldn’t load this note — ${loadError}` : statusLabel}
      </p>
    </div>
  );
};
