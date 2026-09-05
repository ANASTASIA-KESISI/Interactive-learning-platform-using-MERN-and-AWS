// Language dispatch across the two adapters. The dev adapter is Node `vm` and
// can only execute JavaScript, so in dev mode any other language must fall
// through to Lambda rather than erroring or — worse — being shelled out to a
// system interpreter on the developer's machine.

const mockLambdaRun = jest.fn();
const mockDevRun = jest.fn();

jest.mock('../../src/services/codeRunner/lambdaAdapter', () => ({ run: mockLambdaRun }));
jest.mock('../../src/services/codeRunner/devAdapter', () => ({ run: mockDevRun }));

const loadServiceWith = (adapter) => {
  let service;
  jest.isolateModules(() => {
    jest.doMock('../../src/config/env', () => ({
      env: { isProduction: false, isTest: true, nodeEnv: 'test', aws: { region: 'eu-west-1' } },
    }));
    process.env.CODE_RUNNER_ADAPTER = adapter;
    // eslint-disable-next-line global-require
    service = require('../../src/services/codeRunnerService');
  });
  return service;
};

const ok = (stdout) => ({ stdout, stderr: '', exitCode: 0, durationMs: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  mockLambdaRun.mockResolvedValue(ok('out'));
  mockDevRun.mockResolvedValue(ok('out'));
});

describe('adapter selection by language', () => {
  test('dev mode runs JavaScript in process', async () => {
    const svc = loadServiceWith('dev');
    await svc.run('console.log(1)', 'out', 'javascript');

    expect(mockDevRun).toHaveBeenCalledTimes(1);
    expect(mockLambdaRun).not.toHaveBeenCalled();
  });

  test('dev mode sends Python to Lambda', async () => {
    const svc = loadServiceWith('dev');
    await svc.run('print(1)', 'out', 'python');

    expect(mockLambdaRun).toHaveBeenCalledWith({ code: 'print(1)', language: 'python' });
    expect(mockDevRun).not.toHaveBeenCalled();
  });

  test('lambda mode sends every language to Lambda', async () => {
    const svc = loadServiceWith('lambda');
    await svc.run('console.log(1)', 'out', 'javascript');
    await svc.run('print(1)', 'out', 'python');

    expect(mockLambdaRun).toHaveBeenCalledTimes(2);
    expect(mockDevRun).not.toHaveBeenCalled();
  });

  test('language defaults to javascript when omitted', async () => {
    const svc = loadServiceWith('lambda');
    await svc.run('console.log(1)', 'out');

    expect(mockLambdaRun).toHaveBeenCalledWith({
      code: 'console.log(1)',
      language: 'javascript',
    });
  });

  // Validation is a whitespace-normalised stdout comparison, so it is
  // language-agnostic by construction — worth pinning, since a per-language
  // validator would be a much larger change than adding a runner.
  test('pass/fail comparison behaves identically for Python output', async () => {
    const svc = loadServiceWith('lambda');

    mockLambdaRun.mockResolvedValue(ok('Hello, World!\n'));
    expect((await svc.run('print(...)', 'Hello, World!', 'python')).passed).toBe(true);

    mockLambdaRun.mockResolvedValue(ok('wrong'));
    expect((await svc.run('print(...)', 'Hello, World!', 'python')).passed).toBe(false);
  });
});

