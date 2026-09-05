const {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const { User, ROLES } = require('../models/User');
const { getCognitoClient } = require('../config/aws');
const { env } = require('../config/env');
const { notFound, badRequest, serviceUnavailable } = require('../utils/httpError');

const syncUserFromClaims = async (authUser) => {
  const { cognitoId, email, role, claims } = authUser;

  const update = {
    email,
    role,
    firstName: claims.given_name,
    lastName: claims.family_name,
    lastActiveAt: new Date(),
  };

  const user = await User.findOneAndUpdate(
    { cognitoId },
    { $set: update, $setOnInsert: { cognitoId, xpPoints: 0, streak: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return user;
};

const getByCognitoId = (cognitoId) => User.findOne({ cognitoId });

// Roles are owned by Cognito, not Mongo. `requireAuth` derives the role from
// the `cognito:groups` JWT claim and `syncUserFromClaims` mirrors it into Mongo
// on every request — so writing Mongo alone is a no-op that survives exactly
// until the user's next request (S5.5 finding A3). Changing a role therefore
// means moving the user between Cognito groups; the Mongo write here only
// keeps the mirror fresh until their token refreshes.
//
// The change takes effect for the user when they next obtain a token: existing
// access tokens keep the old group claim until they expire or are refreshed.
const setUserRole = async (userId, role) => {
  if (!ROLES.includes(role)) throw badRequest(`Invalid role: ${role}`);

  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.role === role) return user;

  env.assertCognitoConfigured();
  const client = getCognitoClient();
  const UserPoolId = env.aws.cognito.userPoolId;
  const Username = user.cognitoId;

  const { Groups = [] } = await client.send(
    new AdminListGroupsForUserCommand({ UserPoolId, Username }),
  );

  // ADD the new group before removing the old ones. The reverse order looks
  // tidier but is not crash-safe: if the add then fails — a missing group, a
  // throttle, a dropped connection — the user is left holding NO role group at
  // all, and `resolveRole` reads that as `student`. A failed promotion silently
  // demoted people, which is exactly what happened to one account here on
  // 2026-09-05: the `instructor` group was removed, adding `student` failed,
  // and the account came back with no groups.
  //
  // Adding first means a failure leaves the user exactly as they were. The cost
  // is a brief window where they hold two groups, and `resolveRole` resolves
  // that deterministically by picking the highest privilege — so the worst case
  // is a demotion taking effect one token refresh later, never a lost role.
  try {
    await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username, GroupName: role }));
  } catch (err) {
    // `student` is the DEFAULT role, not an elevation: `resolveRole` returns it
    // whenever no elevated group matches, and nothing ever reads a `student`
    // group membership. So a pool without that group can still hold students —
    // demotion just means dropping the elevated groups.
    const missingGroup =
      err.name === 'ResourceNotFoundException' || /group not found/i.test(err.message || '');
    if (missingGroup && role !== 'student') {
      throw serviceUnavailable(
        `The Cognito user pool has no "${role}" group, so the role cannot be assigned. ` +
          `Create a group named exactly "${role}" in pool ${UserPoolId} ` +
          '(Cognito → User pools → Groups), then retry.',
      );
    }
    if (!missingGroup) throw err;
  }

  // Now drop every other application-role group, so the user can never hold two
  // for long — `resolveRole` picks the highest-privilege match, which would
  // otherwise make a demotion permanently ineffective.
  const stale = Groups.map((g) => g.GroupName).filter(
    (name) => ROLES.includes(name) && name !== role,
  );
  for (const GroupName of stale) {
    // eslint-disable-next-line no-await-in-loop
    await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username, GroupName }));
  }

  user.role = role;
  await user.save();
  return user;
};

module.exports = { syncUserFromClaims, getByCognitoId, setUserRole };
