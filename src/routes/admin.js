const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { validateBody, validateParams } = require("../middleware/validate");
const { billingProvider } = require("../services/billing/ManualProvider");
const { extendPlan } = require("../services/billing/payments");

const router = express.Router();
router.use(requireAuth, requireAdmin);

const DAY = 24 * 60 * 60 * 1000;
const idParamSchema = z.object({ id: z.string().min(1).max(60) });

/** DB status can be stale (expiry is applied lazily), so derive the real one. */
function effectiveStatus(u, now) {
  if (u.planStatus === "TRIAL" && u.trialEndsAt < now) return "EXPIRED";
  if (u.planStatus === "ACTIVE" && u.planEndsAt && u.planEndsAt < now) return "EXPIRED";
  return u.planStatus;
}

function endsAtOf(u, status) {
  if (status === "TRIAL") return u.trialEndsAt;
  if (status === "ACTIVE") return u.planEndsAt || null;
  const end = u.planEndsAt || u.trialEndsAt;
  return end && end <= new Date() ? end : null;
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${("0" + (d.getUTCMonth() + 1)).slice(-2)}`;
}

router.get("/stats", async (req, res, next) => {
  try {
    const now = new Date();
    const users = await prisma.user.findMany({
      select: { planStatus: true, trialEndsAt: true, planEndsAt: true, createdAt: true, role: true },
    });
    const byStatus = { TRIAL: 0, ACTIVE: 0, EXPIRED: 0, CANCELED: 0 };
    let expiringSoon = 0;
    let newLast7 = 0;
    users.forEach((u) => {
      const st = effectiveStatus(u, now);
      byStatus[st] = (byStatus[st] || 0) + 1;
      const end = endsAtOf(u, st);
      if ((st === "TRIAL" || st === "ACTIVE") && end && end > now && end - now <= 7 * DAY) expiringSoon++;
      if (now - u.createdAt <= 7 * DAY) newLast7++;
    });

    const since7 = new Date(now.getTime() - 7 * DAY);
    const [attempts, cards] = await Promise.all([
      prisma.examAttempt.findMany({ where: { date: { gte: since7 } }, distinct: ["userId"], select: { userId: true } }),
      prisma.flashcardSrsState.findMany({ where: { updatedAt: { gte: since7 } }, distinct: ["userId"], select: { userId: true } }),
    ]);
    const active7 = new Set(attempts.map((a) => a.userId).concat(cards.map((c) => c.userId))).size;

    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const paid = await prisma.payment.findMany({
      where: { status: "PAID", paidAt: { gte: sixMonthsAgo } },
      select: { amount: true, paidAt: true },
    });
    const monthly = {};
    for (let i = 5; i >= 0; i--) {
      monthly[monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))] = 0;
    }
    let last30 = 0;
    paid.forEach((p) => {
      const k = monthKey(p.paidAt);
      if (k in monthly) monthly[k] += p.amount;
      if (now - p.paidAt <= 30 * DAY) last30 += p.amount;
    });
    const total = await prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true }, _count: true });

    res.json({
      totalUsers: users.length,
      byStatus,
      expiringSoon,
      newLast7,
      active7,
      revenue: {
        thisMonth: monthly[monthKey(now)] || 0,
        last30,
        total: total._sum.amount || 0,
        payments: total._count,
        monthly: Object.keys(monthly).map((k) => ({ month: k, amount: monthly[k] })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const now = new Date();
    const q = String(req.query.q || "").trim();
    const filter = String(req.query.filter || "").trim();
    const users = await prisma.user.findMany({
      where: q
        ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
        : undefined,
      include: { gamify: true, _count: { select: { examAttempts: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const [lastAtt, paid] = await Promise.all([
      prisma.examAttempt.groupBy({ by: ["userId"], _max: { date: true } }),
      prisma.payment.groupBy({ by: ["userId"], where: { status: "PAID" }, _sum: { amount: true } }),
    ]);
    const lastMap = new Map(lastAtt.map((r) => [r.userId, r._max.date]));
    const paidMap = new Map(paid.map((r) => [r.userId, r._sum.amount || 0]));

    let rows = users.map((u) => {
      const status = effectiveStatus(u, now);
      const endsAt = endsAtOf(u, status);
      const g = u.gamify;
      const lastActivity = [lastMap.get(u.id), g && g.lastXpDate ? new Date(g.lastXpDate + "T12:00:00Z") : null]
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status,
        endsAt,
        daysLeft: endsAt ? Math.ceil((new Date(endsAt) - now) / DAY) : null,
        lifetime: status === "ACTIVE" && !u.planEndsAt,
        createdAt: u.createdAt,
        attempts: u._count.examAttempts,
        lastActivity,
        xp: g ? g.xp : 0,
        streak: g ? g.streakCurrent : 0,
        freezes: g ? g.streakFreezes : 0,
        totalPaid: paidMap.get(u.id) || 0,
      };
    });

    if (["TRIAL", "ACTIVE", "EXPIRED", "CANCELED"].includes(filter)) rows = rows.filter((r) => r.status === filter);
    else if (filter === "expiring") rows = rows.filter((r) => (r.status === "TRIAL" || r.status === "ACTIVE") && r.daysLeft !== null && r.daysLeft <= 7);
    else if (filter === "inactive") rows = rows.filter((r) => !r.lastActivity || now - new Date(r.lastActivity) > 7 * DAY);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id", validateParams(idParamSchema), async (req, res, next) => {
  try {
    const [attempts, payments] = await Promise.all([
      prisma.examAttempt.findMany({
        where: { userId: req.params.id },
        orderBy: { date: "desc" },
        take: 10,
        select: { id: true, date: true, modeLabel: true, total: true, answered: true, correct: true },
      }),
      prisma.payment.findMany({ where: { userId: req.params.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    res.json({ attempts, payments });
  } catch (err) {
    next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  try {
    const status = String(req.query.status || "");
    const rows = await prisma.payment.findMany({
      where: ["PENDING", "PAID", "CANCELED"].includes(status) ? { status } : undefined,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(
      rows.map((p) => ({
        id: p.id,
        orderNumber: p.orderNumber,
        email: p.user.email,
        name: p.user.name,
        planCode: p.planCode,
        months: p.months,
        amount: p.amount,
        status: p.status,
        method: p.paymentMethod,
        note: p.note,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

const grantSchema = z
  .object({
    months: z.number().int().min(0).max(36).default(0),
    days: z.number().int().min(0).max(1100).default(0),
    amount: z.number().int().min(0).max(1000000000).default(0),
    method: z.enum(["transferencia", "efectivo", "pagopar", "cortesia", "otro"]).default("transferencia"),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.months > 0 || v.days > 0, { message: "months or days required" });

// Registers a manual payment (or courtesy when amount is 0) and extends access.
router.post("/users/:id/grant", validateParams(idParamSchema), validateBody(grantSchema), async (req, res, next) => {
  try {
    const { months, days, amount, method, note } = req.body;
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "not_found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          userId: target.id,
          planCode: months > 0 ? `manual-${months}m` : `manual-${days}d`,
          months,
          amount,
          status: "PAID",
          paidAt: new Date(),
          paymentMethod: method,
          note: [days > 0 && months > 0 ? `+${days} días` : null, note].filter(Boolean).join(" · ") || null,
          createdBy: req.user.id,
        },
      });
      return extendPlan(tx, target.id, { months, days }, req.user.id);
    });
    res.json({ id: updated.id, planStatus: updated.planStatus, planEndsAt: updated.planEndsAt });
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

const gamifySchema = z.object({
  freezes: z.number().int().min(0).max(50).optional(),
  streak: z.number().int().min(0).max(3650).optional(),
});

router.post("/users/:id/gamify", validateParams(idParamSchema), validateBody(gamifySchema), async (req, res, next) => {
  try {
    const data = {};
    if (req.body.freezes !== undefined) data.streakFreezes = req.body.freezes;
    if (req.body.streak !== undefined) {
      data.streakCurrent = req.body.streak;
      const cur = await prisma.gamifyState.findUnique({ where: { userId: req.params.id } });
      if (cur && req.body.streak > cur.streakLongest) data.streakLongest = req.body.streak;
      // Keep the streak alive: next activity counts as the next day.
      const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
      data.streakLastActiveDate = `${y.getFullYear()}-${("0" + (y.getMonth() + 1)).slice(-2)}-${("0" + y.getDate()).slice(-2)}`;
    }
    const g = await prisma.gamifyState.update({ where: { userId: req.params.id }, data });
    res.json({ streak: g.streakCurrent, freezes: g.streakFreezes });
  } catch (err) {
    next(err);
  }
});

const settings = require("../services/settings");
const pagopar = require("../services/billing/PagoparClient");

async function settingsView() {
  const s = await settings.get();
  return {
    prices: s.prices,
    publicKey: s.pagopar.publicKey || "",
    privateKeySet: !!s.pagopar.privateKey,
    privateKeySource: s.privateKeySource,
    whatsapp: s.whatsapp,
    url: s.url,
    instructions: s.instructions,
    enabled: await pagopar.isConfigured(),
    webhookUrl: "https://calendar.guiafinanceiro.pro/api/billing/webhook",
    returnUrl: "https://calendar.guiafinanceiro.pro/app?pago=1",
  };
}

router.get("/settings", async (req, res, next) => {
  try {
    res.json(await settingsView());
  } catch (err) {
    next(err);
  }
});

const price = z.number().int().min(0).max(1000000000);
const settingsSchema = z.object({
  prices: z.object({ "1m": price.optional(), "3m": price.optional(), "6m": price.optional() }).optional(),
  publicKey: z.string().trim().max(200).optional(),
  privateKey: z.string().trim().max(200).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  url: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\//i.test(v), "url must start with http(s)://").optional(),
  instructions: z.string().trim().max(1000).optional(),
});

router.put("/settings", validateBody(settingsSchema), async (req, res, next) => {
  try {
    await settings.update(req.body);
    res.json(await settingsView());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
