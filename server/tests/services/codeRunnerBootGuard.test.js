// Regression for S5.5 finding B2.
//
// The dev adapter runs student code in-process via Node `vm`, which is not a
// sandbox — `console.log.constructor('return process')()` reaches process.env.
// Adapter choice used to fall back to `dev` whenever NODE_ENV wasn't exactly
// "production", so a mis-set env var on the deployed box would silently execute
// untrusted code inside the API. Boot must fail instead.
//
// `env.isProduction` is mocked rather than driven through process.env because
// the env loader re-reads server/.env with override:true, which would clobber a
// NODE_ENV set here.

const loadServiceWith = ({ isProduction, adapter }) => {
  let service;
  jest.isolateModules(() => {
    jest.doMock('../../src/config/env', () => ({
      env: {
        isProduction,
        isTest: !isProduction,
        nodeEnv: isProduction ? 'production' : 'test',
        aws: { region: 'eu-west-1' },
      },
    }));

    if (adapter === undefined) delete process.env.CODE_RUNNER_ADAPTER;
    else process.env.CODE_RUNNER_ADAPTER = adapter;

    // eslint-disable-next-line global-require
    service = require('../../src/services/codeRunnerService');
  });
  return service;
};

describe('codeRunnerService adapter boot guard', () => {
  const originalAdapter = process.env.CODE_RUNNER_ADAPTER;

  afterEach(() => {
    if (originalAdapter === undefined) delete process.env.CODE_RUNNER_ADAPTER;
    else process.env.CODE_RUNNER_ADAPTER = originalAdapter;
  });

  test('refuses to boot with the dev adapter in production', () => {
    expect(() => loadServiceWith({ isProduction: true, adapter: 'dev' })).toThrow(
      /Refusing to start/,
    );
  });

  test('production defaults to the lambda adapter when unset', () => {
    const service = loadServiceWith({ isProduction: true, adapter: undefined });
    expect(service._adapter).toBe('lambda');
  });

  test('the dev adapter must be opted into explicitly', () => {
    const service = loadServiceWith({ isProduction: false, adapter: 'dev' });
    expect(service._adapter).toBe('dev');
  });

  // The likeliest deploy mistake is a host that never sets NODE_ENV at all, so
  // `isProduction` reads false and the production guard cannot fire. Selection
  // must still land on Lambda: a missing variable can only ever fail safe.
  test('an unset adapter never resolves to dev, even outside production', () => {
    const service = loadServiceWith({ isProduction: false, adapter: undefined });
    expect(service._adapter).toBe('lambda');
  });

  test('an unrecognised adapter value resolves to lambda rather than dev', () => {
    const service = loadServiceWith({ isProduction: false, adapter: 'isolated-vm' });
    expect(service._adapter).toBe('lambda');
  });
});
