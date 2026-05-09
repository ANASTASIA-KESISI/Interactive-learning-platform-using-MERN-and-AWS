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
