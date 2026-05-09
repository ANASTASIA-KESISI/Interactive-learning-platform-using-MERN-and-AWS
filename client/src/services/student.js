import { api, unwrap } from './api.js';

export const getStudentDashboard = () =>
  api.get('/student/dashboard').then(unwrap);

export const getStudentProgress = () =>
  api.get('/student/progress').then(unwrap);
