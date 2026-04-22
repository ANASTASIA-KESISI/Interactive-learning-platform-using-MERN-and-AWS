const authService = require('../services/authService');
const { unauthorized } = require('../utils/httpError');

const attachUser = async (req, _res, next) => {
  try {
    if (!req.user) return next(unauthorized());
    const dbUser = await authService.syncUserFromClaims(req.user);
    req.dbUser = dbUser;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { attachUser };
