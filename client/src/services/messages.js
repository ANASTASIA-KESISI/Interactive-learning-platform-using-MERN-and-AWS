import { api, unwrap } from './api.js';

// Endpoints land in Phase 1-E; the signatures are fixed here so the panels that
// consume them can be written against a stable surface. One thread per
// (student, course); polling, no sockets.

export const listThreads = () => api.get('/messages/threads').then(unwrap);

// `studentId` is required for instructor/admin callers and ignored for
// students, who only ever have one thread per course. Reading a thread marks
// the other side's messages read.
export const getThread = (courseId, studentId) =>
  api
    .get(`/messages/courses/${courseId}`, { params: studentId ? { studentId } : {} })
    .then(unwrap);

// payload: { body, lessonId?, studentId? }
export const sendMessage = (courseId, payload) =>
  api.post(`/messages/courses/${courseId}`, payload).then(unwrap);
