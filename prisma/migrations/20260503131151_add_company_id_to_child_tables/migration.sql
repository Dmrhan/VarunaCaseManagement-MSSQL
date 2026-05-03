-- ============================================================
-- Multi-tenant child table denormalization (Faz 1.5 ek iş).
-- 8 child tablosuna companyId ekle, mevcut satırları parent Case'den
-- backfill et, sonra NOT NULL constraint uygula. Tek migration'da
-- atomik (içeride 3 aşama: ADD nullable → UPDATE backfill → ALTER NOT NULL).
-- ============================================================

-- 1) ADD COLUMN nullable (mevcut satırlara önce NULL yazılır)
ALTER TABLE "AISuggestion"        ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseActivity"        ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseApproval"        ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseAttachment"      ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseCallLog"         ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseNote"            ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseNotification"    ADD COLUMN "companyId" TEXT;
ALTER TABLE "CaseOfferedSolution" ADD COLUMN "companyId" TEXT;

-- 2) Backfill — parent Case'den companyId kopyala
UPDATE "AISuggestion"        AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseActivity"        AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseApproval"        AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseAttachment"      AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseCallLog"         AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseNote"            AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseNotification"    AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";
UPDATE "CaseOfferedSolution" AS t SET "companyId" = c."companyId" FROM "Case" c WHERE c.id = t."caseId";

-- 3) NOT NULL constraint — backfill sonrası tüm satırlar dolu olduğundan güvenli
ALTER TABLE "AISuggestion"        ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseActivity"        ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseApproval"        ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseAttachment"      ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseCallLog"         ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseNote"            ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseNotification"    ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CaseOfferedSolution" ALTER COLUMN "companyId" SET NOT NULL;

-- 4) Index'ler — top-level scope sorguları için
CREATE INDEX "AISuggestion_companyId_idx"        ON "AISuggestion"("companyId");
CREATE INDEX "CaseActivity_companyId_idx"        ON "CaseActivity"("companyId");
CREATE INDEX "CaseApproval_companyId_idx"        ON "CaseApproval"("companyId");
CREATE INDEX "CaseAttachment_companyId_idx"      ON "CaseAttachment"("companyId");
CREATE INDEX "CaseCallLog_companyId_idx"         ON "CaseCallLog"("companyId");
CREATE INDEX "CaseNote_companyId_idx"            ON "CaseNote"("companyId");
CREATE INDEX "CaseNotification_companyId_idx"    ON "CaseNotification"("companyId");
CREATE INDEX "CaseOfferedSolution_companyId_idx" ON "CaseOfferedSolution"("companyId");
