import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

import { cognitoConfig } from '../config/cognitoConfig.js';

let pool;
const getPool = () => {
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: cognitoConfig.userPoolId,
      ClientId: cognitoConfig.clientId,
    });
  }
  return pool;
};

const buildUser = (email) =>
  new CognitoUser({ Username: email, Pool: getPool() });

// Returns the full session so the caller can pick the ID token it wants
// to forward to the API.
export const signIn = (email, password) =>
  new Promise((resolve, reject) => {
    const user = buildUser(email);
    const details = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) =>
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
          expiresAt: session.getIdToken().getExpiration() * 1000,
        }),
      onFailure: reject,
      newPasswordRequired: () =>
        reject(new Error('New password required — complete setup in the AWS console first.')),
    });
  });

export const signUp = (email, password, firstName, lastName) =>
  new Promise((resolve, reject) => {
    const attrs = [
      new CognitoUserAttribute({ Name: 'email', Value: email }),
      new CognitoUserAttribute({ Name: 'given_name', Value: firstName }),
      new CognitoUserAttribute({ Name: 'family_name', Value: lastName }),
    ];
    getPool().signUp(email, password, attrs, null, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

export const confirmSignUp = (email, code) =>
  new Promise((resolve, reject) => {
    buildUser(email).confirmRegistration(code, true, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

export const resendConfirmationCode = (email) =>
  new Promise((resolve, reject) => {
    buildUser(email).resendConfirmationCode((err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

export const signOut = () => {
  const current = getPool().getCurrentUser();
  if (current) current.signOut();
};

// Reads the cached session from Cognito's localStorage. Called on app boot so
// a refresh doesn't kick the user back to the login screen.
export const restoreSession = () =>
  new Promise((resolve) => {
    const current = getPool().getCurrentUser();
    if (!current) return resolve(null);
    current.getSession((err, session) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve({
        idToken: session.getIdToken().getJwtToken(),
        accessToken: session.getAccessToken().getJwtToken(),
        refreshToken: session.getRefreshToken().getToken(),
        expiresAt: session.getIdToken().getExpiration() * 1000,
      });
    });
  });

// Decodes a JWT payload without verifying — safe only for reading client-side
// display fields (email, groups). The server re-verifies every request.
export const decodeJwt = (token) => {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
};
