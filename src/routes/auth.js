const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../db");
const config = require("../config");
const settings = require("../services/settings");
const emailSettings = require("../services/emailSettings");
const mailer = require("../services/mailer");
const { passwordResetEmail } = require("../services/emailTemplates");
const { validateBody } = require("../middleware/validate");
const { authLimiter, loginByEmailLimiter, forgotPasswordByEmailLimiter } = require("../middleware/rateLimit");
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

const forgotPasswordSchema = z.object({ email: emailSchema });

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(128),
  password: passwordSchema,
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** req.protocol reflects the original https since "trust proxy" is set and
 * Traefik forwards X-Forwarded-Proto -- see server.js. */
function publicOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

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

// Always responds the same way whether or not the email is registered, so
// this can never be used to enumerate accounts. The actual email (if any)
// is sent best-effort in the background -- a slow/broken SMTP server should
// never make this request hang or fail from the client's point of view.
router.post(
  "/forgot-password",
  authLimiter,
  forgotPasswordByEmailLimiter,
  validateBody(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const raw = crypto.randomBytes(32).toString("hex");
        const tokenHash = hashToken(raw);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

        const resetUrl = `${publicOrigin(req)}/login?reset=${raw}`;
        const { subject, html, text } = passwordResetEmail({ name: user.name, resetUrl });
        mailer.sendMail({ to: user.email, subject, html, text }).catch((e) => {
          console.error("forgot-password: failed to send email to", user.email, e.message);
        });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const tokenHash = hashToken(token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Invalidate any other still-pending reset tokens for this user, so an
      // older leaked link can't be used after a successful reset.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ ok: true });
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
    const e = await emailSettings.get();
    res.json({
      ...publicUser(req.user),
      payment: { url: s.url, whatsapp: s.whatsapp, instructions: s.instructions },
      contact: { supportEmail: e.supportEmail, paymentsEmail: e.paymentsEmail },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
