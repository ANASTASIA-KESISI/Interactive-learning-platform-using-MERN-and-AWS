import { api, unwrap } from './api.js';

// One round-trip for the whole Home screen: XP/level/rank, streak, badges, the
// enrolled-course cards, the active course with its next lesson, and the recent
// activity feed.
export const getStudentDashboard = () =>
  api.get('/student/dashboard').then(unwrap);

export const getStudentProgress = () =>
  api.get('/student/progress').then(unwrap);

// `{ from, to, days:[{ date:'YYYY-MM-DD', completions }] }` for the trailing 365
// days, zero-filled server-side so the heatmap can lay out a dense grid without
// any gap logic. Student-only — other roles have no progress records.
export const getStudentActivity = () =>
  api.get('/student/activity').then(unwrap);
