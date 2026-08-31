const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { validateParams } = require("../middleware/validate");
const { billingProvider } = require("../services/billing/ManualProvider");

const router = express.Router();
router.use(requireAuth, requireAdmin);

const idParamSchema = z.object({ id: z.string().min(1).max(60) });

router.get("/users", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const users = await prisma.user.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      select: { id: true, email: true, name: true, role: true, planStatus: true, trialEndsAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/activate", validateParams(idParamSchema), async (req, res, next) => {
  try {
    const user = await billingProvider.activate(req.params.id, req.user.id);
    res.json({ id: user.id, planStatus: user.planStatus });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/expire", validateParams(idParamSchema), async (req, res, next) => {
  try {
    const user = await billingProvider.expire(req.params.id, req.user.id);
    res.json({ id: user.id, planStatus: user.planStatus });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
