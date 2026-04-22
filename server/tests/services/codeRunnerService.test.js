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
