-- CreateEnum
CREATE TYPE "AuthThrottleScope" AS ENUM ('ACCOUNT', 'SOURCE');

-- CreateTable
CREATE TABLE "AuthThrottle" (
    "scope" "AuthThrottleScope" NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("scope","keyHash")
);

-- CreateIndex
CREATE INDEX "AuthThrottle_blockedUntil_idx" ON "AuthThrottle"("blockedUntil");
