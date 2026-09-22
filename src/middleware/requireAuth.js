const prisma = require("../db");

/**
 * Requires a logged-in session. Loads the user fresh from the DB (not just
 * trusting session data) and attaches it to req.user. Also lazily flips
 * TRIAL -> EXPIRED if trialEndsAt has passed, so plan status is always
 * accurate without a background job.
 */
async function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: "not_authenticated" });
  }

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "not_authenticated" });
  }

  if (user.planStatus === "TRIAL" && user.trialEndsAt < new Date()) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { planStatus: "EXPIRED", planUpdatedAt: new Date() },
    });
  }

  if (user.planStatus === "ACTIVE" && user.planEndsAt && user.planEndsAt < new Date()) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { planStatus: "EXPIRED", planUpdatedAt: new Date() },
    });
  }

  req.user = user;
  next();
}

/**
 * Use after requireAuth on write endpoints. Blocks with 402 if the user's
 * trial has expired and no one has manually activated their plan yet.
 * Read endpoints intentionally stay open so users keep access to their own
 * past history/progress even after a trial lapses.
 */
function requireActivePlan(req, res, next) {
  if (req.user.planStatus === "EXPIRED" || req.user.planStatus === "CANCELED") {
    return res.status(402).json({ error: "trial_expired" });
  }
  next();
}

module.exports = { requireAuth, requireActivePlan };
