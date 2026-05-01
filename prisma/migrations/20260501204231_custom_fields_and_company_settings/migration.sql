-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('Text', 'Number', 'Date', 'Select', 'Boolean', 'Textarea');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SystemAdmin';

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "customFields" JSONB;

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL,
    "caseType" "CaseType",
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "companyId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "appName" TEXT,
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "FieldDefinition_companyId_caseType_isActive_idx" ON "FieldDefinition"("companyId", "caseType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_companyId_fieldKey_key" ON "FieldDefinition"("companyId", "fieldKey");

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
