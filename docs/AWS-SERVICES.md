# AWS services used by LearnCode

What each AWS service does for the platform, what was created or configured on
it, how the code touches it, and what it cost in time to get right. This is the
service-by-service companion to `ARCHITECTURE.adoc`, which explains the layers,
and to `DEPLOYMENT.md`, which is the runbook and holds every identifier.

Everything lives in one region, `eu-west-1` (Ireland), in one account. All of
it was built through the AWS Console: the AWS CLI is not installed on the
development machine, and the only automation is the GitHub Actions deploy.

## At a glance

| Service | Role in the platform | What exists |
|---|---|---|
| Cognito | Identity: sign-up, sign-in, tokens, roles | One user pool, one app client, three groups |
| Amplify Hosting | Builds and serves the React client over HTTPS | One app on branch `dev`, one rewrite rule |
| EC2 | Runs the Express API | One `t3.micro`, Elastic IP, nginx, systemd unit |
| CloudFront | HTTPS in front of the API | One distribution, caching disabled |
| Lambda | Executes untrusted learner code | Two functions, one per language |
| DynamoDB | Learner progress and engagement events | One table, `userId` / `lessonId` |
| S3 | Media bucket | Configured, not used by any code path |
| CloudWatch | Logs, one metric, one alarm | Three log groups, `api-5xx` filter, `learncode-api-5xx` |
| SNS | Delivers the alarm | Topic `learncode-alerts`, one email subscriber |
| Systems Manager | Shell access and deploys without SSH | Session Manager, Run Command |
| IAM | Who may do what | One user, three roles, one OIDC provider |

External and not AWS, but part of the same picture: **MongoDB Atlas** holds all
content and user state, and **GitHub Actions** drives CI and the API deploy.

---

## Cognito — identity

**What it is.** A managed user directory that handles registration, email
confirmation, password storage, sign-in and token issuance, so the application
never sees or stores a password.

**Why.** FR1 requires authentication with role-based access control, and the
thesis explicitly rejects custom auth. Cognito issues standard JWTs, which lets
the API stay stateless: every request carries its own proof of identity and
role, and nothing about a session is held on the server (NFR2).

**What was created.**

| Item | Value |
|---|---|
| User pool | `eu-west-1_Spm4bEWSk` |
| App client | `1u36e3aa9ruk51v7eaetlpliqn`, public client without a secret, as browsers cannot keep one |
| Groups | `student`, `instructor`, `admin`, mapped one-to-one to the application roles |
| Attributes collected | email (the username), given name, family name |

**How the code uses it.**

- *Browser*: `client/src/services/cognito.js` uses `amazon-cognito-identity-js`
  for sign-up, confirmation code, and sign-in over SRP, so the password never
  leaves the browser in clear. The resulting ID token goes in the
  `Authorization` header of every API call.
- *API*: `server/src/middleware/requireAuth.js` verifies the token's signature
  against the pool's public JWKS and its issuer, then reads the
  `cognito:groups` claim. `requireRole` checks that claim against the route's
  permission matrix. The frontend's own role checks are only for UX; this is
  the enforcement point.
- *Role changes*: `server/src/services/authService.js` moves a user between
  groups with `AdminAddUserToGroup` and `AdminRemoveUserFromGroup`, clearing
  stale groups first. This is the only write the API ever makes to Cognito.
- *Instructor sign-up*: gated by an invite code held in MongoDB (seeded from
  the API's environment, managed from Admin → Settings), not in Cognito. A wrong code produces an ordinary student account rather
  than a failure.

**Worth knowing.**

- A role change takes effect on the user's next token refresh, because the
  group claim is baked into the token at issue time. The admin API says so in
  its response.
- Cognito sends confirmation emails itself. Its built-in sender has a daily
  limit of 50 emails per pool unless Amazon SES is configured, which it is
  not. A pilot cohort of 15 to 30 students signing up over a few days fits;
  a single-day sign-up event for a larger group would not.

---

## Amplify Hosting — the client

**What it is.** A static hosting service with a build pipeline attached to a
Git branch, a CDN and TLS included.

**Why.** The client is a single-page application compiled by Vite into static
files. Amplify builds them on every push and serves them from a CDN over
HTTPS with no server to maintain, which covers NFR4 for the client half with
zero operations work.

**What was created.**

| Item | Value |
|---|---|
| App, branch `dev` | `https://dev.d35i2f5rxki35f.amplifyapp.com` |
| Build spec | `amplify.yml` at the repository root, kept in version control |
| Environment variables | `VITE_API_BASE_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION` |
| Rewrite rule | Amplify's documented SPA regex, type `200`, target `/index.html` |

**How the code uses it.** It does not; Amplify is upstream of the code. The
build runs `npm ci` at the workspace root and `npm run build --workspace
client`, and publishes `client/dist`.

**Worth knowing.**

- The app must *not* be configured as a monorepo with `client` as its root.
  Installing from `client/package.json` alone cannot resolve the workspace.
- `VITE_*` values are inlined at build time. Changing one means a rebuild,
  not a restart.
- The default rewrite rule Amplify creates, `/<*>` with type `404-200`, does
  serve `index.html` for deep links, but with a 301 to a trailing slash and
  then a 404 status. Browsers render it and nobody notices; crawlers, uptime
  probes and Lighthouse see a broken page. It was replaced on 2026-09-13
  with the `200` rewrite (`DEPLOYMENT.md` §5 has the JSON and a curl check).

---

## EC2 — the API host

**What it is.** A virtual machine.

**Why.** The Express API is a long-running Node process that keeps a MongoDB
connection pool open and holds a few in-memory caches. A plain instance was
the shortest path to a working, debuggable server for a single-instance
pilot. Containers or serverless would add build and cold-start concerns for
no benefit at this scale.

**What was created.**

| Item | Value |
|---|---|
| Instance | `learncode-api`, `i-0a50301deb316080e`, `t3.micro`, Amazon Linux 2023 |
| Elastic IP | `18.203.8.24`, so the address survives a stop/start |
| Public DNS | `ec2-18-203-8-24.eu-west-1.compute.amazonaws.com`, used as the CloudFront origin |
| Security group | SSH only from the developer's home IP; port 80 reachable by CloudFront |
| Instance role | `learncode-ec2-role`, see IAM below |
| On the box | nginx on 80 proxying to Node on 4000; systemd unit `learncode-api`; secrets in `/etc/learncode/secrets.env`, root-owned, mode 600 |

**How the code uses it.** `deploy/setup-ec2.sh` provisions a fresh instance
(packages, service account, clone, unit, nginx site) and
`deploy/update-ec2.sh` is the per-deploy path CI runs. The unit file in
`deploy/` carries every non-secret setting, so the host holds nothing that
the repository does not.

**Worth knowing.**

- The instance still runs Node 20, which reached end of life in April 2026.
  The upgrade to 22 is a known, deferred item.
- nginx refuses a `server_name` longer than its default hash bucket, which an
  EC2 public DNS name exceeds. `server_names_hash_bucket_size 128` in the
  site config is not decorative.
- Configuration precedence in the API is real environment first, then the
  environment file. That was a bug fix: a checked-out `.env` once beat the
  unit's `NODE_ENV=production`.

---

## CloudFront — HTTPS for the API

**What it is.** A CDN that can also act as a plain TLS-terminating reverse
proxy.

**Why.** NFR4 demands HTTPS everywhere. The instance serves plain HTTP; putting
CloudFront in front gives a trusted certificate on a `*.cloudfront.net` name
with nothing to install or renew on the box. An Application Load Balancer
would do the same at a higher standing cost for one instance.

**What was created.**

| Item | Value |
|---|---|
| Distribution | `E20QDA6UFH1VN0`, `https://d3n7zqt9fcw62k.cloudfront.net` |
| Origin | The instance's public DNS name over HTTP; CloudFront refuses a bare IP |
| Cache policy | `CachingDisabled` |
| Origin request policy | `AllViewerExceptHostHeader` |
| Allowed methods | All, so writes reach the origin |
| WAF | Deliberately not attached |

**How the code uses it.** The client's `VITE_API_BASE_URL` points at the
distribution. The API sets `trust proxy` in production so `X-Forwarded-*`
headers from nginx and CloudFront are honoured by rate limiting.

**Worth knowing.** The defaults are wrong for an API and fail quietly. The
default cache policy would serve one learner's response to another; the
default origin request policy strips the `Authorization` header, so every
authenticated request would 401. Both were changed on day one. WAF was
declined because it carries a standing monthly cost and `express-rate-limit`,
helmet and Cognito already cover the threat model of a closed pilot.

---

## Lambda — the code runners

**What it is.** Functions that run on demand in an isolated micro-VM, billed
per invocation.

**Why.** FR2 requires executing learner-submitted code, and the one rule the
thesis sets in stone is that untrusted code never runs in the API process.
Lambda gives a fresh, AWS-isolated environment per invocation with a hard
timeout and no network path back into the platform. One function per language
keeps each runtime minimal and lets languages be added without touching the
others. The alternative, `isolated-vm` in-process, is the development adapter
only.

**What was created.**

| Function | Runtime | Config | Handler source |
|---|---|---|---|
| `learncode-runner-js` | Node.js 24 | 10 s timeout, 256 MB, handler `index.handler` | `server/runners/js/index.js` |
| `learncode-runner-py` | Python 3.14 | Same | `server/runners/python/index.py` |

Both were created through the Console from zips built by hand; `template.yaml`
at the repository root is the equivalent SAM definition, kept in step so a
later `sam deploy` cannot silently change a runtime. Each has the basic
execution role Lambda creates by default, which can write its own logs and
nothing else.

**How the code uses it.** `server/src/services/codeRunner/lambdaAdapter.js`
sends `{ code }` with `InvokeCommand` and reads back `{ stdout, stderr,
exitCode }`. The adapter is selected by `CODE_RUNNER_ADAPTER=lambda`, which
the systemd unit sets; the API fails closed if the variable is missing in
production. Python is registered only when `LAMBDA_RUNNER_PY_FUNCTION` is set,
so a host without that function refuses Python at dispatch with a 503 rather
than letting the call reach AWS.

**Worth knowing.**

- The pilot's content is JavaScript only. Python is deployed and verified but
  deliberately unused, so the cohort is not split across languages.
- Testing the deployed JavaScript runner found a sandbox escape that review
  had missed: `console.log.constructor('return process')()` reached
  `process.env`, and with it the execution role's temporary credentials. The
  handler now deletes every AWS credential variable before running learner
  code, in both languages, and the runbook keeps a probe to re-run after any
  redeploy. This is the single most citable security finding of the project.
- Deploying a runner is not enough; the invoke policy (IAM below) must name
  its ARN, in both identities, or the API gets `AccessDeniedException` while
  a Console test of the same function passes.

---

## DynamoDB — progress and engagement events

**What it is.** A managed key-value database with single-digit-millisecond
reads and writes at any scale, billed per request in on-demand mode.

**Why.** The thesis splits storage on purpose: content that is read often and
written rarely goes to MongoDB; events written on every interaction go to
DynamoDB. Every submission, hint reveal, run and note edit is a write, and
these are exactly the data the pilot's evaluation is built on, so they get a
store designed for write throughput.

**What was created.**

| Item | Value |
|---|---|
| Table | `learncode_progress`, on-demand capacity, encrypted at rest by default |
| Partition key | `userId` (string) |
| Sort key | `lessonId` (string) |
| Indexes | None |

The composite key answers both questions the application asks in one
round-trip: one learner's whole history (`Query` on `userId`) and one
learner on one lesson (`GetItem` on both keys).

**How the code uses it.** `server/src/dynamo/progressTable.js` is the only
module that talks to it, through the document client. `progressService`
writes `status`, `attempts`, `score`, `timeSpent`, `hintsUsed`,
`codeSubmissions[]`, `runs`, `questionsAsked` and `noteUpdatedAt`. Course
analytics read it with a filtered `Scan`, paginated, which is fine for a
30-learner pilot and would need a global secondary index on `lessonId` beyond
low thousands of items.

**Worth knowing.**

- The table was created in the Console during S4 and is not defined in code.
  Recreating the environment means recreating it by hand.
- Submitted code is stored on the item, capped in size and trimmed to a
  bounded history, because an item cannot exceed 400 KB.
- Point-in-time recovery is on the pre-pilot checklist and not yet confirmed.

---

## S3 — media bucket

**What it is.** Object storage.

**Why.** The design reserves it for lesson media and badge artwork.

**What was created.** The bucket name `learncode-media` is configured in the
API's environment and the backend IAM user holds S3 access.

**How the code uses it.** It does not, yet. `server/src/config/aws.js` builds
an S3 client that no service calls, and badge artwork ships inside the client
bundle under `client/public/badges/`. S3 is the one service in this document
that is provisioned in configuration but idle in practice. It stays in the
architecture because the design calls for it; the honest status is *reserved*.

---

## CloudWatch — logs, one metric, one alarm

**What it is.** The logging and monitoring service. Logs are stored in log
groups; a metric filter can count matching lines into a metric; an alarm
watches a metric and notifies.

**Why.** NFR3 and NFR6 make claims about latency and uptime that have to be
provable after the fact, and a pilot needs someone told when the API fails
rather than a student discovering it.

**What was created.**

| Item | Value |
|---|---|
| Log group `/learncode/api` | The API's structured JSON lines, one stream per instance, 90-day retention |
| Log groups `/aws/lambda/learncode-runner-js`, `/aws/lambda/learncode-runner-py` | Created automatically by Lambda |
| CloudWatch agent on the instance | Config in `deploy/cloudwatch-agent.json`, installed by `deploy/setup-cloudwatch.sh` |
| Metric filter `api-5xx` | Pattern `{ $.status >= 500 }` on `/learncode/api`, metric `LearnCode/Api5xx` |
| Alarm `learncode-api-5xx` | Sum of `Api5xx` over 5 minutes >= 1, missing data treated as good |

**How the code uses it.** `server/src/utils/logger.js` writes one JSON object
per line to stdout or stderr, and `server/src/middleware/requestLogger.js`
emits one per request with method, route, status, duration and role. What is
deliberately absent: request bodies, which carry learner source code; query
strings and tokens; and, since the logs started leaving the instance, the
client IP. The lines are JSON so Logs Insights can query fields directly; the
per-route latency query in `DEPLOYMENT.md` §7 is how NFR3 is checked.

**Worth knowing.**

- The CloudWatch agent reads files, not the systemd journal. Rather than
  redirect the API's stdout to a file, which needs a restart and blinds
  `journalctl`, a companion unit tails the journal into
  `/var/log/learncode/api.log` with a cursor file, and the agent ships that.
- systemd opens a unit's `StandardOutput=append:` target before it creates
  the directory `LogsDirectory=` declares, so on a fresh host that unit dies
  with `209/STDOUT` unless the directory exists first. The setup script
  creates it.
- A metric produced by a filter does not exist until a log line arrives after
  the filter is created, so the alarm cannot be built from the metric picker
  straight away. Create it from the filter instead.
- There are no dashboards, and the Lambda runners and DynamoDB have no alarms.

---

## SNS — delivering the alarm

**What it is.** A publish-subscribe messaging service; here, the thing that
turns an alarm state change into an email.

**What was created.** Topic `learncode-alerts` with one confirmed email
subscription. The `learncode-api-5xx` alarm publishes to it on entering the
alarm state.

**Worth knowing.** A subscription that is never confirmed from the email AWS
sends receives nothing, and the alarm gives no sign of it. It was confirmed on
2026-09-13.

---

## Systems Manager — access and deploys without SSH

**What it is.** A management service whose agent, pre-installed on Amazon
Linux, keeps an outbound connection to AWS. Through it, *Session Manager*
opens a browser shell on the instance and *Run Command* executes a script on
it, both without an open inbound port or an SSH key.

**Why.** The security group admits SSH only from one home IP, which also
blocks the Console's EC2 Instance Connect since that originates from AWS
ranges. SSM works from any network and leaves no keys anywhere.

**What was created.** Nothing to create; it needs the instance role to allow
the agent to register, which `learncode-ec2-role` does.

**How the code uses it.** The `deploy-api` job in `.github/workflows/ci.yml`
sends one `AWS-RunShellScript` command that resets `/opt/learncode` to the
tested commit and runs `deploy/update-ec2.sh`, then polls for the result and
prints the remote output. Concurrent deploys are serialised with `flock` on
the instance.

**Worth knowing.** Run Command executes as root with an almost empty
environment and no `$HOME`, unlike a Session Manager shell. `git config
--global` and npm's cache both break on that, so the deploy script exports
`HOME=/root` first. A command that works by hand can still fail here.

---

## IAM — who may do what

**What it is.** Identities and the policies attached to them.

**What was created.**

| Identity | Kind | Used by | Holds |
|---|---|---|---|
| `learncode-backend` | User with access keys | Local development, via `server/.env` | DynamoDB, S3, and the `learncode-runtime` inline policy |
| `learncode-ec2-role` | Role on the instance | The deployed API, the SSM agent, the CloudWatch agent | The same `learncode-runtime` inline policy, `AmazonSSMManagedInstanceCore`, `CloudWatchAgentServerPolicy` |
| `learncode-github-deploy` | Role assumed through GitHub OIDC | The CI deploy job | `ssm:SendCommand` scoped to one instance and one document, plus `ssm:GetCommandInvocation` |
| Lambda execution roles | One per function, created by Lambda | The runners | Write their own logs; nothing else |
| GitHub OIDC provider | Identity provider | Lets GitHub Actions assume the deploy role | No static AWS keys anywhere in GitHub |

The `learncode-runtime` policy grants `lambda:InvokeFunction` on the two
runner ARNs by name, not by wildcard, and the three Cognito group-management
actions on the user pool.

**Worth knowing.**

- The user and the role are two copies of the same policy, and updating one
  does not touch the other. Every new language runner means widening both.
- The account's root user was used for Console work throughout. A pilot
  run by one person on one account made a separate admin user a formality;
  a shared or longer-lived deployment should have one.
- The deploy role can run shell commands on exactly one instance and nothing
  else, so a compromised workflow could break the API but not reach Cognito,
  DynamoDB, Lambda or any other resource.

---

## Services deliberately not used

| Service | Why not |
|---|---|
| API Gateway | The thesis names it as a concept; Express middleware (helmet, CORS, rate limiting, JWT, RBAC) does the same job in-process with one fewer hop and no per-request cost |
| Application Load Balancer | One instance; CloudFront already terminates TLS. Needed the day a second instance exists |
| ECS, EKS, Elastic Beanstalk | Container orchestration for one Node process is overhead without benefit at pilot scale |
| RDS, DocumentDB | Content lives in MongoDB Atlas, chosen for the document model and its free tier |
| Route 53, ACM | No custom domain; the `*.amplifyapp.com` and `*.cloudfront.net` names carry AWS-managed certificates |
| SES | Cognito's built-in email suffices for a small cohort; see the daily limit above |
| WAF | Standing monthly cost for a closed pilot already behind Cognito and rate limiting |
| X-Ray, CloudWatch dashboards | Structured logs and Logs Insights cover what the pilot needs to observe |

## Cost shape

Nothing here is reserved or provisioned ahead of demand. The instance is the
one always-on charge; CloudFront, Lambda, DynamoDB on-demand, CloudWatch
ingestion and SNS bill by use and sit inside or near the free tier at pilot
volumes; Amplify bills build minutes and served bytes. There is no billing
alarm yet, and it is on the carried-forward list.
