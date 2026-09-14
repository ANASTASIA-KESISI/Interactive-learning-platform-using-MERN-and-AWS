import {
  levelProgressPct,
  formatXp,
  hintXpPercent,
  hintDiscountedXp,
  DEFAULT_HINT_XP,
} from '../../src/lib/gamification.js';

describe('levelProgressPct', () => {
  test('returns the percentage of the current level filled', () => {
    expect(levelProgressPct({ xpIntoLevel: 25, xpForNextLevel: 100 })).toBe(25);
    expect(levelProgressPct({ xpIntoLevel: 1, xpForNextLevel: 3 })).toBe(33);
  });

  test('clamps a stale or overflowing payload to 0-100', () => {
    expect(levelProgressPct({ xpIntoLevel: 150, xpForNextLevel: 100 })).toBe(100);
    expect(levelProgressPct({ xpIntoLevel: -10, xpForNextLevel: 100 })).toBe(0);
  });

  test('is 0 when the level size is missing or invalid', () => {
    expect(levelProgressPct()).toBe(0);
    expect(levelProgressPct({ xpIntoLevel: 50, xpForNextLevel: 0 })).toBe(0);
    expect(levelProgressPct({ xpIntoLevel: 50, xpForNextLevel: -5 })).toBe(0);
  });
});

describe('formatXp', () => {
  test('prints values under 1000 as plain integers', () => {
    expect(formatXp(0)).toBe('0');
    expect(formatXp(950)).toBe('950');
    expect(formatXp(999.6)).toBe('1000');
  });

  test('abbreviates thousands to one decimal and drops a trailing .0', () => {
    expect(formatXp(1000)).toBe('1k');
    expect(formatXp(1250)).toBe('1.3k');
    expect(formatXp(12_000)).toBe('12k');
  });

  test('treats non-numeric input as zero', () => {
    expect(formatXp(undefined)).toBe('0');
    expect(formatXp('abc')).toBe('0');
    expect(formatXp('1500')).toBe('1.5k');
  });
});

// S9: the hint cost comes from the lesson; a lesson without one uses the pilot
// rule. These only format what the server decides, so the numbers must match
// applyHintDiscount exactly.
describe('hint cost mirror', () => {
  test('defaults to 100 → 50 → 20 when the lesson carries no hintXp', () => {
    expect(hintXpPercent(0)).toBe(100);
    expect(hintXpPercent(1)).toBe(DEFAULT_HINT_XP.afterOne);
    expect(hintXpPercent(2)).toBe(DEFAULT_HINT_XP.afterMore);
    expect(hintDiscountedXp(20, 1)).toBe(10);
    expect(hintDiscountedXp(20, 3)).toBe(4);
  });

  test('uses the lesson\'s own cost when present', () => {
    const hintXp = { afterOne: 80, afterMore: 60 };
    expect(hintDiscountedXp(20, 1, hintXp)).toBe(16);
    expect(hintDiscountedXp(20, 2, hintXp)).toBe(12);
    expect(hintXpPercent(5, hintXp)).toBe(60);
  });

  test('a partial or malformed hintXp falls back field by field', () => {
    expect(hintXpPercent(2, { afterOne: 80 })).toBe(20);
    expect(hintXpPercent(1, { afterOne: 'x', afterMore: 5 })).toBe(50);
  });
});
