import { api, unwrap } from './api.js';

export const getKpis = (weeks = 8) =>
  api.get('/admin/kpis', { params: { weeks } }).then(unwrap);

// Returns { data, meta } rather than unwrapping, because the caller needs the
// pagination totals alongside the rows.
export const listUsers = (params = {}) =>
  api.get('/admin/users', { params }).then((res) => ({
    users: res.data?.data ?? [],
    meta: res.data?.meta ?? { total: 0, page: 1, limit: 20 },
  }));

// Moves the user between Cognito groups server-side. Takes effect for them on
// their next token refresh, not immediately.
export const setUserRole = (userId, role) =>
  api.patch(`/admin/users/${userId}/role`, { role }).then(unwrap);

export const listAllCourses = () => api.get('/admin/courses').then(unwrap);

export const setCoursePublished = (courseId, isPublished) =>
  api.patch(`/admin/courses/${courseId}/publish`, { isPublished }).then(unwrap);

export const listBadges = () => api.get('/admin/badges').then(unwrap);

// ── Universities & departments (S7 D3) ────────────────────────────────────────
// Reference data the signup form and the Courses grouping depend on. Deletes
// are refused server-side (409) while something still references the record.

export const createUniversity = (payload) =>
  api.post('/admin/universities', payload).then(unwrap);

export const updateUniversity = (universityId, payload) =>
  api.patch(`/admin/universities/${universityId}`, payload).then(unwrap);

export const deleteUniversity = (universityId) =>
  api.delete(`/admin/universities/${universityId}`).then(unwrap);

export const createDepartment = (universityId, payload) =>
  api.post(`/admin/universities/${universityId}/departments`, payload).then(unwrap);

export const updateDepartment = (departmentId, payload) =>
  api.patch(`/admin/departments/${departmentId}`, payload).then(unwrap);

export const deleteDepartment = (departmentId) =>
  api.delete(`/admin/departments/${departmentId}`).then(unwrap);
