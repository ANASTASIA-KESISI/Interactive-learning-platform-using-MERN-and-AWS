# Code-runner Lambdas

Per-language Lambda functions that execute untrusted student code. Invoked by
`server/src/services/codeRunner/lambdaAdapter.js` when the API runs with
`CODE_RUNNER_ADAPTER=lambda`.

## Local dev — you don't need these deployed

In `server/.env`, leave `CODE_RUNNER_ADAPTER=dev` (the default outside production).
The API uses the in-process `vm`-based dev adapter, no AWS calls.

## Deploy (production)

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

From the repo root:

```bash
sam build
sam deploy --guided   # first time — pick stack name, region eu-west-1, confirm
sam deploy            # subsequent deploys
```

Then in the production `server/.env`:

```
CODE_RUNNER_ADAPTER=lambda
LAMBDA_RUNNER_JS_FUNCTION=learncode-runner-js
```

The IAM role of whatever runs the Express API (EC2 instance role, ECS task
role, Amplify service role) needs `lambda:InvokeFunction` on the function ARN.

## Adding a language

1. Add the language string to `LESSON_LANGUAGES` in `server/src/models/Lesson.js`.
2. Add a `FUNCTION_NAMES.<lang>` entry in
   `server/src/services/codeRunner/lambdaAdapter.js`.
3. Create `server/runners/<lang>/` with `index.js` (handler) and `package.json`.
   The handler must accept `{ code: string }` and return
   `{ stdout, stderr, exitCode }`.
4. Add a matching `Resource` block to the root `template.yaml`.
5. `sam build && sam deploy`.
