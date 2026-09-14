const codeRunnerService = require('../../src/services/codeRunnerService');

describe('codeRunnerService', () => {
  test('passes when stdout matches expectedOutput exactly', async () => {
    const result = await codeRunnerService.run(
      'console.log("Hello, World!");',
      'Hello, World!',
    );
    expect(result.passed).toBe(true);
    expect(result.stdout).toBe('Hello, World!');
    expect(result.error).toBeNull();
  });

  test('fails when stdout does not match', async () => {
    const result = await codeRunnerService.run(
      'console.log("wrong");',
      'Hello, World!',
    );
    expect(result.passed).toBe(false);
  });

  test('trims trailing whitespace when comparing', async () => {
    const result = await codeRunnerService.run(
      'console.log("42");',
      '42  ',
    );
    expect(result.passed).toBe(true);
  });

  test('captures runtime error and fails gracefully', async () => {
    const result = await codeRunnerService.run(
      'throw new Error("boom");',
      '',
    );
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  test('prevents access to Node built-ins (require)', async () => {
    const result = await codeRunnerService.run(
      'const fs = require("fs"); console.log("ok");',
      'ok',
    );
    expect(result.passed).toBe(false);
  });

  test('multi-line output is captured correctly', async () => {
    const result = await codeRunnerService.run(
      'console.log("line1"); console.log("line2");',
      'line1\nline2',
    );
    expect(result.passed).toBe(true);
  });
});

// The Run button's path (S7 D10): same adapter, same error shaping, but no
// verdict — nothing here may tell the learner whether they got it right.
describe('codeRunnerService.execute (run without validating)', () => {
  test('returns stdout with no verdict field', async () => {
    const result = await codeRunnerService.execute('console.log("anything");');

    expect(result.stdout).toBe('anything');
    expect(result.error).toBeNull();
    expect(typeof result.durationMs).toBe('number');
    expect(result).not.toHaveProperty('passed');
    expect(Object.keys(result).sort()).toEqual(['durationMs', 'error', 'stdout']);
  });

  test('shapes a runtime error the same way run does', async () => {
    const result = await codeRunnerService.execute('throw new Error("boom");');

    expect(result.error).toMatch(/boom/);
    expect(result).not.toHaveProperty('passed');
  });

  test('is sandboxed exactly as run is — no require', async () => {
    const result = await codeRunnerService.execute('const fs = require("fs"); console.log("ok");');

    expect(result.error).not.toBeNull();
  });

  test('output that would have failed validation is still returned verbatim', async () => {
    const result = await codeRunnerService.execute('console.log("wrong");');

    expect(result.stdout).toBe('wrong');
    expect(result.error).toBeNull();
  });
});
