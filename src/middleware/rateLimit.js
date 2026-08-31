const rateLimit = require("express-rate-limit");

// Generic auth abuse protection: 10 requests / 15 min per IP. Applied to
// both /login and /signup. Deliberately returns a generic 429 with no
// "remaining attempts" detail.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

// Extra per-email throttle on login specifically, so a single account can't
// be credential-stuffed just by rotating source IPs. Keyed by the submitted
// email (lowercased) in addition to the IP-based authLimiter above.
const loginByEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
  keyGenerator: (req) => String((req.body && req.body.email) || "").toLowerCase().trim(),
});

// Throttle exam-attempt submissions per session, independent of auth limits,
// as a basic anti-farming guard on the leaderboard-feeding endpoint.
const historyWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
  keyGenerator: (req) => (req.session && req.session.userId) || req.ip,
});

module.exports = { authLimiter, loginByEmailLimiter, historyWriteLimiter };
