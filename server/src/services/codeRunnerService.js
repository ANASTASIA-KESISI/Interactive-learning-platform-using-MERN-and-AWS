// Thin orchestrator — picks an adapter at boot, invokes it, and compares
// the resulting stdout against the lesson's expectedOutput.
// Adapters: `dev` (Node vm, in-process; for laptop iteration), `lambda`
// (per-language AWS Lambda; for prod). Selection via CODE_RUNNER_ADAPTER.

const { env } = require('../config/env');

const adapterName =
  process.env.CODE_RUNNER_ADAPTER || (env.isProduction ? 'lambda' : 'dev');

const adapter =
  adapterName === 'lambda'
    ? require('./codeRunner/lambdaAdapter')
    : require('./codeRunner/devAdapter');

const normalise = (str) => (str || '').trim().replace(/\r\n/g, '\n');

const run = async (code, expectedOutput, language = 'javascript') => {
  const result = await adapter.run({ code, language });
  const passed =
    result.exitCode === 0 &&
    normalise(result.stdout) === normalise(expectedOutput);

  return {
    passed,
    stdout: result.stdout,
    error: result.exitCode !== 0 ? result.stderr || 'Execution error' : null,
    durationMs: result.durationMs,
  };
};

module.exports = { run, _adapter: adapterName };
