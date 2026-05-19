-- WR-A3 / PM-02 — Account address book (country-agnostic).
-- Parent: Account (cascade). Tenant scope: companyId denormalized (FK to Company).
-- isDefault uniqueness enforced at app layer inside transactions — no DB unique
-- to keep soft-delete + re-create race windows benign.

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('Billing', 'Shipping', 'Visit', 'Headquarters', 'Branch');

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'TR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Address_accountId_idx" ON "Address"("accountId");
CREATE INDEX "Address_companyId_idx" ON "Address"("companyId");
CREATE INDEX "Address_accountId_type_idx" ON "Address"("accountId", "type");
CREATE INDEX "Address_accountId_isDefault_idx" ON "Address"("accountId", "isDefault");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Address" ADD CONSTRAINT "Address_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
