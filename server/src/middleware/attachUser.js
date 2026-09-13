const authService = require('../services/authService');
const { unauthorized, forbidden } = require('../utils/httpError');

// The client matches this code, not the message, to tell a deactivated account
// apart from an ordinary 403 (S8 D3).
const ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED';

const attachUser = async (req, _res, next) => {
  try {
    if (!req.user) return next(unauthorized());
    const dbUser = await authService.syncUserFromClaims(req.user);
    // Cognito's disable only blocks new sign-ins; a token issued before the
    // disable verifies fine until it expires. The Mongo mirror is what makes
    // deactivation immediate on the API. Checked after the sync so the
    // lockout is visible in `lastActiveAt` like any other visit.
    if (dbUser.isActive === false) {
      return next(forbidden('This account has been deactivated', { code: ACCOUNT_DEACTIVATED }));
    }
    req.dbUser = dbUser;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { attachUser, ACCOUNT_DEACTIVATED };
