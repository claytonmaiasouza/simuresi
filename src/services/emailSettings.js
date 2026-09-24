const prisma = require("../db");
const config = require("../config");
const secretCrypto = require("./secretCrypto");

// SMTP + contact-address settings managed from the admin dashboard, stored
// as a second row in the same `Setting` table used for payment settings.
// Values saved in the DB override the env defaults from config.js. The SMTP
// password is stored encrypted and never sent back to the client.
const ROW = "email";
const NS = "email-settings";
const encrypt = (text) => secretCrypto.encrypt(NS, text);
const decrypt = (b64) => secretCrypto.decrypt(NS, b64);

let cache = null;

async function readRaw() {
  const row = await prisma.setting.findUnique({ where: { key: ROW } });
  return row && row.value && typeof row.value === "object" ? row.value : {};
}

function build(raw) {
  const pick = (k, envVal) => (raw[k] !== undefined ? raw[k] : envVal);
  const smtpPass = raw.smtpPassEnc ? decrypt(raw.smtpPassEnc) : config.email.smtpPass;
  return {
    smtpHost: pick("smtpHost", config.email.smtpHost),
    smtpPort: Number.isInteger(raw.smtpPort) ? raw.smtpPort : config.email.smtpPort,
    smtpSecure: raw.smtpSecure !== undefined ? !!raw.smtpSecure : config.email.smtpSecure,
    smtpUser: pick("smtpUser", config.email.smtpUser),
    smtpPass,
    smtpPassSource: raw.smtpPassEnc ? "dashboard" : config.email.smtpPass ? "env" : "none",
    fromName: pick("fromName", config.email.fromName),
    fromAddress: pick("fromAddress", config.email.fromAddress),
    supportEmail: pick("supportEmail", config.email.supportEmail),
    paymentsEmail: pick("paymentsEmail", config.email.paymentsEmail),
  };
}

async function get() {
  if (!cache) cache = build(await readRaw());
  return cache;
}

function invalidate() {
  cache = null;
}

function isConfigured(s) {
  return !!(s.smtpHost && s.smtpUser && s.smtpPass);
}

/** Merges a partial update into the stored row. `smtpPass` is only changed when non-empty. */
async function update(patch) {
  const raw = await readRaw();
  const next = { ...raw };
  ["smtpHost", "smtpUser", "fromName", "fromAddress", "supportEmail", "paymentsEmail"].forEach((k) => {
    if (patch[k] !== undefined) next[k] = String(patch[k]).trim();
  });
  if (patch.smtpPort !== undefined) next.smtpPort = patch.smtpPort;
  if (patch.smtpSecure !== undefined) next.smtpSecure = !!patch.smtpSecure;
  if (patch.smtpPass) next.smtpPassEnc = encrypt(patch.smtpPass);
  await prisma.setting.upsert({ where: { key: ROW }, create: { key: ROW, value: next }, update: { value: next } });
  invalidate();
}

module.exports = { get, update, invalidate, isConfigured };
