"""AWS Lambda handler — runs untrusted student Python.

Mirrors server/runners/js/index.js. Lambda's microVM provides the security
boundary; `exec` here is just the cleanest way to capture printed output and
apply a timeout, and is no more a sandbox than Node's `vm` is.

Invocation contract (matches lambdaAdapter on the API side):
    event:    { "code": str }
    response: { "stdout": str, "stderr": str, "exitCode": 0 | 1 }
"""

import contextlib
import io
import os
import signal

TIMEOUT_SECONDS = 5

# See CHALLENGES.md Challenge 13. Escaped code reaches the real process
# environment — verified against the deployed JS runner, where it returned the
# execution role's live STS credentials. This handler calls no AWS service, so
# the credentials have no business being reachable; removing the target is the
# control, since hardening the interpreter against every escape route is not a
# game that can be won. Scrubbed per invocation, not at cold start, because
# Lambda re-injects refreshed credentials into a warm container.
CREDENTIAL_VARS = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
)


def _scrub_credentials():
    for key in CREDENTIAL_VARS:
        os.environ.pop(key, None)


class _ExecutionTimeout(Exception):
    pass


def _on_alarm(_signum, _frame):
    raise _ExecutionTimeout()


def handler(event, _context=None):
    _scrub_credentials()

    code = (event or {}).get("code")
    if not isinstance(code, str):
        return {
            "stdout": "",
            "stderr": "Invalid payload: expected { code: string }",
            "exitCode": 1,
        }

    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0

    previous_handler = signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            # Fresh globals so submissions cannot leak state into each other
            # through a warm container. __name__ is set so `if __name__ ==
            # "__main__"` blocks in student code actually run.
            exec(code, {"__name__": "__main__"})  # noqa: S102 - this is the product
    except _ExecutionTimeout:
        exit_code = 1
        stderr.write(f"Script execution timed out after {TIMEOUT_SECONDS * 1000}ms")
    except BaseException as err:  # noqa: BLE001
        # BaseException, not Exception: student code can raise SystemExit via
        # sys.exit() or exit(), which would otherwise escape and fail the whole
        # invocation rather than being reported as a failed submission.
        exit_code = 1
        stderr.write(f"{type(err).__name__}: {err}")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)

    # print() appends a newline; strip the trailing one so output matches the
    # JS runner, which joins captured lines without a trailing separator. The
    # orchestrator compares this against lesson.expectedOutput.
    return {
        "stdout": stdout.getvalue().rstrip("\n"),
        "stderr": stderr.getvalue().rstrip("\n"),
        "exitCode": exit_code,
    }
