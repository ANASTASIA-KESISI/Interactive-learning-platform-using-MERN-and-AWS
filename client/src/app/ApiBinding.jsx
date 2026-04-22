import { useEffect } from 'react';

import { configureApi } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

// Bridges AuthProvider ↔ the standalone axios client. Rendered once inside
// <App/> so the api module always has a fresh token getter + expiry hook.
export const ApiBinding = ({ children }) => {
  const { getIdToken, logout } = useAuth();

  useEffect(() => {
    configureApi({ getToken: getIdToken, onAuthExpired: logout });
  }, [getIdToken, logout]);

  return children;
};
