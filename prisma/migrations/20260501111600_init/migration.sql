-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('GeneralSupport', 'ProactiveTracking', 'Churn');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon', 'Çözüldü', 'YenidenAcildi', 'İptalEdildi');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('Low', 'Medium', 'High', 'Critical');

-- CreateEnum
CREATE TYPE "CaseOrigin" AS ENUM ('Telefon', 'E-posta', 'Web', 'Chatbot', 'Diğer');

-- CreateEnum
CREATE TYPE "CaseRequestType" AS ENUM ('Bilgi', 'Öneri', 'Talep', 'Şikayet', 'Hata');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('Yok', 'TakımLideri', 'Direktör', 'ÜstYönetim');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('Internal', 'Customer');

-- CreateEnum
CREATE TYPE "FinancialStatus" AS ENUM ('Düşük', 'Orta', 'Yüksek', 'Kritik');

-- CreateEnum
CREATE TYPE "ProductUsage" AS ENUM ('Yüksek', 'Orta', 'Düşük', 'Yok');

-- CreateEnum
CREATE TYPE "UsageChangeAlert" AS ENUM ('Artış', 'Azalma', 'Sabit');

-- CreateEnum
CREATE TYPE "ResponseLevel" AS ENUM ('Yüksek Öncelik', 'Orta Öncelik', 'Düşük Öncelik');

-- CreateEnum
CREATE TYPE "CallDisposition" AS ENUM ('Cevapladı', 'Cevaplamadı', 'NumaraHatalı', 'GörüşmekIstemedi', 'TekrarAranacak');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('Memnun', 'MemnunDeğil', 'Tarafsız', 'Ulaşılamadı');

-- CreateEnum
CREATE TYPE "OfferOutcome" AS ENUM ('KabulEdildi', 'Reddedildi', 'Beklemede');

-- CreateEnum
CREATE TYPE "ChurnResult" AS ENUM ('İptalEdildi', 'DevamEdiyor', 'TeklifKabulEdildi');

-- CreateEnum
CREATE TYPE "RetentionStatus" AS ENUM ('Başarılı', 'Başarısız', 'DevamEdiyor');

-- CreateEnum
CREATE TYPE "CaseHistoryActionType" AS ENUM ('Transfer', 'StatusChange', 'FieldUpdate', 'ChecklistToggle', 'NoteAdded', 'CallLogAdded', 'FileUploaded', 'FileRemoved', 'CaseCreated', 'SLAApplied');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('Bekliyor', 'Onaylandı', 'Reddedildi');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('InApp', 'Email', 'SMS');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "teamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdParty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvrakType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvrakType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryDef" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferedSolutionDef" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferedSolutionDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SLAPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "productGroup" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "subCategoryName" TEXT NOT NULL,
    "requestType" "CaseRequestType" NOT NULL,
    "responseHours" INTEGER NOT NULL,
    "resolutionHours" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SLAPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "productGroup" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "description" TEXT,
    "items" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "caseType" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'Açık',
    "priority" "CasePriority" NOT NULL,
    "origin" "CaseOrigin" NOT NULL,
    "originDescription" TEXT,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subCategory" TEXT NOT NULL,
    "requestType" "CaseRequestType" NOT NULL,
    "productGroup" TEXT,
    "assignedTeamId" TEXT,
    "assignedTeamName" TEXT,
    "assignedPersonId" TEXT,
    "assignedPersonName" TEXT,
    "escalationLevel" "EscalationLevel" NOT NULL DEFAULT 'Yok',
    "thirdPartyId" TEXT,
    "thirdPartyName" TEXT,
    "financialStatus" "FinancialStatus",
    "productUsage" "ProductUsage",
    "usageChangeAlert" "UsageChangeAlert",
    "responseLevel" "ResponseLevel",
    "cancellationRequest" BOOLEAN,
    "offeredSolutions" JSONB,
    "offerExpiryDate" TIMESTAMP(3),
    "offerOutcome" "OfferOutcome",
    "offerRejectionReason" TEXT,
    "actionTaken" TEXT,
    "churnResult" "ChurnResult",
    "retentionStatus" "RetentionStatus",
    "followUpDate" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "cancellationReason" TEXT,
    "slaResponseDueAt" TIMESTAMP(3),
    "slaResolutionDueAt" TIMESTAMP(3),
    "slaViolation" BOOLEAN NOT NULL DEFAULT false,
    "slaPausedAt" TIMESTAMP(3),
    "slaPausedDurationMin" INTEGER NOT NULL DEFAULT 0,
    "slaThirdPartyWaitMin" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "aiCategoryPrediction" TEXT,
    "aiPriorityPrediction" "CasePriority",
    "aiDuplicateScore" DOUBLE PRECISION,
    "aiConfidenceScore" DOUBLE PRECISION,
    "aiGeneratedFlag" BOOLEAN NOT NULL DEFAULT false,
    "aiRejectReason" TEXT,
    "aiCallBrief" TEXT,
    "aiFollowupRecommendation" TEXT,
    "aiRetentionOfferSuggestion" TEXT,
    "checklistItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseActivity" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionType" "CaseHistoryActionType",
    "fieldName" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'Internal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAttachment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileUrl" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseCallLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "callDate" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "callDisposition" "CallDisposition" NOT NULL,
    "callOutcome" "CallOutcome" NOT NULL,
    "description" TEXT,
    "callerId" TEXT NOT NULL,
    "callerName" TEXT NOT NULL,
    "nextFollowupDate" TIMESTAMP(3),
    "lastInteractionDate" TIMESTAMP(3),

    CONSTRAINT "CaseCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseOfferedSolution" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "solutionDefId" TEXT NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offeredBy" TEXT NOT NULL,
    "outcome" "OfferOutcome" NOT NULL DEFAULT 'Beklemede',
    "expiryDate" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "CaseOfferedSolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseApproval" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'Bekliyor',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,

    CONSTRAINT "CaseApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNotification" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "CaseNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "suggestedValue" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "accepted" BOOLEAN,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_name_idx" ON "Account"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdParty_name_key" ON "ThirdParty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EvrakType_name_key" ON "EvrakType"("name");

-- CreateIndex
CREATE INDEX "CategoryDef_parentId_idx" ON "CategoryDef"("parentId");

-- CreateIndex
CREATE INDEX "CategoryDef_companyId_idx" ON "CategoryDef"("companyId");

-- CreateIndex
CREATE INDEX "SLAPolicy_companyId_productGroup_categoryName_subCategoryNa_idx" ON "SLAPolicy"("companyId", "productGroup", "categoryName", "subCategoryName", "requestType");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_companyId_productGroup_categoryName_idx" ON "ChecklistTemplate"("companyId", "productGroup", "categoryName");

-- CreateIndex
CREATE UNIQUE INDEX "Case_caseNumber_key" ON "Case"("caseNumber");

-- CreateIndex
CREATE INDEX "Case_accountId_idx" ON "Case"("accountId");

-- CreateIndex
CREATE INDEX "Case_companyId_idx" ON "Case"("companyId");

-- CreateIndex
CREATE INDEX "Case_assignedPersonId_idx" ON "Case"("assignedPersonId");

-- CreateIndex
CREATE INDEX "Case_assignedTeamId_idx" ON "Case"("assignedTeamId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_caseType_idx" ON "Case"("caseType");

-- CreateIndex
CREATE INDEX "Case_createdAt_idx" ON "Case"("createdAt");

-- CreateIndex
CREATE INDEX "Case_slaResolutionDueAt_idx" ON "Case"("slaResolutionDueAt");

-- CreateIndex
CREATE INDEX "CaseActivity_caseId_idx" ON "CaseActivity"("caseId");

-- CreateIndex
CREATE INDEX "CaseActivity_at_idx" ON "CaseActivity"("at");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_idx" ON "CaseNote"("caseId");

-- CreateIndex
CREATE INDEX "CaseAttachment_caseId_idx" ON "CaseAttachment"("caseId");

-- CreateIndex
CREATE INDEX "CaseCallLog_caseId_idx" ON "CaseCallLog"("caseId");

-- CreateIndex
CREATE INDEX "CaseCallLog_callDate_idx" ON "CaseCallLog"("callDate");

-- CreateIndex
CREATE INDEX "CaseOfferedSolution_caseId_idx" ON "CaseOfferedSolution"("caseId");

-- CreateIndex
CREATE INDEX "CaseApproval_caseId_idx" ON "CaseApproval"("caseId");

-- CreateIndex
CREATE INDEX "CaseApproval_decision_idx" ON "CaseApproval"("decision");

-- CreateIndex
CREATE INDEX "CaseNotification_caseId_idx" ON "CaseNotification"("caseId");

-- CreateIndex
CREATE INDEX "CaseNotification_recipient_readAt_idx" ON "CaseNotification"("recipient", "readAt");

-- CreateIndex
CREATE INDEX "AISuggestion_caseId_idx" ON "AISuggestion"("caseId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryDef" ADD CONSTRAINT "CategoryDef_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CategoryDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryDef" ADD CONSTRAINT "CategoryDef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SLAPolicy" ADD CONSTRAINT "SLAPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assignedPersonId_fkey" FOREIGN KEY ("assignedPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseActivity" ADD CONSTRAINT "CaseActivity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseCallLog" ADD CONSTRAINT "CaseCallLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseOfferedSolution" ADD CONSTRAINT "CaseOfferedSolution_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseOfferedSolution" ADD CONSTRAINT "CaseOfferedSolution_solutionDefId_fkey" FOREIGN KEY ("solutionDefId") REFERENCES "OfferedSolutionDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseApproval" ADD CONSTRAINT "CaseApproval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNotification" ADD CONSTRAINT "CaseNotification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISuggestion" ADD CONSTRAINT "AISuggestion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
