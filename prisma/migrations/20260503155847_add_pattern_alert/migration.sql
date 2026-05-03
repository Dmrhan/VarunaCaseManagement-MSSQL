-- CreateEnum
CREATE TYPE "PatternAlertStatus" AS ENUM ('active', 'dismissed');

-- CreateTable
CREATE TABLE "PatternAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "caseCount" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 60,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caseIds" JSONB NOT NULL,
    "status" "PatternAlertStatus" NOT NULL DEFAULT 'active',
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "PatternAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatternAlert_companyId_idx" ON "PatternAlert"("companyId");

-- CreateIndex
CREATE INDEX "PatternAlert_companyId_detectedAt_idx" ON "PatternAlert"("companyId", "detectedAt");

-- CreateIndex
CREATE INDEX "PatternAlert_status_idx" ON "PatternAlert"("status");
