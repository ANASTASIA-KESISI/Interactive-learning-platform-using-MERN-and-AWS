const { badRequest } = require('../utils/httpError');

// Quiz authoring and grading.
//
// A quiz is a `Lesson` with `type: 'quiz'` and a `questions[]` body, so it
// inherits ordering, XP, hints and one progress record per lesson from the
// content model that already exists. Grading is SERVER-SIDE and the answers
// never travel to the browser before it happens — the same rule that keeps
// `expectedOutput` off the wire for a coding exercise (S5.5 B1). A quiz whose
// correct answers ship with the page measures nothing.

const MAX_QUESTIONS = 50;
const MAX_PROMPT = 2000;
const MAX_OPTION = 500;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

// Validates and normalises an authored `questions` array. Returns the clean
// array; throws 400 with a message naming the offending question (1-based, as
// the author sees them) so the editor can point at the right row.
const normaliseQuestions = (questions) => {
  if (questions === undefined) return undefined;
  if (!Array.isArray(questions)) throw badRequest('questions must be an array');
  if (questions.length > MAX_QUESTIONS) {
    throw badRequest(`A quiz can hold at most ${MAX_QUESTIONS} questions`);
  }

  return questions.map((question, i) => {
    const at = `Question ${i + 1}`;
    if (!question || typeof question !== 'object') throw badRequest(`${at} is malformed`);

    const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : '';
    if (!prompt) throw badRequest(`${at} needs a prompt`);
    if (prompt.length > MAX_PROMPT) throw badRequest(`${at}'s prompt is too long`);

    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((option) => (typeof option === 'string' ? option.trim() : ''))
      .filter(Boolean);
    if (options.length < MIN_OPTIONS) throw badRequest(`${at} needs at least ${MIN_OPTIONS} options`);
    if (options.length > MAX_OPTIONS) throw badRequest(`${at} allows at most ${MAX_OPTIONS} options`);
    if (options.some((option) => option.length > MAX_OPTION)) {
      throw badRequest(`${at} has an option that is too long`);
    }

    // Coercing straight through `Number()` would be a trap: `Number(null)` and
    // `Number('')` are both 0, so a question the author never marked would come
    // out with its FIRST option silently declared correct — a wrong answer key
    // that validates cleanly and is only discovered by a learner losing marks.
    // Accept a real number, or a non-blank numeric string (forms send strings),
    // and nothing else.
    const raw = question.correctIndex;
    const correctIndex =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : NaN;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      // The most likely authoring mistake by far: writing options, never
      // marking one correct, and shipping a quiz nobody can pass.
      throw badRequest(`${at} needs one of its options marked as the correct answer`);
    }

    const explanation =
      typeof question.explanation === 'string' ? question.explanation.trim().slice(0, MAX_PROMPT) : '';

    return { prompt, options, correctIndex, explanation };
  });
};

// The learner-facing projection: prompts and options, never `correctIndex` or
// `explanation`.
const questionsForStudent = (questions = []) =>
  questions.map((question, index) => ({
    index,
    prompt: question.prompt,
    options: question.options,
  }));

// Grades a submitted answer sheet. `answers[i]` is the option index chosen for
// question i; anything absent or out of range counts as unanswered and wrong,
// so a partially filled sheet still grades rather than erroring.
const grade = (lesson, answers) => {
  const questions = lesson.questions || [];
  if (questions.length === 0) {
    throw badRequest('This quiz has no questions yet');
  }
  if (!Array.isArray(answers)) throw badRequest('answers must be an array');
  if (answers.length > questions.length) {
    throw badRequest('More answers submitted than the quiz has questions');
  }

  const results = questions.map((question, i) => {
    const given = Number.isInteger(answers[i]) ? answers[i] : null;
    const answered = given !== null && given >= 0 && given < question.options.length;
    const correct = answered && given === question.correctIndex;

    return {
      index: i,
      correct,
      answered,
      selectedIndex: answered ? given : null,
      // Feedback flows only on the way BACK, after the attempt is committed.
      correctIndex: question.correctIndex,
      explanation: question.explanation || '',
    };
  });

  const total = questions.length;
  const correctCount = results.filter((result) => result.correct).length;
  // Rounded so the displayed percentage and the pass decision can never
  // disagree — a learner told "70%" beside a pass mark of 70 must have passed.
  const score = Math.round((correctCount / total) * 100);
  const passMark = lesson.passMark ?? 70;

  return { total, correctCount, score, passMark, passed: score >= passMark, results };
};

module.exports = {
  normaliseQuestions,
  questionsForStudent,
  grade,
  _limits: { MAX_QUESTIONS, MIN_OPTIONS, MAX_OPTIONS },
};
