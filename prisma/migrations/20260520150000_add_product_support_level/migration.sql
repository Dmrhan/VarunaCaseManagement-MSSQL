-- WR-A6 follow-up — Product.supportLevel (A5 SupportLevel enum dependency satisfied).
-- Additive: existing rows backfill to L1 via default. Composite index for Phase 2
-- tier-based routing/filter sorguları. Non-destructive.

-- AlterTable: Product — supportLevel
ALTER TABLE "Product" ADD COLUMN "supportLevel" "SupportLevel" NOT NULL DEFAULT 'L1';

-- CreateIndex
CREATE INDEX "Product_companyId_supportLevel_idx" ON "Product"("companyId", "supportLevel");
