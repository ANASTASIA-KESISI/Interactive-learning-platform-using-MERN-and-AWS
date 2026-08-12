# DEPLOYMENT.md

Operational guide for putting LearnCode on AWS and running the pilot. Written
for the S6 deployment; assumes the S5.5 hardening changes are in place.

Two things to know before starting:

1. **The AWS CLI is not installed on the development machine.** Steps below are
   written for the AWS Console where possible. The one exception is the Lambda
   runner, which needs AWS SAM — see §2 for the alternatives.
2. **Configuration must come from the platform environment, not a `.env` file.**
   Since S5.5 the env loader treats real environment variables as authoritative
   (precedence: process environment → `server/.env` → repo-root `.env`). Do not
   copy `server/.env` onto a deployed host.

---

## 1. Prerequisites already in place

Recorded here so they are not re-created by mistake:

| Resource | Value |
|---|---|
| AWS account | `InteractiveLearnPlatformAK` (901864772557), root user |
| Region | `eu-west-1` |
| Cognito User Pool | groups `admin`, `instructor`, `student` |
| DynamoDB table | `learncode_progress` — PK `userId` (S), SK `lessonId` (S) |
| IAM user | `learncode-backend` — DynamoDB + S3 access |
| MongoDB | Atlas cluster, connection string in `MONGODB_URI` |

---

## 2. Deploy the code-runner Lambda

**This is the highest-priority item and has never been exercised.** Since S5.5
the Lambda adapter is the default on any host that does not explicitly opt into
the dev runner, so nothing works in production until this function exists.

`template.yaml` at the repo root defines `learncode-runner-js` (Node 22, 10s
timeout, 256MB) from `server/runners/js/`.

**Option A — install AWS SAM CLI (recommended).**

```bash
# Requires AWS CLI + SAM CLI on the machine doing the deploy
sam build
sam deploy --guided     # stack name e.g. learncode-runners, region eu-west-1
```

**Option B — Console upload, no CLI (used for the pilot).** Create the function
by hand:

1. Lambda → Create function → Author from scratch
2. Name `learncode-runner-js`, runtime **Node.js 22.x**, architecture x86_64
3. Configuration → General → Timeout **10s**, Memory **256MB**
4. Upload the deployment zip under Code → Upload from → .zip file
5. Handler must be `index.handler`

Rebuild the zip from the repo root any time the runner changes — the two files
must sit at the **archive root**, not inside a folder, or Lambda cannot find the
handler:

```powershell
Compress-Archive -Path server/runners/js/index.js, server/runners/js/package.json `
  -DestinationPath learncode-runner-js.zip -Force
```

The handler has no dependencies, so there is no `node_modules` to include. The
artifact is gitignored.

**Option C — GitHub Actions.** If you would rather not install anything
locally, add a manually-triggered workflow that runs `sam deploy` with
credentials from repository secrets. Reasonable if deploys become frequent;
overkill for a single pilot function.

**Smoke test** (Lambda console → Test) with this event:

```json
{ "code": "console.log('Hello, World!')" }
```

Expected response: `{"stdout":"Hello, World!","stderr":"","exitCode":0}`.
Then verify a failing case — `{ "code": "throw new Error('boom')" }` should
return `exitCode: 1` with `boom` in `stderr`.

**Then test the adapter → Lambda contract**, which the Console test does not
cover. From `/server`, with the `lambda:InvokeFunction` policy of §3 attached:

```bash
CODE_RUNNER_ADAPTER=lambda node -e "const a=require('./src/services/codeRunner/lambdaAdapter'); a.run({code:\"console.log('hi')\",language:'javascript'}).then(console.log).catch(e=>console.error(e.name,e.message))"
```

`AccessDeniedException` means the policy is missing or its ARN is wrong;
`ResourceNotFoundException` means a name or region mismatch.

**And re-run the credential probe after any runner redeploy** (Challenge 13):

```json
{ "code": "console.log(console.log.constructor('return process.env')().AWS_SECRET_ACCESS_KEY)" }
```

Expected `stdout` is `undefined`. Anything else means the credential scrub in
`server/runners/js/index.js` is missing from the deployed artifact — most
likely a stale zip.

---

## 3. IAM permissions the backend needs

`learncode-backend` currently holds DynamoDB and S3 access. Two additions are
required for S6:

**Invoke the runner Lambda:**

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:eu-west-1:901864772557:function:learncode-runner-js"
}
```

**Manage Cognito group membership** (needed by the admin panel's role control —
without it, `PATCH /api/admin/users/:id/role` returns an AWS authorization
error):

```json
{
  "Effect": "Allow",
  "Action": [
    "cognito-idp:AdminAddUserToGroup",
    "cognito-idp:AdminRemoveUserFromGroup",
    "cognito-idp:AdminListGroupsForUser"
  ],
  "Resource": "arn:aws:cognito-idp:eu-west-1:901864772557:userpool/<USER_POOL_ID>"
}
```

Attach both as an inline policy on the `learncode-backend` user (IAM → Users →
learncode-backend → Add permissions → Create inline policy → JSON).

---

## 4. Backend environment variables

Set these through the hosting platform (EC2 user data / systemd unit /
Amplify environment variables), **not** a `.env` file on the host.

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables `trust proxy`; gates the runner guard |
| `PORT` | `4000` | Behind nginx/ALB |
| `MONGODB_URI` | Atlas SRV string | Atlas Network Access must allow the host IP |
| `CLIENT_ORIGIN` | `https://<frontend-domain>` | CORS allowlist — exact origin, no trailing slash |
| `AWS_REGION` | `eu-west-1` | |
| `COGNITO_USER_POOL_ID` | pool id | |
| `COGNITO_CLIENT_ID` | app client id | |
| `COGNITO_ISSUER` | `https://cognito-idp.eu-west-1.amazonaws.com/<pool-id>` | JWKS is derived from this |
| `DYNAMO_PROGRESS_TABLE` | `learncode_progress` | |
| `S3_MEDIA_BUCKET` | `learncode-media` | |
| **`CODE_RUNNER_ADAPTER`** | **`lambda`** | See below |
| `LAMBDA_RUNNER_JS_FUNCTION` | `learncode-runner-js` | |

**On `CODE_RUNNER_ADAPTER`:** the in-process dev runner executes untrusted
student code inside the API process and is not a sandbox. Since S5.5 it must be
opted into explicitly — any other value, including unset, resolves to `lambda`,
and asking for `dev` while `NODE_ENV=production` refuses to boot. Leaving it
unset in production is safe; setting it to `dev` is a hard startup failure by
design.

Credentials: prefer an **EC2 instance role** over the `learncode-backend` access
keys. The SDK picks up the instance role automatically and nothing has to be
stored on disk. If you keep the static keys, set `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` as platform environment variables.

---

## 5. Frontend

`VITE_*` variables are inlined **at build time**, so they must be present when
`npm run build --workspace client` runs, not at runtime.

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<api-domain>/api` |
| `VITE_COGNITO_USER_POOL_ID` | pool id |
| `VITE_COGNITO_CLIENT_ID` | app client id |
| `VITE_COGNITO_REGION` | `eu-west-1` |

**Amplify Hosting** is the lower-friction option: connect the repo, set build
output to `client/dist`, add the variables above under Environment variables.
Because this is a client-rendered SPA, add a rewrite rule sending `404` to
`/index.html` (200) or deep links like `/admin/users` will 404 on refresh.

**S3 + CloudFront** works equally well and is cheaper; same SPA fallback applies
(custom error response 403/404 → `/index.html`, status 200).

---

## 6. HTTPS

NFR4 requires TLS everywhere. Terminate at the load balancer or CloudFront with
an ACM certificate; ACM certificates are free and auto-renewing. If running
nginx on a single EC2 box instead, use certbot. `CLIENT_ORIGIN` must be the
`https://` origin or CORS will reject the browser's requests.

---

## 7. CloudWatch

Since S6 the API emits one JSON line per request (`src/middleware/requestLogger.js`)
plus structured application logs, so Logs Insights can query fields directly:

```
fields @timestamp, method, path, status, durationMs
| filter status >= 400
| sort @timestamp desc
```

```
fields @timestamp, path, durationMs
| filter ispresent(durationMs)
| stats avg(durationMs), max(durationMs), count() by path
```

The second query is the NFR3 check (primary interactions under 3s).

To get stdout into CloudWatch from EC2, install the CloudWatch agent or run the
API under systemd with `StandardOutput=journal` plus the journald→CloudWatch
integration. Amplify and Lambda ship logs automatically.

Worth adding alarms for: API 5xx rate, Lambda error rate and throttles, and
DynamoDB throttled requests.

---

## 8. Pre-pilot checklist

Run in order once the platform is live:

- [ ] Lambda runner deployed and smoke-tested (§2) — **the production code path
      has never executed before this**
- [ ] Both IAM policies attached (§3); confirm by changing a user's role in the
      admin panel and re-signing-in as that user
- [ ] `node scripts/seedBadges.js` — idempotent, safe to re-run
- [ ] `node scripts/resetStreaks.js` — **required once.** Pre-S5.5 streak values
      are meaningless; run `--dry-run` first to see the count
- [ ] End-to-end smoke test as a real student: sign up → enrol → open an
      exercise → fail a submission → reveal a hint → pass → confirm XP, badge
      and the completion screen
- [ ] Confirm in DevTools that the lesson response contains **no**
      `expectedOutput` and no unrevealed hint text (S5.5 B1)
- [ ] Confirm a draft course 404s for a student account (S5.5 B4)
- [ ] Verify request logs are arriving in CloudWatch as JSON
- [ ] Atlas backups enabled; DynamoDB point-in-time recovery on
- [ ] Decide the pilot end date and diary the export: `node
      scripts/exportSubmissions.js` (anonymous by default)

---

## 9. Known gaps at S6

- **No client test suite.** CI lints and builds the frontend; React Testing
  Library specs are planned but unwritten, so the build is the only frontend
  regression signal.
- **Admin activity log** (`GET /api/admin/activity-log` in the sketch) is not
  implemented — it needs an audit store that does not exist yet. The request
  logger now emits structured events, so CloudWatch Logs Insights covers the
  same need for the pilot.
- **Single API instance.** NFR2 (horizontal scalability) is satisfied
  architecturally — the API is stateless and sessions live in Cognito — but the
  pilot runs one instance. Scaling out means an ALB plus a second instance; no
  code change required.
- **`getCourseAnalytics` uses a DynamoDB Scan.** Fine at pilot scale and
  documented in-code; past a few thousand items it needs a GSI on `lessonId`.
