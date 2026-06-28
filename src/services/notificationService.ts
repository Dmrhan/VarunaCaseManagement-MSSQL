import { apiFetch } from './caseService';

/**
 * WR-D4/D3 Phase 2 — Notification client.
 *
 * Surfaces:
 *  - Templates CRUD (admin)
 *  - Rules CRUD (admin)
 *  - Dispatch viewer (admin) + case-scoped dispatch list (CaseDetail card)
 *  - Manual confirm action
 *
 * Phase 2 constraints — no active delivery surface; `mode='Active'` is
 * server-side blocked. UI never offers "send now".
 */

export type DispatchChannel = 'InApp' | 'Email' | 'ManualTask' | 'Webhook';
export type DispatchMode = 'LogOnly' | 'Manual' | 'Active';
export type DispatchState = 'Pending' | 'Sent' | 'Failed' | 'Suppressed';

export type NotificationEvent =
  | 'resolution_submitted'
  | 'resolution_approved'
  | 'resolution_rejected'
  | 'case_closed'
  | 'case_reopened'
  // M4.1 FAZ B — müşteri bildirim event'leri
  | 'case_created'
  | 'status_changed';

export type AudienceType =
  | 'assignee'
  | 'team_lead'
  | 'supervisor'
  | 'admin'
  | 'customer_primary_contact'
  // M4.1 FAZ B — talep eden (mail göndereni)
  | 'requester'
  | 'static_email';

export interface AudienceRow {
  type: AudienceType;
  targetValue?: string;
}

export interface NotificationTemplate {
  id: string;
  companyId: string;
  key: string;
  name: string;
  description: string | null;
  language: string;
  subjectTemplate: string;
  bodyTemplate: string;
  format: 'plain' | 'html';
  isCustomerFacing: boolean;
  requiredVariables: string[];
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface NotificationRule {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  event: NotificationEvent;
  conditions: {
    category?: string;
    subCategory?: string;
    priority?: string;
    supportLevel?: string;
    teamId?: string;
  };
  isMatchAll: boolean;
  audience: AudienceRow[];
  templateId: string;
  template?: { id: string; key: string; name: string; isCustomerFacing: boolean };
  channel: DispatchChannel;
  mode: DispatchMode;
  suppressDuplicateWithinMinutes: number | null;
  rateLimitPerHour: number | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface NotificationDispatch {
  id: string;
  caseId: string;
  companyId: string;
  event: NotificationEvent;
  ruleId: string | null;
  ruleNameSnapshot: string;
  templateId: string | null;
  templateKeySnapshot: string;
  templateVersionSnapshot: number;
  audienceType: string;
  audienceIdentifier: string;
  channel: DispatchChannel;
  mode: DispatchMode;
  state: DispatchState;
  snapshotSubject: string;
  snapshotBody: string;
  suppressionReason: string | null;
  idempotencyKey: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  deliveryNote: string | null;
  dispatchedAt: string | null;
  failureReason: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateCreateInput {
  companyId: string;
  key: string;
  name: string;
  description?: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  format?: 'plain' | 'html';
  isCustomerFacing?: boolean;
  requiredVariables?: string[];
  isActive?: boolean;
}

export type TemplateUpdateInput = Partial<Omit<TemplateCreateInput, 'companyId' | 'key'>>;

export interface RuleCreateInput {
  companyId: string;
  name: string;
  description?: string | null;
  event: NotificationEvent;
  conditions?: NotificationRule['conditions'];
  isMatchAll?: boolean;
  audience: AudienceRow[];
  templateId: string;
  channel: DispatchChannel;
  // Codex #205 P2a — Active dahil; backend NotificationRule.mode round-trip
  // tip darlığı yüzünden Active editörden Kaydet'le LogOnly'ye düşüyordu.
  mode?: DispatchMode;
  suppressDuplicateWithinMinutes?: number | null;
  rateLimitPerHour?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

export type RuleUpdateInput = Partial<Omit<RuleCreateInput, 'companyId'>>;

export interface PreviewResponse {
  subject: string;
  body: string;
  missing: string[];
}

/** WR-D4/D3 Phase 3 — customer channel resolution result for a case. */
export type CustomerChannel = 'email' | 'phone' | 'manual' | 'portal' | null;
export type CustomerChannelSource =
  | 'case_override'
  | 'account_company'
  | 'account_contact'
  | 'account_fallback'
  | 'none';
export interface CustomerChannelResolution {
  caseOverride: string | null;
  channel: CustomerChannel;
  identifier: string | null;
  contactName: string | null;
  source: CustomerChannelSource;
  suppressionReason: null | 'customer_opted_out' | 'no_channel_available';
}

export const notificationService = {
  /* ---------------- Templates ---------------- */
  async listTemplates(companyId?: string) {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch<{ value: NotificationTemplate[] }>(
      `/api/approvals/notification-templates${qs}`,
      undefined,
      'Şablonlar yükleniyor',
    );
  },
  async createTemplate(data: TemplateCreateInput) {
    return apiFetch<NotificationTemplate>(
      `/api/approvals/notification-templates`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      'Şablon oluşturulamadı',
    );
  },
  async updateTemplate(id: string, data: TemplateUpdateInput) {
    return apiFetch<NotificationTemplate>(
      `/api/approvals/notification-templates/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      'Şablon güncellenemedi',
    );
  },
  async previewTemplate(id: string, payload: { sampleCaseId?: string; vars?: Record<string, string> } = {}) {
    return apiFetch<PreviewResponse>(
      `/api/approvals/notification-templates/${encodeURIComponent(id)}/preview`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      'Önizleme oluşturulamadı',
    );
  },

  /* ---------------- Rules ---------------- */
  async listRules(companyId?: string) {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch<{ value: NotificationRule[] }>(
      `/api/approvals/notification-rules${qs}`,
      undefined,
      'Kurallar yükleniyor',
    );
  },
  async createRule(data: RuleCreateInput) {
    return apiFetch<NotificationRule>(
      `/api/approvals/notification-rules`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      'Kural oluşturulamadı',
    );
  },
  async updateRule(id: string, data: RuleUpdateInput) {
    return apiFetch<NotificationRule>(
      `/api/approvals/notification-rules/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      'Kural güncellenemedi',
    );
  },

  /* ---------------- Dispatches ---------------- */
  async listDispatches(params: {
    companyId?: string;
    event?: NotificationEvent;
    state?: DispatchState;
    limit?: number;
    offset?: number;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.event) qs.set('event', params.event);
    if (params.state) qs.set('state', params.state);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    return apiFetch<{ value: NotificationDispatch[]; total: number }>(
      `/api/approvals/notification-dispatches${qs.toString() ? `?${qs}` : ''}`,
      undefined,
      'Bildirim kayıtları yükleniyor',
    );
  },
  async getCustomerChannel(caseId: string) {
    return apiFetch<CustomerChannelResolution>(
      `/api/approvals/cases/${encodeURIComponent(caseId)}/customer-channel`,
      undefined,
      'Cevap kanalı bilgisi yükleniyor',
    );
  },

  async listForCase(caseId: string) {
    return apiFetch<{ value: NotificationDispatch[] }>(
      `/api/approvals/cases/${encodeURIComponent(caseId)}/dispatches`,
      undefined,
      'Bildirim kayıtları yükleniyor',
    );
  },
  async manualConfirm(dispatchId: string, payload: { deliveryNote: string }) {
    return apiFetch<NotificationDispatch>(
      `/api/approvals/dispatches/${encodeURIComponent(dispatchId)}/manual-confirm`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      'Manuel onay kaydedilemedi',
    );
  },
};
