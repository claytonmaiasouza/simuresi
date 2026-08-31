const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth, requireActivePlan } = require("../middleware/requireAuth");
const { historyWriteLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const { awardXPAndPersist } = require("../services/xpAward");

const router = express.Router();
router.use(requireAuth);

// The largest official simulacro is Bloque I at 80 questions; clamp at 90
// with headroom so a client bug/tamper attempt can't inflate XP with an
// absurd "total" without a full server-side re-grade (flagged as a possible
// future upgrade if leaderboard gaming becomes a real problem).
const MAX_QUESTIONS = 90;

const attemptSchema = z
  .object({
    mode: z.string().min(1).max(40),
    modeLabel: z.string().min(1).max(80),
    total: z.number().int().min(1).max(MAX_QUESTIONS),
    answered: z.number().int().min(0),
    correct: z.number().int().min(0),
    usedSeconds: z.number().int().min(0).max(24 * 60 * 60),
    timeBudget: z.number().int().min(0).max(24 * 60 * 60),
    exitedEarly: z.boolean().default(false),
    isSimulacro: z.boolean(),
    byArea: z.record(z.object({ correct: z.number().int().min(0), total: z.number().int().min(0) })),
  })
  .refine((v) => v.correct <= v.total, { message: "correct cannot exceed total" })
  .refine((v) => v.answered <= v.total, { message: "answered cannot exceed total" });

router.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.examAttempt.findMany({
      where: { userId: req.user.id },
      orderBy: { date: "desc" },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireActivePlan, historyWriteLimiter, validateBody(attemptSchema), async (req, res, next) => {
  try {
    const body = req.body;

    const record = await prisma.examAttempt.create({
      data: {
        userId: req.user.id,
        date: new Date(),
        mode: body.mode,
        modeLabel: body.modeLabel,
        total: body.total,
        answered: body.answered,
        correct: body.correct,
        usedSeconds: body.usedSeconds,
        timeBudget: body.timeBudget,
        exitedEarly: body.exitedEarly,
        isSimulacro: body.isSimulacro,
        byArea: body.byArea,
      },
    });

    const sessionBonus = !body.exitedEarly && body.total >= 5 ? 15 : 0;
    const xpResult = await awardXPAndPersist(req.user.id, body.correct * 10 + sessionBonus);

    res.status(201).json({ record, xpResult });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    await prisma.examAttempt.deleteMany({ where: { userId: req.user.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
