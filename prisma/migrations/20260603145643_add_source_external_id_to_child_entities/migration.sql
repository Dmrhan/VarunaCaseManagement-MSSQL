-- AlterTable
ALTER TABLE "AccountContact" ADD COLUMN     "sourceExternalId" TEXT;

-- AlterTable
ALTER TABLE "AccountProject" ADD COLUMN     "sourceExternalId" TEXT;

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "sourceExternalId" TEXT;

-- CreateIndex
CREATE INDEX "AccountContact_accountId_sourceExternalId_idx" ON "AccountContact"("accountId", "sourceExternalId");

-- CreateIndex
CREATE INDEX "AccountProject_accountCompanyId_sourceExternalId_idx" ON "AccountProject"("accountCompanyId", "sourceExternalId");

-- CreateIndex
CREATE INDEX "Address_accountId_sourceExternalId_idx" ON "Address"("accountId", "sourceExternalId");
