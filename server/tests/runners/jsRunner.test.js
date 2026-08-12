// Tests the Lambda runner handler directly (server/runners/js/index.js), which
// is deployed as its own artifact and is not otherwise covered — the
// codeRunnerService tests exercise the dev adapter.

const { handler } = require('../../runners/js/index');

describe('runner-js handler', () => {
  test('captures stdout from console.log', async () => {
    const res = await handler({ code: "console.log('Hello, World!')" });
    expect(res).toEqual({ stdout: 'Hello, World!', stderr: '', exitCode: 0 });
  });

  test('reports a thrown error without crashing the invocation', async () => {
    const res = await handler({ code: 'throw new Error("boom")' });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/boom/);
  });

  test('rejects a malformed payload', async () => {
    const res = await handler({});
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/Invalid payload/);
  });

  test('separates console.error into stderr', async () => {
    const res = await handler({ code: "console.log('out'); console.error('err')" });
    expect(res.stdout).toBe('out');
    expect(res.stderr).toBe('err');
  });
});

// Regression for CHALLENGES.md Challenge 13. `vm` is not a sandbox: student code
// reaches the real global through any constructor it can see, and against the
// deployed function that returned the execution role's live STS credentials.
// Lambda's microVM remains the security boundary — this asserts we do not leave
// a usable credential sitting inside it.
describe('credential scrubbing', () => {
  const CREDENTIALS = {
    AWS_ACCESS_KEY_ID: 'ASIAEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secret-value',
    AWS_SESSION_TOKEN: 'session-token',
    AWS_SECURITY_TOKEN: 'legacy-token',
  };

  beforeEach(() => Object.assign(process.env, CREDENTIALS));

  test('the known vm escape still works — this is why scrubbing is the control', async () => {
    process.env.NOT_A_CREDENTIAL = 'still-here';

    const res = await handler({
      code: "console.log(console.log.constructor('return process.env')().NOT_A_CREDENTIAL)",
    });

    // If this ever fails, `vm` has become an isolation boundary and the whole
    // sandboxing rationale in CHALLENGES.md 1/6/13 deserves revisiting.
    expect(res.stdout).toBe('still-here');
    delete process.env.NOT_A_CREDENTIAL;
  });

  test.each(Object.keys(CREDENTIALS))('escaped code cannot read %s', async (key) => {
    const res = await handler({
      code: `console.log(String(console.log.constructor('return process.env')().${key}))`,
    });

    expect(res.stdout).toBe('undefined');
  });

  test('credentials are removed even when the submission is malformed', async () => {
    await handler({ code: 12345 });
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
