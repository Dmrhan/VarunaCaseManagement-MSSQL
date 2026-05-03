-- CreateTable
CREATE TABLE "CaseMention" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedBy" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseMention_caseId_idx" ON "CaseMention"("caseId");

-- CreateIndex
CREATE INDEX "CaseMention_mentionedUserId_idx" ON "CaseMention"("mentionedUserId");

-- CreateIndex
CREATE INDEX "CaseMention_companyId_idx" ON "CaseMention"("companyId");

-- AddForeignKey
ALTER TABLE "CaseMention" ADD CONSTRAINT "CaseMention_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
