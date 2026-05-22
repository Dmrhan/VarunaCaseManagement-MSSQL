-- WR-A8 Phase 2b — Customer 360 commit + rollback audit columns.
-- All additive / nullable; Phase 1 ImportJobRow rows continue to work
-- with entityType=null (legacy account-only).

ALTER TABLE "ImportJob"
  ADD COLUMN "entityCountsJson" JSONB;

ALTER TABLE "ImportJobRow"
  ADD COLUMN "entityType"       TEXT,
  ADD COLUMN "parentRowNumber"  INTEGER,
  ADD COLUMN "relationshipKey"  TEXT,
  ADD COLUMN "recordId"         TEXT;

CREATE INDEX "ImportJobRow_importJobId_entityType_idx"
  ON "ImportJobRow"("importJobId", "entityType");

CREATE INDEX "ImportJobRow_recordId_idx"
  ON "ImportJobRow"("recordId");
