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

// Disables (or re-enables) the user in Cognito and mirrors the flag into Mongo
// (S8 D3). Deactivation also revokes their refresh tokens, and the API refuses
// their next request, so it is immediate. 400 for the admin's own account;
// 503 until the Cognito actions are attached to the runtime IAM policy.
export const setUserActive = (userId, isActive) =>
  api.patch(`/admin/users/${userId}/active`, { isActive }).then(unwrap);

export const listAllCourses = () => api.get('/admin/courses').then(unwrap);

// Publishing is refused with a 409 that names the missing module or lesson
// (S8 D1); unpublishing always succeeds.
export const setCoursePublished = (courseId, isPublished) =>
  api.patch(`/admin/courses/${courseId}/publish`, { isPublished }).then(unwrap);

// Unpublished courses only (409 otherwise). Cascades in Mongo; learner
// progress records are retained (S8 D2).
export const deleteCourse = (courseId) =>
  api.delete(`/admin/courses/${courseId}`).then(unwrap);

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

// ── Platform settings (S9) ────────────────────────────────────────────────────
// The instructor invite code lives in Mongo, seeded from INSTRUCTOR_INVITE_CODE
// on a fresh deployment. `source` is 'database' | 'environment' | 'unset'.
// Saving an empty code disables instructor self-signup.

export const getInstructorInviteCode = () =>
  api.get('/admin/settings/instructor-invite-code').then(unwrap);

export const setInstructorInviteCode = (code) =>
  api.put('/admin/settings/instructor-invite-code', { code }).then(unwrap);
