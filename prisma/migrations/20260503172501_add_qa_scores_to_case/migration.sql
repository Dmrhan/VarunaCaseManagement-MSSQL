-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "qaClarityScore" INTEGER,
ADD COLUMN     "qaEmpathyScore" INTEGER,
ADD COLUMN     "qaFeedback" TEXT,
ADD COLUMN     "qaScoredAt" TIMESTAMP(3),
ADD COLUMN     "qaSpeedScore" INTEGER;

-- CreateTable
CREATE TABLE "QAScoreLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empathy" INTEGER NOT NULL,
    "clarity" INTEGER NOT NULL,
    "speed" INTEGER NOT NULL,
    "feedback" TEXT,

    CONSTRAINT "QAScoreLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QAScoreLog_caseId_key" ON "QAScoreLog"("caseId");

-- CreateIndex
CREATE INDEX "QAScoreLog_companyId_idx" ON "QAScoreLog"("companyId");

-- CreateIndex
CREATE INDEX "QAScoreLog_companyId_scoredAt_idx" ON "QAScoreLog"("companyId", "scoredAt");
