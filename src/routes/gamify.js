const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { ensureRollover } = require("../services/xpAward");
const leagueService = require("../services/league");

const router = express.Router();
router.use(requireAuth);

// Replaces loadGamify()/ensureWeeklyLeague(g) -- returns the same shape
// defaultGamify() produced client-side, so the frontend's existing render
// functions (which read g.xp, g.streak.current, g.league.tierIndex, etc.)
// need no changes once loadGamify() is rewritten to return this response.
router.get("/", async (req, res, next) => {
  try {
    const { row } = await ensureRollover(req.user.id);
    res.json({
      xp: row.xp,
      lastXpDate: row.lastXpDate,
      streak: {
        current: row.streakCurrent,
        longest: row.streakLongest,
        lastActiveDate: row.streakLastActiveDate,
        freezes: row.streakFreezes,
      },
      league: {
        tierIndex: row.tierIndex,
        weekKey: row.weekKey,
        weekXp: row.weekXp,
        bots: [],
        lastResult: null, // the one-time promo/demo banner lives on GET /api/league, not here
      },
    });
  } catch (err) {
    next(err);
  }
});

// Replaces the client-only generateBots()-based fake leaderboard in
// renderLeague() with a real ranking among registered users (padded with
// deterministic bots only when a tier is too sparse to feel alive yet).
router.get("/league", async (req, res, next) => {
  try {
    const { row } = await ensureRollover(req.user.id);
    const tier = leagueService.LEAGUE_TIERS[row.tierIndex];

    const { rows, realUserCount } = await leagueService.rankTier(row.weekKey, row.tierIndex, req.user.id, row.weekXp);

    const pendingResult = await prisma.leagueWeekResult.findFirst({
      where: { userId: req.user.id, seen: false },
      orderBy: { weekKey: "desc" },
    });
    let lastResult = null;
    if (pendingResult) {
      lastResult = {
        tierName: leagueService.LEAGUE_TIERS[pendingResult.tierIndex].name,
        rank: pendingResult.rank,
        total: pendingResult.totalInTier,
        promoted: pendingResult.promoted,
        demoted: pendingResult.demoted,
      };
      await prisma.leagueWeekResult.update({ where: { id: pendingResult.id }, data: { seen: true } });
    }

    res.json({
      tierIndex: row.tierIndex,
      tierName: tier.name,
      tierColor: tier.color,
      weekKey: row.weekKey,
      weekXp: row.weekXp,
      rows: rows.map((r) => ({ name: r.name, xp: r.xp, who: r.who })),
      realUserCount,
      lastResult,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
