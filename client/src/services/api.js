import axios from 'axios';

import { apiBaseUrl } from '../config/cognitoConfig.js';

// The server's `attachUser` puts this code on the 403 it returns for a
// deactivated account (S8 D3). Matched by code, never by message text, so an
// ordinary role refusal can never trigger the sign-out below.
export const ACCOUNT_DEACTIVATED_CODE = 'ACCOUNT_DEACTIVATED';
export const ACCOUNT_DEACTIVATED_NOTICE =
  'Your account has been deactivated. Contact your instructor.';

export const isAccountDeactivatedError = (err) =>
  err?.response?.status === 403 &&
  err.response.data?.error?.details?.code === ACCOUNT_DEACTIVATED_CODE;

// Token getter is injected from AuthProvider at app boot so this module
// stays free of React/context coupling and is easy to unit-test.
let tokenGetter = () => null;
let onUnauthorized = null;
let onDeactivated = null;

export const configureApi = ({ getToken, onAuthExpired, onAccountDeactivated = null }) => {
  tokenGetter = getToken;
  onUnauthorized = onAuthExpired;
  onDeactivated = onAccountDeactivated;
};

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = tokenGetter();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && onUnauthorized) {
      onUnauthorized();
    } else if (isAccountDeactivatedError(err)) {
      // The session is dead server-side; drop it here too and say why on the
      // login page. Until <ApiBinding/> has wired the router-aware handler,
      // the plain sign-out is enough — RequireAuth then shows /login.
      if (onDeactivated) onDeactivated();
      else if (onUnauthorized) onUnauthorized();
    }
    return Promise.reject(err);
  },
);

export const unwrap = (res) => res.data?.data ?? res.data;
