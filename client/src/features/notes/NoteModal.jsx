import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Modal } from '../../components/ui/index.js';
import { deleteNote, saveLessonNote, saveModuleNote } from '../../services/notes.js';
import { NoteEditor, useNoteAutosave } from './NoteEditor.jsx';

const errorMessage = (err) => err?.response?.data?.error?.message || err?.message || 'Unknown error';

// Where "Go to content" takes you: a lesson note points at the lesson, a module
// note at its course page (modules have no route of their own).
const contentLink = (note) => {
  if (note.scope === 'lesson' && note.lesson?.id) return `/lessons/${note.lesson.id}`;
  if (note.courseId) return `/courses/${note.courseId}`;
  return null;
};

/**
 * The note detail dialog (demo_assets/note_page.png). Header is the lesson (or
 * module) title over a "Course · Module" line, with "Go to content" and the
 * Modal's own close control; the body is the note itself, editable in place
 * with the same autosave the lesson panel uses.
 *
 * Props: { note, onSaved(noteId, { body, deleted }), onDeleted(noteId), onClose }
 */
export const NoteModal = ({ note, onSaved, onDeleted, onClose }) => {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // The note as it was when the dialog opened. Held in a ref so that telling
  // the list about a save (which re-renders the card behind the dialog) never
  // re-runs the load and clobbers what the learner is typing.
  const opened = useRef(note);
  const load = useCallback(() => Promise.resolve(opened.current), []);
  const save = useCallback(
    async (body) => {
      const target = opened.current;
      const result =
        target.scope === 'lesson'
          ? await saveLessonNote(target.lesson?.id || target.targetId, body)
          : await saveModuleNote(target.module?.id || target.targetId, body);
      onSaved?.(target.id, { body, deleted: Boolean(result?.deleted) });
      return result;
    },
    [onSaved],
  );

  const editor = useNoteAutosave({ load, save });

  const title = note.scope === 'lesson' ? note.lesson?.title : note.module?.title;
  const subtitle = [note.course?.title, note.module?.title].filter(Boolean).join(' · ');
  const href = contentLink(note);

  const confirmDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteNote(note.id);
      onDeleted?.(note.id);
      onClose?.();
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <Modal title={title || 'Note'} onClose={onClose} className="max-w-2xl">
      {/* The Modal primitive owns the title row, so the context line and the
          deep link sit at the top of the body rather than inside the heading. */}
      <div className="-mt-1 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <p className="text-sm text-slate-500">{subtitle || 'Note'}</p>
        {href && (
          <Link to={href} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Go to content <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>

      <NoteEditor
        id={`note-${note.id}`}
        label={title ? `Note on ${title}` : 'Note'}
        editor={editor}
        rows={10}
        className="pt-3"
      />

      {error && <p className="px-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        {confirming ? (
          <>
            <p className="mr-auto text-sm text-slate-600">Delete this note permanently?</p>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-red-600 text-white hover:bg-red-700"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete note'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-ghost text-red-700 hover:bg-red-50"
            onClick={() => setConfirming(true)}
          >
            Delete note
          </button>
        )}
      </div>
    </Modal>
  );
};
