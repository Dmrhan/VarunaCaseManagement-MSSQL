-- WR-A7b / PM-05 — AccountCompany package link + Case product/package integration.
-- Additive non-destructive migration:
--   * AccountCompany.packageId nullable FK to Package (RESTRICT on delete).
--   * Case.productId / productName / packageId / packageName columns.
--   * Indexes for catalog filter & report path'leri.
-- Legacy AccountCompany.packageName ve Case.productGroup alanlarına dokunulmaz.

-- AccountCompany — packageId column + index + FK
ALTER TABLE "AccountCompany"
  ADD COLUMN "packageId" TEXT;

CREATE INDEX "AccountCompany_packageId_idx" ON "AccountCompany"("packageId");

ALTER TABLE "AccountCompany"
  ADD CONSTRAINT "AccountCompany_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Case — productId / productName / packageId / packageName + indexes + FKs
ALTER TABLE "Case"
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "productName" TEXT,
  ADD COLUMN "packageId" TEXT,
  ADD COLUMN "packageName" TEXT;

CREATE INDEX "Case_companyId_productId_idx" ON "Case"("companyId", "productId");
CREATE INDEX "Case_companyId_packageId_idx" ON "Case"("companyId", "packageId");

ALTER TABLE "Case"
  ADD CONSTRAINT "Case_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case"
  ADD CONSTRAINT "Case_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
