-- CreateEnum
CREATE TYPE "CaseLinkType" AS ENUM ('Related', 'Duplicate', 'Parent');

-- CreateTable: CaseWatcher
CREATE TABLE "CaseWatcher" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseWatcher_caseId_userId_key" ON "CaseWatcher"("caseId", "userId");

-- CreateIndex
CREATE INDEX "CaseWatcher_userId_idx" ON "CaseWatcher"("userId");

-- CreateIndex
CREATE INDEX "CaseWatcher_companyId_idx" ON "CaseWatcher"("companyId");

-- CreateIndex
CREATE INDEX "CaseWatcher_caseId_idx" ON "CaseWatcher"("caseId");

-- AddForeignKey
ALTER TABLE "CaseWatcher" ADD CONSTRAINT "CaseWatcher_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CaseLink
CREATE TABLE "CaseLink" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "linkedCaseId" TEXT NOT NULL,
    "linkType" "CaseLinkType" NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseLink_caseId_linkedCaseId_linkType_key" ON "CaseLink"("caseId", "linkedCaseId", "linkType");

-- CreateIndex
CREATE INDEX "CaseLink_caseId_idx" ON "CaseLink"("caseId");

-- CreateIndex
CREATE INDEX "CaseLink_linkedCaseId_idx" ON "CaseLink"("linkedCaseId");

-- CreateIndex
CREATE INDEX "CaseLink_companyId_idx" ON "CaseLink"("companyId");

-- AddForeignKey
ALTER TABLE "CaseLink" ADD CONSTRAINT "CaseLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseLink" ADD CONSTRAINT "CaseLink_linkedCaseId_fkey" FOREIGN KEY ("linkedCaseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
