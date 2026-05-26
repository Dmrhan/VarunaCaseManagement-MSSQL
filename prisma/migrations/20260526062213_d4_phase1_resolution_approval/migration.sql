-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('TeamLead', 'AssignedTeamLead', 'Supervisor', 'Admin', 'SystemAdmin', 'SpecificPerson');

-- CreateEnum
CREATE TYPE "RejectionBehavior" AS ENUM ('ReturnToAssignee', 'ReturnToTeam', 'Escalate');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "approvalState" "ApprovalState";

-- CreateTable
CREATE TABLE "ResolutionApprovalPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "matchScope" JSONB NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "approverPersonId" TEXT,
    "allowSelfApprove" BOOLEAN NOT NULL DEFAULT false,
    "rejectionBehavior" "RejectionBehavior" NOT NULL DEFAULT 'ReturnToAssignee',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "ResolutionApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseResolutionApproval" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "policyId" TEXT,
    "policyNameSnapshot" TEXT NOT NULL,
    "state" "ApprovalState" NOT NULL DEFAULT 'Pending',
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolutionSummary" TEXT NOT NULL,
    "customerMessageDraft" TEXT,
    "expectedApproverPersonId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseResolutionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResolutionApprovalPolicy_companyId_isActive_idx" ON "ResolutionApprovalPolicy"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "ResolutionApprovalPolicy_companyId_sortOrder_idx" ON "ResolutionApprovalPolicy"("companyId", "sortOrder");

-- CreateIndex
CREATE INDEX "CaseResolutionApproval_caseId_idx" ON "CaseResolutionApproval"("caseId");

-- CreateIndex
CREATE INDEX "CaseResolutionApproval_companyId_state_idx" ON "CaseResolutionApproval"("companyId", "state");

-- CreateIndex
CREATE INDEX "CaseResolutionApproval_expectedApproverPersonId_state_idx" ON "CaseResolutionApproval"("expectedApproverPersonId", "state");

-- CreateIndex
CREATE INDEX "CaseResolutionApproval_caseId_state_idx" ON "CaseResolutionApproval"("caseId", "state");

-- AddForeignKey
ALTER TABLE "ResolutionApprovalPolicy" ADD CONSTRAINT "ResolutionApprovalPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionApprovalPolicy" ADD CONSTRAINT "ResolutionApprovalPolicy_approverPersonId_fkey" FOREIGN KEY ("approverPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseResolutionApproval" ADD CONSTRAINT "CaseResolutionApproval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseResolutionApproval" ADD CONSTRAINT "CaseResolutionApproval_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ResolutionApprovalPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseResolutionApproval" ADD CONSTRAINT "CaseResolutionApproval_expectedApproverPersonId_fkey" FOREIGN KEY ("expectedApproverPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
