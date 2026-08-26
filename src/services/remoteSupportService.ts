/**
 * Uzak Destek (TeamViewer) frontend adapter — yalnız Varuna BFF çağırır.
 *
 *   POST /api/cases/:id/remote-session      → "Bağlantı Al" işareti aç
 *   GET  /api/cases/:id/remote-sessions     → vakanın oturumları
 *
 * TeamViewer'a doğrudan çağrı yapmaz. Süre butonda ölçülmez; gece reconcile
 * TeamViewer bağlantı raporundan gerçek süreyi yazar (matchState/durationSec).
 */
import { apiFetch } from './caseService';

export interface RemoteSession {
  id: string;
  caseId: string;
  agentName: string;
  customerTvId: string;
  tool: string;
  startedAt: string;
  durationSec: number | null;
  matchState: 'pending' | 'matched' | 'ambiguous' | 'unmatched';
  tvStartDate: string | null;
  tvEndDate: string | null;
  note: string | null;
}

export interface RemoteSessionsResponse {
  items: RemoteSession[];
}

export interface StartRemoteResponse {
  session: RemoteSession;
  launch: { deepLink: string };
}

export const remoteSupportService = {
  async list(caseId: string): Promise<RemoteSessionsResponse | undefined> {
    return apiFetch<RemoteSessionsResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/remote-sessions`,
      { method: 'GET' },
      'Bağlantılı destek oturumları alınamadı',
    );
  },

  async start(
    caseId: string,
    customerTvId: string,
    launchedVia: 'deeplink' | 'manual' = 'deeplink',
  ): Promise<StartRemoteResponse | undefined> {
    return apiFetch<StartRemoteResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/remote-session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerTvId, launchedVia }),
      },
      'Bağlantılı destek başlatılamadı',
    );
  },
};
