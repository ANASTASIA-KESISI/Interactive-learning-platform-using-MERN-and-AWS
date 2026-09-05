import { api, unwrap } from './api.js';

// Self-service promotion to `instructor`, gated on an institution-held invite
// code. The role lives in a Cognito group, so the caller must refresh its
// Cognito session afterwards for the new claim to land in the ID token —
// `useAuth().refreshSession()` does that.
export const claimInstructor = (code) =>
  api.post('/auth/claim-instructor', { code }).then(unwrap);
