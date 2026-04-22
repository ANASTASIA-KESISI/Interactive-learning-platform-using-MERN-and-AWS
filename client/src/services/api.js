import axios from 'axios';

import { apiBaseUrl } from '../config/cognitoConfig.js';

// Token getter is injected from AuthProvider at app boot so this module
// stays free of React/context coupling and is easy to unit-test.
let tokenGetter = () => null;
let onUnauthorized = null;

export const configureApi = ({ getToken, onAuthExpired }) => {
  tokenGetter = getToken;
  onUnauthorized = onAuthExpired;
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
    }
    return Promise.reject(err);
  },
);

export const unwrap = (res) => res.data?.data ?? res.data;
