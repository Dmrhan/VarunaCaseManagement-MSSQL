-- WR-A7 / PM-05 — Package + PackageItem catalog foundation.
-- Tenant-scoped Package; PackageItem composite PK (packageId, productId).
-- Cross-table same-company invariant enforced at app layer (Prisma cannot
-- enforce cross-table CHECK declaratively).
-- Does NOT touch Case, AccountCompany.packageName, or Product schema.

-- CreateTable: Package
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "supportLevel" "SupportLevel" NOT NULL DEFAULT 'L1',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PackageItem (composite PK)
CREATE TABLE "PackageItem" (
    "packageId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageItem_pkey" PRIMARY KEY ("packageId", "productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Package_companyId_code_key" ON "Package"("companyId", "code");
CREATE INDEX "Package_companyId_isActive_idx" ON "Package"("companyId", "isActive");
CREATE INDEX "Package_companyId_supportLevel_idx" ON "Package"("companyId", "supportLevel");
CREATE INDEX "PackageItem_productId_idx" ON "PackageItem"("productId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
