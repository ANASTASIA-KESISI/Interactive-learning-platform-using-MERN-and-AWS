import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/ui/index.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { listNotes } from '../../services/notes.js';
import { NoteModal } from './NoteModal.jsx';

const errorMessage = (err) => err?.response?.data?.error?.message || err?.message || 'Unknown error';

// The learner's own locale decides the format — the pilot cohort is Greek and
// the platform is English, and neither of those should override the machine.
const formatStamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

// "Getting Started · The console & console.log", degrading gracefully when the
// module or lesson behind a note has since been deleted.
const trail = (note) =>
  [note.module?.title, note.lesson?.title].filter(Boolean).join(' · ') ||
  (note.scope === 'module' ? 'Module note' : 'Lesson note');

// Courses get an optional emoji/short-label icon (S7 D11); the first letter of
// the title is the fallback so every card has the same visual anchor.
const CourseIcon = ({ note }) => (
  <span
    aria-hidden="true"
    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-100 text-sm font-semibold text-brand-700"
  >
    {note.course?.icon || note.course?.title?.[0]?.toUpperCase() || '📝'}
  </span>
);

const NoteCard = ({ note, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(note)}
    className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
  >
    <div className="flex items-start justify-between gap-4">
      {/* Plain text, never Markdown: whatever the learner typed is what shows. */}
      <p className="line-clamp-2 whitespace-pre-wrap text-sm font-medium text-slate-900">
        {note.body}
      </p>
      <time
        dateTime={note.updatedAt || undefined}
        className="shrink-0 text-xs text-slate-400 sm:text-sm"
      >
        {formatStamp(note.updatedAt)}
      </time>
    </div>

    <div className="mt-4 flex items-center gap-3">
      <CourseIcon note={note} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">
          {note.course?.title || 'Course unavailable'}
        </span>
        <span className="block truncate text-sm text-slate-500">{trail(note)}</span>
      </span>
    </div>
  </button>
);

/**
 * `/notes` — every note the signed-in user has written, newest first
 * (demo_assets/notes_page.png). Clicking a card opens the detail modal, which
 * edits the note in place and can delete it; both paths update this list
 * without a refetch so the page never flickers under the dialog.
 */
export const NotesPage = () => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listNotes()
      .then((data) => {
        if (!cancelled) setNotes(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dropNote = (noteId) => {
    setNotes((current) => current.filter((note) => note.id !== noteId));
    setOpenId((current) => (current === noteId ? null : current));
  };

  // An emptied note is deleted server-side, so the card goes with it.
  const applySave = (noteId, { body, deleted }) => {
    if (deleted) {
      dropNote(noteId);
      return;
    }
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId ? { ...note, body, updatedAt: new Date().toISOString() } : note,
      ),
    );
  };

  const open = notes.find((note) => note.id === openId) || null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">My notes</h1>
        <p className="mt-1 text-slate-600">
          The ideas and reminders you have saved while learning.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Spinner label="Loading your notes…" />
      ) : notes.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No notes yet"
          description="Open a lesson and use the Notes tab — anything you write there shows up here."
          action={
            <Link className="btn-primary" to="/courses">
              Browse courses
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} onOpen={() => setOpenId(note.id)} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <NoteModal
          key={open.id}
          note={open}
          onSaved={applySave}
          onDeleted={dropNote}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};
