import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as cognito from '../services/cognito.js';
import { configureApi } from '../services/api.js';
import { getMe } from '../services/me.js';

export const AuthContext = createContext(null);

const resolveRole = (claims) => {
  const groups = claims?.['cognito:groups'] || [];
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('instructor')) return 'instructor';
  return 'student';
};

// Everything the ID token alone can tell us. The role MUST come from here (the
// Cognito group claim) and never from the profile payload — the server derives
// it the same way and is authoritative either way.
const buildUserFromSession = (session) => {
  const claims = cognito.decodeJwt(session.idToken);
  return {
    cognitoId: claims?.sub,
    email: claims?.email,
    firstName: claims?.given_name,
    lastName: claims?.family_name,
    avatar: null,
    role: resolveRole(claims),
  };
};

// Claims + `/api/me`. `dbId` is the Mongo id — CourseDetailPage and
// AdminUsersPage have always read it, but nothing set it before S7, so the
// "Edit course" and "you" affordances never rendered.
const mergeProfile = (claimsUser, profile) => ({
  ...claimsUser,
  profile: profile ?? null,
  dbId: profile?.id ?? null,
  firstName: profile?.firstName || claimsUser.firstName || null,
  lastName: profile?.lastName || claimsUser.lastName || null,
  avatar: profile?.avatar || claimsUser.avatar || null,
});

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // The token getter reads a ref rather than state so it is correct the moment
  // a session is assigned. The profile fetch below happens in the same
  // microtask as `setSession`, i.e. before React re-renders and before
  // <ApiBinding/>'s effect could re-run — a state-backed getter would still be
  // returning null and /api/me would 401 on every page refresh.
  const sessionRef = useRef(null);
  const claimsUserRef = useRef(null);
  const logoutRef = useRef(() => {});
  const configuredRef = useRef(false);

  const getIdToken = useCallback(() => sessionRef.current?.idToken || null, []);

  if (!configuredRef.current) {
    configuredRef.current = true;
    configureApi({ getToken: getIdToken, onAuthExpired: () => logoutRef.current() });
  }

  // A failed profile fetch must not lock the user out: the claims-only user is
  // enough to render the shell, and the pages that need `dbId` degrade to
  // hiding an affordance rather than erroring.
  const loadProfile = useCallback(async () => {
    try {
      return await getMe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Could not load profile from /api/me', err);
      return null;
    }
  }, []);

  const applySession = useCallback(
    async (s) => {
      sessionRef.current = s;
      setSession(s);
      const claimsUser = buildUserFromSession(s);
      claimsUserRef.current = claimsUser;
      const profile = await loadProfile();
      const merged = mergeProfile(claimsUser, profile);
      setUser(merged);
      return merged;
    },
    [loadProfile],
  );

  useEffect(() => {
    let cancelled = false;

    cognito
      .restoreSession()
      .then(async (s) => {
        if (!s || cancelled) return;
        await applySession(s);
      })
      .catch(() => {
        // No usable cached session — fall through to the login screen.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    async (email, password) => {
      const s = await cognito.signIn(email, password);
      await applySession(s);
      return s;
    },
    [applySession],
  );

  const logout = useCallback(() => {
    cognito.signOut();
    sessionRef.current = null;
    claimsUserRef.current = null;
    setSession(null);
    setUser(null);
  }, []);
  logoutRef.current = logout;

  // Re-reads /api/me without touching the Cognito session — for after a
  // profile edit or an action that changes XP, badges or the unread count.
  const refreshProfile = useCallback(async () => {
    const profile = await getMe();
    setUser((current) => mergeProfile(claimsUserRef.current || current || {}, profile));
    return profile;
  }, []);

  // Pulls a brand new ID token so a group change made server-side (the
  // instructor claim, an admin role change) lands in the claims without the
  // user signing out and back in.
  const refreshSession = useCallback(async () => {
    const s = await cognito.refreshSession();
    if (!s) return null;
    return applySession(s).then(() => s);
  }, [applySession]);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      login,
      logout,
      getIdToken,
      refreshProfile,
      refreshSession,
    }),
    [user, session, loading, login, logout, getIdToken, refreshProfile, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
