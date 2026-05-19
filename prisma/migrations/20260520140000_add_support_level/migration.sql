-- WR-A5 + WR-B1 / PM-03 — SupportLevel enum + Person/Team/Case columns.
-- Phase 1 foundation only. Default L1 — existing rows backfill to L1 cleanly.
-- No PersonTeam, no Product.supportLevel, no SLA rewrite.

-- CreateEnum
CREATE TYPE "SupportLevel" AS ENUM ('L1', 'L2', 'L3', 'Expert');

-- AlterTable: Person — isTeamLead + supportLevel
ALTER TABLE "Person" ADD COLUMN "isTeamLead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Person" ADD COLUMN "supportLevel" "SupportLevel" NOT NULL DEFAULT 'L1';

-- AlterTable: Team — defaultSupportLevel
ALTER TABLE "Team" ADD COLUMN "defaultSupportLevel" "SupportLevel" NOT NULL DEFAULT 'L1';

-- AlterTable: Case — supportLevel
ALTER TABLE "Case" ADD COLUMN "supportLevel" "SupportLevel" NOT NULL DEFAULT 'L1';

-- CreateIndex (Case tier filter / routing Phase 2)
CREATE INDEX "Case_companyId_supportLevel_idx" ON "Case"("companyId", "supportLevel");
