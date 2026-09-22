const crypto = require("crypto");
const prisma = require("../db");
const config = require("../config");

// Payment settings managed from the admin dashboard. Values saved in the DB
// override the env defaults. The Pagopar private key is stored encrypted
// (AES-256-GCM, key derived from SESSION_SECRET) and never sent to clients.
const ROW = "payments";
const KEY = crypto.createHash("sha256").update("settings:" + config.sessionSecret).digest();

let cache = null;

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

async function readRaw() {
  const row = await prisma.setting.findUnique({ where: { key: ROW } });
  return row && row.value && typeof row.value === "object" ? row.value : {};
}

const PLAN_DEFS = [
  { code: "1m", months: 1 },
  { code: "3m", months: 3 },
  { code: "6m", months: 6 },
];

async function build() {
  const raw = await readRaw();
  const envPrice = {};
  config.plans.forEach((p) => (envPrice[p.code] = p.amount));
  const prices = {};
  PLAN_DEFS.forEach((d) => {
    const v = raw.prices && raw.prices[d.code] !== undefined ? raw.prices[d.code] : envPrice[d.code];
    prices[d.code] = Number.isInteger(v) && v > 0 ? v : 0;
  });
  const pick = (k, envVal) => (raw[k] !== undefined ? raw[k] : envVal);
  const privateKey = raw.privateKeyEnc ? decrypt(raw.privateKeyEnc) : config.pagopar.privateKey;
  return {
    prices,
    plans: PLAN_DEFS.filter((d) => prices[d.code] > 0).map((d) => ({ code: d.code, months: d.months, amount: prices[d.code] })),
    whatsapp: String(pick("whatsapp", config.paymentWhatsapp) || "").replace(/[^0-9]/g, ""),
    url: pick("url", config.paymentUrl) || "",
    instructions: pick("instructions", config.paymentInstructions) || "",
    pagopar: {
      ...config.pagopar,
      publicKey: raw.publicKey !== undefined ? raw.publicKey : config.pagopar.publicKey,
      privateKey,
    },
    privateKeySource: raw.privateKeyEnc ? "dashboard" : config.pagopar.privateKey ? "env" : "none",
  };
}

async function get() {
  if (!cache) cache = await build();
  return cache;
}

function invalidate() {
  cache = null;
}

/** Merges a partial update into the stored row. `privateKey` is only changed when non-empty. */
async function update(patch) {
  const raw = await readRaw();
  const next = { ...raw };
  if (patch.prices) next.prices = { ...(raw.prices || {}), ...patch.prices };
  ["publicKey", "whatsapp", "url", "instructions"].forEach((k) => {
    if (patch[k] !== undefined) next[k] = patch[k];
  });
  if (patch.privateKey) next.privateKeyEnc = encrypt(patch.privateKey);
  await prisma.setting.upsert({ where: { key: ROW }, create: { key: ROW, value: next }, update: { value: next } });
  invalidate();
}

module.exports = { get, update, invalidate };
