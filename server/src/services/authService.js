const {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const { User, ROLES } = require('../models/User');
const { getCognitoClient } = require('../config/aws');
const { env } = require('../config/env');
const { notFound, badRequest } = require('../utils/httpError');

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

  // Remove every other application-role group first so a user can never hold
  // two — `resolveRole` picks the highest-privilege match, which would make a
  // demotion silently ineffective.
  const stale = Groups.map((g) => g.GroupName).filter(
    (name) => ROLES.includes(name) && name !== role,
  );
  for (const GroupName of stale) {
    // eslint-disable-next-line no-await-in-loop
    await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username, GroupName }));
  }

  await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username, GroupName: role }));

  user.role = role;
  await user.save();
  return user;
};

module.exports = { syncUserFromClaims, getByCognitoId, setUserRole };
