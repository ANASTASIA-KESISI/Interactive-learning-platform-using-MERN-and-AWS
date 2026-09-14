const { Setting } = require('../models/Setting');
const { env } = require('../config/env');
const { badRequest } = require('../utils/httpError');

// The instructor invite code (S7 D2) started life as INSTRUCTOR_INVITE_CODE
// in the deployment's secrets file. Rotating it there means a Session Manager
// hop and a service restart, which is not something an admin can do from the
// panel — so the code now lives in Mongo, with the environment variable kept
// as the seed for a fresh deployment and the fallback until an admin saves one.
//
// Precedence: Mongo document (even an empty one — an admin may deliberately
// disable self-signup) > INSTRUCTOR_INVITE_CODE > unset (endpoint returns 503).
//
// Not cached: the claim endpoint is rate-limited to 5/15 min, and the admin
// panel reads it on demand, so one findOne per call is nothing — and a cache
// would be the only way a rotated code could stay valid after rotation.

const INVITE_CODE_MIN = 8;
const INVITE_CODE_MAX = 128;

const readInstructorInviteCode = async () => {
  const doc = await Setting.findOne({ key: 'instructorInviteCode' }).lean();
  if (doc) {
    return {
      code: doc.value || '',
      source: 'database',
      updatedAt: doc.updatedAt || null,
      updatedBy: doc.updatedBy || null,
    };
  }
  const fromEnv = env.instructorInviteCode || '';
  return {
    code: fromEnv,
    source: fromEnv ? 'environment' : 'unset',
    updatedAt: null,
    updatedBy: null,
  };
};

// Just the effective code, for the compare in the claim endpoint.
const getInstructorInviteCode = async () => (await readInstructorInviteCode()).code;

// Empty string is a valid write: it disables self-signup until an admin sets a
// new code, regardless of what the environment variable says. Anything else
// must be long enough not to be guessed within the endpoint's rate budget and
// short enough to type. Whitespace is trimmed; a code that is nothing but
// whitespace is treated as "disable".
const setInstructorInviteCode = async (rawCode, adminUserId) => {
  if (typeof rawCode !== 'string') throw badRequest('code must be a string');
  const code = rawCode.trim();

  if (code) {
    if (code.length < INVITE_CODE_MIN) {
      throw badRequest(`code must be at least ${INVITE_CODE_MIN} characters`);
    }
    if (code.length > INVITE_CODE_MAX) {
      throw badRequest(`code must be at most ${INVITE_CODE_MAX} characters`);
    }
    if (/\s/.test(code)) throw badRequest('code must not contain whitespace');
  }

  await Setting.findOneAndUpdate(
    { key: 'instructorInviteCode' },
    { $set: { value: code, updatedBy: adminUserId } },
    { upsert: true, new: true, runValidators: true },
  );

  return readInstructorInviteCode();
};

module.exports = {
  INVITE_CODE_MIN,
  INVITE_CODE_MAX,
  readInstructorInviteCode,
  getInstructorInviteCode,
  setInstructorInviteCode,
};
