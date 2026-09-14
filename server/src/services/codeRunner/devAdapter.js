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

const run = async ({ code, language }) => {
  if (language !== 'javascript') {
    throw new Error(
      `devAdapter supports only javascript (got "${language}"). Other languages run via the Lambda adapter in production.`,
    );
  }

  const stdoutLines = [];
  const stderrLines = [];
  const start = Date.now();

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
    durationMs: Date.now() - start,
  };
};

module.exports = { run };
