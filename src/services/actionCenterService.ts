import { apiFetch, caseService } from './caseService';
import type { CaseNote } from '@/features/cases/types';

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

/**
 * Aksiyonlarım > Bildirimler — mention satırında inline cevap akışı.
 *
 * Davranış (Codex P1 hotfix sonrası):
 *  - item.objectType === 'CaseNote' && item.objectId varsa → silent
 *    tryAddReply. Live-emit path artık her zaman top-level note id'sini
 *    yazıyor; bu yol normalde başarılı olur.
 *  - tryAddReply `max_depth` veya `not_found` döndürürse → kaynak satır
 *    legacy/bozuk demektir (örn. bu fix öncesi reply-id atanmış eski
 *    satır, ya da parent silinmiş). Vakaya yeni iç not olarak yazılır;
 *    kullanıcıya max_depth toast'ı GÖSTERİLMEZ.
 *  - tryAddReply `forbidden` veya `unknown` döndürürse → composer
 *    `Cevap gönderilemedi.` inline hatası gösterir.
 *  - objectId yoksa → doğrudan addNote.
 *
 * Cevap her durumda vakanın kalıcı sohbet kaydıdır. ActionItem sadece
 * çalışma yüzeyi.
 *
 * Sonra: ActionItem markDone({ outcome: 'replied' }) ile kapanır.
 *
 * Dönüş sözleşmesi:
 *  - { reply, doneMarked: true } → her şey başarılı.
 *  - { reply, doneMarked: false, doneFailed: true } → not yazıldı ama
 *    markDone başarısız. UI inline uyarı gösterir, kullanıcı manuel
 *    "Okundu" diyebilir. NOT yeniden yazılmaz.
 *  - { error: 'no_case' } → caseId yok (defansif; UI butonu gizlemeli).
 *  - { error: 'note_failed' } → not/reply yazımı başarısız. ActionItem
 *    aktif kalır.
 */
export async function replyToMentionActionItem({
  item,
  content,
  authorName,
}: {
  item: ActionItem;
  content: string;
  authorName: string;
}): Promise<{
  reply?: CaseNote;
  doneMarked?: boolean;
  doneFailed?: boolean;
  error?: 'no_case' | 'note_failed';
}> {
  if (!item.caseId) return { error: 'no_case' };

  const trimmed = content.trim();
  if (!trimmed) return { error: 'note_failed' };

  const payload = {
    content: trimmed,
    visibility: 'Internal' as const,
    authorName,
  };

  let reply: CaseNote | undefined;
  if (item.objectType === 'CaseNote' && item.objectId) {
    const r = await caseService.tryAddReply(item.caseId, item.objectId, payload);
    if (r.ok) {
      reply = r.note;
    } else if (r.reason === 'max_depth' || r.reason === 'not_found') {
      // Legacy/bad target (örn. Codex P1 hotfix'inden önce reply-id
      // atanmış eski ActionItem, ya da parent silinmiş). Sessizce
      // taze top-level internal note'a düş — objectId=null path'iyle
      // aynı sonuç. Composer max_depth'i hiçbir zaman göstermez.
      reply = await caseService.addNote(item.caseId, payload);
    } else {
      // forbidden / unknown / empty — composer kendi inline
      // "Cevap gönderilemedi." mesajını gösterir.
      return { error: 'note_failed' };
    }
  } else {
    reply = await caseService.addNote(item.caseId, payload);
  }

  if (!reply) return { error: 'note_failed' };

  const done = await actionCenterService.markDone(item.id, { outcome: 'replied' });
  if (!done) {
    return { reply, doneMarked: false, doneFailed: true };
  }
  return { reply, doneMarked: true };
}

export const ACTION_CENTER_EVENT = 'app:action-center-changed';

/** Broadcast a change so all open bells/drawers refresh. */
export function emitActionCenterChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTION_CENTER_EVENT));
}
