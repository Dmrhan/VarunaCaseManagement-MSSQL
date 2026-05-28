-- Half-Shipped Audit PR-3: ActionItem soft archive.
-- OD-073 RESOLVED — Done/Dismissed/Expired items archived 30 days after
-- terminal transition; rows are NOT hard-deleted, only `archivedAt`
-- timestamp is set and active inbox queries filter `archivedAt IS NULL`.
--
-- Additive migration: nullable column + one new index. Backward
-- compatible — existing rows continue to surface in active inbox until
-- the archive cron runs.

ALTER TABLE "ActionItem"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Supports the cron scan:
--   WHERE state IN ('Done','Dismissed','Expired')
--     AND "archivedAt" IS NULL
--     AND "updatedAt" < $cutoff
CREATE INDEX "ActionItem_state_updatedAt_idx"
  ON "ActionItem" ("state", "updatedAt");
