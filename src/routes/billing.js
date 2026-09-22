const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../db");
const settings = require("../services/settings");
const { requireAuth } = require("../middleware/requireAuth");
const { validateBody } = require("../middleware/validate");
const pagopar = require("../services/billing/PagoparClient");
const { confirmPayment } = require("../services/billing/payments");

const router = express.Router();

const perUser = (max) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => (req.session && req.session.userId) || req.ip,
  });

router.get("/plans", requireAuth, async (req, res, next) => {
  try {
    const s = await settings.get();
    res.json({ enabled: await pagopar.isConfigured(), currency: "PYG", plans: s.plans });
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = z.object({ plan: z.string().min(1).max(10) });

router.post("/checkout", requireAuth, perUser(20), validateBody(checkoutSchema), async (req, res, next) => {
  try {
    if (!(await pagopar.isConfigured())) return res.status(503).json({ error: "payments_not_configured" });
    const plan = (await settings.get()).plans.find((p) => p.code === req.body.plan);
    if (!plan) return res.status(400).json({ error: "invalid_plan" });

    const payment = await prisma.payment.create({
      data: { userId: req.user.id, planCode: plan.code, months: plan.months, amount: plan.amount },
    });

    let hash;
    try {
      ({ hash } = await pagopar.createOrder({ payment, user: req.user }));
    } catch (err) {
      console.error("pagopar createOrder failed:", err.message);
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "CANCELED" } });
      return res.status(502).json({ error: "gateway_error" });
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { pagoparHash: hash } });
    res.json({ url: await pagopar.payUrl(hash) });
  } catch (err) {
    next(err);
  }
});

// Called by the app when the customer comes back from Pagopar (covers a
// missed/late webhook): re-checks the user's pending payments with Pagopar.
router.post("/sync", requireAuth, perUser(60), async (req, res, next) => {
  try {
    if (!(await pagopar.isConfigured())) return res.json({ status: "none" });
    const pending = await prisma.payment.findMany({
      where: { userId: req.user.id, status: "PENDING", pagoparHash: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    let status = "none";
    for (const p of pending) {
      try {
        const s = await confirmPayment(p);
        if (s === "PAID") status = "PAID";
        else if (status !== "PAID") status = s;
      } catch (err) {
        console.error("sync confirm failed:", err.message);
      }
    }
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

// Pagopar "URL de respuesta". Public endpoint: never trust the body -- verify
// its token, then re-check the order server-to-server before granting access.
// Pagopar's validation circuit requires the `resultado` array echoed back.
router.post("/webhook", async (req, res) => {
  try {
    const first = req.body && Array.isArray(req.body.resultado) ? req.body.resultado[0] : null;
    if (!first || !first.hash_pedido) return res.status(400).json({ error: "bad_request" });
    if (!(await pagopar.verifyWebhookToken(first.hash_pedido, first.token))) {
      return res.status(401).json({ error: "invalid_token" });
    }
    const payment = await prisma.payment.findUnique({ where: { pagoparHash: String(first.hash_pedido) } });
    if (!payment) return res.status(404).json({ error: "unknown_order" });

    await confirmPayment(payment);
    res.status(200).json(req.body.resultado);
  } catch (err) {
    console.error("webhook error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
