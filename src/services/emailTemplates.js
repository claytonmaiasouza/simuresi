// Minimal, self-contained HTML email templates (inline styles only -- most
// email clients strip <style> blocks). Kept deliberately simple: one accent
// color, one button, no external assets/images to load or break.
const ACCENT = "#0E6E56";
const INK = "#1B2621";
const PAPER = "#F8F9F4";

function shell(bodyHtml) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;border:1px solid #E3E6DD;">
    <div style="font-family:Georgia,serif;font-weight:800;font-size:1.3rem;color:${ACCENT};margin-bottom:18px;">SimuResi</div>
    ${bodyHtml}
    <p style="margin-top:28px;font-size:.78rem;color:#4B5750;">Si no fuiste vos quien pidió esto, podés ignorar este email con tranquilidad.</p>
  </div>
</body></html>`;
}

function button(url, label) {
  return `<a href="${url}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;margin:16px 0;">${label}</a>`;
}

function passwordResetEmail({ name, resetUrl }) {
  const greeting = name ? `Hola ${name},` : "Hola,";
  const html = shell(`
    <p>${greeting}</p>
    <p>Recibimos un pedido para restablecer la contraseña de tu cuenta en SimuResi.</p>
    <p>${button(resetUrl, "Crear nueva contraseña")}</p>
    <p style="font-size:.85rem;color:#4B5750;">Este enlace vale por 1 hora. Si el botón no funciona, copiá y pegá esta dirección en tu navegador:<br><span style="word-break:break-all;">${resetUrl}</span></p>
  `);
  const text = `${greeting}\n\nRecibimos un pedido para restablecer la contraseña de tu cuenta en SimuResi.\n\nEntrá a este enlace (vale por 1 hora) para crear una nueva contraseña:\n${resetUrl}\n\nSi no fuiste vos, podés ignorar este email.`;
  return { subject: "Recuperá tu contraseña de SimuResi", html, text };
}

module.exports = { passwordResetEmail };
