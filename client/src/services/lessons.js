import { api, unwrap } from './api.js';

export const getLesson = (lessonId) =>
  api.get(`/lessons/${lessonId}`).then(unwrap);

export const updateLesson = (lessonId, payload) =>
  api.patch(`/instructor/lessons/${lessonId}`, payload).then(unwrap);

export const revealHint = (lessonId, hintIndex) =>
  api.post(`/lessons/${lessonId}/hint`, { hintIndex }).then(unwrap);
