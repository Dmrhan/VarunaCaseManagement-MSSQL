import { apiFetch } from './caseService';

/**
 * WR-ACTION-CENTER Phase 1 — Approval Visibility MVP client.
 *
 * Five endpoints under /api/action-center:
 *   GET    /                — list (view-filtered)
 *   GET    /summary         — badge counts
 *   POST   /:id/done        — mark done
 *   POST   /:id/snooze      — push to snoozedUntil
 *   POST   /:id/dismiss     — dismiss with optional note
 *
 * apiFetch returns undefined on error (toast already shown).
 */

export type ActionItemKind =
  | 'approval_pending'
  | 'approval_decided'
  | 'case_returned_to_assignee'
  | 'mention'
  // WR-NOTIFICATION-CENTER Phase 2B — generic CaseNotification migration.
  // watcher_event covers watcher_added / watcher_update / note_reaction.
  // system_alert covers transfer_warning (supervisor-side warning).
  | 'watcher_event'
  | 'system_alert';

export type ActionItemState =
  | 'Pending'
  | 'InProgress'
  | 'Snoozed'
  | 'Done'
  | 'Dismissed'
  | 'Expired';

export type ActionCenterView = 'action' | 'fyi' | 'snoozed' | 'done';

export interface ActionItem {
  id: string;
  companyId: string;
  userId: string;
  personId: string | null;
  kind: ActionItemKind;
  state: ActionItemState;
  actionRequired: boolean;
  objectType: string | null;
  objectId: string | null;
  caseId: string | null;
  caseNumber: string | null;
  caseTitle: string | null;
  generatedBy: string | null;
  groupKey: string | null;
  dedupKey: string | null;
  priority: number;
  reasonLabel: string;
  createdAt: string;
  updatedAt: string;
  firstSeenAt: string | null;
  snoozedUntil: string | null;
  doneAt: string | null;
  doneByUserId: string | null;
  doneOutcome: string | null;
  closeNote: string | null;
}

export interface ActionCenterBadgeCounts {
  actionRequired: number;
  fyi: number;
  snoozed: number;
}

export interface ActionCenterListResponse {
  items: ActionItem[];
  total: number;
  badgeCounts: ActionCenterBadgeCounts;
}

export interface ListParams {
  view?: ActionCenterView;
  state?: ActionItemState;
  kind?: ActionItemKind;
  limit?: number;
  offset?: number;
  companyId?: string;
}

export const actionCenterService = {
  async list(params: ListParams = {}) {
    const qs = new URLSearchParams();
    if (params.view) qs.set('view', params.view);
    if (params.state) qs.set('state', params.state);
    if (params.kind) qs.set('kind', params.kind);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    if (params.companyId) qs.set('companyId', params.companyId);
    return apiFetch<ActionCenterListResponse>(
      `/api/action-center${qs.toString() ? `?${qs}` : ''}`,
      undefined,
      'Eylem Merkezi yükleniyor',
    );
  },

  async summary(companyId?: string) {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch<ActionCenterBadgeCounts>(
      `/api/action-center/summary${qs}`,
      undefined,
      'Eylem sayıları yükleniyor',
    );
  },

  async markDone(id: string, payload: { outcome?: string; closeNote?: string } = {}) {
    return apiFetch<ActionItem>(
      `/api/action-center/${encodeURIComponent(id)}/done`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Eylem tamamlanamadı',
    );
  },

  async snooze(id: string, payload: { snoozedUntil: string }) {
    return apiFetch<ActionItem>(
      `/api/action-center/${encodeURIComponent(id)}/snooze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Erteleme kaydedilemedi',
    );
  },

  async dismiss(id: string, payload: { closeNote?: string } = {}) {
    return apiFetch<ActionItem>(
      `/api/action-center/${encodeURIComponent(id)}/dismiss`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Yok sayılamadı',
    );
  },

  /**
   * WR-NOTIFICATION-CENTER Phase 2C P0 — manual unsnooze.
   * Returns the row back into the active queue (state=Pending,
   * snoozedUntil=null). Toast on failure ("Ertelemeyi kaldırma
   * başarısız"); apiFetch handles 4xx surface.
   */
  async unsnooze(id: string) {
    return apiFetch<ActionItem>(
      `/api/action-center/${encodeURIComponent(id)}/unsnooze`,
      { method: 'POST' },
      'Ertelemeyi kaldırma başarısız',
    );
  },
};

export const ACTION_CENTER_EVENT = 'app:action-center-changed';

/** Broadcast a change so all open bells/drawers refresh. */
export function emitActionCenterChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTION_CENTER_EVENT));
}
