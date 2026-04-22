const { User } = require('../models/User');

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

module.exports = { syncUserFromClaims, getByCognitoId };
