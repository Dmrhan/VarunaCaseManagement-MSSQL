-- CreateTable
CREATE TABLE "CaseReminder" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseReminder_userId_remindAt_idx" ON "CaseReminder"("userId", "remindAt");

-- CreateIndex
CREATE INDEX "CaseReminder_caseId_idx" ON "CaseReminder"("caseId");

-- CreateIndex
CREATE INDEX "CaseReminder_companyId_idx" ON "CaseReminder"("companyId");

-- AddForeignKey
ALTER TABLE "CaseReminder" ADD CONSTRAINT "CaseReminder_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReminder" ADD CONSTRAINT "CaseReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
