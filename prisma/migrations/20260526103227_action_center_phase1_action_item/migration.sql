-- CreateEnum
CREATE TYPE "ActionItemKind" AS ENUM ('approval_pending', 'approval_decided', 'case_returned_to_assignee', 'case_assigned', 'case_transferred', 'case_sla_at_risk', 'case_sla_breach', 'mention', 'watcher_event', 'dispatch_manual_confirm', 'dispatch_review_needed', 'pattern_alert', 'manual_task', 'system_alert');

-- CreateEnum
CREATE TYPE "ActionItemState" AS ENUM ('Pending', 'InProgress', 'Snoozed', 'Done', 'Dismissed', 'Expired');

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "kind" "ActionItemKind" NOT NULL,
    "state" "ActionItemState" NOT NULL DEFAULT 'Pending',
    "actionRequired" BOOLEAN NOT NULL DEFAULT true,
    "objectType" TEXT,
    "objectId" TEXT,
    "caseId" TEXT,
    "caseNumber" TEXT,
    "caseTitle" TEXT,
    "generatedBy" TEXT,
    "groupKey" TEXT,
    "dedupKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "reasonLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "doneOutcome" TEXT,
    "closeNote" TEXT,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionItem_userId_state_createdAt_idx" ON "ActionItem"("userId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActionItem_userId_state_actionRequired_idx" ON "ActionItem"("userId", "state", "actionRequired");

-- CreateIndex
CREATE INDEX "ActionItem_companyId_kind_state_idx" ON "ActionItem"("companyId", "kind", "state");

-- CreateIndex
CREATE INDEX "ActionItem_objectType_objectId_idx" ON "ActionItem"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "ActionItem_state_snoozedUntil_idx" ON "ActionItem"("state", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ActionItem_dedupKey_key" ON "ActionItem"("dedupKey");
