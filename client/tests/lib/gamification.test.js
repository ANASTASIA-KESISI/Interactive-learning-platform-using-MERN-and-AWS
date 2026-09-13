import { levelProgressPct, formatXp } from '../../src/lib/gamification.js';

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
