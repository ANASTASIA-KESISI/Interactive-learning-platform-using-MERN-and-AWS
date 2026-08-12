# LearnCode — Solution Sketch

A condensed, implementation-oriented blueprint for the LearnCode platform. Derived from Chapters 3–4 of the thesis. Paired with `CLAUDE.md` (which is written for AI assistants) — this file is written for human engineers planning the build.

---

## 1. Problem & Goals

**Problem.** Existing LMSs (Moodle, Canvas, Blackboard) provide institutional control and RBAC but lack embedded code execution, real-time feedback, and fine-grained engagement analytics. Commercial platforms (Codecademy, LeetCode) offer great interactive coding but are closed ecosystems with no institutional customization.

**Goal.** Build a cloud-native, full-stack platform that combines *both*:
- Institutional control (roles, data ownership, on-prem-grade auth)
- Interactive pedagogy (embedded editor, scaffolded hints, formative feedback, gamification)
- Learning analytics (engagement metrics ready for empirical evaluation via SUS + DynamoDB data)

**Non-goals (for the MSc scope).**
- Multi-tenant SaaS
- Mobile native apps
- Real-time collaborative editing
- AI tutor / LLM-driven feedback (listed as future work in Chapter 7)

---

## 2. Pedagogical Principles (drive architecture decisions)

Three concepts are operationalized as platform features, not just content:

1. **Scaffolding** (Vygotsky ZPD) → progressive hints stored with each lesson, revealed one at a time, each reveal logged as an analytics event.
2. **Formative feedback** → automated code execution + validation on every submission, returning pass/fail + error context before the lesson ends (not at the end).
3. **Self-regulated learning** → a visible progress dashboard (XP, streak, completion %) so learners can monitor and plan their own progression. Gamification elements are *lightweight* on purpose (progress bars + badges, not leaderboards) to avoid displacing intrinsic motivation.

These principles turn into concrete data fields and events later in this sketch — keep the link between "pedagogical concept" and "schema field" traceable.

---

## 3. High-Level Architecture

Four-layer cloud-native stack:

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer (Browser)                  │
│   React 18 SPA · React Router · Tailwind · Monaco Editor    │
│           Recharts · Role-based UI rendering                │
└────────────────────────────┬────────────────────────────────┘
                             │  HTTPS / JSON
┌────────────────────────────▼────────────────────────────────┐
│                  API Layer (Node.js + Express)              │
│     JWT auth middleware · RBAC middleware · Rate limit      │
│                 CORS · Request logging                      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│              Service Layer (Business Logic)                 │
│    Auth · Course · Progress · Gamification · CodeRunner     │
└────────┬──────────┬──────────┬──────────┬──────────┬────────┘
         │          │          │          │          │
┌────────▼──┐ ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐
│  Cognito  │ │ MongoDB  │ │DynamoDB│ │   S3   │ │  CW    │
│  (users)  │ │ (content)│ │(events)│ │(media) │ │ (logs) │
└───────────┘ └──────────┘ └────────┘ └────────┘ └────────┘
```

Deployment target: AWS EC2 or Amplify, CI/CD via GitHub Actions, observability via CloudWatch.

---

## 4. Module Breakdown

### 4.1 Frontend (`/client`)

```
client/
├── src/
│   ├── app/              # App shell, routing, providers
│   ├── features/
│   │   ├── auth/         # Login, signup, Cognito hosted UI integration
│   │   ├── dashboard/    # Student dashboard (XP, streak, courses, activity)
│   │   ├── courses/      # Course browse, enroll, module/lesson navigation
│   │   ├── lesson/       # Split-pane tutorial + code editor
│   │   ├── gamification/ # Badge cards, XP bar, streak widget
│   │   ├── instructor/   # Course authoring (modules, lessons, hints, hints, expected output)
│   │   └── admin/        # Users, courses approval, KPIs, logs
│   ├── components/       # Reusable UI primitives
│   ├── services/         # API client (one file per backend service)
│   ├── hooks/            # useAuth, useRole, useProgress
│   └── utils/
├── public/
└── package.json
```

Key UI decisions:
- **Split-pane lesson page** is the heart of the product. Left = Markdown content + progressive hints (one at a time, reveal triggers an analytics event). Right = Monaco editor + output console.
- **Dashboard is always the first thing a student sees post-login.** Visible progress is a pedagogical requirement (SRL), not a preference.
- **Role-based route guards** on the client. Admin routes are not code-split into a separate bundle — security is enforced server-side.

### 4.2 Backend (`/server`)

```
server/
├── src/
│   ├── app.js            # Express app assembly, middleware chain
│   ├── config/           # env loading, AWS clients, Mongo connection
│   ├── middleware/
│   │   ├── requireAuth.js    # JWT validation against Cognito JWKS
│   │   ├── requireRole.js    # RBAC enforcement
│   │   ├── rateLimit.js
│   │   └── errorHandler.js
│   ├── routes/           # Thin handlers — parse, call service, respond
│   │   ├── auth.routes.js
│   │   ├── courses.routes.js
│   │   ├── lessons.routes.js
│   │   ├── progress.routes.js
│   │   ├── gamification.routes.js
│   │   ├── instructor.routes.js
│   │   └── admin.routes.js
│   ├── services/         # Business logic (see 4.3)
│   ├── models/           # Mongoose schemas
│   ├── dynamo/           # DynamoDB table definitions + query helpers
│   └── utils/
├── tests/
└── package.json
```

### 4.3 Service Layer

| Service | Inputs | Outputs | Persistence |
|---|---|---|---|
| **AuthService** | Cognito JWTs | user profile sync | Mongo `users` (on first login, sync from Cognito) |
| **CourseService** | course/module/lesson CRUD | content tree | Mongo `courses`, `modules`, `lessons` |
| **ProgressService** | lesson events (start, submit, hint-reveal, complete) | progress records, aggregates | DynamoDB `progress` |
| **GamificationService** | progress events (subscribed) | XP delta, badges awarded, streak state | Mongo `users` (state) + `badges` (rules) |
| **CodeRunnerService** | source code + lesson id | stdout, stderr, pass/fail | stateless (no DB) |

**Event flow for a code submission** (the most important user interaction):

```
1. Client POST /api/lessons/:id/submit  { code }
2. requireAuth → requireRole('student')
3. Route handler calls CodeRunnerService.run(code, lesson.expectedOutput)
4. Route handler calls ProgressService.recordSubmission(userId, lessonId, result)
5. ProgressService writes to DynamoDB AND emits a domain event
6. GamificationService listens → awards XP, checks badge rules, updates streak
7. Response bundles: execution result + updated XP + any new badges
```

The response is aggregated so the client gets everything it needs to update the UI in one round-trip (supports the user-centric API principle from Chapter 2.6.3).

---

## 5. Data Model Summary

**MongoDB (content + user state):**

- `users` { `_id`, `cognitoId`, `email`, `firstName`, `lastName`, `role` ∈ {student,instructor,admin}, `avatar`, `enrolledCourses[]`, `xpPoints`, `badges[]`, `streak`, `createdAt` }
- `courses` { `_id`, `title`, `description`, `instructor`, `category`, `difficulty`, `modules[]`, `enrollmentCount`, `isPublished`, `createdAt` }
- `modules` { `_id`, `courseId`, `title`, `order`, `lessons[]`, `quizId` }
- `lessons` { `_id`, `moduleId`, `title`, `type` ∈ {tutorial,exercise,quiz}, `content` (Markdown), `codeTemplate`, `expectedOutput`, **`hints[]`**, `order`, `xpReward` }
- `badges` { `_id`, `name`, `description`, `icon`, `criteria` {type, threshold}, `xpValue` }

**DynamoDB (events + analytics):**

- `progress` table
  - PK: `userId` (String)
  - SK: `lessonId` (String)
  - attrs: `status` (not_started|in_progress|completed), `attempts`, `score`, `timeSpent` (s), `completedAt` (ISO), `hintsUsed`, `codeSubmissions[]`
  - `codeSubmissions[]` entries are `{ code, stdout, error, passed, hintsUsedAtSubmit, submittedAt }`, size-bounded (code ≤4KB, stdout ≤2KB, error ≤1KB) and windowed to the most recent 20 — `attempts` remains the true lifetime count. `hintsUsedAtSubmit` snapshots the hint count at that attempt so consecutive entries answer "did revealing a hint change what the learner wrote next" (H1). Submitted code is **pseudonymous at rest, anonymous on export**: the partition key is an opaque ObjectId and no read surface pairs code with a name; `server/scripts/exportSubmissions.js` emits `learner-NN` tokens and writes no re-identification mapping unless `--with-key` is passed. See CHALLENGES.md Challenge 9.

The composite key lets us answer both "show me one learner's full history" (query by PK) and "did this learner complete this lesson" (get by PK+SK) with single-digit-ms latency.

---

## 6. API Surface (indicative)

Endpoints are designed around **user roles and screens**, not around internal resources (user-centric REST, Chapter 2.6.3).

**Student**
- `GET /api/student/dashboard` — aggregated view (XP, streak, courses-in-progress, recent activity)
- `GET /api/courses` / `GET /api/courses/:id`
- `POST /api/courses/:id/enroll`
- `GET /api/lessons/:id` — lesson content + hints metadata (not hint text until revealed)
- `POST /api/lessons/:id/hint` — reveal next hint (logged)
- `POST /api/lessons/:id/submit` — execute + validate + record progress + apply gamification (response bundles all of it)
- `GET /api/student/progress`

**Instructor**
- `POST /api/instructor/courses`
- `POST /api/instructor/courses/:id/modules`
- `POST /api/instructor/modules/:id/lessons`
- `PATCH /api/instructor/lessons/:id` — edit scaffolding (hints, expectedOutput)
- `GET /api/instructor/courses/:id/analytics`

**Admin**
- `GET /api/admin/kpis`
- `GET /api/admin/users` / `PATCH /api/admin/users/:id/role`
- `GET /api/admin/courses` / `PATCH /api/admin/courses/:id/publish`
- `GET /api/admin/activity-log`

All protected endpoints pass through `requireAuth → requireRole([...])`.

---

## 7. Implementation Roadmap (6 sprints from thesis §3.4.2, plus S5.5 added at the 2026-08-12 review)

| Sprint | Focus | Exit criteria |
|---|---|---|
| **S1 — Foundation** | Cognito integration, JWT middleware, RBAC, Express scaffolding, Mongo connection, `users` model | A student can sign up via Cognito, log in, and hit a role-gated health endpoint |
| **S2 — Content** | Course/module/lesson CRUD, instructor authoring UI, Markdown rendering | An instructor can create a course with modules and lessons; a student can browse and read a lesson |
| **S3 — Interactive coding** | Monaco editor integration, CodeRunnerService (sandboxed), automated output validation, progressive hint reveal | A student can write code, run it, see pass/fail, and reveal hints one at a time |
| **S4 — Progress & analytics** | DynamoDB `progress` table, ProgressService, student dashboard with Recharts, instructor analytics view | All meaningful interactions are logged; dashboards render real data |
| **S5 — Gamification** | XP accrual, badge award engine, streak tracking, progress bars, notifications | Completing a lesson updates XP, may award a badge, and updates the streak |
| **S5.5 — Hardening refactor** *(added + shipped 2026-08-12)* | Fixes from the pre-deployment code review (see `REFACTOR.md`): streak tracking off a dedicated completion timestamp, idempotent hint counting, stop leaking `expectedOutput`/hints to the client, runner-adapter boot guard, mass-assignment allowlists, DynamoDB submission size caps | ✅ Met. Streaks increment through the real submit flow; hint counts survive refresh; answers absent from student payloads; prod boot refuses the dev runner adapter; 68 server tests pass |
| **S6 — Admin + Deploy** | Admin panel (role management via Cognito groups), deferred module/lesson CRUD, AWS deployment (EC2/Amplify), `sam deploy` of `runner-js`, GitHub Actions CI/CD, CloudWatch wiring (structured JSON logs) | Platform is live on AWS, CI runs on every PR, logs land in CloudWatch |

Order matters: S1 → S2 → S3 is a strict dependency chain. S4 can start in parallel with late S3. S5 depends on S4 (gamification reads progress events). **S5.5 was inserted after the 2026-08-12 review and must complete before S6's deploy** — its findings silently corrupt the pilot data (streaks, hint usage, pass rates) that the thesis evaluation depends on. S6 runs throughout but hardens at the end.

---

## 8. Key Design Decisions & Rationale

| Decision | Alternative | Why we picked this |
|---|---|---|
| **React SPA** (no SSR) | Next.js SSR | Platform is authenticated, SEO doesn't matter, SPA is simpler (Table 2.1 in thesis) |
| **Cognito for auth** | Custom JWT + bcrypt | Don't reinvent auth; reduces OWASP surface area; managed MFA |
| **MongoDB + DynamoDB hybrid** | Single DB | Different workloads: content (rich schema, flexible queries) vs events (high write throughput, predictable access) |
| **Monaco Editor** | CodeMirror | Same engine as VS Code → students get a familiar editing experience |
| **Lightweight gamification** (XP, badges, streaks) | Leaderboards, competitive ranking | Literature warns that extrinsic motivators can displace intrinsic learning motivation; the thesis explicitly adopts the lightweight approach |
| **Layered architecture** | Microservices | Microservices are over-engineered at MSc-thesis scale (Table 2.1); layered monolith with clean service boundaries is easier to deploy and evaluate |
| **User-centric API** | Resource-centric REST | Chapter 2.6.3: user-centric APIs measurably improved UEQ scores in prior e-learning studies |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Code execution is a security hole** | Critical — arbitrary code injection | CodeRunnerService must run in a sandbox (container, Lambda, or vm2 at minimum). **Never** `eval` in the main process. |
| **DynamoDB cost/hot-partition** | Medium | Use `userId` as PK so writes are spread across learners. Monitor in CloudWatch. |
| **Cognito lock-in** | Low-medium | Auth logic stays in a single `AuthService` adapter so a future migration touches one module. |
| **Small pilot sample (15–30)** | Limits statistical power | Acknowledged in thesis §3.8. Use mixed-methods (SUS + analytics + qualitative) to triangulate. |
| **Analytics must be correct for the evaluation** | High — thesis depends on it | Instrument from day 1. Every learner-facing interaction emits a progress event. Add integration tests that assert event emission. |
| **WCAG 2.1 AA compliance** | Required by NFR5 | Bake accessibility into component library from S2, not as a retrofit. |

---

## 10. Open Questions

These are decisions left to make at implementation time:

1. ~~**CodeRunner isolation strategy**~~ — **Resolved (S3 kickoff, 2026-04-26).** Dual adapter behind a single `CodeRunnerService` interface: **AWS Lambda** in production (one function per language, starting with `runner-js`), **`isolated-vm`** in local dev (in-process V8 isolate, no Docker needed). Adapter selected by env var at boot. `vm2` was rejected — deprecated 2023 due to repeated sandbox-escape CVEs. Rationale: Lambda gives multi-language support and AWS-grade isolation; isolated-vm keeps laptop dev friction-free. Deployment via **AWS SAM** (`template.yaml` at repo root). The `CodeRunnerService` interface stays narrow (`run(code, language) → {stdout, stderr, exitCode, durationMs}`) so the adapters are swappable.
2. ~~**Which languages does the code editor support?**~~ — **Resolved (S3 kickoff, 2026-04-26).** **JavaScript only for the pilot**, per thesis Chapter 4 default. Python and other languages are future work — adding one is a new Lambda + a `language` enum value, no architectural change. `lessons.language` (default `"javascript"`) is the schema field that drives runner selection.
3. **Real-time feedback transport** — polling after submit, or WebSockets? Polling is simpler and likely sufficient for the pilot.
4. ~~**Hint reveal cost**~~ — **Resolved (S5 kickoff, 2026-05-10).** Tiered discount: 0 hints → 100% XP, 1 hint → 50%, 2+ hints → 20%. Implemented in `gamificationService.applyHintDiscount`. Encourages self-attempt without zeroing the reward.
5. **Instructor course approval flow** — do instructors publish directly, or does admin approve? Depends on institutional policy.

Resolve these before the relevant sprint starts, not during it.

---

## 11. Future Work (post-pilot)

Items intentionally **out of scope for the pilot** but worth recording so they aren't re-litigated:

1. **Richer exercise validation beyond stdout matching.** Today `codeRunnerService` compares `lesson.expectedOutput` to the student's stdout (whitespace-normalised). Suitable for "print X" exercises, insufficient for anything that returns values, has side effects, or needs multiple test cases. Extension path:
   - Add `Lesson.validationType` (`stdout` | `tests`) and `Lesson.testCases: [{input, expected}]`
   - In `codeRunnerService`, generate a per-strategy wrapper script that combines student code + harness, run via the existing adapter, parse structured results back into `passed` + per-test detail
   - Update `LessonEditorPage` to author test cases; update the lesson output panel to render per-test pass/fail
   - The runner interface (`run(code, language) → {stdout, stderr, exitCode, durationMs}`) does **not** need to change — wrapping is the orchestrator's job
   - Roughly half a sprint. Worth doing if pilot SUS feedback indicates exercises feel too shallow.

2. **Multi-language support (Python, etc.).** JavaScript is the only language wired today by deliberate pilot-scope decision (see §10 item 2). Cookbook to add a language:
   - Extend `Lesson.LESSON_LANGUAGES` enum to include the new language
   - Create `server/runners/<lang>/` with the runner handler
   - Add a `Runner<Lang>` resource to `template.yaml` and `sam deploy`
   - Add an entry to `lambdaAdapter.FUNCTION_NAMES` and a corresponding `LAMBDA_RUNNER_<LANG>_FUNCTION` env var
   - Decide what to do in **dev mode**: the Node `vm` dev adapter can only run JavaScript. Options: (a) gate non-JS exercises behind `CODE_RUNNER_ADAPTER=lambda` only, (b) shell out to the system interpreter (`python3`, `java`, etc.), (c) reintroduce a containerised dev adapter (rejected at S3 for Windows toolchain reasons — re-evaluate if Docker becomes a hard dependency anyway)
   - Architecture is intentionally ready for this — the per-language Lambda topology was chosen at S3 specifically to keep adding languages a config change, not a redesign.

These connect to the thesis Chapter 7 "future work" framing: validation extensibility serves H1 (better feedback signal density), and multi-language support broadens institutional applicability beyond the JavaScript pilot.
