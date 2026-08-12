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
