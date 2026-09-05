const path = require('path');
const dotenv = require('dotenv');

// Precedence: real process environment > server/.env > repo-root .env.
//
// dotenv does not overwrite variables that already exist, so loading the more
// specific file FIRST gives it priority while leaving anything the deployment
// platform injected untouched. The previous ordering used `override: true` on
// server/.env, which meant a checked-out dev file beat the real environment —
// `NODE_ENV=production node src/server.js` resolved to "development", so the
// code-runner boot guard never fired and the in-process dev adapter would have
// run untrusted student code on the deployed host.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key, fallback) => process.env[key] ?? fallback;

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '4000')),
  mongoUri: optional('MONGODB_URI', 'mongodb://localhost:27017/learncode'),
  clientOrigin: optional('CLIENT_ORIGIN', 'http://localhost:5173'),
  // Institution-held secret that lets a self-registered account claim the
  // `instructor` role (S7 D2). Empty disables the claim endpoint (503).
  instructorInviteCode: optional('INSTRUCTOR_INVITE_CODE', ''),
  aws: {
    region: optional('AWS_REGION', 'eu-west-1'),
    cognito: {
      userPoolId: optional('COGNITO_USER_POOL_ID', ''),
      clientId: optional('COGNITO_CLIENT_ID', ''),
      issuer: optional('COGNITO_ISSUER', ''),
    },
    dynamo: {
      progressTable: optional('DYNAMO_PROGRESS_TABLE', 'learncode_progress'),
    },
    s3: {
      mediaBucket: optional('S3_MEDIA_BUCKET', 'learncode-media'),
    },
  },
};

env.isProduction = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

env.assertCognitoConfigured = () => {
  if (!env.aws.cognito.userPoolId || !env.aws.cognito.issuer) {
    throw new Error(
      'Cognito is not configured. Set COGNITO_USER_POOL_ID and COGNITO_ISSUER in your .env file.',
    );
  }
};

module.exports = { env, required };
