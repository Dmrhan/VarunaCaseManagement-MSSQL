-- WR-Smart-Ticket Phase 2a — CaseSolutionStep table.
--
-- Yeni tablo. Mevcut Case / Company tablolarına dokunmaz; tamamen additive
-- ve downtime'sız.
--
-- Unique constraint (caseId, source, sourceRef) idempotency içindir:
--   - source='ai_suggested_step' + sourceRef NOT NULL → re-run import
--     duplicate yaratmaz.
--   - source='manual' satırlar sourceRef = NULL ile birden fazla olabilir
--     (NULL'lar Postgres unique kuralında ayrı sayılır).
--
-- onDelete: Case Cascade (case silinince adımlar da silinir); Company
-- NoAction (cross-tenant kazara silmeyi engeller; case scope guard zaten
-- companyId tutarlılığını sağlar).

CREATE TABLE "CaseSolutionStep" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceTitle" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "note" TEXT,
    "triedAt" TIMESTAMP(3),
    "triedByUserId" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "outcomeByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseSolutionStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaseSolutionStep_caseId_source_sourceRef_key"
    ON "CaseSolutionStep"("caseId", "source", "sourceRef");

CREATE INDEX "CaseSolutionStep_caseId_stepIndex_idx"
    ON "CaseSolutionStep"("caseId", "stepIndex");

CREATE INDEX "CaseSolutionStep_caseId_status_idx"
    ON "CaseSolutionStep"("caseId", "status");

CREATE INDEX "CaseSolutionStep_companyId_idx"
    ON "CaseSolutionStep"("companyId");

CREATE INDEX "CaseSolutionStep_source_sourceRef_idx"
    ON "CaseSolutionStep"("source", "sourceRef");

ALTER TABLE "CaseSolutionStep" ADD CONSTRAINT "CaseSolutionStep_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "Case"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseSolutionStep" ADD CONSTRAINT "CaseSolutionStep_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
