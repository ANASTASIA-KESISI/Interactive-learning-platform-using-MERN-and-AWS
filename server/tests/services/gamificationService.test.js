const {
  xpForLevel,
  levelFromXp,
  rankForLevel,
  gamificationSummary,
  _internal: { applyHintDiscount, utcDayDiff, updateStreak, evaluateBadges },
} = require('../../src/services/gamificationService');

describe('applyHintDiscount', () => {
  test('full XP when no hints used', () => {
    expect(applyHintDiscount(20, 0)).toBe(20);
  });

  test('50% XP after first hint', () => {
    expect(applyHintDiscount(20, 1)).toBe(10);
  });

  test('20% XP from second hint onwards', () => {
    expect(applyHintDiscount(20, 2)).toBe(4);
    expect(applyHintDiscount(20, 5)).toBe(4);
  });

  test('rounds discounted XP to nearest integer', () => {
    expect(applyHintDiscount(15, 1)).toBe(8);
    expect(applyHintDiscount(15, 2)).toBe(3);
  });

  test('treats negative hints as zero', () => {
    expect(applyHintDiscount(20, -1)).toBe(20);
  });
});

describe('utcDayDiff', () => {
  test('same calendar day in UTC returns 0', () => {
    const a = new Date('2026-05-10T01:00:00Z');
    const b = new Date('2026-05-10T23:59:59Z');
    expect(utcDayDiff(a, b)).toBe(0);
  });

  test('next UTC day returns 1', () => {
    const a = new Date('2026-05-10T23:00:00Z');
    const b = new Date('2026-05-11T01:00:00Z');
    expect(utcDayDiff(a, b)).toBe(1);
  });

  test('multi-day gap returns the day count', () => {
    const a = new Date('2026-05-01T12:00:00Z');
    const b = new Date('2026-05-08T12:00:00Z');
    expect(utcDayDiff(a, b)).toBe(7);
  });
});

describe('updateStreak', () => {
  test('first completion ever sets streak to 1', () => {
    const user = { streak: 0, lastCompletionAt: null };
    updateStreak(user, new Date('2026-05-10T10:00:00Z'));
    expect(user.streak).toBe(1);
    expect(user.lastCompletionAt.toISOString()).toBe('2026-05-10T10:00:00.000Z');
  });

  test('same-day completion does not change streak', () => {
    const user = { streak: 3, lastCompletionAt: new Date('2026-05-10T08:00:00Z') };
    updateStreak(user, new Date('2026-05-10T22:00:00Z'));
    expect(user.streak).toBe(3);
  });

  test('next-day completion increments streak', () => {
    const user = { streak: 3, lastCompletionAt: new Date('2026-05-10T22:00:00Z') };
    updateStreak(user, new Date('2026-05-11T08:00:00Z'));
    expect(user.streak).toBe(4);
  });

  test('gap of 2+ days resets streak to 1', () => {
    const user = { streak: 12, lastCompletionAt: new Date('2026-05-01T10:00:00Z') };
    updateStreak(user, new Date('2026-05-05T10:00:00Z'));
    expect(user.streak).toBe(1);
  });

  // Regression for S5.5 finding A1: `attachUser` refreshes `lastActiveAt` on
  // every request, so a same-day login used to make the streak diff 0 and
  // pinned the streak forever. Streaks must key off completions only.
  test('a login today does not suppress yesterday-to-today increment', () => {
    const user = {
      streak: 4,
      lastCompletionAt: new Date('2026-05-10T20:00:00Z'),
      lastActiveAt: new Date('2026-05-11T09:00:00Z'),
    };
    updateStreak(user, new Date('2026-05-11T10:00:00Z'));
    expect(user.streak).toBe(5);
  });
});

describe('evaluateBadges', () => {
  const makeBadge = (overrides) => ({
    _id: { toString: () => overrides.name },
    name: overrides.name,
    icon: overrides.icon || '🏅',
    description: overrides.description || '',
    criteria: overrides.criteria,
    xpValue: overrides.xpValue || 0,
  });

  test('awards a lessons_completed badge when threshold reached', () => {
    const user = { xpPoints: 0, streak: 0, lessonsCompleted: 1, badges: [] };
    const badges = [
      makeBadge({ name: 'First Steps', criteria: { type: 'lessons_completed', threshold: 1 }, xpValue: 25 }),
    ];
    const awarded = evaluateBadges(user, badges);
    expect(awarded).toHaveLength(1);
    expect(awarded[0].name).toBe('First Steps');
    expect(user.xpPoints).toBe(25);
    expect(user.badges).toHaveLength(1);
  });

  // One case per criteria type added after the original three. Each asserts
  // the counter it reads, because the failure mode of a wrong mapping is a
  // badge that silently never awards.
  test.each([
    ['unaided_completions', 'unaidedCompletions'],
    ['quizzes_passed', 'quizzesPassed'],
    ['courses_completed', 'coursesCompleted'],
    ['notes_written', 'notesWritten'],
  ])('awards a %s badge from the %s counter', (type, counter) => {
    const user = { xpPoints: 0, streak: 0, lessonsCompleted: 0, badges: [], [counter]: 3 };
    const badges = [makeBadge({ name: 'Earned', criteria: { type, threshold: 3 }, xpValue: 10 })];

    expect(evaluateBadges(user, badges).map((b) => b.name)).toEqual(['Earned']);
    expect(user.xpPoints).toBe(10);
  });

  test('withholds a badge whose counter is still short of the threshold', () => {
    const user = { xpPoints: 0, streak: 0, lessonsCompleted: 0, badges: [], quizzesPassed: 2 };
    const badges = [makeBadge({ name: 'Quiz Master', criteria: { type: 'quizzes_passed', threshold: 3 } })];

    expect(evaluateBadges(user, badges)).toEqual([]);
  });

  test('treats a missing counter as zero rather than throwing', () => {
    // A pre-S8 user document has none of the new fields on it.
    const user = { xpPoints: 0, streak: 0, lessonsCompleted: 0, badges: [] };
    const badges = [makeBadge({ name: 'On Your Own', criteria: { type: 'unaided_completions', threshold: 1 } })];

    expect(evaluateBadges(user, badges)).toEqual([]);
  });

  test('ignores a criteria type it does not know', () => {
    // A badge seeded by a newer build must not break the award path for a
    // server that predates it.
    const user = { xpPoints: 9999, streak: 99, lessonsCompleted: 99, badges: [] };
    const badges = [makeBadge({ name: 'From The Future', criteria: { type: 'moon_landings', threshold: 1 } })];

    expect(evaluateBadges(user, badges)).toEqual([]);
    expect(user.xpPoints).toBe(9999);
  });

  test('does not re-award an already earned badge', () => {
    const earnedId = { toString: () => 'First Steps' };
    const user = { xpPoints: 25, streak: 0, lessonsCompleted: 1, badges: [earnedId] };
    const badges = [
      makeBadge({ name: 'First Steps', criteria: { type: 'lessons_completed', threshold: 1 }, xpValue: 25 }),
    ];
    const awarded = evaluateBadges(user, badges);
    expect(awarded).toHaveLength(0);
    expect(user.xpPoints).toBe(25);
  });

  test('cascades: badge XP can trigger another xp_reached badge', () => {
    const user = { xpPoints: 75, streak: 0, lessonsCompleted: 5, badges: [] };
    const badges = [
      // 5-lesson badge awards 50 XP, pushing user to 125 XP and triggering Centurion
      makeBadge({ name: 'Getting Started', criteria: { type: 'lessons_completed', threshold: 5 }, xpValue: 50 }),
      makeBadge({ name: 'Centurion', criteria: { type: 'xp_reached', threshold: 100 }, xpValue: 0 }),
    ];
    const awarded = evaluateBadges(user, badges);
    expect(awarded.map((a) => a.name).sort()).toEqual(['Centurion', 'Getting Started']);
    expect(user.xpPoints).toBe(125);
  });

  test('returns empty when no thresholds met', () => {
    const user = { xpPoints: 10, streak: 1, lessonsCompleted: 0, badges: [] };
    const badges = [
      makeBadge({ name: 'Centurion', criteria: { type: 'xp_reached', threshold: 100 } }),
    ];
    const awarded = evaluateBadges(user, badges);
    expect(awarded).toHaveLength(0);
  });
});

// ── Level & rank (S7 D8) ──────────────────────────────────────────────────────
//
// xpForLevel(n) = 50·(n−1)·n is the CUMULATIVE XP needed to reach level n, so
// the band widths grow linearly (100, 200, 300 …). These are pure display
// functions — nothing is stored, so a threshold change re-levels everyone.
describe('xpForLevel', () => {
  test.each([
    [1, 0],
    [2, 100],
    [3, 300],
    [4, 600],
    [5, 1000],
    [10, 4500],
  ])('level %i requires %i cumulative XP', (level, xp) => {
    expect(xpForLevel(level)).toBe(xp);
  });
});

describe('levelFromXp', () => {
  test.each([
    [0, 1, 0, 100],
    [99, 1, 99, 100],
    [100, 2, 0, 200],
    [299, 2, 199, 200],
    [300, 3, 0, 300],
    [600, 4, 0, 400],
    [1000, 5, 0, 500],
    [1250, 5, 250, 500],
    [4500, 10, 0, 1000],
  ])('%i XP → level %i (%i/%i into the level)', (xp, level, into, next) => {
    expect(levelFromXp(xp)).toEqual({
      level,
      xpIntoLevel: into,
      xpForNextLevel: next,
    });
  });

  test('treats negative or non-numeric XP as zero', () => {
    expect(levelFromXp(-50).level).toBe(1);
    expect(levelFromXp(undefined)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 });
  });

  test('xpIntoLevel never exceeds xpForNextLevel', () => {
    for (let xp = 0; xp <= 5000; xp += 37) {
      const { xpIntoLevel, xpForNextLevel } = levelFromXp(xp);
      expect(xpIntoLevel).toBeGreaterThanOrEqual(0);
      expect(xpIntoLevel).toBeLessThan(xpForNextLevel);
    }
  });
});

describe('rankForLevel', () => {
  test.each([
    [1, 'Bronze I'],
    [2, 'Bronze II'],
    [3, 'Bronze III'],
    [4, 'Silver I'],
    [5, 'Silver II'],
    [6, 'Silver III'],
    [7, 'Gold I'],
    [8, 'Gold II'],
    [9, 'Gold III'],
    [10, 'Platinum'],
    [42, 'Platinum'],
  ])('level %i → %s', (level, rank) => {
    expect(rankForLevel(level)).toBe(rank);
  });

  test('falls back to the first tier for a nonsense level', () => {
    expect(rankForLevel(0)).toBe('Bronze I');
    expect(rankForLevel(undefined)).toBe('Bronze I');
  });
});

describe('gamificationSummary', () => {
  test('assembles the block every consumer renders', () => {
    expect(gamificationSummary({ xpPoints: 650, streak: 4 })).toEqual({
      xpPoints: 650,
      level: 4,
      xpIntoLevel: 50,
      xpForNextLevel: 400,
      rank: 'Silver I',
      streak: 4,
    });
  });

  test('defaults a brand new user to level 1 / Bronze I', () => {
    expect(gamificationSummary({})).toEqual({
      xpPoints: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNextLevel: 100,
      rank: 'Bronze I',
      streak: 0,
    });
  });
});
