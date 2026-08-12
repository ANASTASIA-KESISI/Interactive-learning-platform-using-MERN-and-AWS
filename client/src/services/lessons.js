import { api, unwrap } from './api.js';

// Learner view: no expectedOutput, hints as `hintCount` + already-revealed text.
export const getLesson = (lessonId) =>
  api.get(`/lessons/${lessonId}`).then(unwrap);

// Authoring view: full document including expectedOutput and every hint.
// Ownership-gated server-side.
export const getLessonForEdit = (lessonId) =>
  api.get(`/instructor/lessons/${lessonId}`).then(unwrap);

export const updateLesson = (lessonId, payload) =>
  api.patch(`/instructor/lessons/${lessonId}`, payload).then(unwrap);

export const revealHint = (lessonId, hintIndex) =>
  api.post(`/lessons/${lessonId}/hint`, { hintIndex }).then(unwrap);

export const submitCode = (lessonId, code) =>
  api.post(`/lessons/${lessonId}/submit`, { code }).then(unwrap);
