-- CreateIndex
CREATE INDEX "Case_slaResponseDueAt_idx" ON "Case"("slaResponseDueAt");

-- CreateIndex
CREATE INDEX "CaseCallLog_nextFollowupDate_idx" ON "CaseCallLog"("nextFollowupDate");
