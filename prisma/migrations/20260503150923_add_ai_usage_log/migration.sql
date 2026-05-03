-- CreateTable
CREATE TABLE "AIUsageLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "caseId" TEXT,
    "userId" TEXT,
    "accepted" BOOLEAN,
    "responseTimeMs" INTEGER,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIUsageLog_companyId_idx" ON "AIUsageLog"("companyId");

-- CreateIndex
CREATE INDEX "AIUsageLog_companyId_createdAt_idx" ON "AIUsageLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsageLog_endpoint_idx" ON "AIUsageLog"("endpoint");
