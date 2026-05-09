// AWS Lambda handler — runs untrusted student JavaScript in a Node `vm`
// context. Lambda's microVM provides the security boundary; the `vm` here is
// just the cleanest way to capture console.log output and apply a timeout.
//
// Invocation contract (matches lambdaAdapter on the API side):
//   event:    { code: string }
//   response: { stdout: string, stderr: string, exitCode: 0 | 1 }
const vm = require('vm');

const TIMEOUT_MS = 5000;

const stringify = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
};

exports.handler = async (event) => {
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
