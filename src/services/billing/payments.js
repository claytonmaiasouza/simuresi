const prisma = require("../../db");
const pagopar = require("./PagoparClient");

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function truthy(v) {
  return v === true || v === "true" || v === "t" || v === 1 || v === "1";
}

/**
 * Extends the user's access by months and/or days and marks the plan ACTIVE.
 * Remaining time on a running trial/subscription is preserved (the new period
 * starts where the current one ends). Must be called inside a transaction.
 */
async function extendPlan(tx, userId, { months = 0, days = 0 }, by) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  const now = new Date();
  let base = now;
  if (user.planStatus === "ACTIVE" && user.planEndsAt && user.planEndsAt > now) base = user.planEndsAt;
  else if (user.planStatus === "TRIAL" && user.trialEndsAt > now) base = user.trialEndsAt;

  const end = addMonths(base, months);
  end.setUTCDate(end.getUTCDate() + days);

  return tx.user.update({
    where: { id: userId },
    data: { planStatus: "ACTIVE", planEndsAt: end, planUpdatedAt: now, planUpdatedBy: by || null },
  });
}

/**
 * Marks a PENDING payment as PAID exactly once (safe against duplicate
 * webhooks / concurrent sync calls) and extends the user's plan.
 */
async function applyPaid(paymentId, method) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), paymentMethod: method || null },
    });
    if (claimed.count === 0) return false;

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    await extendPlan(tx, payment.userId, { months: payment.months }, "pagopar");
    return true;
  });
}

/**
 * Re-checks a payment with Pagopar directly (never trusts the webhook body
 * alone) and applies it if genuinely paid for the exact expected amount.
 */
async function confirmPayment(payment) {
  if (payment.status !== "PENDING" || !payment.pagoparHash) return payment.status;
  const order = await pagopar.fetchOrder(payment.pagoparHash);
  if (!order) return "PENDING";

  if (truthy(order.pagado)) {
    const paidAmount = Math.round(Number(order.monto));
    if (paidAmount !== payment.amount) {
      console.error(`payment ${payment.id}: amount mismatch (expected ${payment.amount}, got ${order.monto})`);
      return "PENDING";
    }
    await applyPaid(payment.id, order.forma_pago);
    return "PAID";
  }
  if (truthy(order.cancelado)) {
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "CANCELED" } });
    return "CANCELED";
  }
  return "PENDING";
}

module.exports = { applyPaid, confirmPayment, extendPlan, addMonths };
