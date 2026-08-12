import { api, unwrap } from './api.js';

// ── Student / public ──────────────────────────────────────────────────────────

export const listCourses = (params = {}) =>
  api.get('/courses', { params }).then(unwrap);

export const getCourse = (courseId) =>
  api.get(`/courses/${courseId}`).then(unwrap);

export const enrollInCourse = (courseId) =>
  api.post(`/courses/${courseId}/enroll`).then(unwrap);

// ── Instructor ────────────────────────────────────────────────────────────────

export const listMyCourses = () =>
  api.get('/instructor/courses').then(unwrap);

export const createCourse = (payload) =>
  api.post('/instructor/courses', payload).then(unwrap);

export const updateCourse = (courseId, payload) =>
  api.patch(`/instructor/courses/${courseId}`, payload).then(unwrap);

export const publishCourse = (courseId) =>
  api.post(`/instructor/courses/${courseId}/publish`).then(unwrap);

export const addModule = (courseId, payload) =>
  api.post(`/instructor/courses/${courseId}/modules`, payload).then(unwrap);

export const addLesson = (moduleId, payload) =>
  api.post(`/instructor/modules/${moduleId}/lessons`, payload).then(unwrap);

export const updateModule = (moduleId, payload) =>
  api.patch(`/instructor/modules/${moduleId}`, payload).then(unwrap);

// Removes the module and every lesson inside it. Learner progress records are
// retained server-side as pilot research data.
export const deleteModule = (moduleId) =>
  api.delete(`/instructor/modules/${moduleId}`).then(unwrap);

export const deleteLesson = (lessonId) =>
  api.delete(`/instructor/lessons/${lessonId}`).then(unwrap);

export const getCourseAnalytics = (courseId) =>
  api.get(`/instructor/courses/${courseId}/analytics`).then(unwrap);
