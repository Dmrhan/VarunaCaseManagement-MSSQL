-- Operations Intelligence Dashboard — Phase 1 Migration
-- docs/OPERATIONS_DASHBOARD_DESIGN.md §2.4 + §2.6.6

-- 1) Composite indexes on Case for analytics hot paths.
-- Mevcut tek-sutun indexlere ek; additive, downtime'siz.
-- 800 agent × 30K/gun olcekte raw SQL CTE'leri icin gerekli.
CREATE INDEX IF NOT EXISTS "Case_companyId_createdAt_idx"
  ON "Case"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "Case_companyId_status_idx"
  ON "Case"("companyId", "status");

CREATE INDEX IF NOT EXISTS "Case_companyId_assignedTeamId_idx"
  ON "Case"("companyId", "assignedTeamId");

CREATE INDEX IF NOT EXISTS "Case_companyId_category_subCategory_idx"
  ON "Case"("companyId", "category", "subCategory");

CREATE INDEX IF NOT EXISTS "Case_companyId_resolvedAt_idx"
  ON "Case"("companyId", "resolvedAt");

-- 2) MetricQueryAudit — her analytics endpoint çağrısı bir audit satırı.
-- HR/audit replay icin; cleanup cron'u Phase 5+.
CREATE TABLE "MetricQueryAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "scopeFingerprint" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "filterFingerprint" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "recordsScanned" INTEGER,
    "responseHash" TEXT,

    CONSTRAINT "MetricQueryAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetricQueryAudit_userId_generatedAt_idx"
  ON "MetricQueryAudit"("userId", "generatedAt");

CREATE INDEX "MetricQueryAudit_endpoint_generatedAt_idx"
  ON "MetricQueryAudit"("endpoint", "generatedAt");

CREATE INDEX "MetricQueryAudit_scopeFingerprint_idx"
  ON "MetricQueryAudit"("scopeFingerprint");
