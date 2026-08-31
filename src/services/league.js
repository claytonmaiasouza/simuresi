// Server-authoritative port of the weekly-league math from the original
// client-only simulacro-residentado.html (LEAGUE_TIERS, isoWeekKey,
// mulberry32, seedFromStr, generateBots, ensureWeeklyLeague). Real users now
// replace the client's fake-bot-only comparison; bots are only blended in to
// pad a sparse tier so early adopters still see a motivating leaderboard.

const prisma = require("../db");

const LEAGUE_TIERS = [
  { name: "Bronce", color: "#A15C2E" },
  { name: "Plata", color: "#8B95A1" },
  { name: "Oro", color: "#C99A2E" },
  { name: "Zafiro", color: "#2F6FA8" },
  { name: "Rubí", color: "#B23A52" },
  { name: "Esmeralda", color: "#2E8B57" },
  { name: "Amatista", color: "#7B4FA0" },
  { name: "Perla", color: "#AFA48C" },
  { name: "Obsidiana", color: "#4A4A52" },
  { name: "Diamante", color: "#3FB6C9" },
];

const BOT_NAMES = [
  "Ariana", "Bruno", "Camila", "Diego", "Elena", "Fabián", "Gabriela", "Hugo", "Isabela", "Joaquín",
  "Karina", "Lucas", "Mariana", "Nicolás", "Olivia", "Pablo", "Rocío", "Santiago", "Tamara", "Valentina",
  "Ximena", "Yago", "Zunilda", "Agustín", "Belén", "Cristian", "Dahiana", "Emiliano", "Florencia", "Gonzalo",
];

const MIN_TIER_SIZE = 5; // below this many real users, pad with deterministic bots

function isoWeekKey(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${("0" + weekNo).slice(-2)}`;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function generateBots(weekKey, tierIndex) {
  const rnd = mulberry32(seedFromStr(weekKey + "|" + tierIndex));
  const pool = BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const names = pool.slice(0, 9);
  const min = 15 + tierIndex * 18;
  const max = 90 + tierIndex * 55;
  return names.map((name) => {
    const blended = (rnd() + rnd()) / 2;
    return { name, xp: Math.round(min + blended * (max - min)), who: "bot" };
  });
}

/**
 * Ranks a user against their peer group for a given (weekKey, tierIndex),
 * blending in deterministic bots when the real-user count is below
 * MIN_TIER_SIZE. Returns { rows, rank, total, realUserCount } where rows are
 * sorted desc by xp and rank/total describe the given user's position.
 */
async function rankTier(weekKey, tierIndex, userId, userWeekXp) {
  const realRows = await prisma.gamifyState.findMany({
    where: { weekKey, tierIndex },
    orderBy: { weekXp: "desc" },
    take: 200,
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  let rows = realRows.map((r) => ({
    who: r.userId === userId ? "user" : "real",
    userId: r.userId,
    name: r.userId === userId ? "Vos" : r.user.name || r.user.email.split("@")[0],
    xp: r.weekXp,
  }));

  // if the requesting user isn't in the query result yet (e.g. this is being
  // called mid-rollover before the row is written), make sure they're present
  if (!rows.some((r) => r.userId === userId)) {
    rows.push({ who: "user", userId, name: "Vos", xp: userWeekXp || 0 });
  }

  const realUserCount = rows.length;
  if (realUserCount < MIN_TIER_SIZE) {
    const bots = generateBots(weekKey, tierIndex);
    rows = rows.concat(bots);
  }

  rows.sort((a, b) => b.xp - a.xp);
  const rank = rows.findIndex((r) => r.who === "user") + 1;

  return { rows, rank, total: rows.length, realUserCount };
}

/**
 * Lazily rolls a GamifyState row forward to the current ISO week if needed.
 * Mutates `row`'s tierIndex/weekKey/weekXp in place; caller persists it.
 * Returns the LeagueWeekResult data to persist (or null if no rollover
 * happened), matching the shape the old client stored as g.league.lastResult.
 */
async function ensureWeeklyLeague(row) {
  const wk = isoWeekKey(new Date());
  if (row.weekKey === wk) return null;

  let lastResult = null;
  if (row.weekKey) {
    const { rank, total, realUserCount } = await rankTier(row.weekKey, row.tierIndex, row.userId, row.weekXp);
    let promoted = false;
    let demoted = false;
    if (rank <= 3 && row.tierIndex < LEAGUE_TIERS.length - 1) {
      row.tierIndex++;
      promoted = true;
    } else if (rank > total - 3 && row.tierIndex > 0) {
      row.tierIndex--;
      demoted = true;
    }
    lastResult = {
      weekKey: row.weekKey,
      tierIndex: row.tierIndex,
      weekXp: row.weekXp,
      rank,
      totalInTier: total,
      promoted,
      demoted,
      realUserCount,
    };
  }

  row.weekKey = wk;
  row.weekXp = 0;
  return lastResult;
}

module.exports = {
  LEAGUE_TIERS,
  BOT_NAMES,
  MIN_TIER_SIZE,
  isoWeekKey,
  mulberry32,
  seedFromStr,
  generateBots,
  rankTier,
  ensureWeeklyLeague,
};
