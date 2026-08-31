const { BillingProvider } = require("./BillingProvider");
const prisma = require("../../db");

/**
 * Manual, admin-driven billing: no payment gateway involved. The owner
 * activates/expires customers by hand (e.g. after a bank transfer) via the
 * admin API until a real processor is wired up.
 */
class ManualProvider extends BillingProvider {
  async activate(userId, adminUserId) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        planStatus: "ACTIVE",
        planUpdatedAt: new Date(),
        planUpdatedBy: adminUserId || null,
      },
    });
  }

  async expire(userId, adminUserId) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        planStatus: "EXPIRED",
        planUpdatedAt: new Date(),
        planUpdatedBy: adminUserId || null,
      },
    });
  }

  async status(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { planStatus: true } });
    return user ? user.planStatus : null;
  }
}

module.exports = { ManualProvider, billingProvider: new ManualProvider() };
