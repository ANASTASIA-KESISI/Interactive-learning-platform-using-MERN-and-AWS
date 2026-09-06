import { api, unwrap } from './api.js';

// Learner view: no expectedOutput, hints as `hintCount` + already-revealed text.
export const getLesson = (lessonId) =>
  api.get(`/lessons/${lessonId}`).then(unwrap);

// Authoring view: full document including expectedOutput and every hint.
// Ownership-gated server-side.
export const getLessonForEdit = (lessonId) =>
  api.get(`/instructor/lessons/${lessonId}`).then(unwrap);

export const updateLesson = (lessonId, payload) =>
  api.patch(`/instructor/lessons/${lessonId}`, payload).then(unwrap);

export const revealHint = (lessonId, hintIndex) =>
  api.post(`/lessons/${lessonId}/hint`, { hintIndex }).then(unwrap);

export const submitCode = (lessonId, code) =>
  api.post(`/lessons/${lessonId}/submit`, { code }).then(unwrap);

// D10 — "Run" executes without validating: no verdict, no XP, no attempt
// burned. The server bumps a `runs` counter so the experimentation is still
// visible in the pilot's engagement data.
export const runCode = (lessonId, code) =>
  api.post(`/lessons/${lessonId}/run`, { code }).then(unwrap);

// Grades a quiz answer sheet server-side. `answers[i]` is the option index the
// learner picked for question i, or null if they skipped it. The correct
// answers only ever travel back in the response — never with the lesson.
export const submitQuiz = (lessonId, answers) =>
  api.post(`/lessons/${lessonId}/quiz`, { answers }).then(unwrap);

// Active seconds spent on the lesson page. Telemetry only — the response says
// nothing a screen needs, so callers ignore it and swallow failures.
export const reportTimeOnTask = (lessonId, seconds) =>
  api.post(`/lessons/${lessonId}/time`, { seconds }).then(unwrap);
