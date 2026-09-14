import { api, unwrap } from './api.js';

// The one call the shell makes after sign-in. Returns the Mongo user id
// (`dbId` on the client), the derived level/rank block, the institution the
// learner belongs to and the unread-message count behind the header bell.
export const getMe = () => api.get('/me').then(unwrap);

// Allowlisted server-side: firstName, lastName, bio, avatar, universityId,
// departmentId. A department that does not belong to the university is a 400.
export const updateMe = (payload) => api.patch('/me', payload).then(unwrap);

// Session heartbeat (S8 D6). Telemetry only: the server answers 202 for every
// role and records nothing for anyone but a student, so the caller never
// needs the response.
export const sendSessionHeartbeat = (sessionId) =>
  api.post('/me/session', { sessionId }).then(unwrap);
