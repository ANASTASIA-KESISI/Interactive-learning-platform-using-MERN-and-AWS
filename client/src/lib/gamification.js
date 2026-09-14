// Display-only mirrors of the server's level maths (S7 D8). The server is
// authoritative — `/api/me` and the submit response ship `level`,
// `xpIntoLevel` and `xpForNextLevel`; these only format them.

// Percentage of the current level the learner has filled, clamped to 0–100 so
// a stale payload can never overflow the bar.
export const levelProgressPct = ({ xpIntoLevel = 0, xpForNextLevel = 0 } = {}) => {
  if (!xpForNextLevel || xpForNextLevel <= 0) return 0;
  const pct = (xpIntoLevel / xpForNextLevel) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

// 950 → "950", 1 250 → "1.3k". Keeps the header pill a fixed width once pilot
// totals grow past four digits.
export const formatXp = (n) => {
  const xp = Number(n) || 0;
  if (xp < 1000) return String(Math.round(xp));
  return `${(xp / 1000).toFixed(1).replace(/\.0$/, '')}k`;
};

// Hint cost (S9). The server's `applyHintDiscount` is authoritative and the
// lesson carries its own `hintXp`; a lesson saved before the field existed
// arrives without it and falls back to the pilot rule (100 → 50 → 20).
export const DEFAULT_HINT_XP = Object.freeze({ afterOne: 50, afterMore: 20 });

const pct = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
};

// Percentage of the reward kept once `hintsUsed` hints have been revealed.
export const hintXpPercent = (hintsUsed, hintXp) => {
  if (hintsUsed <= 0) return 100;
  return hintsUsed === 1
    ? pct(hintXp?.afterOne, DEFAULT_HINT_XP.afterOne)
    : pct(hintXp?.afterMore, DEFAULT_HINT_XP.afterMore);
};

export const hintDiscountedXp = (xpReward, hintsUsed, hintXp) =>
  Math.round(((Number(xpReward) || 0) * hintXpPercent(hintsUsed, hintXp)) / 100);
