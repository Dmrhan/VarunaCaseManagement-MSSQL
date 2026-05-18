-- Phase D — Müşterisiz vaka akışı kapanışı

-- AlterTable: Case.customerMatchPending
ALTER TABLE "Case" ADD COLUMN "customerMatchPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: CompanySettings.requireCustomerOnCaseCreate
ALTER TABLE "CompanySettings" ADD COLUMN "requireCustomerOnCaseCreate" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: accountId IS NULL vakalar customerMatchPending = true ile işaretlenir.
UPDATE "Case" SET "customerMatchPending" = true WHERE "accountId" IS NULL;
