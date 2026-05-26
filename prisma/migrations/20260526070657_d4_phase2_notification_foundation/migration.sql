-- CreateEnum
CREATE TYPE "DispatchChannel" AS ENUM ('InApp', 'Email', 'ManualTask', 'Webhook');

-- CreateEnum
CREATE TYPE "DispatchMode" AS ENUM ('LogOnly', 'Manual', 'Active');

-- CreateEnum
CREATE TYPE "DispatchState" AS ENUM ('Pending', 'Sent', 'Failed', 'Suppressed');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "communicationState" TEXT;

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "event" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "isMatchAll" BOOLEAN NOT NULL DEFAULT false,
    "audience" JSONB NOT NULL,
    "templateId" TEXT NOT NULL,
    "channel" "DispatchChannel" NOT NULL,
    "mode" "DispatchMode" NOT NULL DEFAULT 'LogOnly',
    "suppressDuplicateWithinMinutes" INTEGER,
    "rateLimitPerHour" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'plain',
    "isCustomerFacing" BOOLEAN NOT NULL DEFAULT false,
    "requiredVariables" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleNameSnapshot" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKeySnapshot" TEXT NOT NULL,
    "templateVersionSnapshot" INTEGER NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceIdentifier" TEXT NOT NULL,
    "channel" "DispatchChannel" NOT NULL,
    "mode" "DispatchMode" NOT NULL,
    "state" "DispatchState" NOT NULL DEFAULT 'Pending',
    "snapshotSubject" TEXT NOT NULL,
    "snapshotBody" TEXT NOT NULL,
    "suppressionReason" TEXT,
    "idempotencyKey" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "deliveryNote" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationRule_companyId_event_isActive_idx" ON "NotificationRule"("companyId", "event", "isActive");

-- CreateIndex
CREATE INDEX "NotificationRule_companyId_sortOrder_idx" ON "NotificationRule"("companyId", "sortOrder");

-- CreateIndex
CREATE INDEX "NotificationRule_templateId_idx" ON "NotificationRule"("templateId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_companyId_isActive_idx" ON "NotificationTemplate"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_companyId_key_key" ON "NotificationTemplate"("companyId", "key");

-- CreateIndex
CREATE INDEX "NotificationDispatch_caseId_createdAt_idx" ON "NotificationDispatch"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDispatch_companyId_event_createdAt_idx" ON "NotificationDispatch"("companyId", "event", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDispatch_companyId_state_idx" ON "NotificationDispatch"("companyId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDispatch_idempotencyKey_unique" ON "NotificationDispatch"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
