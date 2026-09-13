# S8 — Course lifecycle rules, account deactivation, metric completeness

Planning document for the four adjustments requested on 2026-09-13. Everything
below respects `CLAUDE.md`: thin routes → services → Mongo/Dynamo,
`requireAuth → requireRole → attachUser` on every protected route, content in
Mongo / events in Dynamo, roles owned by Cognito, and every new learner
interaction observable in the DynamoDB progress table so the pilot can
correlate it (H1/H2).

Execution: three work packages, each implemented by a separate agent on its own
branch in a git worktree, then merged into `dev` by the coordinator. Packages
were cut so that they touch different regions of the few shared files
(`admin.routes.js`, `User.js`); the merge is expected to be clean.

---

## 0. Decisions (read first)

| # | Decision | Why |
|---|---|---|
| D1 | **A course is publishable only if it has at least one module that has at least one lesson.** An empty module does not make a course teachable. The rule lives in one service function used by both the instructor's publish endpoint and the admin's publish toggle. | Both paths flip `isPublished`; a rule enforced in one route and not the other is not a rule. |
| D2 | **Deleting a course is allowed only while it is unpublished**, for its owning instructor or an admin. Deletion cascades in Mongo to the course's modules, lessons, notes and message threads, and removes the course from every user's `enrolledCourses`. **DynamoDB progress records are left in place**, consistent with the existing module/lesson delete policy: they are the research record, and rewriting history to match a later content edit would falsify it. | Published courses may have learners mid-way; unpublish first, then delete, is the deliberate two-step. |
| D3 | **Deactivation is a Cognito `AdminDisableUser` plus a Mongo mirror `isActive`**, with `AdminUserGlobalSignOut` so the user's refresh tokens die immediately. A still-valid access token is rejected by `attachUser` on its next request via the Mongo flag, so the lockout is immediate on the API even though Cognito's disable only prevents new sign-ins. An admin cannot deactivate their own account. | Mirrors how roles work (Cognito owns identity; Mongo mirrors). Disabling in Cognito alone would leave an hour-long window of valid tokens. |
| D4 | **New IAM actions are required** on the `learncode-runtime` policy, in both identities: `cognito-idp:AdminDisableUser`, `AdminEnableUser`, `AdminUserGlobalSignOut`. This is a console step the coordinator will surface; the code must fail with a 503 that names the missing permission, the way the role endpoint already does for a missing group. | Same trap as S6 A3: a Console test passes while the API gets `AccessDeniedException`. |
| D5 | **Badge awards get a timestamp** through a new parallel array `users.badgeAwards[{ badge, awardedAt }]`. The existing `badges[]` of ids stays as-is so nothing that reads it changes. Awards made before S8 have no timestamp and are reported as undated. | Changing the shape of `badges[]` would touch every reader (dashboard, profile, gamification, export) for a gain that a parallel array delivers for free. |
| D6 | **Sessions are recorded in the progress table** as items with sort key `session#<sessionId>`, so the polyglot rule (events → Dynamo) holds and no new table has to be created by hand in the console. A session's `durationSec` is *active* time: each heartbeat adds the gap since the previous heartbeat, capped at 120 s, so an idle or hidden tab adds nothing. Only students record sessions, consistent with every other progress signal. | The thesis lists "average session duration". Time on task per lesson exists; a session is the missing unit. Capping the gap makes the number honest without a session-timeout heuristic. |
| D7 | **Every reader of `queryByUser` and `scanAll` must skip `session#` items.** Two call sites exist today — `progressService.getStudentProgress` and `scripts/exportSubmissions.js` — and everything the dashboard, activity feed and profile show flows through the first. Filter at those two points, and re-grep before finishing. | Mixing item types in one partition is fine only if every consumer knows. |
| D8 | **Mean submissions per exercise and hint-reveal rate** are added to the per-lesson analytics rows the instructor page already renders, as `avgAttemptsPerLearner` and `hintRevealRate`. **Average session duration and badges awarded per week** are added to the admin KPIs, since neither is per course. | Puts each metric where the role that needs it already looks. |
| D9 | No `window.confirm`/`alert`. Destructive actions use the existing `Modal` in `client/src/components/ui/`. | Native dialogs block browser automation and are inconsistent with the app. |
| D10 | Commit messages follow the repository style: an imperative subject line and a body that says why, with **no `Co-Authored-By` or `Claude-Session` trailers**. | Repository convention. |

---

## 1. Work package A — course lifecycle (items 1 and 2)

**Owner:** agent A, branch `s8/course-lifecycle`.

### A1. Publish rule

- `server/src/services/courseService.js`
  - Add `assertPublishable(course)`: loads the course's modules with their
    `lessons` arrays; throws `409` via the existing `conflict` helper in
    `server/src/utils/httpError.js`, with a message that names
    the missing piece: "Add at least one module before publishing" or "Every
    module needs at least one lesson before publishing" (name the empty
    module's title).
  - `publishCourse` calls it before setting `isPublished`.
  - New `setCoursePublished(courseId, isPublished)` for the admin path: loads
    the course, calls `assertPublishable` only when `isPublished === true`,
    saves. Unpublishing has no precondition.
- `server/src/routes/admin.routes.js`: `PATCH /courses/:id/publish` delegates
  to `courseService.setCoursePublished` instead of `findByIdAndUpdate`.
- Client
  - `client/src/features/instructor/CourseEditorPage.jsx`: the Publish control
    is disabled when the loaded course fails the rule, with the reason shown
    inline next to it; the server error message is surfaced if the request is
    still refused.
  - `client/src/features/admin/AdminCoursesPage.jsx`: the publish toggle
    surfaces the 409 message rather than a generic error.
- Tests: `server/tests/services/courseService.test.js` (rule: no modules,
  module without lessons, happy path; admin path honours it; unpublish does
  not), and a route test proving `PATCH /api/admin/courses/:id/publish` returns
  409 with the message.

### A2. Course deletion

- `server/src/services/courseService.js`: `deleteCourse(courseId, actor)`
  where `actor = { id, role }`.
  - 404 if missing; 403 unless `actor.role === 'admin'` or actor owns it;
    409 if `isPublished` ("Unpublish the course before deleting it").
  - Cascade, in this order: `Lesson.deleteMany({ moduleId: { $in: moduleIds } })`,
    `Module.deleteMany({ courseId })`, `Note.deleteMany({ courseId })`,
    `Message.deleteMany({ courseId })`, `User.updateMany({ enrolledCourses: courseId }, { $pull: { enrolledCourses: courseId } })`,
    then `Course.deleteOne`. Return counts.
  - Leave DynamoDB alone and say so in a comment, pointing at the existing
    `deleteModule` rationale.
- Routes
  - `DELETE /api/instructor/courses/:id` (existing `auth` chain; passes
    `{ id: req.dbUser._id, role: req.dbUser.role }`).
  - `DELETE /api/admin/courses/:id` (admin chain; same service call).
- Client
  - `client/src/services/instructor.js` and `admin.js`: `deleteCourse`.
  - `CourseEditorPage.jsx`: a Delete action visible only while unpublished,
    behind a `Modal` confirmation that repeats the course title; on success
    navigate to the instructor dashboard.
  - `AdminCoursesPage.jsx`: Delete action per row, enabled only for
    unpublished courses, same confirmation pattern.
- Tests: service (ownership, admin override, published refusal, cascade calls
  in order, enrolment pull) and both routes (403 for a non-owner instructor,
  409 for published, 200 with counts).

### A3. Docs for package A

- `CLAUDE.md`: under the Course Service row, one sentence each for the publish
  rule and the unpublished-only delete with its Mongo cascade and Dynamo
  non-cascade.
- `docs/ARCHITECTURE.adoc`, Layer 3 services table: same two sentences.

---

## 2. Work package B — account deactivation (item 3)

**Owner:** agent B, branch `s8/user-deactivation`.

- `server/src/models/User.js`: `isActive: { type: Boolean, default: true, index: true }`;
  include it in `toSafeJSON`.
- `server/src/services/authService.js`
  - `setUserActive(userId, isActive, actorId)`: 400 if `userId === actorId`
    ("You cannot deactivate your own account"); 404 if missing; no-op if
    unchanged. On deactivate: `AdminDisableUserCommand` then
    `AdminUserGlobalSignOutCommand`; on activate: `AdminEnableUserCommand`.
    Then set the Mongo flag and save. Map `AccessDeniedException` to a 503
    whose message names the three `cognito-idp` actions to add to the
    `learncode-runtime` policy, in the style of the existing missing-group 503.
  - `syncUserFromClaims`: unchanged write, but the caller checks the flag.
- `server/src/middleware/attachUser.js`: after sync, if `dbUser.isActive === false`,
  `next(forbidden('This account has been deactivated'))` with `code: 'ACCOUNT_DEACTIVATED'`
  on the error if the error helper supports a code; otherwise a message the
  client can match exactly.
- `server/src/routes/admin.routes.js`
  - `PATCH /api/admin/users/:id/active` with body `{ isActive: boolean }`;
    validates the boolean; calls the service with `req.dbUser._id`.
  - `GET /api/admin/users` already returns user documents; confirm `isActive`
    is in the projection.
- Client
  - `client/src/services/admin.js`: `setUserActive(userId, isActive)`.
  - `client/src/features/admin/AdminUsersPage.jsx`: an Active column and a
    Deactivate/Reactivate action per row, disabled on the admin's own row,
    behind a `Modal` confirmation; deactivated rows visibly muted.
  - `client/src/services/api.js`: on a 403 whose body matches the deactivation
    error, sign the user out and redirect to `/login` with a notice
    ("Your account has been deactivated. Contact your instructor."). Reuse
    whatever notice mechanism the login page already has (`notice` prop or
    query param; check `LoginPage.jsx`).
- Tests: service (self-deactivation refused, Cognito calls in order,
  AccessDenied → 503 naming the actions), middleware (`attachUser` rejects an
  inactive user with 403), route (admin-only; validation of the boolean).
- Docs: `DEPLOYMENT.md` §3 — add the three actions to the Cognito statement of
  the `learncode-runtime` policy and a line saying deactivation returns 503
  until they are attached. `CLAUDE.md` Auth Service row: one sentence.

---

## 3. Work package C — metric completeness (item 4)

**Owner:** agent C, branch `s8/metrics`.

The thesis names five engagement metrics. The current coverage, from
`docs/ARCHITECTURE.adoc` "Evaluation metrics":

| Metric | Today | After C |
|---|---|---|
| Lesson-completion rate | Reported | Unchanged |
| Mean code submissions per exercise | Derivable | Reported per lesson (`avgAttemptsPerLearner`) |
| Hint usage frequency | `avgHintsUsed` | Plus `hintRevealRate` (share of learners who revealed ≥ 1 hint) |
| Badge acquisition rate | Counts only, undated | Dated awards; admin KPI `badgesAwardedByWeek` |
| Average session duration | Not captured | Admin KPI `avgSessionDurationSec` from session items |

### C1. Per-lesson analytics

- `server/src/services/progressService.js` `getCourseAnalytics`: per lesson add
  `avgAttemptsPerLearner` (`totalAttempts / uniqueLearners`, one decimal, 0
  when no learners) and `hintRevealRate` (learners with `hintsUsed > 0` over
  `uniqueLearners`, percentage, rounded). Count `learnersWithHints` in the
  aggregate.
- `client/src/features/instructor/InstructorAnalyticsPage.jsx`: two new
  columns, with the same empty-state handling the table already has.
- Tests: extend `server/tests/services/progressService.test.js`.

### C2. Badge award timestamps

- `server/src/models/User.js`: `badgeAwards: [{ badge: { type: ObjectId, ref: 'Badge' }, awardedAt: { type: Date, default: Date.now } }]`.
- `server/src/services/gamificationService.js` `evaluateBadges`: whenever it
  pushes to `user.badges`, also push `{ badge: badge._id, awardedAt: now }`
  to `user.badgeAwards`. `now` is passed in or defaulted once per call so all
  badges from one completion share a timestamp.
- `server/src/routes/student.routes.js` badge gallery: include `awardedAt`
  per earned badge where a matching `badgeAwards` entry exists, else `null`.
  `client/src/features/profile/ProfilePage.jsx`: show the date under an
  earned badge when present (small, muted).
- `server/src/routes/admin.routes.js` `GET /kpis`: `badgesAwardedTotal` and
  `badgesAwardedByWeek` (same weekly buckets as `activeByWeek`, from an
  aggregation over `badgeAwards.awardedAt`). `AdminOverviewPage.jsx`: one
  stat tile and a second series or small table alongside the weekly-active
  chart; follow the existing chart component and palette.
- Tests: gamification (award writes both arrays with one timestamp), KPI route
  (aggregation shape with mocked `User.aggregate`).

### C3. Sessions

- `server/src/dynamo/progressTable.js`
  - `SESSION_PREFIX = 'session#'` exported.
  - `scanSessionsSince(sinceIso)`: `scanAllPages` with
    `FilterExpression: 'begins_with(lessonId, :p) AND startedAt >= :since'`.
- `server/src/services/progressService.js`
  - `recordSessionHeartbeat(userId, sessionId, now = new Date())`:
    key `{ userId, lessonId: 'session#' + sessionId }`. If no item: put
    `{ type: 'session', startedAt, lastSeenAt, durationSec: 0, heartbeats: 1 }`.
    Else `durationSec += min((now - lastSeenAt) / 1000, 120)`, `lastSeenAt = now`,
    `heartbeats += 1`. Return `{ durationSec }`.
  - `isSessionItem(item)` helper; `getStudentProgress` filters them out.
  - `getSessionStats(sinceIso)`: `{ sessions, avgSessionDurationSec, medianSessionDurationSec }`
    over `scanSessionsSince`.
- **Every consumer of `queryByUser` must skip session items.** Grep
  `queryByUser` and `scanAll` across `server/src` and `server/scripts` and add
  the filter to each: at minimum the student dashboard, the activity feed, the
  profile heatmap and `scripts/exportSubmissions.js`.
- `server/src/routes/me.routes.js`: `POST /api/me/session` body `{ sessionId }`
  (string, 8–64 chars, `[A-Za-z0-9_-]`). Students only record; any other role
  gets `202 { recorded: false }`, mirroring the time-on-task endpoint. Rate
  limit is the global one; do not add another.
- `server/src/routes/admin.routes.js` `GET /kpis`: add `avgSessionDurationSec`,
  `medianSessionDurationSec` and `sessions` over the same `weeks` window.
  `AdminOverviewPage.jsx`: one stat tile "Avg active session", formatted
  `m:ss`, with the count as its subtitle.
- Client
  - `client/src/hooks/useSessionHeartbeat.js`: on mount read or create a
    session id in `sessionStorage` (`crypto.randomUUID()`), post a heartbeat
    immediately, then every 60 s while `document.visibilityState === 'visible'`,
    and once more when the tab becomes hidden. Refs only, no re-renders,
    fire-and-forget with errors swallowed, same discipline as `useTimeOnTask`.
  - Mount it once in `client/src/app/AppShell.jsx`, only when the signed-in
    role is `student`.
  - `client/src/services/me.js`: `sendSessionHeartbeat(sessionId)`.
  - Test in `client/tests/hooks/useSessionHeartbeat.test.js` with fake timers,
    mirroring the existing time-on-task hook test.
- Tests: progressService (first heartbeat creates, second accumulates, gap
  capped at 120, non-session items filtered), progressTable filter expression,
  route (student records, instructor gets 202, validation).

### C4. Docs for package C

- `CLAUDE.md`: progress table paragraph — add the `session#` items, their
  fields and the rule that readers skip them; add `badgeAwards` to the users
  collection line.
- `docs/ARCHITECTURE.adoc`: update the "Evaluation metrics" table to the
  "After C" column above, keeping the wording honest ("active session
  duration, heartbeat-based"); update "The progress table" section; drop the
  "Session duration not measured" and "Badges not timestamped" rows from the
  gaps table (pre-S8 awards stay undated; say so in the metrics table).
- `README.md`: the "What the pilot can measure" table to match.
- `server/scripts/exportSubmissions.js`: header comment notes session items
  are excluded.

---

## 4. Definition of done, per package

1. `npm test --workspace server` and `npm run lint --workspace server` green.
2. `npm run lint --workspace client`, `npm test --workspace client` and
   `npm run build --workspace client` green (build needs the three `VITE_*`
   placeholders CI uses; see `.github/workflows/ci.yml`).
3. New behaviour covered by tests in the existing style (mocked Mongoose and
   AWS SDK; no live infrastructure).
4. Docs listed in the package updated.
5. Committed on the package branch in one or a few commits, repository style,
   no attribution trailers. Not pushed; the coordinator merges.

## 5. Coordinator follow-ups after merge

- Attach the three Cognito actions from D4 to `learncode-runtime` in both
  identities (console step for the user).
- Rebuild `docs/ARCHITECTURE.html` and `.pdf`.
- Full test run on the merged tree; push; watch CI and the deploy.
- Verify on the live platform: publish refusal, delete flow, deactivation,
  a session row appearing in DynamoDB for a student account.
