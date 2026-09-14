import { titleCase, optionLabel } from '../../src/lib/labels.js';

describe('titleCase', () => {
  test('capitalises ordinary enum values', () => {
    expect(titleCase('beginner')).toBe('Beginner');
    expect(titleCase('quiz')).toBe('Quiz');
  });

  test('uses the proper spelling for language names', () => {
    expect(titleCase('javascript')).toBe('JavaScript');
    expect(titleCase('JAVASCRIPT')).toBe('JavaScript');
    expect(titleCase('python')).toBe('Python');
    expect(titleCase('js')).toBe('JS');
  });

  test('reads snake_case and kebab-case as words', () => {
    expect(titleCase('code_exercise')).toBe('Code Exercise');
    expect(titleCase('multiple-choice')).toBe('Multiple Choice');
    expect(titleCase('  padded   value ')).toBe('Padded Value');
  });

  test('returns an empty string for nothing', () => {
    expect(titleCase(null)).toBe('');
    expect(titleCase(undefined)).toBe('');
    expect(titleCase('   ')).toBe('');
  });

  test('optionLabel is the same function', () => {
    expect(optionLabel).toBe(titleCase);
  });
});
