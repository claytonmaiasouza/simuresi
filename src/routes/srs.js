const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth, requireActivePlan } = require("../middleware/requireAuth");
const { validateBody, validateParams } = require("../middleware/validate");
const { awardXPAndPersist } = require("../services/xpAward");
const { BOX_DAYS, DAY_MS } = require("../services/gamify");

const router = express.Router();
router.use(requireAuth);

const XP_BY_RATING = { again: 2, hard: 5, easy: 8 };

const cardIdParamSchema = z.object({ cardId: z.string().min(1).max(40) });
const rateSchema = z.object({ rating: z.enum(["again", "hard", "easy"]) });

router.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.flashcardSrsState.findMany({ where: { userId: req.user.id } });
    const map = {};
    rows.forEach((r) => {
      map[r.cardId] = { box: r.box, due: r.due.getTime(), reps: r.reps };
    });
    res.json(map);
  } catch (err) {
    next(err);
  }
});

// The rating (again/hard/easy) is submitted, not a client-computed
// box/due/reps — the server owns the SRS scheduling math (same algorithm
// the original client used in rateFlashCard) so a client can't hand-craft
// an arbitrary due date, box, or XP amount.
router.put(
  "/:cardId",
  requireActivePlan,
  validateParams(cardIdParamSchema),
  validateBody(rateSchema),
  async (req, res, next) => {
    try {
      const { cardId } = req.params;
      const { rating } = req.body;

      const existing = await prisma.flashcardSrsState.findUnique({
        where: { userId_cardId: { userId: req.user.id, cardId } },
      });

      let box = existing ? existing.box : 0;
      const reps = (existing ? existing.reps : 0) + 1;
      let due;

      if (rating === "again") {
        box = 0;
        due = new Date();
      } else if (rating === "hard") {
        box = Math.max(box, 1);
        due = new Date(Date.now() + BOX_DAYS[box] * DAY_MS);
      } else {
        box = Math.min(box + 1, BOX_DAYS.length - 1);
        due = new Date(Date.now() + BOX_DAYS[box] * DAY_MS);
      }

      const srsState = await prisma.flashcardSrsState.upsert({
        where: { userId_cardId: { userId: req.user.id, cardId } },
        create: { userId: req.user.id, cardId, box, due, reps },
        update: { box, due, reps },
      });

      const xpResult = await awardXPAndPersist(req.user.id, XP_BY_RATING[rating]);

      res.json({ srsState: { box: srsState.box, due: srsState.due.getTime(), reps: srsState.reps }, xpResult });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
