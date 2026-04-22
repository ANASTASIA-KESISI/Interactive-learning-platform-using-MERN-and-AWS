import { createContext, useCallback, useEffect, useMemo, useState } from 'react';

import * as cognito from '../services/cognito.js';

export const AuthContext = createContext(null);

const resolveRole = (claims) => {
  const groups = claims?.['cognito:groups'] || [];
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('instructor')) return 'instructor';
  return 'student';
};

const buildUserFromSession = (session) => {
  const claims = cognito.decodeJwt(session.idToken);
  return {
    cognitoId: claims?.sub,
    email: claims?.email,
    firstName: claims?.given_name,
    lastName: claims?.family_name,
    role: resolveRole(claims),
  };
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cognito
      .restoreSession()
      .then((s) => {
        if (s) {
          setSession(s);
          setUser(buildUserFromSession(s));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const s = await cognito.signIn(email, password);
    setSession(s);
    setUser(buildUserFromSession(s));
    return s;
  }, []);

  const logout = useCallback(() => {
    cognito.signOut();
    setSession(null);
    setUser(null);
  }, []);

  const getIdToken = useCallback(() => session?.idToken || null, [session]);

  const value = useMemo(
    () => ({ user, session, loading, login, logout, getIdToken }),
    [user, session, loading, login, logout, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
