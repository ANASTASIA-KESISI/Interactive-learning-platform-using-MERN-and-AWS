const quizService = require('../../src/services/quizService');

// Quizzes are a `Lesson` with a `questions[]` body. Two properties matter most:
// grading is arithmetic an author can trust, and the answer key never leaves the
// server before the learner has committed (the quiz equivalent of S5.5 B1).

const question = (over = {}) => ({
  prompt: 'What does console.log do?',
  options: ['Prints to the console', 'Deletes a file', 'Starts a server'],
  correctIndex: 0,
  explanation: 'It writes its arguments to stdout.',
  ...over,
});

describe('normaliseQuestions — authoring validation', () => {
  test('trims and returns a clean question set', () => {
    const [clean] = quizService.normaliseQuestions([
      { prompt: '  Why?  ', options: ['  a ', 'b'], correctIndex: 1, explanation: ' because ' },
    ]);

    expect(clean).toEqual({
      prompt: 'Why?',
      options: ['a', 'b'],
      correctIndex: 1,
      explanation: 'because',
    });
  });

  test('undefined passes through, so a PATCH that omits questions stays partial', () => {
    expect(quizService.normaliseQuestions(undefined)).toBeUndefined();
  });

  test('rejects a question with no prompt, naming the row the author sees', () => {
    expect(() => quizService.normaliseQuestions([question({ prompt: '   ' })])).toThrow(
      /Question 1 needs a prompt/,
    );
  });

  test('rejects fewer than two options', () => {
    expect(() => quizService.normaliseQuestions([question({ options: ['only one'] })])).toThrow(
      /at least 2 options/,
    );
  });

  test('rejects more than six options', () => {
    const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(() => quizService.normaliseQuestions([question({ options })])).toThrow(/at most 6/);
  });

  // The failure an author cannot see by reading their own form: options written,
  // none marked, and a quiz that nobody can pass.
  test('rejects a correctIndex that points past the options', () => {
    expect(() => quizService.normaliseQuestions([question({ correctIndex: 9 })])).toThrow(
      /marked as the correct answer/,
    );
  });

  test('rejects a non-integer correctIndex', () => {
    expect(() => quizService.normaliseQuestions([question({ correctIndex: null })])).toThrow(
      /marked as the correct answer/,
    );
  });

  test('blank options are dropped before the count is checked', () => {
    expect(() =>
      quizService.normaliseQuestions([question({ options: ['a', '   ', ''] })]),
    ).toThrow(/at least 2 options/);
  });

  test('rejects a non-array', () => {
    expect(() => quizService.normaliseQuestions('nope')).toThrow(/must be an array/);
  });
});

describe('questionsForStudent — the answer key stays server-side', () => {
  test('sends prompts and options only', () => {
    const projected = quizService.questionsForStudent([question(), question()]);

    projected.forEach((q) => {
      expect(q).not.toHaveProperty('correctIndex');
      expect(q).not.toHaveProperty('explanation');
      expect(Object.keys(q).sort()).toEqual(['index', 'options', 'prompt']);
    });
  });

  test('carries the original index so a submitted sheet lines up', () => {
    expect(quizService.questionsForStudent([question(), question()]).map((q) => q.index)).toEqual([
      0, 1,
    ]);
  });
});

describe('grade', () => {
  const lesson = (over = {}) => ({
    questions: [question(), question({ correctIndex: 2 }), question({ correctIndex: 1 })],
    passMark: 70,
    ...over,
  });

  test('scores a perfect sheet and passes it', () => {
    const result = quizService.grade(lesson(), [0, 2, 1]);

    expect(result.correctCount).toBe(3);
    expect(result.total).toBe(3);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  test('an unanswered question counts as wrong rather than erroring', () => {
    const result = quizService.grade(lesson(), [0, null, 1]);

    expect(result.correctCount).toBe(2);
    expect(result.results[1]).toMatchObject({ answered: false, correct: false, selectedIndex: null });
  });

  test('a short sheet grades the questions it covers', () => {
    const result = quizService.grade(lesson(), [0]);

    expect(result.correctCount).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  test('an out-of-range selection is treated as unanswered', () => {
    const result = quizService.grade(lesson(), [99, 2, 1]);

    expect(result.results[0]).toMatchObject({ answered: false, correct: false });
    expect(result.correctCount).toBe(2);
  });

  // The rounded score is what the learner is shown, so the pass decision must be
  // made on the same number — otherwise "67%" can sit beside a pass mark of 67
  // and report a fail.
  test('the pass decision uses the same rounded score that is displayed', () => {
    const result = quizService.grade(lesson({ passMark: 67 }), [0, 2, null]);

    expect(result.score).toBe(67);
    expect(result.passed).toBe(true);
  });

  test('respects a custom pass mark', () => {
    const result = quizService.grade(lesson({ passMark: 100 }), [0, 2, null]);

    expect(result.passed).toBe(false);
  });

  test('defaults the pass mark to 70 when the lesson has none', () => {
    const result = quizService.grade(lesson({ passMark: undefined }), [0, 2, null]);

    expect(result.passMark).toBe(70);
    expect(result.passed).toBe(false);
  });

  test('feedback carries the correct answer and explanation back', () => {
    const result = quizService.grade(lesson(), [1, 2, 1]);

    expect(result.results[0]).toMatchObject({
      correct: false,
      selectedIndex: 1,
      correctIndex: 0,
      explanation: 'It writes its arguments to stdout.',
    });
  });

  test('refuses a quiz with no questions instead of scoring 0 of 0', () => {
    expect(() => quizService.grade({ questions: [] }, [])).toThrow(/no questions/);
  });

  test('rejects a non-array answer sheet', () => {
    expect(() => quizService.grade(lesson(), 'a')).toThrow(/answers must be an array/);
  });

  test('rejects more answers than there are questions', () => {
    expect(() => quizService.grade(lesson(), [0, 0, 0, 0])).toThrow(/More answers/);
  });
});

// `Number(null)` and `Number('')` are both 0, so coercing the raw value would
// have marked the FIRST option correct for a question the author never
// answered — an answer key that is wrong, valid, and invisible until a learner
// loses marks on it.
describe('normaliseQuestions — correctIndex is never coerced from nothing', () => {
  const base = {
    prompt: 'Pick one',
    options: ['a', 'b', 'c'],
    explanation: '',
  };

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['a non-numeric string', 'first'],
    ['a fraction', 1.5],
    ['a boolean', false],
  ])('rejects %s rather than defaulting to option 1', (_label, correctIndex) => {
    expect(() => quizService.normaliseQuestions([{ ...base, correctIndex }])).toThrow(
      /marked as the correct answer/,
    );
  });

  test('accepts a numeric string, because that is what a form sends', () => {
    const [clean] = quizService.normaliseQuestions([{ ...base, correctIndex: '2' }]);

    expect(clean.correctIndex).toBe(2);
  });

  test('accepts index 0, which must not be mistaken for "unset"', () => {
    const [clean] = quizService.normaliseQuestions([{ ...base, correctIndex: 0 }]);

    expect(clean.correctIndex).toBe(0);
  });
});
