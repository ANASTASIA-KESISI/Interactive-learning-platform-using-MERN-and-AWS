# CHALLENGES.md

A record of architectural decisions made during LearnCode development. Each
entry lists the options considered, their trade-offs, and the rationale for the
chosen path. Intended to:

1. Support the thesis methodology section (alternatives considered + rejected).
2. Help future contributors understand why the architecture is the way it is.
3. Make it easy to revisit a decision if its assumptions later change.

Add a new entry per non-trivial design decision. Keep entries factual — capture
what was discussed, not what looks best in hindsight.

---

## S3 — Interactive Coding Sprint

Decisions made at sprint kickoff (2026-04-26), before any S3 code was written.

### Challenge 1 — `CodeRunnerService` isolation strategy

**Problem.** The platform must execute untrusted JavaScript submitted by
students. Running it in the main Node.js process would expose `process.env`
(AWS keys, Cognito secrets, MongoDB URI), the file system, network, and the
ability to crash the API via `process.exit()` or pin a CPU with an infinite
loop. CLAUDE.md is explicit: *"never `eval` or execute untrusted code in the
main Node process"* (OWASP A03 Injection). The question is *how* to isolate.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **`isolated-vm`** (V8 isolates, in-process) | Fast (~10ms), tight memory + CPU limits, actively maintained, used in production by Cloudflare Workers | JavaScript-only; in-process so a V8 zero-day could break out (rare) |
| **Docker-per-submission** | Strongest isolation short of separate VMs (kernel-level boundaries); multi-language (any image) | Needs Docker daemon; 100–500ms container startup per submission; cleanup logic is real work; cgroup resource limits add friction |
| **AWS Lambda** | Strong AWS-grade isolation (Firecracker microVM); multi-language (Node, Python, Java, Go, .NET, Ruby + custom runtimes); scales horizontally for free | 200ms–2s cold starts; adds a deploy pipeline; per-invocation cost (free tier covers pilot but adds up at scale) |
| ~~**vm2**~~ | (was the de-facto Node sandbox) | **Deprecated 2023.** Multiple sandbox-escape CVEs (CVE-2023-29017, -29199, -30547). Author concluded the design is fundamentally unsound and stopped maintenance. CLAUDE.md mentioned it before this decision; that reference has been removed. |

**Decision.** AWS Lambda for production + a separate dev adapter for local
iteration. Multi-language support was the deciding factor — the user wanted
Python (and possibly more) as a future option, which rules out `isolated-vm`
(JS-only) and pushes against single-process options in general.

**Rationale.** Even though the pilot is JS-only (see Challenge 2), the runner
interface needs to *not foreclose* multi-language support. Lambda is the only
option that gives multi-language out of the box without us building a Docker
pipeline. The cost question (free tier easily covers the pilot — ~6 000
invocations against a 1 000 000-request/month free quota) and the cold-start
question (200ms–1s on first call after idle, <50ms thereafter) were both
weighed and accepted as tolerable for the pilot.

**Sidebar — Docker for *deployment* vs Docker for *sandboxing*.** The user
correctly observed that the platform will likely use Docker for *deployment*
(packaging the Express API as a container image for EC2/Fargate/Amplify). That
is a different decision from using Docker for the sandbox. Using Docker to
deploy doesn't make Docker-for-sandbox "free": the API container would have
to either run a Docker daemon inside itself (Docker-in-Docker, fragile) or
mount the host's Docker socket (one sandbox escape = full host compromise —
worse than vm2). Managed AWS compute (ECS Fargate, Amplify) doesn't expose the
Docker socket at all, so adopting Docker-for-sandbox would also constrain the
deploy target. The two decisions are independent.

**Sidebar — Is Lambda free?** For the pilot, effectively yes. AWS Lambda has
an *always-free* tier of 1M requests/month + 400 000 GB-seconds of compute.
A 30-student pilot doing ~50 runs per student per week over 4 weeks ≈ 6 000
invocations — a tiny fraction of free tier. Cost is not the deciding factor in
either direction.

---

### Challenge 2 — Language scope for the pilot

**Problem.** `SOLUTION_SKETCH.md` §10 left this open: *"the thesis mentions
JavaScript for the pilot modules; is Python a stretch goal?"* The answer
informs Challenge 1 (single-language tools become viable if the answer is
"JS only forever") and the Lambda topology in Challenge 4.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **JavaScript only** | Simpler implementation; single Monaco language mode; one Lambda runner; aligns with thesis Chapter 4 default | Forecloses Python without future schema change |
| **JS + Python from day 1** | Wider learner appeal | Doubles the runner deploy artifacts; adds a language enum and authoring UI complexity; bandwidth cost in S3 |
| **JS now, language abstraction left open for later** | Lean S3 scope; preserves Python as future work | Needs a `lessons.language` schema field to be added now (cheap) |

**Decision.** JavaScript only for the pilot. `lessons.language` enum added
to the schema now (default `"javascript"`) to keep the abstraction in place.
Adding a language later is: extend the enum + deploy `runner-<lang>` Lambda +
register it in `lambdaAdapter.js`.

**Rationale.** Aligns with the §10 default and the thesis's Chapter 4 wording.
S3 bandwidth is finite and the pilot evaluation (SUS + DynamoDB metrics)
doesn't depend on language coverage. The `language` field plus per-language
Lambda topology (Challenge 4) make the future expansion cheap.

---

### Challenge 3 — Local development experience for the Lambda runner

**Problem.** Lambda gives strong production isolation but adds friction for
laptop development. Calling real Lambda from a developer's machine requires
AWS credentials, deployed function, and IAM permissions just to test the lesson
page — too much friction for daily iteration.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **AWS SAM Local** (`sam local invoke`) | Full prod parity; runs Lambda inside a local Docker container | Requires Docker on the dev machine; ~1s container spawn per invoke |
| **LocalStack** | Emulates the entire AWS surface locally | Heavier setup; mocks introduce their own divergence risks |
| **Dual adapter** — `CodeRunnerService` exposes one interface; dev impl runs in-process, prod impl invokes Lambda; selected via env var | No Docker on laptop; sub-millisecond invocations in dev; clean swap point | Two implementations to maintain; small risk of dev/prod divergence in behaviour |

**Decision.** Dual adapter behind a single `CodeRunnerService` interface.
Selected at boot by `CODE_RUNNER_ADAPTER` env var (defaults to `dev` outside
production).

**Rationale.** Mirrors the Sketch §9 mitigation already used for Cognito
("auth logic stays in a single AuthService adapter so a future migration
touches one module"). The narrow interface (`run(code, language) →
{stdout, stderr, exitCode, durationMs}`) is the only contract the rest of the
platform sees. The thesis defence story is clean: production uses Lambda's
microVM isolation; the dev adapter is for iteration speed only and is not
relied on for security. The dev adapter implementation discussed at sign-off
was `isolated-vm` (V8 isolates, JS-only).

---

### Challenge 4 — Lambda function topology: per-language vs single router

**Problem.** With Lambda chosen as the prod runner (Challenge 1) and a future
multi-language path open (Challenge 2), there are two ways to organise the
Lambda functions.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Per-language functions** (`runner-js`, `runner-py`, …) | Smaller deploy artifacts; language-specific runtime config (Node 22 vs Python 3.13); independent IAM; cold start scoped per language | One IAM/SAM resource per language; n functions to deploy |
| **Single router Lambda** (Node Lambda that shells out to interpreters bundled in the deployment) | Single deploy artifact; one cold-start cohort | We're back to managing a multi-language sandbox inside Lambda — defeats half the reason for picking Lambda; bigger zip; runtime version trade-offs |

**Decision.** Per-language Lambdas. Pilot ships with just `learncode-runner-js`.

**Rationale.** Each language's runner is independently deployable and scalable;
no shared blast radius. The single-router option re-introduces the
"manage interpreters yourself" complexity that Lambda was supposed to remove.

---

### Challenge 5 — Lambda deployment tooling

**Problem.** Need a way to deploy Lambda functions reproducibly. Options vary
from "official AWS, simple YAML" to "general-purpose IaC".

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **AWS SAM** | Official AWS; YAML config (~30 lines for one function); `sam build && sam deploy`; good thesis story ("AWS-native serverless tooling") | Locked to CloudFormation under the hood (slower than direct API for some ops) |
| **AWS CDK** | Programmable IaC in TypeScript/Python; more powerful for complex infra | Heavier; JavaScript build step before deploy |
| **Serverless Framework** | Multi-cloud; popular | Third-party tool; less direct AWS integration |
| **Terraform** | Multi-cloud, mature | Requires a state backend; more verbose for a small Lambda |
| **Manual zip + upload** | Zero tooling | No reproducibility; not acceptable beyond a one-off test |

**Decision.** AWS SAM. `template.yaml` lives at the repo root; runners live
in `server/runners/<lang>/`.

**Rationale.** Lowest tooling overhead for the smallest defensible footprint.
Easy to write up in the thesis methods section. CDK would be over-engineering
for the current scope; Terraform would make the project multi-tool when it
doesn't need to be.

---

## S5.5 — Hardening Refactor Sprint

Decisions made during the pre-deployment hardening sprint (2026-08-12), which
was inserted between S5 and S6 after a full-codebase review. Findings and
implementation record live in `REFACTOR.md`.

### Challenge 6 — Dev-adapter implementation: `isolated-vm` vs Node `vm`

**Supersedes the implementation half of Challenge 3.** Challenge 3's decision
(dual adapter behind one interface, selected by env var) stands unchanged; only
the dev implementation named there is out of date.

**Problem.** Challenge 3 recorded `isolated-vm` as the dev-side sandbox at S3
sign-off. During S3 implementation `isolated-vm` proved to need a C++ build
toolchain (node-gyp, MSVC build tools) that the development machine —
Windows 10 — does not have. The choice was: install and maintain the toolchain,
drop the dev adapter and require AWS credentials for all local work, or
substitute a different in-process mechanism.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Install the Windows C++ toolchain for `isolated-vm`** | Matches the signed-off decision; real memory/CPU limits in dev | Multi-GB toolchain install; native rebuilds on every Node upgrade; fragile for anyone cloning the repo on Windows |
| **Node built-in `vm`** | Zero dependencies, no native build; adequate to capture `console.log` and apply a wall-clock timeout | **Not a sandbox** — `console.log.constructor('return process')()` escapes to `process.env`; synchronous, so an infinite loop blocks the event loop for the whole timeout |
| **Drop the dev adapter; always call Lambda** | Full dev/prod parity | Every laptop edit-refresh cycle needs deployed infra + credentials; the friction Challenge 3 existed to remove |

**Decision.** Node built-in `vm` for the dev adapter. The same mechanism is used
inside `server/runners/js/index.js`, where Lambda's Firecracker microVM — not
`vm` — is the actual security boundary.

**Rationale.** Challenge 3 already established that the dev adapter is an
iteration-speed tool and is *not* relied on for security; production isolation
is Lambda's job. Given that, the difference between `isolated-vm` and `vm` in
dev is developer ergonomics, and `vm` wins on setup cost. The thesis defence
story is unchanged: production untrusted code runs in per-language Lambdas.

**Consequence (and why this entry matters).** Because the dev adapter is not a
boundary, the *adapter selection* becomes security-critical. The S3 code chose
`dev` whenever `NODE_ENV !== 'production'`, so a single missing environment
variable on a deployed host would have run student code inside the API process
with `process.env` reachable (AWS keys, Mongo URI).

S5.5 first added a boot guard keyed on `env.isProduction`. Validating it
revealed that guard could not fire: `config/env.js` loaded `server/.env` with
`override: true`, so a checked-out dev file beat host-injected variables and
`NODE_ENV=production node src/server.js` resolved to `"development"`. The fix
is two-layer, and the ordering of the two matters:

1. **Environment precedence** — load the more specific `.env` first and drop
   `override`, so precedence is real environment > `server/.env` > root `.env`.
   The deployment platform is authoritative again (this also unblocked
   platform-injected `MONGODB_URI`, AWS credentials and `PORT`).
2. **Fail-safe selection** — do not key adapter choice on `NODE_ENV` alone,
   because a host that never sets it leaves `isProduction` false and the guard
   mute. `dev` is opt-in only; unset, empty or unrecognised values resolve to
   `lambda`. A missing variable can then only fail *safe*, and the worst case
   is a loud Lambda error rather than a silent security downgrade.

The general principle worth carrying forward: when a configuration value
selects between a secure and an insecure code path, the insecure one must
require explicit opt-in. Defaulting to it and guarding the default is strictly
weaker, because the guard depends on yet another variable being correct.

---

### Challenge 7 — Where exercise answers live

**Problem.** `GET /api/lessons/:id` and `GET /api/courses/:id` returned whole
lesson documents, so `expectedOutput` and every hint reached the browser. The
hint-reveal endpoint existed but only logged an analytics event — the client
rendered hints from the already-downloaded array. Pilot subjects are MSc
students; reading the answer out of the network tab and passing with
`console.log("<answer>")` is trivial, and it corrupts exactly the metrics
(pass rate, attempts, hint usage) that H1 is evaluated on.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Obfuscate / hash `expectedOutput` client-side** | No API change | Security theatre; comparison logic would still be client-visible |
| **Keep hints client-side, strip only `expectedOutput`** | Smaller change; hint reveal stays instant with no network round-trip | Hint text is still the answer for most scaffolded exercises; hint-usage analytics stay gameable |
| **Serve neither; hints only via the reveal endpoint** | Answers never leave the server; the reveal endpoint becomes load-bearing rather than decorative, so the analytics event cannot be bypassed | One round-trip per hint; needs a separate authoring endpoint; revealed hints must be re-served after a refresh |

**Decision.** Withhold both. The learner payload carries `hintCount` plus
`revealedHints` (the hints that learner has already unlocked, replayed from
their DynamoDB progress record); hint text is otherwise obtainable only from
`POST /api/lessons/:id/hint`. Authoring reads through a new ownership-gated
`GET /api/instructor/lessons/:id`.

**Rationale.** Scaffolding is a pedagogical mechanism the thesis measures, not
just a UI affordance — so the reveal has to be a server-recorded event that
cannot be skipped. Replaying already-revealed hints keeps that honest without
punishing a refresh, and pairs with the S5.5 A2 fix that made the reveal count
idempotent (`max(current, hintIndex + 1)` rather than an increment).

**Sidebar — why the lesson projection is security, not performance.** The
course-tree populate now selects `title type order xpReward language`. It reads
like an optimisation and does cut payload size, but its primary job is
preventing the same answer leak one level up, via the course endpoint.

---

### Challenge 8 — Bounding the DynamoDB progress item

**Problem.** `progress` items append one entry to `codeSubmissions[]` per
attempt, storing raw stdout. A DynamoDB item is hard-capped at 400KB. A learner
printing inside a loop, or simply grinding many attempts, can push their own
item past that ceiling — after which every subsequent write for that lesson
fails and their progress silently stops being recorded, mid-pilot.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Truncate + cap in the item** | Keeps the single-round-trip access pattern from the data model; no new infrastructure | Loses full submission history beyond the window |
| **Move submissions to their own table** (PK `userId#lessonId`, SK timestamp) | Unbounded history; no item-size ceiling | A second table and a second query for every progress read; over-built for a 2–4 week pilot |
| **Write submissions to S3, keep pointers in Dynamo** | Cheap, unbounded | Extra round-trip and lifecycle management for data nobody has committed to analysing |

**Decision.** Truncate stored stdout to 2KB and error text to 1KB, and window
`codeSubmissions` to the most recent 20. `attempts` remains the true lifetime
count, so the metrics that feed the evaluation are unaffected.

**Rationale.** The evaluation uses attempts, completion, hint usage and time —
all scalars that survive windowing. The full transcript is a debugging
convenience, not a thesis input. If per-submission analysis is wanted later,
the separate-table option is the upgrade path and does not disturb the
progress item's shape.

**Open item.** The Sketch's `codeSubmissions[]` implies the submitted *code* is
stored; it never has been. Storing a truncated `code` field is a decision that
must be made **before** the pilot — it cannot be reconstructed after the fact.

---

### Challenge 9 — Retaining learner source code, and at what identifiability

**Problem.** `codeSubmissions[]` recorded the *outcome* of each attempt
(`passed`, `stdout`, `error`) but never the source the learner submitted, even
though `SOLUTION_SKETCH.md` §5 and `CLAUDE.md` both read as though it did. That
makes every analytics number a symptom with no cause: a lesson showing a 30%
pass rate over 8 attempts per learner could equally be conceptually hard, or an
`expectedOutput` that fails on a missing comma. Aggregates cannot distinguish
the two, and the instructor analytics screen says as much in its own subtitle
("*Higher values may indicate the lesson needs scaffolding tweaks*").

This decision was time-boxed to before the pilot: every other data-quality
issue found in the S5.5 review was repairable after the fact, but code text
that was never captured cannot be reconstructed without re-running the study.

**Options considered — whether to store it:**

| Option | Pros | Cons |
|---|---|---|
| **Don't store it** | Nothing to justify in the ethics protocol; smallest items | Forecloses misconception analysis, exercise-brittleness diagnosis, and any evidence that a hint changed behaviour; unrecoverable |
| **Store truncated code per attempt** | Turns aggregate symptoms into diagnosable causes; supplies the qualitative half of a mixed-methods evaluation that §3.8 already leans on for triangulation; ~5 lines | Grows the item (bounded); becomes personal data in a research study |
| **Store full keystroke/edit history** | Richest possible trace of the learning process | Genuinely invasive; needs client instrumentation; far past what the pilot's questions require |

**Decision.** Store the submitted source, truncated to 4KB, inside the existing
progress item, alongside a new `hintsUsedAtSubmit` snapshot on each entry.

**Options considered — at what identifiability:**

| Option | Pros | Cons |
|---|---|---|
| **Fully anonymous** (separate store, no learner key) | Outside GDPR scope; simplest consent story | Destroys per-learner sequencing — cannot compare an attempt before a hint reveal with the one after, and cannot tell one learner's 20 attempts from 20 learners' single attempts |
| **Pseudonymous at rest, anonymous on export** (kept under the opaque ObjectId; export emits tokens and no mapping) | Retains trajectory analysis; no new store; nobody using the product can attribute code to a person; the analysed dataset has no route back to an identity | The live table is still keyed by `userId`, so the store itself is pseudonymous |
| **Identified in the researcher export** | Joinable to SUS responses and demographics | Requires the consent form to state the researcher can attribute submissions |

**Decision.** Pseudonymous at rest, anonymous on export. Code stays in the
progress item, whose partition key is already an opaque Mongo ObjectId rather
than a name or email — the application needs that key to serve a learner their
own progress, so pseudonymity at rest is unavoidable. No read surface pairs a
submission with an identity: `getStudentProgress` drops the transcript
entirely, and `scripts/exportSubmissions.js` substitutes stable `learner-NN`
tokens and writes **no** token→userId mapping unless explicitly asked
(`--with-key`). The analysed dataset is therefore anonymous. Export paths are
gitignored either way.

**Rationale.** The deciding factor was `hintsUsedAtSubmit`. H1 is a claim about
scaffolding, and the strongest available evidence for it is that a hint reveal
measurably changed what the learner wrote next — which requires linking
consecutive attempts to the same person. Full anonymity would have bought a
cleaner consent story at the cost of the analysis the data was being collected
for. Pseudonymity keeps the linkage while ensuring the platform itself can
never attribute code to a student.

**Governance position (decided 2026-08-12).** No separate participant consent
form. LearnCode operates as university teaching infrastructure, and submission
data is processed on the same basis as any other coursework the institution
holds; anonymity of the analysed dataset is the control relied upon. Recorded
here because the thesis methods section should state the basis it operated
under, whatever that basis is.

**Consequences to act on:**

- **The exported dataset is anonymous by default.** `exportSubmissions.js`
  writes tokens only and emits no token→userId mapping unless `--with-key` is
  passed. This costs the analysis nothing — tokens still link one learner's
  attempts to each other, which is all the trajectory and before/after-hint
  comparisons require. A mapping is only needed to identify a specific
  student, so it is opt-in and, when generated, is personal data.
- **Stored data remains pseudonymous, and cannot be otherwise.** The progress
  table is keyed by `userId` because the application needs it to serve a
  learner their own progress. The distinction worth keeping straight: the
  *store* is pseudonymous by necessity, the *research dataset* is anonymous by
  default.
- Code content can be self-identifying regardless of keys (a student who writes
  `// Maria's attempt`). Screen for this before quoting any extract in the
  thesis; it is not something the storage layer can solve.
- Any future instructor-facing view of submissions must render tokens, not
  names — the pedagogical uses (spotting broken exercises, misconception
  clusters, hint quality) all work fully anonymised.

**Sidebar — Scan pagination.** Storing code makes progress items materially
larger, which brings the table within reach of DynamoDB's 1MB Scan page limit.
`scanByLessonIds` previously issued a single `ScanCommand` and ignored
`LastEvaluatedKey`, so it would have silently returned partial results and
understated the instructor analytics. Both scans now page to exhaustion.

---

## S6 — Admin + Deploy Sprint

Decisions made during the final roadmap sprint (2026-08-12).

### Challenge 10 — Where application roles actually live

**Problem.** `PATCH /api/admin/users/:id/role` wrote `role` to Mongo and looked
like it worked, but `requireAuth` derives the role from the `cognito:groups`
JWT claim and `syncUserFromClaims` mirrors that back into Mongo on every
request. The write therefore survived until the user's next call and no further
(S5.5 finding A3). Something had to become authoritative.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Mongo is authoritative; stop syncing role from the claim** | No AWS calls; role changes take effect instantly | Contradicts "delegate identity to Cognito" (CLAUDE.md); two systems disagree about who is an admin; a Cognito group grant would silently do nothing |
| **Cognito is authoritative; admin writes move group membership** | One source of truth; group membership is visible and auditable in the Console; matches the S1 design | Needs extra IAM permissions; change is not instant — it lands on the user's next token refresh |
| **Dual-write and reconcile** | Instant locally, eventually consistent | Two writers to the same fact; reconciliation logic is a bug farm for no real gain at pilot scale |

**Decision.** Cognito is authoritative. `authService.setUserRole` calls
`AdminListGroupsForUser`, removes any *other* application-role group, then
`AdminAddUserToGroup` for the target role; the Mongo write only refreshes the
mirror.

**Rationale.** The alternative asks the platform to disagree with its own
identity provider. Removing stale groups first is not incidental: `resolveRole`
returns the highest-privilege group a user holds, so demoting an admin while
leaving them in the `admin` group would appear to succeed and change nothing.

**Consequences.** The backend IAM identity needs `cognito-idp:AdminAddUserToGroup`,
`AdminRemoveUserFromGroup` and `AdminListGroupsForUser` (`DEPLOYMENT.md` §3) —
without them the endpoint fails with an AWS authorization error rather than
silently doing nothing, which is the better failure. The admin UI states plainly
that a change lands on the user's next sign-in, because existing access tokens
keep the old claim until they expire. Admins cannot change their own role, so a
sole admin cannot lock themselves out.

---

### Challenge 11 — What to do with progress records when content is deleted

**Problem.** S6 added module and lesson deletion (deferred from S5). Learner
progress in DynamoDB is keyed by `lessonId`; deleting a lesson leaves records
pointing at content that no longer exists.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Cascade-delete the progress records** | No orphans; dashboard denominators stay exact | Destroys pilot research data to tidy up a content edit; a mid-pilot deletion would silently rewrite the evaluation's history |
| **Retain them** | The record of what learners actually did is preserved | Orphaned records slightly skew the learner's own dashboard completion rate |
| **Block deletion once a lesson has progress** | No orphans and no data loss | Requires a Scan per delete (no GSI on `lessonId`); makes instructors fight the tool to fix a typo'd lesson |

**Decision.** Retain the progress records. Deleting a module removes its lessons
from MongoDB; DynamoDB is untouched.

**Rationale.** These records are the pilot's evidence. An instructor tidying
content in week 3 should not be able to alter what the evaluation says happened
in week 2. The cost is confined and small: `getCourseAnalytics` only aggregates
lessons that still belong to the course, so instructor analytics are unaffected;
only the learner's personal completion-rate denominator drifts, and only if
content they touched was later deleted.

**Sidebar — dense ordering.** `addModule`/`addLesson` derive the next `order`
from the array length, so a deletion that left a gap would hand the next new
item an order that collides with an existing one. Both delete paths renumber the
survivors.

---

### Challenge 12 — Request logging format

**Problem.** CLAUDE.md requires structured JSON logs so CloudWatch Logs Insights
can query them, but the API used `morgan('combined')`, which emits a single
opaque string per request. Insights can only regex over that.

**Decision.** Replaced morgan with `middleware/requestLogger.js`, built on the
existing `utils/logger` JSON emitter. Fields: method, route path, status,
duration, caller role, IP. Log level derives from the status class so 5xx lands
on stderr. `morgan` was removed from the dependencies.

**Rationale.** `fields @timestamp, path, durationMs | stats avg(durationMs) by
path` is the NFR3 (<3s interactions) check, and it needs real fields. Request
bodies, query strings and the `authorization` header are deliberately excluded —
bodies carry learner source code.

**Sidebar — `trust proxy`.** Behind an ALB or Amplify the client address arrives
in `X-Forwarded-For`; without `app.set('trust proxy', 1)` every request appears
to originate from the proxy, which would bucket the entire user base into one
rate-limit key and log the wrong address. Enabled in production only, since the
header is forgeable when there is no proxy in front.

---

### Challenge 13 — Credentials inside the code-runner sandbox

**Found by testing, not review.** The first end-to-end invocation of the
deployed `learncode-runner-js` (2026-08-12, immediately after the Console
deploy) included a deliberate escape probe. It succeeded.

**Problem.** `vm` is not a sandbox — student code reaches the real global object
through any constructor it can see:

```js
console.log.constructor('return process.env')()
```

Run against the live Lambda, that returned the full environment, including the
execution role's temporary credentials (`ASIA…` key id plus an
`AWS_SESSION_TOKEN`, i.e. STS credentials belonging to the function itself, not
the `learncode-backend` IAM user).

**What was and was not compromised.** The microVM boundary held: the escape
reached the *inside of the disposable sandbox* and no further — not the API
host, MongoDB, DynamoDB, S3, or the backend's IAM keys. The leaked credentials
carry only `AWSLambdaBasicExecutionRole`, so the realistic worst case is a
student writing junk into one CloudWatch log group. The architecture behaved as
Challenge 1 and Challenge 6 said it would; what was wrong is that a credential
was sitting inside the blast radius with no reason to be there.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| **Harden the `vm` context against known escapes** | No infrastructure change | Whack-a-mole against a mechanism Node's own docs say is not a security boundary; every hardening is one new constructor away from being bypassed |
| **Scrub the credential variables before executing** | Removes the target rather than chasing the route; 4 lines; the handler calls no AWS service so nothing legitimate breaks | Does not stop a student reaching anything else in the sandbox (network egress, `/tmp`) |
| **Run the Lambda in a VPC with no NAT gateway** | Kills outbound network entirely — no exfiltration, no calling out | Extra infrastructure; cold starts grow with ENI attachment; overkill for a 15–30 person pilot |

**Decision.** Scrub `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_SESSION_TOKEN` and `AWS_SECURITY_TOKEN` from `process.env` at the top of
every invocation. Per-invocation rather than once at cold start, because Lambda
re-injects refreshed credentials into the environment of a warm container.

**Rationale.** The threat is not "student reads an environment variable", it is
"student obtains a usable AWS credential". Deleting the credential addresses the
threat directly and cannot be routed around by a cleverer escape, whereas
hardening `vm` can. This is defence in depth *behind* the real boundary, not a
replacement for it — the security story remains "Lambda's microVM isolates
untrusted code", exactly as at S3.

**Residual risk, accepted for the pilot.** Escaped code still has ordinary Node
capabilities inside the sandbox: outbound HTTP and `/tmp`, bounded by the 10s
function timeout and 256MB. For a small academic pilot with identified
participants this is proportionate. If the platform were ever opened to
anonymous users, the VPC-without-NAT option above is the next control to add.

**Lesson for the write-up.** This is worth a paragraph in the thesis security
chapter: a design can be correct and still ship an avoidable weakness, and it
was a five-line adversarial test against the *deployed* system — not code
review, which had passed this file twice — that surfaced it.

---

### Challenge 14 — Python support, and why it stays out of the pilot

**Supersedes the scope half of Challenge 2.** That entry decided JavaScript-only
for the pilot and recorded the cookbook for adding a language. This entry
executes the cookbook and separates two things Challenge 2 conflated: what the
*platform* supports, and what the *pilot* teaches.

**Problem.** With `learncode-runner-js` deployed and verified end to end
(2026-08-12), the per-language Lambda topology stopped being a claim and became
something testable. The question was whether to demonstrate it.

**Decision — platform: supported.** `python` is now in `Lesson.LESSON_LANGUAGES`
and the instructor editor, with `server/runners/python/` and a
`learncode-runner-py` function on the Python 3.13 runtime.

**Decision — pilot content: JavaScript only, unchanged.**

**Rationale for the split.** The constraint is methodological, not technical.
The pilot has 15–30 participants and §3.8 already concedes limited statistical
power. Splitting that cohort across two languages introduces a second variable
into a study designed to isolate the effect of scaffolding (H1) and gamification
(H2): hint usage, completion rate and time-on-task would then vary partly by
language, and neither half of a split cohort would be large enough to say much.
Keeping the pilot single-language while shipping multi-language capability gives
the Chapter 7 future-work claim something demonstrable behind it — the
architecture generalises, and here is a second runtime proving it — without
contaminating the data the thesis rests on.

**Implementation notes worth keeping:**

- **The credential scrub was ported, not assumed.** `exec` in Python is no more
  a sandbox than Node's `vm`; student code can reach `os.environ` and would
  have found the execution role's STS credentials exactly as Challenge 13
  found them on the JS runner. The Python handler scrubs the same four
  variables per invocation.
- **`BaseException`, not `Exception`.** Student code calling `sys.exit()` or
  `exit()` raises `SystemExit`, which derives from `BaseException`. Catching
  only `Exception` would let it escape and fail the whole invocation instead of
  being reported as a failed submission.
- **Timeout via `signal.alarm`**, mirroring the JS runner's 5s script guard,
  which sits inside the 10s function timeout.
- **Output normalisation.** `print()` appends a newline; the handler strips the
  trailing one so stdout matches the JS runner's line-joining, since the
  orchestrator compares both against the same `expectedOutput` field.
- **Dispatch is gated on configuration.** `python` is registered in
  `lambdaAdapter.FUNCTION_NAMES` only when `LAMBDA_RUNNER_PY_FUNCTION` is set,
  so a host without the function deployed refuses Python at dispatch with a
  clear message rather than surfacing an AWS `ResourceNotFoundException`.
- **Dev mode routes non-JavaScript to Lambda.** The in-process adapter is Node
  `vm` and cannot run Python. The alternative — shelling out to a system
  `python3` — would execute untrusted code on a developer's machine with no
  isolation whatsoever, which is worse than anything this architecture has
  accepted so far.
- **The IAM invoke policy must be widened.** It scopes
  `lambda:InvokeFunction` to the JS function ARN; Python fails with
  `AccessDeniedException` until the new ARN is added.

**Validation is unchanged and language-agnostic** — a whitespace-normalised
stdout comparison. Adding a language needed no validator work, which is the
clearest evidence the S3 interface boundary was drawn in the right place.

---

## How to add a new entry

When making a non-trivial decision, add a `### Challenge N — <topic>` section
with:

- **Problem.** What forced the decision; what's at stake.
- **Options considered.** Table or list with pros/cons.
- **Decision.** The chosen option in one sentence.
- **Rationale.** Why this one beats the others *given current constraints*.
- **Sidebars** (optional) for related questions/clarifications that don't
  themselves rise to "challenge" status.

Avoid revising past entries in place. If a decision is overturned later, add
a new entry that links back ("Supersedes Challenge N") and explains what
changed in the assumptions.
