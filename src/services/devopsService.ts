/**
 * PR-D3 — Azure DevOps / TFS frontend adapter.
 *
 * Sadece BFF endpoint'lerine (PR-D2 ile gelen) çağrı yapar:
 *   GET    /api/cases/:id/devops-items
 *   POST   /api/cases/:id/devops-link
 *   DELETE /api/cases/:id/devops-link/:workItemId
 *
 * **TFS'e DOĞRUDAN çağrı YAPMAZ**. PAT/secret frontend'e indirilmez —
 * tüm auth + parse + allowlist guardrail server-side `devopsClient`'ta.
 *
 * apiFetch wrapper pattern: caseService.archive/restore ile aynı.
 */

import { apiFetch } from './caseService';
import type { Case } from '@/features/cases/types';

/**
 * Bağlı bir DevOps work item'ın UI'da gösterilen snapshot'ı.
 *
 * Bu tip server/lib/devopsClient.js normalizeWorkItem çıktısı +
 * caseRepository.linkDevops meta + listDevopsLive _stale flag birleşimidir.
 * Backend ALLOWLIST guard'lı — Description/ReproSteps SIZAMAZ.
 */
export interface DevopsItem {
  // 16 allowlist alanı (normalizeWorkItem)
  id: number;
  state: string | null;
  project: string | null;
  type: string | null;
  title: string | null;
  assignee: string | null;
  createdDate: string | null;
  resolvedDate: string | null;
  closedDate: string | null;
  rootCause: string | null;
  foundIn: string | null;
  packageType: string | null;
  projectLayer: string | null;
  extraField4: string | null;
  foundInRelease: string | null;
  bugGroup: string | null;
  url: string | null;

  // linkDevops meta (her zaman var)
  linkedAt: string | null;
  linkedByUserId: string | null;
  linkedByUserName: string | null;
  lastSyncedAt: string | null;

  // listDevopsLive: live response'da id yoksa snapshot + _stale: true
  _stale?: boolean;
}

export interface DevopsItemsResponse {
  items: DevopsItem[];
  stale: boolean;
  error?: { code: string; message: string };
}

export const devopsService = {
  /** Bağlı DevOps work item'larının canlı listesini çek. */
  async getItems(caseId: string): Promise<DevopsItemsResponse | undefined> {
    return apiFetch<DevopsItemsResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/devops-items`,
      undefined,
      'DevOps bağlı iş öğeleri yüklenemedi',
    );
  },

  /**
   * Yeni work item bağla. `workItemRef` ham id veya TFS URL olabilir;
   * backend parseWorkItemId ile çözer ve canlı doğrular.
   * Dönen: güncel Case (devops array customFields'te).
   */
  async link(caseId: string, workItemRef: string | number): Promise<Case | undefined> {
    return apiFetch<Case>(
      `/api/cases/${encodeURIComponent(caseId)}/devops-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workItemRef }),
      },
      'DevOps iş öğesi bağlanamadı',
    );
  },

  /** Bağlı work item'ı kaldır (idempotent — zaten yoksa sessiz 200). */
  async unlink(caseId: string, workItemId: number): Promise<Case | undefined> {
    return apiFetch<Case>(
      `/api/cases/${encodeURIComponent(caseId)}/devops-link/${workItemId}`,
      { method: 'DELETE' },
      'DevOps iş öğesi kaldırılamadı',
    );
  },
};
