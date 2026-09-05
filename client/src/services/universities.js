import { api, unwrap } from './api.js';

// Public endpoint — the signup form needs the university/department tree
// before an account (and therefore a token) exists.
export const listUniversities = () => api.get('/universities').then(unwrap);
