-- DropForeignKey
ALTER TABLE "Case" DROP CONSTRAINT "Case_accountId_fkey";

-- AlterTable: Case.accountId / accountName nullable (Phase C2 — müşterisiz vaka)
ALTER TABLE "Case" ALTER COLUMN "accountId" DROP NOT NULL,
ALTER COLUMN "accountName" DROP NOT NULL;

-- CreateTable: AccountProduct
CREATE TABLE "AccountProduct" (
    "id" TEXT NOT NULL,
    "accountCompanyId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountProduct_accountCompanyId_idx" ON "AccountProduct"("accountCompanyId");

-- CreateIndex (composite uniqueness — productCode NULL'da PG default davranışı: birden çok NULL kabul edilir)
CREATE UNIQUE INDEX "AccountProduct_accountCompanyId_productCode_key" ON "AccountProduct"("accountCompanyId", "productCode");

-- AddForeignKey
ALTER TABLE "AccountProduct" ADD CONSTRAINT "AccountProduct_accountCompanyId_fkey" FOREIGN KEY ("accountCompanyId") REFERENCES "AccountCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-add FK with ON DELETE SET NULL (Account silinirse Case'lerin accountId'si null'a düşer; vaka arşivi korunur)
ALTER TABLE "Case" ADD CONSTRAINT "Case_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
