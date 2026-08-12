# REFACTOR.md — Pre-S6 Hardening Review

Findings from the full-codebase review performed 2026-08-12, after S5 shipped
(`5ec85a7`) and before S6 (Admin + Deploy) kickoff. Scope: all server routes,
services, middleware, the DynamoDB layer, both code-runner adapters, the SAM
template, and the key client screens, checked against `SOLUTION_SKETCH.md` and
`CLAUDE.md`.

These items form the scope of **Sprint S5.5 — Hardening Refactor** (see §7 of
`SOLUTION_SKETCH.md`). They are ordered by severity: group A silently corrupts
the pilot data the thesis evaluation depends on, group B is security /
integrity, group C is scale traps that will bite mid-pilot.

Status legend: ☐ open · ☑ done

---

## A. Bugs that corrupt thesis data (fix first)

### A1 ☑ Streaks can never increment

- **Where:** `server/src/services/authService.js:11`, `server/src/services/gamificationService.js:29-39`
- **What:** `attachUser` runs on every authenticated request and
  `syncUserFromClaims` stamps `lastActiveAt = new Date()`. By the time
  `onLessonCompleted` re-reads the user and calls `updateStreak`,
  `lastActiveAt` is always "today", the UTC day-diff is 0, and the streak is
  left alone — permanently stuck at its default of 0. Streak badges never
  award. Unit tests pass because they exercise `updateStreak` in isolation
  with hand-built user objects.
- **Impact:** H2 (gamification → self-regulated learning) loses its streak
  signal entirely; `streak_days` badges unreachable.
- **Fix:** Add a dedicated `User.lastCompletionAt` field written **only** by
  the gamification service, and base `updateStreak` on it. Keep
  `lastActiveAt` for the admin WAU KPI (its correct use). Add an integration
  test that goes through the real submit flow across two simulated days.
- **Data note:** Existing user records already carry stale streak values from
  the pre-S5 logic (logged 2026-05-10, never corrected). Reset streaks when
  the fix lands, before the pilot starts.

### A2 ☑ Hint counts inflate on page refresh

- **Where:** `server/src/services/progressService.js:68-73`,
  `client/src/features/lesson/LessonPage.jsx:150`
- **What:** The client keeps `revealedCount` in component state, so a page
  refresh resets it to 0 and the student re-reveals hint #1;
  `recordHintReveal` blindly increments `hintsUsed`. One hint seen + two
  refreshes = `hintsUsed: 3`, dropping the student from the 50% XP tier to
  20% and inflating the hint-usage analytics H1 relies on.
- **Fix:** Server-side, store `hintsUsed = max(current, hintIndex + 1)`
  instead of incrementing. (Optionally return revealed hints with the lesson
  progress so the client can restore state after refresh — cosmetic, not
  required for data integrity.)

### A3 ☑ Admin role-change endpoint is a no-op *(fixed in S6)*

- **Where:** `server/src/routes/admin.routes.js:50`,
  `server/src/middleware/requireAuth.js:39-44`, `server/src/services/authService.js:8`
- **What:** `PATCH /api/admin/users/:id/role` writes `role` to Mongo, but on
  the user's next request `attachUser` re-syncs `role` from the Cognito
  `cognito:groups` claim and overwrites it. The endpoint appears to work in
  the UI but has no lasting effect.
- **Fix:** Role management must go through Cognito group membership
  (`AdminAddUserToGroup` / `AdminRemoveUserFromGroup` via the Cognito SDK in
  `authService`), with the Mongo `role` remaining a synced mirror. Slot this
  into the S6 admin-panel work; until then, hide or disable the role control.

---

## B. Security / pilot-integrity gaps

### B1 ☑ Expected output and all hints are shipped to the browser

- **Where:** `server/src/services/courseService.js:107-124`
  (`getLessonForStudent` spreads the whole lesson document, despite its
  comment claiming otherwise), `server/src/routes/courses.routes.js:23`
  (`GET /api/courses/:id` returns the fully-populated lesson tree),
  `client/src/features/lesson/LessonPage.jsx:110-111` (hints rendered from
  the pre-downloaded array — the `/hint` call is only an analytics ping).
- **What:** `expectedOutput` and the full `hints[]` reach any authenticated
  client. Pilot subjects are MSc students: the network tab gives them the
  expected stdout, and `console.log("<answer>")` passes any exercise —
  silently corrupting H1 and the completion metrics.
- **Fix:**
  - Strip `expectedOutput` and `hints` from every student-facing payload;
    send `hintCount` instead.
  - Serve hint text only from `POST /api/lessons/:id/hint` (endpoint already
    exists and logs the reveal).
  - Field-select the course-tree populate (`title type order xpReward
    language` is all the course page needs).
  - Instructor routes keep full access to their own lessons.

### B2 ☑ Production code-runner fails open to the in-process adapter

- **Where:** `server/src/services/codeRunnerService.js:8-9`,
  `server/src/config/env.js:18`, `server/src/services/codeRunner/devAdapter.js`
- **What:** Adapter selection defaults to `dev` unless `NODE_ENV=production`.
  Forget to set `NODE_ENV` on the EC2 box in S6 and the API runs untrusted
  student code in-process via Node `vm` — which is **not** a sandbox:
  `console.log.constructor('return process')()` escapes to `process.env`
  (AWS keys, Mongo URI). The dual-adapter design already accepts that the dev
  adapter is not a security boundary (CHALLENGES.md, Challenge 3), but
  nothing enforces it.
- **Fix:** Fail fast at boot: if `env.isProduction` and the resolved adapter
  is `dev`, throw and refuse to start. One `if` + one test.
- **Related (dev-only, accepted):** `vm.runInContext` is synchronous, so a
  hostile `while(true)` freezes the dev API for the full 5s timeout, and the
  timeout does not cover microtask loops. Tolerable locally; the boot guard
  is what keeps it out of prod.

### B3 ☑ Mass assignment in instructor endpoints

- **Where:** `server/src/services/courseService.js:9-11` (`Course.create`
  with spread `req.body`), `:46-53` (`updateCourse` via `Object.assign`),
  `:126-137` (`updateLesson` via `Object.assign`)
- **What:** An instructor can set `instructor` (course hijack),
  `enrollmentCount`, `isPublished` (bypassing the publish flow and the
  still-open admin-approval question, Sketch §10.5), or re-parent a lesson
  via `moduleId`.
- **Fix:** Allowlist editable fields per operation (course:
  `title description category difficulty`; lesson: `title type language
  content codeTemplate expectedOutput hints xpReward`). Reject or ignore
  everything else.

### B4 ☑ Unpublished courses readable by ID

- **Where:** `server/src/routes/courses.routes.js:23`,
  `server/src/services/courseService.js:25-35`
- **What:** `GET /api/courses` filters `isPublished: true`, but
  `GET /api/courses/:id` does not — any authenticated user can read another
  instructor's draft course tree by ID.
- **Fix:** For non-owner, non-admin callers, require `isPublished: true` in
  `getCourseById` (or a student-facing variant of it).

---

## C. Bottlenecks / scale traps

### C1 ☑ DynamoDB progress item grows unbounded

- **Where:** `server/src/services/progressService.js:37-45`
- **What:** Every attempt appends `{passed, stdout, error, submittedAt}` to
  `codeSubmissions[]` with **untruncated stdout**. A student printing in a
  loop, or grinding 50+ attempts, pushes the single progress item toward
  DynamoDB's 400KB hard limit — after which every write for that lesson 500s
  and progress recording stops mid-pilot.
- **Fix:** Truncate stored stdout (≤2KB per submission) and cap the array
  (keep the most recent ~20 submissions; keep `attempts` as the true count).
- **Decision needed:** the Sketch's `codeSubmissions[]` implies the submitted
  *code* is stored, but it isn't. If the thesis analysis wants to inspect
  code evolution, add a truncated `code` field **now** — it cannot be
  recovered later.

### C2 ☑ Student dashboard over-fetches

- **Where:** `server/src/routes/student.routes.js:27-31`,
  `server/src/services/courseService.js:25-35`
- **What:** `GET /api/student/dashboard` calls `getCourseById` per enrolled
  course, each populating **full** lesson documents (Markdown `content`,
  `expectedOutput`, `hints`) just to count lesson IDs.
- **Fix:** Projection-only populate (`_id` on lessons; `title category
  difficulty modules` on course), or a dedicated lean summary query. Partly
  falls out of B1's field selection.

### C3 ☐ Mongo write on every authenticated request

- **Where:** `server/src/middleware/attachUser.js`, `server/src/services/authService.js:14-18`
- **What:** `findOneAndUpdate` upsert per request. Fine for ≤30 users; noted
  so it isn't copied into higher-traffic paths. Throttling `lastActiveAt`
  writes (e.g. only when >5 min stale) is optional; A1's fix removes the
  harmful side.

### C4 ☑ Analytics `Scan` — accepted for pilot

- `progressTable.scanByLessonIds` is documented in-code as pilot-scale with a
  GSI exit path. No action; recorded here so it isn't re-flagged.

---

## D. S6 carry-over notes (not S5.5 scope)

- Deferred CRUD from S5: `PATCH /modules/:id`, `DELETE /modules/:id`,
  `DELETE /lessons/:id` + CourseEditorPage support.
- `learncode-runner-js` Lambda not yet deployed — the prod adapter path is
  unexercised (adapter ↔ handler contract verified to match on review).
- `morgan('combined')` is not the structured JSON logging CLAUDE.md requires
  for CloudWatch Logs Insights — swap to a JSON logger at deploy time.
- CHALLENGES.md: add a superseding entry to Challenge 3 recording the
  post-signoff dev-adapter swap (`isolated-vm` → Node `vm`, Windows toolchain
  reasons) — B2 makes the "dev adapter is not a security boundary" caveat
  load-bearing, so the record should reflect what actually runs. Fixes B1,
  B2, C1 are each worth their own Challenge entry.

---

## Sprint S5.5 — Hardening Refactor

Inserted before S6 because S6 deploys the platform and starts the pilot; the
items above must land **before** real pilot data is collected.

**Scope:** A1, A2, B1, B2, B3, B4, C1, C2 (+ optional C3 throttle).
A3 is executed inside S6's admin-panel work but is tracked here.

**Exit criteria:**

- Streaks increment across UTC days through the real submit flow
  (integration-tested), and never via mere logins.
- `hintsUsed` is idempotent under repeated reveals of the same hint index.
- `expectedOutput` and hint text are absent from every student-facing
  response body; hints arrive only via the reveal endpoint.
- Boot fails loudly when `NODE_ENV=production` resolves the `dev` runner
  adapter.
- Instructor create/update endpoints accept only allowlisted fields;
  drafts are not readable by non-owners.
- Progress submissions are size-bounded (stdout truncated, array capped).
- Full server test suite passes; new regression tests cover each A/B item.

---

## Implementation record (S5.5 shipped 2026-08-12)

All eight in-scope findings are closed. Server suite: **68 tests passing**
(up from 40); server lint and client build clean.

**Backend**

| Finding | Change |
|---|---|
| A1 | New `User.lastCompletionAt`, written only by `gamificationService`; `updateStreak` reads it instead of `lastActiveAt` (which stays for the WAU KPI). Migration script `server/scripts/resetStreaks.js` clears the meaningless stored streaks. |
| A2 | `recordHintReveal(userId, lessonId, hintIndex)` stores `max(current, hintIndex + 1)`. Route passes the index; `hintIndex` validation tightened to `Number.isInteger`. |
| B1 | `getLessonForStudent` withholds `expectedOutput` and returns `hintCount` + `revealedHints` (replayed from the learner's progress record). Course-tree populate projects lessons down to `title type order xpReward language`. New ownership-gated `GET /api/instructor/lessons/:id` serves the full document for authoring. |
| B2 | Adapter selection now fails safe: `dev` must be opted into explicitly (`CODE_RUNNER_ADAPTER=dev`) and everything else resolves to `lambda`; asking for `dev` while `env.isProduction` throws at require-time. Also fixed the root cause found while validating the guard — see below. |
| B3 | `COURSE_WRITABLE` / `MODULE_WRITABLE` / `LESSON_WRITABLE` allowlists applied through a `pick()` helper in create and update paths. |
| B4 | `getCourseById(courseId, viewer)` throws 404 (not 403, so drafts aren't probeable) for unpublished courses unless the viewer owns them or is an admin. |
| C1 | Stored stdout truncated to 2KB, error text to 1KB, `codeSubmissions` windowed to the last 20. `attempts` still counts every submission. |
| C2 | Dashboard uses a single `getEnrolledCourseSummaries` lean query projecting to lesson IDs, replacing N full `getCourseById` calls. |

**Frontend**

- `LessonPage` `HintList` now holds revealed hint *text* (seeded from
  `revealedHints`, extended by the reveal response) rather than slicing a
  pre-downloaded array — hints survive a refresh without re-counting.
- `LessonEditorPage` reads through the new `getLessonForEdit` authoring
  endpoint, since the learner endpoint no longer carries the answers.

**Incidental**

- Added `server/.eslintrc.cjs`. `npm run lint` had been failing outright
  ("couldn't find a configuration file") — S6's CI gates on it. `lint` and
  `format` now also cover `scripts/`.

**Deferred out of S5.5 (unchanged, still open)**

- ~~**A3** — Cognito-group role management~~ **done in S6:**
  `authService.setUserRole` moves the user between Cognito groups (clearing any
  other role group first, since `resolveRole` picks the highest-privilege match
  and a stale group would make demotions ineffective). Requires the
  `cognito-idp:Admin*` IAM policy in `DEPLOYMENT.md` §3.
- **C3** — per-request Mongo write in `attachUser`; harmless once A1 landed.
- ~~**C1 decision** — submitted *code* is still not persisted.~~ **Resolved
  2026-08-12: capture it.** `codeSubmissions[]` entries now carry `code` (≤4KB)
  and `hintsUsedAtSubmit`; `scripts/exportSubmissions.js` produces a
  token-only, anonymous dataset (`--with-key` opts into a re-identification
  mapping if ever needed). See CHALLENGES.md Challenge 9.

### B5 ☑ `server/.env` overrode the real process environment (found 2026-08-12, post-fix)

Surfaced while validating the B2 guard, and the reason B2's first
implementation did not actually close the hole it was written for.

- **Where:** `server/src/config/env.js:4-5`
- **What:** the loader read repo-root `.env` and then `server/.env` with
  `override: true`, so values in a checked-out dev file beat variables injected
  by the host. Demonstrated: `NODE_ENV=production node src/server.js` resolved
  `env.nodeEnv` to `"development"`, `isProduction` to `false`, the B2 guard
  never fired, and the in-process `vm` adapter was selected — precisely the
  scenario B2 exists to prevent. The blast radius is wider than the runner:
  no platform-injected variable (`MONGODB_URI`, AWS credentials, `PORT`) could
  take effect on EC2 or Amplify.
- **Fix:** load the more specific file first and drop `override`. dotenv does
  not overwrite existing variables, so precedence becomes
  **real environment > `server/.env` > root `.env`** — the layering the two
  files were there to express, with the deployment platform authoritative.
- **Hardening on top:** adapter selection no longer keys off `NODE_ENV` alone,
  because a host that never sets `NODE_ENV` leaves `isProduction` false and the
  guard unable to fire. `dev` is now opt-in only; unset, empty or unrecognised
  values resolve to `lambda`. Verified end-to-end: a clean host with no
  `CODE_RUNNER_ADAPTER` selects `lambda`, and `NODE_ENV=production` with a
  stale dev `.env` refuses to boot.

**Residual risk (accepted, documented):** copying `server/.env` onto a
production host *and* never setting `NODE_ENV` would still select the dev
adapter. `server/.env` is gitignored and there is no deploy path that copies
it; the deploy checklist covers it.

**Operational note for deploy:** set `NODE_ENV=production` and
`CODE_RUNNER_ADAPTER=lambda` through the platform's environment configuration,
not a `.env` file. Local dev opts into the in-process runner via
`CODE_RUNNER_ADAPTER=dev` (added to `server/.env` and `.env.example`); the test
suite opts in through `tests/setupEnv.js`.
