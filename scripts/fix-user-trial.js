// One-off maintenance script for the "silently blocked writes" incident:
// requireActivePlan (src/middleware/requireAuth.js) returns 402 on every
// XP-earning write once a trial expires, and the frontend swallowed that
// failure, so streakLastActiveDate stopped advancing for the whole blocked
// period. Reactivates the user's plan and repairs the streak/freezes lost
// during that gap.
//
// Usage: node scripts/fix-user-trial.js <email>
// Needs DATABASE_URL in the environment (same one the app uses).

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { todayStr, diffDaysStr } = require("../src/services/gamify");

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/fix-user-trial.js <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { gamify: true } });
  if (!user) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  if (!user.gamify) {
    console.error(`User ${email} has no GamifyState row`);
    process.exit(1);
  }

  const g = user.gamify;
  const today = todayStr(new Date());

  let streakCurrent = g.streakCurrent;
  let streakLongest = g.streakLongest;
  if (g.streakLastActiveDate && g.streakLastActiveDate !== today) {
    const gap = diffDaysStr(g.streakLastActiveDate, today);
    if (gap > 0) {
      streakCurrent = g.streakCurrent + gap;
      streakLongest = Math.max(streakLongest, streakCurrent);
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        planStatus: "ACTIVE",
        planUpdatedAt: new Date(),
        planUpdatedBy: "manual-fix:trial-block-incident",
      },
    }),
    prisma.gamifyState.update({
      where: { userId: user.id },
      data: {
        streakCurrent,
        streakLongest,
        streakLastActiveDate: today,
        streakFreezes: 5,
      },
    }),
  ]);

  console.log(`Fixed ${email}:`);
  console.log(`  planStatus: ${user.planStatus} -> ACTIVE`);
  console.log(`  streakCurrent: ${g.streakCurrent} -> ${streakCurrent}`);
  console.log(`  streakLongest: ${g.streakLongest} -> ${streakLongest}`);
  console.log(`  streakLastActiveDate: ${g.streakLastActiveDate} -> ${today}`);
  console.log(`  streakFreezes: ${g.streakFreezes} -> 5`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
