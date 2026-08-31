const prisma = require("../db");
const gamifyService = require("./gamify");
const leagueService = require("./league");

async function getOrCreateRow(userId) {
  const row = await prisma.gamifyState.findUnique({ where: { userId } });
  if (row) return row;
  return prisma.gamifyState.create({ data: { userId } });
}

async function persistRow(row) {
  return prisma.gamifyState.update({
    where: { userId: row.userId },
    data: {
      xp: row.xp,
      lastXpDate: row.lastXpDate,
      streakCurrent: row.streakCurrent,
      streakLongest: row.streakLongest,
      streakLastActiveDate: row.streakLastActiveDate,
      streakFreezes: row.streakFreezes,
      tierIndex: row.tierIndex,
      weekKey: row.weekKey,
      weekXp: row.weekXp,
    },
  });
}

/**
 * Fetches (or creates) the user's GamifyState row and runs the lazy weekly
 * rollover check on it. Used both by GET /api/gamify and GET /api/league
 * (which must reflect a rollover even without an XP-earning action having
 * just happened) and internally by awardXPAndPersist below.
 */
async function ensureRollover(userId) {
  const row = await getOrCreateRow(userId);
  const lastResult = await leagueService.ensureWeeklyLeague(row);
  if (lastResult) {
    await prisma.leagueWeekResult.upsert({
      where: { userId_weekKey: { userId, weekKey: lastResult.weekKey } },
      create: {
        userId,
        weekKey: lastResult.weekKey,
        tierIndex: lastResult.tierIndex,
        weekXp: lastResult.weekXp,
        rank: lastResult.rank,
        totalInTier: lastResult.totalInTier,
        promoted: lastResult.promoted,
        demoted: lastResult.demoted,
      },
      update: {},
    });
    await persistRow(row);
  }
  return { row, lastResult };
}

/**
 * Shared entry point for every XP-earning action (exam attempts, flashcard
 * ratings): rolls the week forward if needed, awards XP + touches the
 * streak, and persists the result. Used by routes/history.js and
 * routes/srs.js.
 */
async function awardXPAndPersist(userId, amount) {
  const { row } = await ensureRollover(userId);
  const xpResult = gamifyService.awardXP(row, amount);
  await persistRow(row);
  return xpResult;
}

module.exports = { ensureRollover, awardXPAndPersist };
