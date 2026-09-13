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

`template.yaml` at the repo root defines `learncode-runner-js` (Node 24, 10s
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
2. Name `learncode-runner-js`, runtime **Node.js 24.x** (what is deployed; keep
   `template.yaml` in step), architecture x86_64
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

### 2b. Deploy the Python runner (optional — not used by the pilot)

Python is supported by the platform but deliberately absent from pilot content
(CHALLENGES.md Challenge 14). Deploy it only if you want the capability
available, e.g. to demonstrate multi-language support at a defence.

Same Console flow as §2 Option B, with three differences:

1. Function name **`learncode-runner-py`**, runtime **Python 3.14** (what is
   deployed; `template.yaml` matches)
2. Upload `learncode-runner-py.zip`, rebuilt with:
   ```powershell
   Compress-Archive -Path server/runners/python/index.py `
     -DestinationPath learncode-runner-py.zip -Force
   ```
3. Timeout **10s**, memory **256MB**, handler **`index.handler`** (as for JS)

Then set `LAMBDA_RUNNER_PY_FUNCTION=learncode-runner-py` in the systemd unit
and restart. Without that variable, Python submissions are refused at dispatch
rather than reaching AWS — which is the intended behaviour on hosts where the
function does not exist.

**Widen the IAM invoke policy** (§3) to cover the new ARN, or every Python
submission returns `AccessDeniedException`.

Console test events:

```json
{ "code": "print('Hello, World!')" }
```
→ `{"stdout": "Hello, World!", "stderr": "", "exitCode": 0}`

```json
{ "code": "raise ValueError('boom')" }
```
→ `exitCode: 1`, `stderr` containing `ValueError: boom`

```json
{ "code": "import sys; print('bye'); sys.exit(1)" }
```
→ `exitCode: 1` — confirms `SystemExit` is caught rather than escaping

```json
{ "code": "while True: pass" }
```
→ `exitCode: 1`, `stderr` reporting the 5s timeout

```json
{ "code": "import os; print(os.environ.get('AWS_SECRET_ACCESS_KEY'))" }
```
→ `stdout` of `None` — the Challenge 13 credential scrub

## 3. IAM permissions the backend needs

`learncode-backend` currently holds DynamoDB and S3 access. Two additions are
required for S6:

**Invoke the runner Lambda:**

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": [
    "arn:aws:lambda:eu-west-1:901864772557:function:learncode-runner-js",
    "arn:aws:lambda:eu-west-1:901864772557:function:learncode-runner-py"
  ]
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

Attach both, as the inline policy `learncode-runtime`, to **two identities**,
and remember that updating one does not touch the other:

| Identity | Used by | Where |
|---|---|---|
| User `learncode-backend` | Local development, keys in `server/.env` | IAM → Users → learncode-backend → Add permissions → Create inline policy → JSON |
| Role `learncode-ec2-role` | The deployed API | IAM → Roles → learncode-ec2-role → same |

The instance role additionally carries two AWS-managed policies:
`AmazonSSMManagedInstanceCore`, so the SSM agent can register and Session
Manager and Run Command work, and `CloudWatchAgentServerPolicy`, so the
CloudWatch agent can create the log group and ship lines (§7).

---

## 4. Backend environment variables

Set these through the hosting platform (EC2 user data / systemd unit /
Amplify environment variables), **not** a `.env` file on the host.

Ready-made server config lives in `deploy/`, with the non-secret values for this
account already filled in:

| File | Purpose |
|---|---|
| `deploy/setup-ec2.sh` | Provisions a fresh Amazon Linux 2023 box — Node, git, nginx, service account, clone, deps, unit + site install. Idempotent; re-run for a full re-provision. |
| `deploy/update-ec2.sh` | Fast per-deploy update on an already-provisioned box: deps → unit/nginx refresh → restart → health check. Run by CI via SSM (§10), or by hand from a Session Manager shell. |
| `deploy/learncode-api.service` | systemd unit. Non-secret config inline; `MONGODB_URI` read from root-owned `/etc/learncode/secrets.env` (chmod 600) so it stays out of `systemctl show`. |
| `deploy/nginx-learncode.conf` | Reverse proxy 80 → loopback:4000, with the `X-Forwarded-*` headers `trust proxy` depends on and timeouts wide enough for a Lambda cold start. |

`CLIENT_ORIGIN` in the unit file and `server_name` in the nginx site carry the
**real production values in the repo** (the Amplify origin and the EC2 public
DNS name). Do not edit them on the host — CI re-copies both files on every
deploy, so host-side edits are overwritten. Change them in the repo instead.
(If deploying to a different account, replace both values before first boot.)

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
| `LAMBDA_RUNNER_PY_FUNCTION` | `learncode-runner-py` | **Required for Python lessons.** Unlike the JS one this has no built-in default: the adapter registers Python only when it is named, so an environment without the runner deployed rejects a Python submission at dispatch with a 503 naming this variable, rather than failing inside AWS. Both functions are deployed in `eu-west-1`; leaving this unset makes every Python lesson unrunnable even though the Lambda exists. |
| `INSTRUCTOR_INVITE_CODE` | long random secret (keep in `secrets.env`, beside `MONGODB_URI`) | Lets a signed-in student claim the `instructor` role via `POST /api/auth/claim-instructor`. Unset/empty disables the endpoint (503) and instructor signup silently creates an ordinary student account. Generate with `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. Rotate by editing `secrets.env` and restarting the service — already-promoted accounts keep their role, which lives in Cognito. |

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
Because this is a client-rendered SPA, deep links like `/admin/users` need a
rewrite to `/index.html`. Do **not** keep Amplify's default `/<*>` rule of
type `404-200`: it serves the page but with a 301 to a trailing slash and then
a 404 status, so crawlers, uptime probes and Lighthouse treat every deep link
as broken. Use Amplify's documented SPA rule instead (Hosting → Rewrites and
redirects → Manage → JSON editor):

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "status": "200",
    "target": "/index.html"
  }
]
```

Paths without a file extension get `index.html` with a 200; real assets pass
through. Takes effect immediately, no rebuild. Verify the status, not just
that the page renders:

```bash
curl -s -o /dev/null -L -w "%{url_effective} %{http_code}\n" https://<client>/login
```

It must end in `200` with no redirect. Applied to the live app on 2026-09-13.

**S3 + CloudFront** works equally well and is cheaper; same SPA fallback applies
(custom error response 403/404 → `/index.html`, status 200).

---

## 6. HTTPS

NFR4 requires TLS everywhere. As deployed: the client is served by Amplify
over HTTPS on its `*.amplifyapp.com` name, and the API sits behind CloudFront
distribution `E20QDA6UFH1VN0` (`https://d3n7zqt9fcw62k.cloudfront.net`), which
terminates TLS on its `*.cloudfront.net` name with an AWS-managed certificate
and forwards to the instance over plain HTTP on port 80. No certificate is
installed or renewed on the box, and no custom domain exists, so ACM and
Route 53 are not involved.

CloudFront's defaults are wrong for an API and were changed: cache policy
`CachingDisabled` (the default would serve one learner's response to another),
origin request policy `AllViewerExceptHostHeader` (the default strips the
`Authorization` header), all HTTP methods allowed, and the origin given as the
instance's public DNS name because CloudFront refuses a bare IP.

`CLIENT_ORIGIN` on the API must be the `https://` Amplify origin or CORS will
reject the browser's requests. If a custom domain is ever added, an ACM
certificate in `us-east-1` is what CloudFront needs for it.

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

Lambda and Amplify ship their logs automatically (`/aws/lambda/learncode-runner-js`,
`/aws/lambda/learncode-runner-py`, and the Amplify console's build logs). The
API's logs do **not** get there on their own: systemd stores them in the
journal, and the CloudWatch agent reads files, not the journal.

### Shipping the API logs

**Live on the instance since 2026-09-13.** Log group `/learncode/api`, one
stream per instance id, 90-day retention. The steps below are what was run,
kept for a fresh host; nothing about the API itself changes and the API is
not restarted.

One trap, already handled by the script but worth knowing if the unit is ever
installed by hand: systemd opens the `StandardOutput=append:` file *before*
it creates the directory `LogsDirectory=` declares, so on a host where
`/var/log/learncode` does not exist the unit dies with `209/STDOUT` before
`journalctl` runs. Create the directory first.

How it fits together:

```
learncode-api ──stdout──> journal ──learncode-journal-export.service──> /var/log/learncode/api.log
                                                                              │
                                                       amazon-cloudwatch-agent ┘──> log group /learncode/api
```

| File | Role |
|---|---|
| `deploy/learncode-journal-export.service` | `journalctl -u learncode-api -f -o cat` into the log file, with a cursor file so a restart resumes rather than repeats |
| `deploy/cloudwatch-agent.json` | Agent config: that one file → log group `/learncode/api`, stream = instance id, 90-day retention |
| `deploy/logrotate-learncode` | Daily rotation with `copytruncate`, since both writer and agent hold the file open |
| `deploy/setup-cloudwatch.sh` | Installs all of the above, idempotent |

Steps:

1. **IAM.** Console → IAM → Roles → `learncode-ec2-role` → Add permissions →
   Attach policies → `CloudWatchAgentServerPolicy`. This is the managed policy
   for exactly this job (create log groups and streams, put events, set
   retention). No inline JSON needed. **Already attached to the live role as
   of 2026-09-13**; only a fresh instance needs this step.
2. **Get the files onto the instance.** Push to `dev` and let CI deploy, or from
   a Session Manager shell `sudo git -C /opt/learncode pull`.
3. **Run the setup** from Session Manager:
   ```bash
   sudo bash /opt/learncode/deploy/setup-cloudwatch.sh
   ```
   It installs the agent, `jq` and `logrotate`, starts the export unit, starts
   the agent from the repo's config, makes one health request and prints the
   last exported line plus the status of both services.
4. **Verify in AWS**, allowing about a minute: CloudWatch → Log groups →
   `/learncode/api` → a stream named after the instance. Then run the first
   Insights query above against that group.
5. **Tick the checklist item** in §8.

If the log group never appears, look for `AccessDenied` in
`/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log`; that means
step 1 has not taken effect.

**Reading the logs on the host** stays available regardless, and is quicker
for a live tail:

```bash
journalctl -u learncode-api -f -o cat                                  # live
journalctl -u learncode-api --since today -o cat | jq -c 'select(.level=="error")'
journalctl -u learncode-api --since today -o cat | jq -c 'select(.message=="request" and .durationMs>3000)'
```

### Alarms

One alarm is live since 2026-09-13, so a 5xx spike during the pilot is noticed
by a person being told rather than by a student:

| Piece | Value |
|---|---|
| Metric filter on `/learncode/api` | name `api-5xx`, pattern `{ $.status >= 500 }`, metric `LearnCode/Api5xx`, value 1, default 0 |
| Alarm `learncode-api-5xx` | Sum over 5 minutes >= 1, missing data treated as good |
| Notification | SNS topic `learncode-alerts`, email subscription confirmed |

Two console traps met while creating it: the filter name field picked up a
trailing space and the create failed with "Could not describe metric filter";
and the metric does not appear in the alarm's metric picker until a log line
has arrived after the filter exists, so create the alarm from the filter
itself (log group → Metric filters → select → Create alarm) rather than by
browsing metrics.

Not yet configured, in the order worth adding: Lambda error rate and
throttles for the two runners, and DynamoDB throttled requests.

---

## 8. Pre-pilot checklist

Run in order once the platform is live:

- [ ] Lambda runner deployed and smoke-tested (§2) — **the production code path
      has never executed before this**
- [ ] Both IAM policies attached (§3); confirm by changing a user's role in the
      admin panel and re-signing-in as that user
- [ ] `node scripts/seedBadges.js` — idempotent, safe to re-run
- [ ] `node scripts/seedUniversities.js` — **required once before signups open.**
      Idempotent (upserts by `code`). Without it the signup form has no
      university or department to offer and the Courses screen cannot group by
      semester
- [ ] `INSTRUCTOR_INVITE_CODE` set in the platform environment (§4). Leaving it
      unset is safe — `POST /api/auth/claim-instructor` returns 503 and instructor
      signup degrades to a student account — but no one can self-serve the
      instructor role until it is set
- [x] `node scripts/resetStreaks.js` — **required once.** Pre-S5.5 streak values
      are meaningless; run `--dry-run` first to see the count. Done 2026-09-13:
      4 users, 2 non-zero streaks cleared, second dry run reports 0 left.
- [ ] End-to-end smoke test as a real student: sign up with a university and
      department → enrol → open an exercise → **Run** without submitting → fail a
      submission → reveal a hint → pass → confirm XP, badge, and the confetti
      completion overlay
- [ ] S7 surfaces, as the same student: save a lesson note and find it on
      `/notes`; send a question from the lesson and confirm it reaches the
      instructor inbox and the reply comes back; check the course leaderboard and
      the profile activity heatmap render
- [ ] S7 instructor path: sign up at `/signup/instructor` with the invite code,
      sign in, and confirm the account really holds the `instructor` Cognito
      group (the role only lands in a freshly issued token)
- [ ] Confirm in DevTools that the lesson response contains **no**
      `expectedOutput` and no unrevealed hint text (S5.5 B1)
- [ ] Confirm a draft course 404s for a student account (S5.5 B4)
- [x] Ship the API logs to CloudWatch (§7) — done 2026-09-13.
- [x] Verify request logs are arriving in CloudWatch as JSON — log group
  `/learncode/api` visible with the instance stream, 2026-09-13.
- [x] Deep links return `200`, not `404` (§5 curl check) — rule replaced and
  verified 2026-09-13.
- [ ] Lighthouse accessibility on the authenticated screens. The public pages
  score 100 (2026-09-13, reports in `docs/lighthouse/`); the dashboard,
  lesson, notes, profile and admin screens need a logged-in run, e.g. Chrome
  started with `--remote-debugging-port=9222` while signed in, then
  `npx lighthouse <url> --port=9222 --only-categories=accessibility`.
- [ ] Atlas backups enabled; DynamoDB point-in-time recovery on
- [ ] Rotate the Atlas database password. The current one was printed into
  session transcripts twice before the seed scripts were changed to log only
  the host. **Deliberately deferred on 2026-09-13**: the transcripts are local
  files and Atlas Network Access limits connections to allow-listed IPs, so
  the exposure is judged low. Revisit if Network Access ever contains
  `0.0.0.0/0`, or before any wider rollout. Procedure: Atlas → Database Access
  → Edit Password; update `MONGODB_URI` in `/etc/learncode/secrets.env` and
  restart `learncode-api`; update local `server/.env`.
- [ ] Decide the pilot end date and diary the export: `node
      scripts/exportSubmissions.js` (anonymous by default)

---

## 9. Known gaps at S6

- **The API host runs Node 20, which reached end-of-life in April 2026** and so
  receives no further security patches. `deploy/setup-ec2.sh` pins `nodejs20`.
  Deliberately deferred during the 2026-08-12 deployment to avoid churn
  mid-setup; the AWS SDK also drops Node 20 in January 2027, which is a second
  reason to move. Upgrade path is `dnf install nodejs22`, repoint the
  `alternatives` symlink, re-run `npm ci --omit=dev --workspace server`, restart
  the unit — and update the pin in the setup script so a rebuild does not
  reintroduce it. The Lambda runner is unaffected (Node 24).

- **Thin client test suite.** Since 2026-09-13 the client has 20 Jest + React
  Testing Library tests (display helpers, `BadgeIcon`, the time-on-task hook)
  and CI runs them. No page-level component is tested; the production build
  remains the regression signal for those.
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

---

## 10. CI/CD — automatic deploys on push

Since the pipeline landed, a push to `dev` deploys the whole platform:

- **Client** — Amplify Hosting watches `dev` and rebuilds the SPA on every
  push by itself. Nothing to do; this predates the pipeline.
- **API** — the `deploy-api` job in `.github/workflows/ci.yml` runs **after**
  the server (lint + test) and client (lint + test + build) jobs pass, and only for
  pushes to `dev`. It assumes an AWS role via **GitHub OIDC** (no stored AWS
  keys), then uses **SSM Run Command** — the same channel as Session Manager,
  so no ports are opened and no SSH keys exist — to reset `/opt/learncode` to
  the exact commit that passed CI and run `deploy/update-ec2.sh`. The job
  fails loudly if the remote script fails or the API does not come back
  healthy, and finishes by curling the public CloudFront `/health` URL.
- **Lambda runners** — deliberately *not* in the pipeline. They change
  rarely; redeploy them by hand per §2, and re-run the credential probe
  (Challenge 13) whenever you do.

A PR, or a push to `main`, runs the lint/test/build gates only — no deploy.

### One-time setup (AWS Console + GitHub)

Everything below was designed for the Console (no local AWS CLI needed).

**A. Create the GitHub OIDC identity provider** (once per AWS account):

1. IAM → Identity providers → **Add provider** → OpenID Connect
2. Provider URL: `https://token.actions.githubusercontent.com`
3. Audience: `sts.amazonaws.com` → Add provider

**B. Create the deploy role:**

1. IAM → Roles → **Create role** → Web identity
2. Identity provider: `token.actions.githubusercontent.com`,
   audience `sts.amazonaws.com`
3. GitHub organization: `ANASTASIA-KESISI`, repository:
   `Interactive-learning-platform-using-MERN-and-AWS` (branch can stay blank;
   the workflow itself only deploys from `dev`)
4. Attach no managed policies; name it `learncode-github-deploy` → Create
5. Open the role → Permissions → **Create inline policy** → JSON, paste
   (replace `<INSTANCE-ID>` with the real instance id, e.g. `i-0abc…`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendDeployCommand",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:eu-west-1::document/AWS-RunShellScript",
        "arn:aws:ec2:eu-west-1:901864772557:instance/<INSTANCE-ID>"
      ]
    },
    {
      "Sid": "ReadCommandResult",
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

   The `SendCommand` statement is scoped to one instance and one document, so
   even a compromised workflow can only run shell commands on the API box —
   it cannot touch Lambda, Cognito, DynamoDB or any other instance.

6. Copy the role ARN
   (`arn:aws:iam::901864772557:role/learncode-github-deploy`).

**C. Wire up GitHub** (repo → Settings → Secrets and variables → Actions):

1. **Secrets** tab → New repository secret: name `AWS_DEPLOY_ROLE_ARN`,
   value = the role ARN from step B6
2. **Variables** tab → New repository variable: name `EC2_INSTANCE_ID`,
   value = the instance id (EC2 Console → Instances → `learncode-api` →
   Instance ID column)

**D. Verify:** push any commit to `dev` and watch Actions → CI/CD. The
`deploy-api` job prints the remote script's stdout (git SHA, npm install,
restart, health check) and ends with the public health probe.

Confirm the deploy actually landed by reading the live health endpoint:

```
curl -s https://d3n7zqt9fcw62k.cloudfront.net/health
```

`commit` must equal the pushed SHA, and `uptime` should be seconds rather than
days — together they prove the right code is running *and* that the service
really restarted.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy's repo filter does not match the repository |
| `AccessDeniedException` on `ssm:SendCommand` | Inline policy's instance ARN is wrong |
| `InvalidInstanceId`, or an empty `--instance-ids` | `EC2_INSTANCE_ID` saved under Secrets instead of Variables (`vars.` reads only the Variables tab). The job guards against the empty case with an explicit message. |
| Remote stderr shows `fatal: $HOME not set` | **SSM Run Command supplies no `HOME`**, unlike an interactive Session Manager shell — so a command verified by hand can still fail here. `git config --global` aborts and npm loses its cache directory. Both the workflow and `update-ec2.sh` now export `HOME=/root`; keep it that way. |
| Status stays `Pending` for the whole poll | SSM agent not running, or the instance lost its IAM role |
| `API did not answer /health within 180s`, but `/health` works moments later | `src/server.js` awaits the Mongo connection before `app.listen()`, so a slow Atlas handshake keeps port 4000 shut while the process is otherwise fine. Check the deployed commit in `/health` before assuming the deploy failed. |
| `could not build server_names_hash` | A `server_name` longer than ~32 chars overflows nginx's default bucket; the site config sets `server_names_hash_bucket_size 128` for exactly this reason. Do not remove it. |

**A red deploy does not mean the code did not ship.** `update-ec2.sh` installs
and restarts before it verifies, so a late failure can leave the new commit
live while the job reports failure. Always read `/health` before concluding
anything — `commit` is the ground truth.

### Manual deploy fallback

If GitHub is down or CI is misbehaving, deploy from a Session Manager shell:

```bash
sudo git -C /opt/learncode fetch origin dev
sudo git -C /opt/learncode reset --hard origin/dev
sudo bash /opt/learncode/deploy/update-ec2.sh
```
