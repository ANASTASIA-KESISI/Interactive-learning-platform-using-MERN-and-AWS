const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { env } = require('../../config/env');

// One function per language (CHALLENGES.md Challenge 4). Python is registered
// only when its function name is configured, so an environment without the
// Lambda deployed rejects a Python submission at dispatch with a clear message
// rather than failing inside AWS with ResourceNotFoundException.
const FUNCTION_NAMES = {
  javascript: process.env.LAMBDA_RUNNER_JS_FUNCTION || 'learncode-runner-js',
  ...(process.env.LAMBDA_RUNNER_PY_FUNCTION
    ? { python: process.env.LAMBDA_RUNNER_PY_FUNCTION }
    : {}),
};

let client;
const getClient = () => {
  if (!client) client = new LambdaClient({ region: env.aws.region });
  return client;
};

const run = async ({ code, language }) => {
  const functionName = FUNCTION_NAMES[language];
  if (!functionName) {
    throw new Error(`No Lambda runner configured for language "${language}"`);
  }

  const start = Date.now();
  const cmd = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ code })),
  });

  const res = await getClient().send(cmd);

  if (res.FunctionError) {
    return {
      stdout: '',
      stderr: `Lambda invocation failed: ${res.FunctionError}`,
      exitCode: 1,
      durationMs: Date.now() - start,
    };
  }

  const payload = res.Payload
    ? JSON.parse(Buffer.from(res.Payload).toString('utf-8'))
    : {};

  return {
    stdout: payload.stdout || '',
    stderr: payload.stderr || '',
    exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : 0,
    durationMs: Date.now() - start,
  };
};

module.exports = { run };
