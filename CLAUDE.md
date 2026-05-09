# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This repository implements **LearnCode**, a full-stack interactive learning platform for programming education, built as the practical artifact of an MSc thesis ("Design and Evaluation of a Full-Stack Interactive Learning Platform Using the MERN Stack and AWS Cloud Services", University of Macedonia, 2026). The platform bridges the institutional flexibility of open LMSs (Moodle, Canvas) with the interactive pedagogy of commercial coding platforms (Codecademy, LeetCode).

The design is pedagogically grounded in the **ADDIE** instructional design model and operationalizes three research concepts as first-class platform features: **scaffolding** (progressive hints, code templates), **formative feedback** (automated validation, real-time error messages), and **self-regulated learning** (progress visualization, lightweight gamification). When adding features, preserve this pedagogical intent — e.g. a "hint" is not a UI affordance, it is a scaffolding mechanism that should be revealed progressively and tracked in analytics.

The repository is at an early scaffolding stage. Most of the structure described below does not yet exist on disk — treat this document as the **target architecture** derived from Chapter 4 of the thesis, not a description of current files. Before implementing, check whether the relevant module already exists.

## Repository Structure (target)

Monorepo with two top-level application directories:

- `/client` — React SPA frontend
- `/server` — Node.js/Express backend

Keep frontend and backend dependencies strictly isolated in their own `package.json` files. Shared types/constants (if introduced) should live in a top-level `/shared` directory, not be imported across the `client`/`server` boundary via relative paths.

## Common Commands

Commands below assume the target monorepo layout. Run them from the respective subdirectory unless noted.

**Backend (`/server`):**
- `npm run dev` — start Express API with hot reload (nodemon)
- `npm start` — start API in production mode
- `npm test` — run Jest unit/integration tests
- `npm test -- <pattern>` — run a single test file or test name pattern
- `npm run lint` — ESLint over `src/`
- `npm run format` — Prettier write

**Frontend (`/client`):**
- `npm run dev` — Vite/CRA dev server
- `npm run build` — production bundle
- `npm test` — Jest + React Testing Library
- `npm run lint` / `npm run format`

**Runtime prerequisites:** Node.js v18+, npm. AWS credentials configured via `~/.aws/credentials` or environment variables for any code path that touches Cognito, DynamoDB, or S3. A running MongoDB instance (MongoDB Atlas connection string in `.env`) is required for backend tests that are not mocked.

## Architecture

The platform follows a **four-layer cloud-native architecture**. Each layer has a distinct responsibility and communicates only with adjacent layers — do not introduce shortcuts (e.g. calling DynamoDB directly from a route handler).

### Layer 1 — Client (React SPA)
- **React 18+** with React Router for client-side navigation
- **Tailwind CSS** for styling
- **Monaco Editor** (preferred, same engine as VS Code) or CodeMirror for the embedded code editor
- **Recharts** (preferred) or D3.js for the analytics dashboard
- **Role-based UI rendering** — the same app shell adapts to student / instructor / admin based on the authenticated user's role claim. Route guards must enforce this on the client, and the backend must re-enforce it — never trust the client role alone.

Key screens (see Chapter 4.4 of the thesis for wireframes):
1. **Student Dashboard** — XP, streak, completion rate, badges, enrolled-course cards with progress bars, recent activity feed
2. **Tutorial / Code Exercise page** — split-pane layout: instructional Markdown + progressive hints on the left, code editor + output/test-result console on the right
3. **Admin Panel** — sidebar navigation, platform KPIs, weekly active users chart, user management, activity log

### Layer 2 — API (Node.js / Express)
- RESTful endpoints, stateless
- **JWT middleware** validates tokens issued by AWS Cognito on every protected route
- **RBAC middleware** runs after JWT validation and checks the role claim against a per-route permission matrix (see the RBAC matrix in thesis Figure 4.3)
- **API Gateway concerns** handled in Express middleware: rate limiting, CORS, request logging to CloudWatch

API endpoints are designed **user-centrically** — organized around what a user role needs to accomplish, not around internal data models. For example, `GET /api/student/dashboard` returns the aggregated view the student screen needs, rather than forcing the client to compose it from five resource endpoints.

### Layer 3 — Services (business logic)
Five core service modules. Each has its own folder under `server/src/services/` and exposes a clean interface to the route handlers:

| Service | Responsibility |
|---|---|
| **Auth Service** | Delegates to AWS Cognito (user pools, MFA, identity federation). Never implement custom password hashing or token issuance. |
| **Course Service** | CRUD for courses → modules → lessons hierarchy. Persists to MongoDB. |
| **Progress Service** | Tracks learner interactions (completion, time-on-task, code submissions, hints used). Writes to DynamoDB. |
| **Gamification Service** | XP accrual, badge award rules, streak tracking. Reads/writes user gamification state in MongoDB and listens to Progress Service events. |
| **Code Runner Service** | Sandboxed execution of learner code and validation against `expectedOutput`. Must be isolated — never `eval` or execute untrusted code in the main Node process. Implemented as a thin orchestrator over two adapters: `isolated-vm` for dev, AWS Lambda (per-language functions, e.g. `runner-js`) for prod. |

Route handlers are thin: they parse/validate input, call one or more services, and format the response. Business logic belongs in services, not routes.

### Layer 4 — Data (polyglot persistence)

**Two databases, intentionally chosen for different workloads** — do not collapse them into one without a very strong reason.

**MongoDB Atlas** (document store, via Mongoose) — structured content and user state:
- `users` — profile, `cognitoId`, `role` (student/instructor/admin), `xpPoints`, `badges[]`, `streak`, `enrolledCourses[]`
- `courses` — metadata, instructor ref, `modules[]`
- `modules` — ordered within a course, `lessons[]`
- `lessons` — **the scaffolding lives here**: Markdown `content`, `codeTemplate`, `expectedOutput`, ordered `hints[]`, `xpReward`, `type`
- `badges` — achievement criteria and XP values

**AWS DynamoDB** (key-value) — high-throughput analytics writes:
- `progress` table — partition key `userId`, sort key `lessonId`. Tracks `status`, `attempts`, `score`, `timeSpent`, `hintsUsed`, `codeSubmissions[]`, `completedAt`. This composite key enables both "one learner's full history" and "one learner's progress on one lesson" queries in a single round-trip.

Rule of thumb: **content goes to Mongo, events go to Dynamo.** A new piece of data that is read often and written rarely belongs in Mongo; data that is written on every interaction (click, submission, hint reveal) belongs in Dynamo.

**AWS S3** — media assets and static files.
**AWS CloudWatch** — logs, metrics, alerts. Backend logs should be structured (JSON) so they are queryable in CloudWatch Logs Insights.

## Authentication & Authorization

- Identity is managed entirely by **AWS Cognito User Pools**. The backend never stores passwords.
- Cognito groups map to application roles (`student`, `instructor`, `admin`). Role is a claim in the JWT.
- Every protected route must pass through `requireAuth` (JWT validation) followed by `requireRole([...])` (RBAC check). The permission matrix is the single source of truth for what each role can do.
- Frontend role checks are for UX only — the backend is authoritative.

## Functional & Non-Functional Requirements

From Chapter 3.2 of the thesis. Treat these as acceptance criteria when implementing features:

**Functional:** FR1 auth + RBAC, FR2 interactive code editor with execution and validation, FR3 course→module→lesson hierarchy, FR4 scaffolded hints + formative error messages, FR5 XP/badges/streaks/progress bars, FR6 analytics dashboard, FR7 instructor course creation, FR8 admin tools.

**Non-functional:** NFR1 responsive (desktop + mobile), NFR2 horizontally scalable cloud deployment, NFR3 primary interactions <3s, NFR4 HTTPS/TLS everywhere, NFR5 WCAG 2.1 AA, NFR6 99.5% uptime during pilot.

## Security Requirements (non-negotiable)

- HTTPS/TLS for all client↔server communication
- JWT tokens with appropriate expiration + refresh (Cognito-managed)
- Server-side input validation on every endpoint (prevent injection)
- RBAC enforced at middleware, not in handlers
- Rate limiting on all public endpoints
- Encryption at rest (Mongo Atlas + DynamoDB default) and in transit
- Follow OWASP Top 10 — if a change touches auth, input handling, or code execution, re-check against OWASP before merging
- The Code Runner Service handles untrusted user code — it must run in a sandbox, **never in the main API process**. Use **AWS Lambda** in production (one function per language, isolated by AWS) and **`isolated-vm`** for local dev (V8 isolates, no Docker required). Do **not** use `vm2` — it was deprecated in 2023 after repeated sandbox-escape CVEs. The two adapters live behind the `CodeRunnerService` interface and are picked by env var at boot.

## Deployment

- Hosting: **AWS EC2** or **AWS Amplify**
- CI/CD: **GitHub Actions** — lint + test must pass before deploy
- Monitoring: **CloudWatch** for logs, metrics, and alerting

## Testing

- **Jest** for backend unit + integration tests
- **React Testing Library** (on Jest) for frontend component tests
- **Postman** collections for manual API validation — keep them in `/server/postman/` if they're added
- Run a single test: `npm test -- path/to/file.test.js` or `npm test -- -t "test name pattern"`

## Pilot Study Context

The platform will be evaluated in a time-bound pilot (15–30 MSc students, 2–4 weeks) using the **System Usability Scale (SUS)** plus DynamoDB-sourced engagement metrics (session duration, completion rate, hint usage, badge acquisition). This means:

- **Analytics instrumentation is a requirement, not a nice-to-have.** Any new learner-facing interaction should emit a progress event to DynamoDB so it shows up in the evaluation.
- The two research hypotheses (H1: scaffolding/feedback → engagement; H2: gamification → self-regulated learning) depend on being able to correlate scaffold usage and gamification events with engagement metrics. Preserve this data lineage when refactoring.

## Things to Avoid

- Do **not** implement custom authentication logic — delegate to Cognito.
- Do **not** merge the two databases. The polyglot split is deliberate.
- Do **not** execute learner-submitted code in the main Node process.
- Do **not** put business logic in Express route handlers — it goes in services.
- Do **not** trust role claims sent from the frontend — re-validate server-side.
- Do **not** introduce SSR/Next.js without a strong reason. The thesis explicitly chose a client-rendered SPA because the platform is authenticated and SEO is not a concern (see Table 2.1).
