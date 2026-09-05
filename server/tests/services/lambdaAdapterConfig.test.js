// How the Lambda adapter decides a language is runnable, and what it does when
// it decides one is not. Both halves were live defects on 2026-09-05:
//
//   - Python was DEPLOYED in eu-west-1 but `LAMBDA_RUNNER_PY_FUNCTION` was
//     never set, so the adapter never registered the language and every Python
//     lesson was unrunnable against a perfectly healthy function. JavaScript
//     hid the asymmetry by carrying a built-in default name.
//   - The refusal threw a plain Error, which `errorHandler` turned into a bare
//     500 whose body said only "Internal server error", so the one sentence
//     naming the missing variable never reached anyone.
//
// The adapter reads the environment once, at require time, so every test loads
// a fresh copy through `loadAdapter` after setting the variables it means to
// test. Reading ambient state instead would make this file pass or fail
// depending on whether server/.env happens to name the Python runner — which
// is precisely the coupling that let the bug through.
//
// Lives apart from codeRunnerDispatch.test.js, which mocks this adapter away
// wholesale; here we exercise the real one.

// `config/env` runs `dotenv.config()` at load, and `jest.isolateModules` resets
// the registry so it runs again on every fresh require — re-reading server/.env
// and putting back the very variable a test had just deleted. Mocking the
// module keeps the environment under the test's control instead of the
// developer's local file.
jest.mock('../../src/config/env', () => ({
  env: { aws: { region: 'eu-west-1' } },
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({
    send: jest.fn().mockRejectedValue(new Error('mock AWS: reached the client')),
  })),
  InvokeCommand: jest.fn(),
}));

const JS_VAR = 'LAMBDA_RUNNER_JS_FUNCTION';
const PY_VAR = 'LAMBDA_RUNNER_PY_FUNCTION';

const loadAdapter = () => {
  let adapter;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    adapter = require('../../src/services/codeRunner/lambdaAdapter');
  });
  return adapter;
};

const withEnv = (vars) => {
  Object.entries(vars).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

const ORIGINAL = { [JS_VAR]: process.env[JS_VAR], [PY_VAR]: process.env[PY_VAR] };

afterEach(() => withEnv(ORIGINAL));

describe('a language with no configured function', () => {
  test('rejects with a 503 HttpError, not a generic Error', async () => {
    withEnv({ [PY_VAR]: undefined });

    await expect(loadAdapter().run({ code: 'print(1)', language: 'python' })).rejects.toMatchObject(
      { name: 'HttpError', status: 503 },
    );
  });

  test('the message names the variable to set and where the runbook explains it', async () => {
    withEnv({ [PY_VAR]: undefined });

    await expect(loadAdapter().run({ code: 'print(1)', language: 'python' })).rejects.toThrow(
      /LAMBDA_RUNNER_PY_FUNCTION.*DEPLOYMENT\.md/s,
    );
  });

  test('an unknown language is refused the same way', async () => {
    await expect(loadAdapter().run({ code: 'puts 1', language: 'ruby' })).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('language registration from the environment', () => {
  // The regression that mattered: naming the function must make the language
  // dispatchable. Reaching the (mocked) AWS client is the proof — the rejection
  // then comes from the client, never as a 503 refusal at the boundary.
  test('naming the Python function registers the language', async () => {
    withEnv({ [PY_VAR]: 'learncode-runner-py' });

    await expect(
      loadAdapter().run({ code: 'print(1)', language: 'python' }),
    ).rejects.not.toMatchObject({ status: 503 });
  });

  test('JavaScript needs no variable, which is why the asymmetry went unnoticed', async () => {
    withEnv({ [JS_VAR]: undefined });

    await expect(
      loadAdapter().run({ code: 'console.log(1)', language: 'javascript' }),
    ).rejects.not.toMatchObject({ status: 503 });
  });
});
