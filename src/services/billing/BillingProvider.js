/**
 * Contract every billing provider must implement. There is no real payment
 * gateway wired up yet (no processor decided/registered at launch time) --
 * ManualProvider is the only implementation for now, driven by an admin
 * flipping a user's plan by hand. Adding a real gateway later (Stripe /
 * MercadoPago / Bancard) means writing a new class implementing this same
 * interface plus a webhook route that calls activate()/expire() -- nothing
 * else in the app (routes, schema, frontend) needs to change.
 */
class BillingProvider {
  // eslint-disable-next-line no-unused-vars
  async activate(userId) {
    throw new Error("not_implemented");
  }
  // eslint-disable-next-line no-unused-vars
  async expire(userId) {
    throw new Error("not_implemented");
  }
  // eslint-disable-next-line no-unused-vars
  async status(userId) {
    throw new Error("not_implemented");
  }
}

module.exports = { BillingProvider };
