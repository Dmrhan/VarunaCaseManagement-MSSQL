import { apiFetch } from './caseService';

/**
 * WR-D4 Phase 1 — Resolution Approval client.
 *
 * UI layer kullanır: admin CRUD (ResolutionApprovalPoliciesPage) + case
 * detayında submit/approve/reject + history listesi.
 *
 * apiFetch error toast'larını kendisi gösterir; bu yüzden tüm return tipleri
 * `T | undefined`. UI undefined geldiğinde aksiyon almaz (kullanıcı zaten
 * uyarılmıştır).
 */

export type ApproverType =
  | 'TeamLead'
  | 'AssignedTeamLead'
  | 'Supervisor'
  | 'Admin'
  | 'SystemAdmin'
  | 'SpecificPerson';

export type RejectionBehavior = 'ReturnToAssignee' | 'ReturnToTeam' | 'Escalate';

export type ApprovalState = 'Pending' | 'Approved' | 'Rejected';

export interface ResolutionApprovalPolicy {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  matchScope: {
    category?: string;
    subCategory?: string;
    priority?: string;
    supportLevel?: string;
    teamId?: string;
  };
  approverType: ApproverType;
  approverPersonId: string | null;
  allowSelfApprove: boolean;
  rejectionBehavior: RejectionBehavior;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface CaseResolutionApproval {
  id: string;
  caseId: string;
  companyId: string;
  policyId: string | null;
  policyNameSnapshot: string;
  state: ApprovalState;
  submittedByUserId: string;
  submittedAt: string;
  resolutionSummary: string;
  customerMessageDraft: string | null;
  expectedApproverPersonId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseApprovalsResponse {
  approvals: CaseResolutionApproval[];
  matchedPolicy: ResolutionApprovalPolicy | null;
  expectedApprover: { personId: string } | null;
  approvalState: ApprovalState | null;
}

export interface PolicyCreateInput {
  companyId: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  matchScope?: ResolutionApprovalPolicy['matchScope'];
  approverType: ApproverType;
  approverPersonId?: string | null;
  allowSelfApprove?: boolean;
  rejectionBehavior?: RejectionBehavior;
}

export type PolicyUpdateInput = Partial<Omit<PolicyCreateInput, 'companyId'>>;

export const approvalService = {
  /* ---------------- Policy CRUD (Admin) ---------------- */
  async listPolicies(companyId?: string) {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch<{ value: ResolutionApprovalPolicy[] }>(
      `/api/approvals/policies${qs}`,
      undefined,
      'Politikalar yükleniyor',
    );
  },

  async getPolicy(id: string) {
    return apiFetch<ResolutionApprovalPolicy>(
      `/api/approvals/policies/${encodeURIComponent(id)}`,
      undefined,
      'Politika yükleniyor',
    );
  },

  async createPolicy(data: PolicyCreateInput) {
    return apiFetch<ResolutionApprovalPolicy>(
      `/api/approvals/policies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Politika oluşturulamadı',
    );
  },

  async updatePolicy(id: string, data: PolicyUpdateInput) {
    return apiFetch<ResolutionApprovalPolicy>(
      `/api/approvals/policies/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Politika güncellenemedi',
    );
  },

  /* ---------------- Case detail surface ---------------- */
  async getCaseApprovals(caseId: string) {
    return apiFetch<CaseApprovalsResponse>(
      `/api/approvals/cases/${encodeURIComponent(caseId)}`,
      undefined,
      'Onay bilgisi yükleniyor',
    );
  },

  async submit(
    caseId: string,
    payload: { resolutionSummary: string; customerMessageDraft?: string | null },
  ) {
    return apiFetch<CaseResolutionApproval>(
      `/api/approvals/cases/${encodeURIComponent(caseId)}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Çözüm onayına gönderilemedi',
    );
  },

  async approve(approvalId: string, payload: { override?: boolean } = {}) {
    return apiFetch<CaseResolutionApproval>(
      `/api/approvals/${encodeURIComponent(approvalId)}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Onay verilemedi',
    );
  },

  async reject(
    approvalId: string,
    payload: { rejectionReason: string; override?: boolean },
  ) {
    return apiFetch<CaseResolutionApproval>(
      `/api/approvals/${encodeURIComponent(approvalId)}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Reddedilemedi',
    );
  },
};
