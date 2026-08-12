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
