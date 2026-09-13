import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { ACCOUNT_DEACTIVATED_NOTICE, configureApi } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

// Bridges AuthProvider ↔ the standalone axios client. Rendered once inside
// <App/> so the api module always has a fresh token getter + expiry hook.
export const ApiBinding = ({ children }) => {
  const { getIdToken, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    configureApi({
      getToken: getIdToken,
      onAuthExpired: logout,
      // A deactivated account (S8 D3): the API has already refused the
      // request, so drop the session and tell the user why on the login page,
      // through the same router-state notice the signup flows use. Navigate
      // first so RequireAuth's own redirect never replaces the notice.
      onAccountDeactivated: () => {
        navigate('/login', { replace: true, state: { notice: ACCOUNT_DEACTIVATED_NOTICE } });
        logout();
      },
    });
  }, [getIdToken, logout, navigate]);

  return children;
};
