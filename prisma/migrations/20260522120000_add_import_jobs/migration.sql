-- WR-A8 — Data Integration Studio (Account import audit)
-- Yeni tablolar: ImportJob + ImportJobRow.
-- Phase 1 yalnızca Account hedefi destekler. Tenant-scoped, rollback verisi
-- (beforeJson/afterJson, accountId) audit için saklanır.

CREATE TABLE "ImportJob" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "targetType"          TEXT NOT NULL DEFAULT 'account',
  "sourceType"          TEXT NOT NULL,
  "sourceName"          TEXT,
  "sourceUrlMasked"     TEXT,
  "fileName"            TEXT,
  "dataPath"            TEXT,
  "targetSchemaVersion" TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'draft',
  "totalRows"           INTEGER NOT NULL DEFAULT 0,
  "createCount"         INTEGER NOT NULL DEFAULT 0,
  "updateCount"         INTEGER NOT NULL DEFAULT 0,
  "skippedCount"        INTEGER NOT NULL DEFAULT 0,
  "errorCount"          INTEGER NOT NULL DEFAULT 0,
  "warningCount"        INTEGER NOT NULL DEFAULT 0,
  "summaryJson"         JSONB,
  "createdByUserId"     TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"           TIMESTAMP(3),
  "completedAt"         TIMESTAMP(3),
  "rolledBackAt"        TIMESTAMP(3),
  "rolledBackByUserId"  TEXT,

  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportJob_companyId_idx" ON "ImportJob"("companyId");
CREATE INDEX "ImportJob_companyId_createdAt_idx" ON "ImportJob"("companyId", "createdAt");
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

ALTER TABLE "ImportJob"
  ADD CONSTRAINT "ImportJob_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ImportJobRow" (
  "id"             TEXT NOT NULL,
  "importJobId"    TEXT NOT NULL,
  "rowNumber"      INTEGER NOT NULL,
  "action"         TEXT NOT NULL DEFAULT 'skip',
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "accountId"      TEXT,
  "matchKey"       TEXT,
  "errorsJson"     JSONB,
  "warningsJson"   JSONB,
  "rawJson"        JSONB,
  "normalizedJson" JSONB,
  "beforeJson"     JSONB,
  "afterJson"      JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImportJobRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportJobRow_importJobId_idx" ON "ImportJobRow"("importJobId");
CREATE INDEX "ImportJobRow_importJobId_status_idx" ON "ImportJobRow"("importJobId", "status");
CREATE INDEX "ImportJobRow_accountId_idx" ON "ImportJobRow"("accountId");

ALTER TABLE "ImportJobRow"
  ADD CONSTRAINT "ImportJobRow_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
