import { api, unwrap } from './api.js';

// Endpoints land in Phase 1-C; the signatures are fixed here so the pages that
// consume them can be written against a stable surface.

export const listNotes = () => api.get('/notes').then(unwrap);

export const getLessonNote = (lessonId) => api.get(`/notes/lesson/${lessonId}`).then(unwrap);

// An empty body deletes the note.
export const saveLessonNote = (lessonId, body) =>
  api.put(`/notes/lesson/${lessonId}`, { body }).then(unwrap);

export const getModuleNote = (moduleId) => api.get(`/notes/module/${moduleId}`).then(unwrap);

export const saveModuleNote = (moduleId, body) =>
  api.put(`/notes/module/${moduleId}`, { body }).then(unwrap);

export const deleteNote = (noteId) => api.delete(`/notes/${noteId}`).then(unwrap);
