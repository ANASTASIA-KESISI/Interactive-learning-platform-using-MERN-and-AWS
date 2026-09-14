const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const { env } = require('../config/env');
const { unauthorized } = require('../utils/httpError');

let jwks;

const getJwks = () => {
  if (!jwks) {
    env.assertCognitoConfigured();
    jwks = jwksClient({
      jwksUri: `${env.aws.cognito.issuer}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
    });
  }
  return jwks;
};

const getSigningKey = (header, callback) => {
  getJwks().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
};

const extractToken = (req) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
};

// Cognito exposes group membership via the `cognito:groups` claim. We map
// the first matching group to an application role so downstream RBAC has a
// single, predictable field to check.
const resolveRole = (claims) => {
  const groups = claims['cognito:groups'] || [];
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('instructor')) return 'instructor';
  return 'student';
};

const verifyToken = (token) =>
  new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        issuer: env.aws.cognito.issuer,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      },
    );
  });

const requireAuth = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('Missing bearer token');

    const claims = await verifyToken(token);

    req.user = {
      cognitoId: claims.sub,
      email: claims.email,
      role: resolveRole(claims),
      claims,
    };

    next();
  } catch (err) {
    if (err.name === 'HttpError') return next(err);
    next(unauthorized('Invalid or expired token'));
  }
};

module.exports = { requireAuth };
