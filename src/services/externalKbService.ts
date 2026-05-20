/**
 * WR-KB3 — External Knowledge Base / AI service frontend adapter.
 *
 * Bu modül BFF proxy üzerinden dış servise çağrı yapar. Hiçbir yanıt
 * yorumlanmaz; UI'a HAM data iletilir. Frontend `Case` mutation, Runa AI
 * tetiklemesi veya AIUsageLog yazımı YAPMAZ.
 *
 * Backend wrapper kontratı:
 *   {
 *     ok: true,
 *     endpoint: 'ask' | 'search' | 'categorize' | 'analyze' | 'health' | 'stats',
 *     rawSource: 'enroute-kb',
 *     data: <external response exactly as returned>,
 *     meta: { proxiedAt, latencyMs }
 *   }
 * veya
 *   {
 *     ok: false,
 *     endpoint,
 *     rawSource: 'enroute-kb',
 *     error: { code, message, status }
 *   }
 */

import { apiFetch } from './caseService';

export type ExternalKbEndpoint =
  | 'health'
  | 'stats'
  | 'ask'
  | 'search'
  | 'categorize'
  | 'analyze';

export type ExternalKbStrictness = 'lenient' | 'normal' | 'strict';

export interface ExternalKbWrappedSuccess<T = unknown> {
  ok: true;
  endpoint: ExternalKbEndpoint;
  rawSource: 'enroute-kb';
  data: T;
  meta: { proxiedAt: string; latencyMs: number };
}

export interface ExternalKbWrappedError {
  ok: false;
  endpoint: ExternalKbEndpoint | null;
  rawSource: 'enroute-kb';
  error: { code: string; message: string; status: number | null };
  meta?: { proxiedAt: string; latencyMs: number };
  data?: unknown;
}

export type ExternalKbWrappedResponse<T = unknown> =
  | ExternalKbWrappedSuccess<T>
  | ExternalKbWrappedError;

export interface ExternalKbSettingsStatus {
  companyId: string;
  configured: boolean;
  enabled?: boolean;
  providerName?: string | null;
  baseUrl?: string | null;
  authType?: 'none' | 'apiKey' | 'bearerToken';
  apiKeySecretName?: string | null;
  /** Server-side resolved: true if authType=none, or env var with that name is set. */
  secretConfigured?: boolean;
  defaultTopK?: number;
  defaultStrictness?: ExternalKbStrictness;
  defaultRerank?: boolean;
  defaultVerify?: boolean;
  showCitations?: boolean;
  allowAgentUse?: boolean;
  allowSupervisorUse?: boolean;
  allowCsmUse?: boolean;
}

export interface AskInput {
  companyId: string;
  query: string;
  topK?: number;
  strictness?: ExternalKbStrictness;
  rerank?: boolean;
  verify?: boolean;
  sourceTypes?: string[];
}

export interface SearchInput {
  companyId: string;
  query: string;
  topK?: number;
  sourceTypes?: string[];
}

export interface CategorizeInput {
  companyId: string;
  description: string;
}

export interface AnalyzeInput {
  companyId: string;
  freeText: string;
  /** Opsiyonel — vaka kimliği (EnRoute "bildirimNo"). */
  bildirimNo?: string;
  /** Opsiyonel — proje / müşteri etiketi. */
  project?: string;
  /** Legacy — eski caller'lar için context objesi. */
  context?: unknown;
}

const BASE = '/api/external-kb';

async function postJson<T>(path: string, body: unknown, errorMsg: string): Promise<ExternalKbWrappedResponse<T>> {
  const data = await apiFetch<ExternalKbWrappedResponse<T>>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, errorMsg);
  return (
    data ?? {
      ok: false,
      endpoint: null,
      rawSource: 'enroute-kb',
      error: { code: 'client_network_error', message: errorMsg, status: null },
    }
  );
}

async function getJson<T>(path: string, errorMsg: string): Promise<ExternalKbWrappedResponse<T>> {
  const data = await apiFetch<ExternalKbWrappedResponse<T>>(path, undefined, errorMsg);
  return (
    data ?? {
      ok: false,
      endpoint: null,
      rawSource: 'enroute-kb',
      error: { code: 'client_network_error', message: errorMsg, status: null },
    }
  );
}

export const externalKbService = {
  async settingsStatus(companyId: string): Promise<ExternalKbSettingsStatus | undefined> {
    return apiFetch<ExternalKbSettingsStatus>(
      `${BASE}/settings-status?companyId=${encodeURIComponent(companyId)}`,
      undefined,
      'Bilgi Bankası ayarları okunamadı',
    );
  },
  async health(companyId: string): Promise<ExternalKbWrappedResponse> {
    return getJson(
      `${BASE}/health?companyId=${encodeURIComponent(companyId)}`,
      'Bilgi Bankası health çağrısı başarısız',
    );
  },
  async stats(companyId: string): Promise<ExternalKbWrappedResponse> {
    return getJson(
      `${BASE}/stats?companyId=${encodeURIComponent(companyId)}`,
      'Bilgi Bankası stats çağrısı başarısız',
    );
  },
  async ask(input: AskInput): Promise<ExternalKbWrappedResponse> {
    return postJson(`${BASE}/ask`, input, 'Soru gönderilemedi');
  },
  async search(input: SearchInput): Promise<ExternalKbWrappedResponse> {
    return postJson(`${BASE}/search`, input, 'Arama gönderilemedi');
  },
  async categorize(input: CategorizeInput): Promise<ExternalKbWrappedResponse> {
    return postJson(`${BASE}/categorize`, input, 'Kategorize çağrısı başarısız');
  },
  async analyze(input: AnalyzeInput): Promise<ExternalKbWrappedResponse> {
    return postJson(`${BASE}/analyze`, input, 'Analiz çağrısı başarısız');
  },
};
