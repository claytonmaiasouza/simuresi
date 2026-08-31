const REQUIRED = ["DATABASE_URL", "SESSION_SECRET"];

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
  };
}

module.exports = loadConfig();
