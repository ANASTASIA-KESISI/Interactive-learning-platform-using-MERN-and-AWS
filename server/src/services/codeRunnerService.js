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

const lambdaAdapter = require('./codeRunner/lambdaAdapter');
const devAdapter = adapterName === 'dev' ? require('./codeRunner/devAdapter') : null;

// The dev adapter is Node `vm` and can only execute JavaScript, so in dev mode
// any other language falls through to the deployed Lambda. That keeps laptop
// iteration on JS instant while avoiding the alternative — shelling out to a
// system interpreter, which would run untrusted code on the developer's machine
// with no isolation at all.
const adapterFor = (language) => {
  if (adapterName === 'lambda') return lambdaAdapter;
  return language === 'javascript' ? devAdapter : lambdaAdapter;
};

const normalise = (str) => (str || '').trim().replace(/\r\n/g, '\n');

// Execute-only path, behind the editor's Run button (S7 D10). Same adapter,
// same error shaping, but no comparison against `expectedOutput` and no
// `passed` field — the answer must not be inferable from an endpoint that
// never needed it (S5.5 B1). `run` is layered on top so there is exactly one
// place where an adapter is chosen and its result is shaped.
const execute = async (code, language = 'javascript') => {
  const result = await adapterFor(language).run({ code, language });

  return {
    stdout: result.stdout,
    error: result.exitCode !== 0 ? result.stderr || 'Execution error' : null,
    durationMs: result.durationMs,
  };
};

const run = async (code, expectedOutput, language = 'javascript') => {
  const { stdout, error, durationMs } = await execute(code, language);

  return {
    passed: error === null && normalise(stdout) === normalise(expectedOutput),
    stdout,
    error,
    durationMs,
  };
};

module.exports = { run, execute, _adapter: adapterName };
