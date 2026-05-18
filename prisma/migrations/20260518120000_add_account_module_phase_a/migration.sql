-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "vkn" TEXT;

-- CreateTable
CREATE TABLE "AccountCompany" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalCustomerCode" TEXT,
    "packageName" TEXT,
    "contractStartAt" TIMESTAMP(3),
    "contractEndAt" TIMESTAMP(3),
    "segment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "preferredChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountCompany_companyId_idx" ON "AccountCompany"("companyId");

-- CreateIndex
CREATE INDEX "AccountCompany_accountId_idx" ON "AccountCompany"("accountId");

-- CreateIndex
CREATE INDEX "AccountCompany_externalCustomerCode_idx" ON "AccountCompany"("externalCustomerCode");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCompany_accountId_companyId_key" ON "AccountCompany"("accountId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCompany_companyId_externalCustomerCode_key" ON "AccountCompany"("companyId", "externalCustomerCode");

-- CreateIndex
CREATE INDEX "AccountContact_accountId_idx" ON "AccountContact"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_vkn_key" ON "Account"("vkn");

-- AddForeignKey
ALTER TABLE "AccountCompany" ADD CONSTRAINT "AccountCompany_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCompany" ADD CONSTRAINT "AccountCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountContact" ADD CONSTRAINT "AccountContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
