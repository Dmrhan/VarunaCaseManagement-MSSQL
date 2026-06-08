-- WR-Smart-Ticket Phase 1a — TaxonomyDef foundation.
--
-- Per-tenant generic taxonomy vocabulary for Smart Ticket intake/closure
-- dropdowns. Additive + no existing-table mutation; all Smart Ticket
-- feature work in later PRs depends on this table.
--
-- Hierarchy: `parentId` used ONLY for rootCauseDetail rows pointing at
-- their parent rootCauseGroup row. Other taxonomyType rows have
-- parentId = NULL. Constraint NoAction on parent FK keeps SQL Server
-- portability in mind (no multi-cascade path).

CREATE TABLE "TaxonomyDef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxonomyType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxonomyDef_companyId_taxonomyType_code_key"
    ON "TaxonomyDef"("companyId", "taxonomyType", "code");

CREATE INDEX "TaxonomyDef_companyId_taxonomyType_isActive_sortOrder_idx"
    ON "TaxonomyDef"("companyId", "taxonomyType", "isActive", "sortOrder");

CREATE INDEX "TaxonomyDef_parentId_idx" ON "TaxonomyDef"("parentId");

ALTER TABLE "TaxonomyDef" ADD CONSTRAINT "TaxonomyDef_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxonomyDef" ADD CONSTRAINT "TaxonomyDef_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "TaxonomyDef"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
