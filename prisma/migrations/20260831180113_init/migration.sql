-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planStatus" "PlanStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "planUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planUpdatedBy" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "modeLabel" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "answered" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "usedSeconds" INTEGER NOT NULL,
    "timeBudget" INTEGER NOT NULL,
    "exitedEarly" BOOLEAN NOT NULL DEFAULT false,
    "isSimulacro" BOOLEAN NOT NULL,
    "byArea" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashcardSrsState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 0,
    "due" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashcardSrsState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamifyState" (
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "lastXpDate" TEXT,
    "streakCurrent" INTEGER NOT NULL DEFAULT 0,
    "streakLongest" INTEGER NOT NULL DEFAULT 0,
    "streakLastActiveDate" TEXT,
    "streakFreezes" INTEGER NOT NULL DEFAULT 1,
    "tierIndex" INTEGER NOT NULL DEFAULT 0,
    "weekKey" TEXT,
    "weekXp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamifyState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LeagueWeekResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "tierIndex" INTEGER NOT NULL,
    "weekXp" INTEGER NOT NULL,
    "rank" INTEGER,
    "totalInTier" INTEGER,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "demoted" BOOLEAN NOT NULL DEFAULT false,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueWeekResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ExamAttempt_userId_date_idx" ON "ExamAttempt"("userId", "date");

-- CreateIndex
CREATE INDEX "FlashcardSrsState_userId_due_idx" ON "FlashcardSrsState"("userId", "due");

-- CreateIndex
CREATE UNIQUE INDEX "FlashcardSrsState_userId_cardId_key" ON "FlashcardSrsState"("userId", "cardId");

-- CreateIndex
CREATE INDEX "LeagueWeekResult_weekKey_tierIndex_idx" ON "LeagueWeekResult"("weekKey", "tierIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueWeekResult_userId_weekKey_key" ON "LeagueWeekResult"("userId", "weekKey");

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardSrsState" ADD CONSTRAINT "FlashcardSrsState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamifyState" ADD CONSTRAINT "GamifyState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueWeekResult" ADD CONSTRAINT "LeagueWeekResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
