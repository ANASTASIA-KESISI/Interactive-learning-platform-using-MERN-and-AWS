// Cognito config sourced from Vite env vars. Thrown errors here fail loud —
// we intentionally don't silently fall back, so misconfiguration surfaces in dev.
const required = (key) => {
  const value = import.meta.env[key];
  if (!value) {
    // eslint-disable-next-line no-console
    console.warn(`Missing env var ${key} — auth will not work until it is set.`);
  }
  return value || '';
};

export const cognitoConfig = {
  userPoolId: required('VITE_COGNITO_USER_POOL_ID'),
  clientId: required('VITE_COGNITO_CLIENT_ID'),
  region: required('VITE_COGNITO_REGION'),
};

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
