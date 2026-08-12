// AWS Lambda handler — runs untrusted student JavaScript in a Node `vm`
// context. Lambda's microVM provides the security boundary; the `vm` here is
// just the cleanest way to capture console.log output and apply a timeout.
//
// Invocation contract (matches lambdaAdapter on the API side):
//   event:    { code: string }
//   response: { stdout: string, stderr: string, exitCode: 0 | 1 }
const vm = require('vm');

const TIMEOUT_MS = 5000;

// `vm` is not a sandbox and never was — student code can reach the real global
// object through any constructor it can see (`console.log.constructor(...)`),
// which is why Lambda's microVM is the actual security boundary. Verified
// against the deployed function on 2026-08-12: the escape works, and it read
// the execution role's temporary credentials straight out of `process.env`.
//
// Playing whack-a-mole with escape routes is the wrong game. Removing the
// target is not: this handler calls no AWS service, so the credentials have no
// business being reachable. Scrubbed per invocation rather than once at cold
// start, because Lambda re-injects them into the environment when they refresh.
const CREDENTIAL_VARS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
];

const scrubCredentials = () => {
  for (const key of CREDENTIAL_VARS) delete process.env[key];
};

const stringify = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
};

exports.handler = async (event) => {
  scrubCredentials();

  const { code } = event || {};
  if (typeof code !== 'string') {
    return { stdout: '', stderr: 'Invalid payload: expected { code: string }', exitCode: 1 };
  }

  const stdoutLines = [];
  const stderrLines = [];

  const consoleMock = {
    log: (...args) => stdoutLines.push(args.map(stringify).join(' ')),
    info: (...args) => stdoutLines.push(args.map(stringify).join(' ')),
    error: (...args) => stderrLines.push(args.map(stringify).join(' ')),
    warn: (...args) => stderrLines.push(args.map(stringify).join(' ')),
  };

  const context = vm.createContext({ console: consoleMock });

  let exitCode = 0;
  let runtimeError = '';

  try {
    vm.runInContext(code, context, {
      timeout: TIMEOUT_MS,
      filename: 'student.js',
      displayErrors: true,
    });
  } catch (err) {
    exitCode = 1;
    runtimeError = err.message || 'Execution error';
  }

  const stderr = [...stderrLines, runtimeError].filter(Boolean).join('\n');

  return {
    stdout: stdoutLines.join('\n'),
    stderr,
    exitCode,
  };
};
