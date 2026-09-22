const crypto = require("crypto");
const settings = require("../settings");

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

async function isConfigured() {
  const s = await settings.get();
  return !!(s.pagopar.publicKey && s.pagopar.privateKey && s.plans.length);
}

function pad(n) {
  return ("0" + n).slice(-2);
}

// Pagopar expects "Y-m-d H:i:s".
function formatDeadline(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function post(path, body) {
  const s = await settings.get();
  const res = await fetch(s.pagopar.apiBase + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // handled below
  }
  if (!res.ok || !json) {
    throw new Error(`pagopar_http_${res.status}`);
  }
  return json;
}

/**
 * Creates a Pagopar order (API 2.0, tipo_pedido VENTA-COMERCIO) and returns
 * the order hash; the customer is redirected to `${payBase}/${hash}`.
 * token = sha1(private_key + id_pedido_comercio + monto_total)
 */
async function createOrder({ payment, user }) {
  const { publicKey, privateKey, category, cityId, paymentDeadlineHours } = (await settings.get()).pagopar;
  const idPedido = String(payment.orderNumber);
  const monto = String(payment.amount);
  const deadline = new Date(Date.now() + paymentDeadlineHours * 3600 * 1000);
  const descripcion = `Suscripción SimuResi - ${payment.months} ${payment.months === 1 ? "mes" : "meses"}`;

  const body = {
    token: sha1(privateKey + idPedido + monto),
    public_key: publicKey,
    tipo_pedido: "VENTA-COMERCIO",
    id_pedido_comercio: idPedido,
    monto_total: payment.amount,
    fecha_maxima_pago: formatDeadline(deadline),
    descripcion_resumen: descripcion,
    comprador: {
      nombre: user.name || user.email,
      email: user.email,
      telefono: "",
      documento: "",
      tipo_documento: "CI",
      ruc: "",
      razon_social: user.name || user.email,
      ciudad: null,
      direccion: "",
      direccion_referencia: "",
      coordenadas: "",
    },
    compras_items: [
      {
        nombre: descripcion,
        cantidad: 1,
        precio_total: payment.amount,
        ciudad: cityId,
        categoria: category,
        descripcion,
        id_producto: `plan-${payment.planCode}`,
        url_imagen: "",
        public_key: publicKey,
        vendedor_telefono: "",
        vendedor_direccion: "",
        vendedor_direccion_referencia: "",
        vendedor_direccion_coordenadas: "",
      },
    ],
  };

  const json = await post("/api/comercios/2.0/iniciar-transaccion", body);
  const first = Array.isArray(json.resultado) ? json.resultado[0] : null;
  if (!json.respuesta || !first || !first.data) {
    throw new Error("pagopar_create_failed");
  }
  return { hash: String(first.data) };
}

/** Server-to-server status check. token = sha1(private_key + "CONSULTA"). */
async function fetchOrder(hash) {
  const { publicKey, privateKey } = (await settings.get()).pagopar;
  const json = await post("/api/pedidos/1.1/traer", {
    hash_pedido: hash,
    token: sha1(privateKey + "CONSULTA"),
    token_publico: publicKey,
  });
  const first = Array.isArray(json.resultado) ? json.resultado[0] : null;
  if (!json.respuesta || !first) return null;
  return first;
}

/** Webhook body token: sha1(private_key + hash_pedido). */
async function verifyWebhookToken(hash, token) {
  const { privateKey } = (await settings.get()).pagopar;
  if (!privateKey || !hash || !token) return false;
  const expected = Buffer.from(sha1(privateKey + hash));
  const got = Buffer.from(String(token));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

async function payUrl(hash) {
  return `${(await settings.get()).pagopar.payBase}/${hash}`;
}

module.exports = { isConfigured, createOrder, fetchOrder, verifyWebhookToken, payUrl };
