-- WR-A8 — AccountProduct ↔ Product Catalog link (additive, backward-compatible).
-- Legacy AccountProduct rows (productName/Code free-text) continue to work
-- with productId = NULL. New rows can reference Product catalog; productId
-- onDelete: SetNull preserves snapshot productName/Code when a catalog row
-- is deleted.

ALTER TABLE "AccountProduct"
  ADD COLUMN "productId" TEXT;

CREATE INDEX "AccountProduct_productId_idx" ON "AccountProduct"("productId");

ALTER TABLE "AccountProduct"
  ADD CONSTRAINT "AccountProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
