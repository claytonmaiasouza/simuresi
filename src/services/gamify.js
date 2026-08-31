// Server-authoritative port of the XP/level/streak math from the original
// client-only simulacro-residentado.html (functions: touchStreak, awardXP,
// levelInfo, thresholdForLevel). Constants and algorithms must match the
// frontend exactly so displayed numbers never disagree.

const LEVEL_THRESHOLDS = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600,
  9200, 11000, 13000, 15200, 17600, 20200,
];
const LEVEL_STEP_AFTER = 2500;

const BOX_DAYS = [0, 1, 3, 7, 16, 35, 90];
const DAY_MS = 24 * 60 * 60 * 1000;

function todayStr(d) {
  const y = d.getFullYear();
  const m = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

function dateFromStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function diffDaysStr(a, b) {
  const ms = dateFromStr(b) - dateFromStr(a);
  return Math.round(ms / DAY_MS);
}

function thresholdForLevel(level) {
  if (level <= 1) return 0;
  const idx = level - 1;
  if (idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx];
  const over = idx - (LEVEL_THRESHOLDS.length - 1);
  return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + over * LEVEL_STEP_AFTER;
}

function levelInfo(xp) {
  let level = 1;
  while (thresholdForLevel(level + 1) <= xp) level++;
  const floor = thresholdForLevel(level);
  const ceil = thresholdForLevel(level + 1);
  const pct = ceil > floor ? Math.round(((xp - floor) / (ceil - floor)) * 100) : 100;
  return { level, floor, ceil, pct: Math.max(0, Math.min(100, pct)) };
}

/**
 * Mutates the flat streak fields of a GamifyState-shaped row in place
 * (streakCurrent, streakLongest, streakLastActiveDate, streakFreezes).
 * Mirrors the client's touchStreak(g) operating on g.streak.*.
 */
function touchStreak(row) {
  const today = todayStr(new Date());
  if (row.streakLastActiveDate === today) return;

  if (!row.streakLastActiveDate) {
    row.streakCurrent = 1;
  } else {
    const gap = diffDaysStr(row.streakLastActiveDate, today);
    if (gap === 1) {
      row.streakCurrent++;
    } else if (gap === 2 && row.streakFreezes > 0) {
      row.streakFreezes--;
      row.streakCurrent++;
      row.freezeUsed = true;
    } else if (gap >= 2) {
      row.streakCurrent = 1;
    }
  }
  row.streakLongest = Math.max(row.streakLongest || 0, row.streakCurrent);
  row.streakLastActiveDate = today;
  if (row.streakCurrent > 0 && row.streakCurrent % 7 === 0 && row.streakFreezes < 1) {
    row.streakFreezes = 1;
  }
}

/**
 * Mutates row.xp, row.lastXpDate, row.weekXp in place and returns the same
 * shape awardXP() returned client-side: {gained, base, dailyBonus, streak,
 * freezeUsed, xpTotal}. Caller is responsible for persisting `row` (and for
 * calling the league rollover check first, since weekXp accrual should
 * happen against the current week).
 */
function awardXP(row, amount) {
  const today = todayStr(new Date());
  const dailyBonus = row.lastXpDate !== today ? 5 : 0;
  row.lastXpDate = today;
  touchStreak(row);
  const total = amount + dailyBonus;
  row.xp += total;
  row.weekXp = (row.weekXp || 0) + total;
  return {
    gained: total,
    base: amount,
    dailyBonus,
    streak: row.streakCurrent,
    freezeUsed: !!row.freezeUsed,
    xpTotal: row.xp,
  };
}

module.exports = {
  LEVEL_THRESHOLDS,
  LEVEL_STEP_AFTER,
  BOX_DAYS,
  DAY_MS,
  todayStr,
  dateFromStr,
  diffDaysStr,
  thresholdForLevel,
  levelInfo,
  touchStreak,
  awardXP,
};
