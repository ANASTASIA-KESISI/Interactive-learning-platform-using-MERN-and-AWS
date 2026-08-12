process.env.NODE_ENV = 'test';
// The in-process runner is opt-in (see codeRunnerService); tests that execute
// student code rely on it, so ask for it explicitly.
process.env.CODE_RUNNER_ADAPTER = 'dev';
process.env.PORT = '0';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/learncode-test';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.COGNITO_USER_POOL_ID = 'eu-west-1_test';
process.env.COGNITO_CLIENT_ID = 'test-client';
process.env.COGNITO_ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
