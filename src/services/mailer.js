const nodemailer = require("nodemailer");
const emailSettings = require("./emailSettings");

/**
 * Sends an email via the SMTP config saved in the admin dashboard (falls
 * back to env vars if nothing was saved there -- see emailSettings.js).
 * A fresh transporter is created per call: send volume here is tiny
 * (password resets, payment notices), so the simplicity of never dealing
 * with stale cached credentials after a settings change is worth more than
 * the connection-reuse we'd get from caching.
 */
async function sendMail({ to, subject, html, text }) {
  const s = await emailSettings.get();
  if (!emailSettings.isConfigured(s)) {
    console.error(`mailer: SMTP not configured, could not send "${subject}" to ${to}`);
    return { sent: false, reason: "not_configured" };
  }
  const transporter = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPass },
  });
  const from = s.fromAddress ? `"${s.fromName}" <${s.fromAddress}>` : `"${s.fromName}" <${s.smtpUser}>`;
  await transporter.sendMail({ from, to, subject, html, text });
  return { sent: true };
}

module.exports = { sendMail };
