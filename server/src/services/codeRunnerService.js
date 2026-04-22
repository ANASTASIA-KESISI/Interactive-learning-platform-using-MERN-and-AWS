const { NodeVM, VMScript } = require('vm2');

const TIMEOUT_MS = 5000;

// Captures console.log output produced by the sandboxed code.
const buildConsoleMock = (lines) => ({
  log: (...args) => lines.push(args.map(String).join(' ')),
  error: (...args) => lines.push(args.map(String).join(' ')),
  warn: (...args) => lines.push(args.map(String).join(' ')),
});

const normalise = (str) => (str || '').trim().replace(/\r\n/g, '\n');

const run = async (code, expectedOutput) => {
  const outputLines = [];

  try {
    const vm = new NodeVM({
      timeout: TIMEOUT_MS,
      sandbox: { console: buildConsoleMock(outputLines) },
      require: false,
      eval: false,
      wasm: false,
    });

    const script = new VMScript(code, { filename: 'student.js' });
    vm.run(script);
  } catch (err) {
    const errorMessage = err.message || 'Execution error';
    return {
      passed: false,
      stdout: outputLines.join('\n'),
      error: errorMessage,
    };
  }

  const stdout = outputLines.join('\n');
  const passed = normalise(stdout) === normalise(expectedOutput);

  return { passed, stdout, error: null };
};

module.exports = { run };
