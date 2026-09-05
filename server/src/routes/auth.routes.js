const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const authService = require('../services/authService');
const { env } = require('../config/env');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { attachUser } = require('../middleware/attachUser');
const { HttpError, badRequest, forbidden } = require('../utils/httpError');

const router = express.Router();

// The invite code is a shared secret an institution hands to its teaching
// staff, so the endpoint is guessable by design and needs a much tighter
// budget than the app-wide 120/min limiter (S7 D2).
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Try again in 15 minutes.' } },
});

// Constant-time compare. `timingSafeEqual` throws on unequal lengths, so the
// length is checked first — that leaks the code's length and nothing else,
// which is the accepted trade-off for this primitive.
const codeMatches = (candidate, expected) => {
  const a = Buffer.from(String(candidate), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// POST /api/auth/claim-instructor
//
// Self-service promotion to `instructor`, gated on an institution-held code.
// Roles live in Cognito groups, so this delegates to authService.setUserRole —
// the same AdminAddUserToGroup path the admin panel uses. The caller's current
// token keeps the old claim until they refresh their session, hence the note.
router.post(
  '/claim-instructor',
  claimLimiter,
  requireAuth,
  requireRole('student'),
  attachUser,
  async (req, res, next) => {
    try {
      const expected = env.instructorInviteCode;
      if (!expected) {
        throw new HttpError(503, 'Instructor self-signup is not enabled on this deployment');
      }

      const { code } = req.body || {};
      if (typeof code !== 'string' || !code) throw badRequest('code is required');

      if (!codeMatches(code, expected)) {
        // Deliberately generic: a specific message would tell a guesser
        // whether they got the length right.
        throw forbidden('That invite code is not valid');
      }

      await authService.setUserRole(req.dbUser._id, 'instructor');

      res.json({
        data: {
          role: 'instructor',
          note: 'Refresh your session for the new role to take effect.',
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
