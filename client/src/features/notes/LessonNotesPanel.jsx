import { useCallback } from 'react';

import { getLessonNote, saveLessonNote } from '../../services/notes.js';
import { NoteEditor, useNoteAutosave } from './NoteEditor.jsx';

/**
 * The autosaving note editor for one lesson — the lesson page's Notes tab
 * (P2-D) and the notes section beneath a reading lesson.
 *
 * Props: { lessonId, className }
 *
 * Deliberately chrome-free (demo_assets/lesson_notes.png): the panel around it
 * supplies the tab heading, so all this contributes is a roomy plain-text field
 * that saves itself ~800 ms after typing stops, on blur, and on unmount.
 */
export const LessonNotesPanel = ({ lessonId, className = '' }) => {
  const load = useCallback(() => getLessonNote(lessonId), [lessonId]);
  const save = useCallback((body) => saveLessonNote(lessonId, body), [lessonId]);
  const editor = useNoteAutosave({ load, save });

  if (!lessonId) return null;

  return (
    <NoteEditor
      id={`lesson-note-${lessonId}`}
      label="Your notes for this lesson"
      placeholder="Write a note for this lesson…"
      editor={editor}
      className={`h-full ${className}`.trim()}
    />
  );
};
