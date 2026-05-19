-- WR-A4 / PM-04 — AccountProject for UNIVERA project-based cases.
-- Decision Sprint §④ — AccountCompany-scoped (Guardrail #2), nullable Case FK,
-- opt-in via Company flags (default false).

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('Active', 'Passive', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "AccountProject" (
    "id" TEXT NOT NULL,
    "accountCompanyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'Active',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountProject_accountCompanyId_idx" ON "AccountProject"("accountCompanyId");
CREATE INDEX "AccountProject_accountCompanyId_isActive_idx" ON "AccountProject"("accountCompanyId", "isActive");
CREATE UNIQUE INDEX "AccountProject_accountCompanyId_code_key" ON "AccountProject"("accountCompanyId", "code");

-- AddForeignKey
ALTER TABLE "AccountProject" ADD CONSTRAINT "AccountProject_accountCompanyId_fkey"
  FOREIGN KEY ("accountCompanyId") REFERENCES "AccountCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Case
ALTER TABLE "Case" ADD COLUMN "accountProjectId" TEXT;
ALTER TABLE "Case" ADD COLUMN "accountProjectName" TEXT;

-- CreateIndex
CREATE INDEX "Case_accountProjectId_idx" ON "Case"("accountProjectId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_accountProjectId_fkey"
  FOREIGN KEY ("accountProjectId") REFERENCES "AccountProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: CompanySettings (opt-in flags, default false)
ALTER TABLE "CompanySettings" ADD COLUMN "projectsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanySettings" ADD COLUMN "projectsRequired" BOOLEAN NOT NULL DEFAULT false;
