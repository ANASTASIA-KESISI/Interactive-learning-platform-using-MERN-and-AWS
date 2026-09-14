const { User } = require('../models/User');
const { University } = require('../models/University');
const { Department } = require('../models/Department');
const gamificationService = require('./gamificationService');
const messageService = require('./messageService');
const { badRequest, notFound } = require('../utils/httpError');

// Self-service profile fields. Everything else on the user document is
// server-owned: `role` lives in Cognito (authService), `xpPoints`, `streak`,
// `badges`, `lessonsCompleted` and `enrolledCourses` are written by the
// gamification/course services only. Spreading req.body would let a learner
// award themselves XP (S5.5 B3, same class of defect).
const PROFILE_WRITABLE = ['firstName', 'lastName', 'bio', 'avatar', 'universityId', 'departmentId'];

const TEXT_FIELDS = ['firstName', 'lastName', 'bio', 'avatar'];
const BIO_MAX = 500;
const NAME_MAX = 100;
const AVATAR_MAX = 512;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const pick = (source, allowed) =>
  Object.fromEntries(
    Object.entries(source || {}).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    ),
  );

// '' and null both mean "clear this reference"; anything else must look like an
// ObjectId before it reaches Mongo, or a malformed value surfaces as a 500.
const normaliseRef = (value, field) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw badRequest(`${field} must be a valid id`);
  }
  return value;
};

const sameId = (a, b) => Boolean(a) && Boolean(b) && a.toString() === b.toString();

// `/api/me` — the one call the shell makes after sign-in. Level, rank and the
// XP-into-level numbers are derived here (never stored, S7 D8) so the header,
// Home and Profile all read the same figures.
const getMe = async (user) => {
  if (!user) throw notFound('User not found');

  await user.populate([
    { path: 'universityId', select: 'name code' },
    { path: 'departmentId', select: 'name code semesterCount' },
  ]);

  // `populate` leaves the raw ObjectId in place when the referenced document
  // has been deleted, so only treat a ref as resolved once it carries a name.
  const resolved = (ref) => (ref && ref.name ? ref : null);
  const university = resolved(user.universityId);
  const department = resolved(user.departmentId);
  const { level, xpIntoLevel, xpForNextLevel, rank } = gamificationService.gamificationSummary(user);
  const unreadMessages = await messageService.countUnreadFor(user._id, user.role);

  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    role: user.role,
    avatar: user.avatar ?? null,
    bio: user.bio ?? null,
    xpPoints: user.xpPoints ?? 0,
    streak: user.streak ?? 0,
    lessonsCompleted: user.lessonsCompleted ?? 0,
    level,
    xpIntoLevel,
    xpForNextLevel,
    rank,
    university: university
      ? { id: university._id.toString(), name: university.name, code: university.code }
      : null,
    department: department
      ? {
          id: department._id.toString(),
          name: department.name,
          code: department.code,
          semesterCount: department.semesterCount,
        }
      : null,
    enrolledCourseIds: (user.enrolledCourses || []).map((id) => id.toString()),
    badgeCount: (user.badges || []).length,
    unreadMessages,
    createdAt: user.createdAt ?? null,
  };
};

// PATCH /api/me. The institutional pair is validated together: a department is
// only meaningful inside its university, and the Courses page groups by
// `department.semesterCount`, so a mismatched pair would silently produce an
// empty course list rather than an error the learner can act on.
const updateMe = async (userId, body) => {
  const updates = pick(body, PROFILE_WRITABLE);

  for (const field of TEXT_FIELDS) {
    if (!(field in updates)) continue;
    if (updates[field] === null) {
      updates[field] = '';
      continue;
    }
    if (typeof updates[field] !== 'string') throw badRequest(`${field} must be a string`);
    updates[field] = updates[field].trim();
  }
  if ('bio' in updates && updates.bio.length > BIO_MAX) {
    throw badRequest(`bio must be ${BIO_MAX} characters or fewer`);
  }
  if ('avatar' in updates && updates.avatar.length > AVATAR_MAX) {
    throw badRequest(`avatar must be ${AVATAR_MAX} characters or fewer`);
  }
  for (const field of ['firstName', 'lastName']) {
    if (field in updates && updates[field].length > NAME_MAX) {
      throw badRequest(`${field} must be ${NAME_MAX} characters or fewer`);
    }
  }

  const wantsUniversity = 'universityId' in updates;
  const wantsDepartment = 'departmentId' in updates;
  if (wantsUniversity) updates.universityId = normaliseRef(updates.universityId, 'universityId');
  if (wantsDepartment) updates.departmentId = normaliseRef(updates.departmentId, 'departmentId');

  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');

  if (wantsUniversity || wantsDepartment) {
    const universityId = wantsUniversity ? updates.universityId : user.universityId;
    const departmentId = wantsDepartment ? updates.departmentId : user.departmentId;

    if (universityId) {
      const university = await University.findById(universityId).lean();
      if (!university) throw badRequest('Unknown university');
    }

    if (departmentId) {
      const department = await Department.findById(departmentId).lean();
      if (!department) throw badRequest('Unknown department');

      if (!sameId(department.universityId, universityId)) {
        // The caller chose the pair — tell them it does not hold.
        if (wantsDepartment) {
          throw badRequest('departmentId must belong to the selected university');
        }
        // They only moved university; the stored department is now orphaned,
        // so drop it rather than leaving an inconsistent pair behind.
        updates.departmentId = null;
      }
    }
  }

  Object.assign(user, updates);
  await user.save();
  return getMe(user);
};

module.exports = { getMe, updateMe, PROFILE_WRITABLE };
