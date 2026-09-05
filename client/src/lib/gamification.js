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
