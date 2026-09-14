const { forbidden, unauthorized } = require('../utils/httpError');
const { ROLES } = require('../models/User');

const requireRole = (allowed) => {
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  const invalid = allowedList.filter((r) => !ROLES.includes(r));
  if (invalid.length) {
    throw new Error(`requireRole received unknown roles: ${invalid.join(', ')}`);
  }

  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowedList.includes(req.user.role)) {
      return next(forbidden(`Role '${req.user.role}' is not permitted on this route`));
    }
    next();
  };
};

module.exports = { requireRole };
