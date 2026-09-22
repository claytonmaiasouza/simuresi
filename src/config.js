const REQUIRED = ["DATABASE_URL", "SESSION_SECRET"];

function buildPlans() {
  const defs = [
    { code: "1m", months: 1, env: "PRICE_1M" },
    { code: "3m", months: 3, env: "PRICE_3M" },
    { code: "6m", months: 6, env: "PRICE_6M" },
  ];
  return defs
    .map((d) => ({ code: d.code, months: d.months, amount: parseInt(process.env[d.env] || "0", 10) }))
    .filter((p) => Number.isInteger(p.amount) && p.amount > 0);
}

function loadConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing required env vars: " + missing.join(", "));
    process.exit(1);
  }
  return {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    databaseUrl: process.env.DATABASE_URL,
    sessionSecret: process.env.SESSION_SECRET,
    trialDays: parseInt(process.env.TRIAL_DAYS || "14", 10),
    // Hosts that get the marketing/portal landing page at "/" instead of the
    // bare login form. Legacy domains not in this list keep the old behavior
    // untouched, so existing bookmarks/users are never disrupted by the switch.
    landingHosts: (process.env.LANDING_HOSTS || "simuresi.com.py,www.simuresi.com.py")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    paymentUrl: process.env.PAYMENT_URL || "",
    paymentWhatsapp: (process.env.PAYMENT_WHATSAPP || "").replace(/[^0-9]/g, ""),
    paymentInstructions: process.env.PAYMENT_INSTRUCTIONS || "",
    plans: buildPlans(),
    pagopar: {
      publicKey: process.env.PAGOPAR_PUBLIC_KEY || "",
      privateKey: process.env.PAGOPAR_PRIVATE_KEY || "",
      apiBase: (process.env.PAGOPAR_API_BASE || "https://api.pagopar.com").replace(/\/+$/, ""),
      payBase: (process.env.PAGOPAR_PAY_BASE || "https://www.pagopar.com/pagos").replace(/\/+$/, ""),
      category: process.env.PAGOPAR_CATEGORY || "909",
      cityId: process.env.PAGOPAR_CITY_ID || "1",
      paymentDeadlineHours: parseInt(process.env.PAGOPAR_DEADLINE_HOURS || "48", 10),
    },
  };
}

module.exports = loadConfig();
