import { useCallback } from 'react';

import { getModuleNote, saveModuleNote } from '../../services/notes.js';
import { NoteEditor, useNoteAutosave } from './NoteEditor.jsx';

/**
 * The autosaving note editor for one module, opened from the course page.
 *
 * Props: { moduleId, className }
 *
 * Same behaviour as LessonNotesPanel — module notes are for the "what is this
 * unit about" thoughts that do not belong to any single lesson, so they are
 * never counted as lesson activity (the server only stamps DynamoDB for
 * student *lesson* notes).
 */
export const ModuleNotesPanel = ({ moduleId, className = '' }) => {
  const load = useCallback(() => getModuleNote(moduleId), [moduleId]);
  const save = useCallback((body) => saveModuleNote(moduleId, body), [moduleId]);
  const editor = useNoteAutosave({ load, save });

  if (!moduleId) return null;

  return (
    <NoteEditor
      id={`module-note-${moduleId}`}
      label="Your notes for this module"
      placeholder="Write a note for this module…"
      editor={editor}
      rows={8}
      className={className}
    />
  );
};
