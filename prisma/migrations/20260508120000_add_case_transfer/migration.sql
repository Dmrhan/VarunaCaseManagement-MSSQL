-- AlterTable: Case.transferCount
ALTER TABLE "Case" ADD COLUMN "transferCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: CaseTransfer
CREATE TABLE "CaseTransfer" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromTeamId" TEXT,
    "toTeamId" TEXT NOT NULL,
    "fromPersonId" TEXT,
    "toPersonId" TEXT,
    "reason" TEXT NOT NULL,
    "reasonCode" TEXT,
    "transferredBy" TEXT NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiSuggestedTeamId" TEXT,
    "aiSuggestedReason" TEXT,
    "aiReasonCode" TEXT,
    "aiConfidence" DOUBLE PRECISION,

    CONSTRAINT "CaseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseTransfer_caseId_idx" ON "CaseTransfer"("caseId");

-- CreateIndex
CREATE INDEX "CaseTransfer_companyId_idx" ON "CaseTransfer"("companyId");

-- CreateIndex
CREATE INDEX "CaseTransfer_companyId_transferredAt_idx" ON "CaseTransfer"("companyId", "transferredAt");

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
