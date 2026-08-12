// Thin orchestrator — picks an adapter at boot, invokes it, and compares
// the resulting stdout against the lesson's expectedOutput.
// Adapters: `dev` (Node vm, in-process; for laptop iteration), `lambda`
// (per-language AWS Lambda; for prod). Selection via CODE_RUNNER_ADAPTER.

const { env } = require('../config/env');

// The dev adapter runs student code in-process via Node `vm`, which is NOT a
// sandbox — `console.log.constructor('return process')()` reaches process.env
// (AWS keys, Mongo URI). Lambda's microVM is the only security boundary we
// have, so adapter selection is a security decision and fails SAFE:
//
//   - `dev` is never a default; it must be opted into explicitly.
//   - Anything else (unset, typo'd, `lambda`) resolves to Lambda, where the
//     worst case is a loud runtime failure rather than a silent downgrade.
//   - Asking for `dev` in production is refused outright.
//
// Deliberately not keyed on NODE_ENV alone: a host that never sets NODE_ENV is
// the likeliest deployment mistake, and that path must not select `dev`.
const adapterName = process.env.CODE_RUNNER_ADAPTER === 'dev' ? 'dev' : 'lambda';

if (env.isProduction && adapterName !== 'lambda') {
  throw new Error(
    `Refusing to start: CODE_RUNNER_ADAPTER="${process.env.CODE_RUNNER_ADAPTER}" in ` +
      'production. The dev adapter executes untrusted code in the API process and ' +
      'is not a security boundary. Set CODE_RUNNER_ADAPTER=lambda.',
  );
}

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
