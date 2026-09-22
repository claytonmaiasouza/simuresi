const express = require("express");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const prisma = require("../db");
const config = require("../config");
const settings = require("../services/settings");
const { validateBody } = require("../middleware/validate");
const { authLimiter, loginByEmailLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const BCRYPT_COST = 12;
// Precomputed once so a "user not found" login attempt still pays a bcrypt
// comparison cost similar to a "wrong password" attempt, to avoid the two
// cases being distinguishable purely by response time.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-normalization", BCRYPT_COST);

const emailSchema = z.string().trim().toLowerCase().email().max(254);
// bcrypt silently truncates at 72 bytes -- cap input length so a very long
// password can't be used as a hashing-cost DoS vector, and so truncation
// never silently changes what "the password" effectively is.
const passwordSchema = z.string().min(8).max(72);

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    planStatus: user.planStatus,
    trialEndsAt: user.trialEndsAt,
    planEndsAt: user.planEndsAt,
  };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.post("/signup", authLimiter, validateBody(signupSchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "email_in_use" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const trialEndsAt = new Date(Date.now() + config.trialDays * 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name || null,
        trialEndsAt,
        gamify: {
          create: {
            xp: 0,
            streakCurrent: 0,
            streakLongest: 0,
            streakFreezes: 1,
            tierIndex: 0,
            weekXp: 0,
          },
        },
      },
    });

    await regenerateSession(req);
    req.session.userId = user.id;

    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", authLimiter, loginByEmailLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    const hashToCheck = user ? user.passwordHash : DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCheck);

    if (!user || !ok) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    await regenerateSession(req);
    req.session.userId = user.id;

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(204).end();
  });
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const s = await settings.get();
    res.json({
      ...publicUser(req.user),
      payment: { url: s.url, whatsapp: s.whatsapp, instructions: s.instructions },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
