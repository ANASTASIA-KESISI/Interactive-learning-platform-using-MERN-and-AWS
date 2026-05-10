const {
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
  test('first activity ever sets streak to 1', () => {
    const user = { streak: 0, lastActiveAt: null };
    updateStreak(user, new Date('2026-05-10T10:00:00Z'));
    expect(user.streak).toBe(1);
    expect(user.lastActiveAt.toISOString()).toBe('2026-05-10T10:00:00.000Z');
  });

  test('same-day completion does not change streak', () => {
    const user = { streak: 3, lastActiveAt: new Date('2026-05-10T08:00:00Z') };
    updateStreak(user, new Date('2026-05-10T22:00:00Z'));
    expect(user.streak).toBe(3);
  });

  test('next-day completion increments streak', () => {
    const user = { streak: 3, lastActiveAt: new Date('2026-05-10T22:00:00Z') };
    updateStreak(user, new Date('2026-05-11T08:00:00Z'));
    expect(user.streak).toBe(4);
  });

  test('gap of 2+ days resets streak to 1', () => {
    const user = { streak: 12, lastActiveAt: new Date('2026-05-01T10:00:00Z') };
    updateStreak(user, new Date('2026-05-05T10:00:00Z'));
    expect(user.streak).toBe(1);
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
