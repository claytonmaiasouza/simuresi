const crypto = require("crypto");
const config = require("../config");

// Shared AES-256-GCM helper for small secrets stored in the `Setting` table
// (Pagopar private key, SMTP password, ...). Each caller passes its own
// `namespace` so different secrets never share a derived key even though
// they all derive from the same SESSION_SECRET.
//
// IMPORTANT: the "settings" namespace is used by src/services/settings.js
// for the Pagopar private key -- it must keep using exactly that string
// forever, or every already-encrypted key stored in production becomes
// undecryptable (nothing rotates SESSION_SECRET, but this module must not
// be the thing that silently breaks it either).
function keyFor(namespace) {
  return crypto.createHash("sha256").update(namespace + ":" + config.sessionSecret).digest();
}

function encrypt(namespace, text) {
  const key = keyFor(namespace);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function decrypt(namespace, b64) {
  try {
    const key = keyFor(namespace);
    const buf = Buffer.from(b64, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

module.exports = { encrypt, decrypt };
