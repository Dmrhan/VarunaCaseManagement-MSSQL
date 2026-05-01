import type {
  Case,
  CaseCallLog,
  CaseHistoryEntry,
  CaseNote,
  CasePriority,
  CaseRequestType,
  CaseType,
  FinancialStatus,
  ProductUsage,
  UsageChangeAlert,
} from '@/features/cases/types';

/**
 * RUNA AI servisi — gerçek Anthropic API çağrılarını BFF üzerinden yapar.
 * Hata/timeout durumunda null döner; UI sessizce devam edip toast gösterir.
 */

export const USE_MOCK_AI = false;

const API_BASE = '/api/ai';
const TIMEOUT_MS = 30_000;

export type AiErrorKind = 'network' | 'rate_limited' | 'timeout' | 'unconfigured' | 'server';

export interface AiError {
  kind: AiErrorKind;
  message: string;
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: AiError }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  console.log(`[ai] → POST ${API_BASE}${path}`);
  try {
    const { getAccessToken } = await import('./supabase');
    const token = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (r.status === 429) {
      console.warn(`[ai] ← ${r.status} rate_limited`);
      return { ok: false, error: { kind: 'rate_limited', message: 'Çok fazla istek, lütfen bekleyin.' } };
    }
    if (r.status === 503) {
      console.warn(`[ai] ← ${r.status} unconfigured (API key yok)`);
      return { ok: false, error: { kind: 'unconfigured', message: 'AI servisi yapılandırılmamış.' } };
    }
    if (!r.ok) {
      let detail: unknown;
      try {
        detail = await r.json();
      } catch {
        detail = await r.text().catch(() => '(no body)');
      }
      console.error(`[ai] ← ${r.status} server error`, detail);
      return { ok: false, error: { kind: 'server', message: 'AI önerisi alınamadı.' } };
    }
    const data = (await r.json()) as T;
    console.log(`[ai] ← ${r.status} OK`, data);
    return { ok: true, data };
  } catch (e) {
    const isAbort = (e as { name?: string })?.name === 'AbortError';
    console.error(`[ai] ← ${isAbort ? 'TIMEOUT' : 'NETWORK ERROR'}`, e);
    return {
      ok: false,
      error: {
        kind: isAbort ? 'timeout' : 'network',
        message: isAbort ? 'AI isteği zaman aşımına uğradı.' : 'AI servisine ulaşılamadı.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- 1) Kategori önerisi ----

export interface CategorySuggestionInput {
  description: string;
  caseType: CaseType;
  companyName?: string;
  /** Strict json_schema mode için zorunlu — kategori + alt kategori enum'ları */
  availableCategories: { category: string; subCategories: string[] }[];
  /** Strict json_schema mode için zorunlu — talep türü enum'u */
  availableRequestTypes: CaseRequestType[];
}

export interface CategorySuggestion {
  category: string;
  /** Strict mode artık null dönmez — her zaman geçerli bir alt kategori */
  subCategory: string;
  requestType: CaseRequestType;
  priority: CasePriority;
  confidence: number;
  reasoning: string;
}

// ---- 2) Çözüm taslağı ----

export interface ResolutionDraftInput {
  caseSubject: string;
  description: string;
  caseType?: CaseType;
  category?: string;
  history?: CaseHistoryEntry[];
  notes?: CaseNote[];
}

// ---- 3) Supervisor özeti ----

export interface SupervisorSummaryInput {
  case: Pick<
    Case,
    | 'title'
    | 'description'
    | 'category'
    | 'subCategory'
    | 'status'
    | 'priority'
    | 'slaViolation'
    | 'slaResponseDueAt'
    | 'slaResolutionDueAt'
    | 'slaPausedAt'
    | 'createdAt'
  >;
  history?: CaseHistoryEntry[];
  notes?: CaseNote[];
  callLogs?: CaseCallLog[];
}

export interface SupervisorSummary {
  summary: string;
  riskLevel: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';
  keyPoints: string[];
  recommendation: string;
}

// ---- 4) Churn dönüşüm önerisi ----

export interface ChurnConversionInput {
  case: Pick<Case, 'title' | 'companyName' | 'accountName'>;
  callLogs?: CaseCallLog[];
  financialStatus?: FinancialStatus;
  productUsage?: ProductUsage;
  usageChangeAlert?: UsageChangeAlert;
}

export interface ChurnConversion {
  churnRisk: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';
  shouldConvert: boolean;
  reasoning: string;
  suggestedAction: string;
}

// ---- 6) Dashboard chat ----

export interface DashboardCaseSnapshot {
  caseNumber: string;
  title: string;
  priority: string;
  status: string;
  caseType: string;
  category: string;
  subCategory: string;
  slaViolation: boolean;
  slaResponseDueAt?: string;
  slaResolutionDueAt?: string;
  slaPausedAt?: string;
  accountName: string;
  companyName: string;
  ageHours: number;
  assignedPersonName?: string;
  assignedTeamName?: string;
}

export interface DashboardContext {
  totalCases: number;
  openCases: number;
  slaViolationRate: number;
  avgTtrHours: number;
  criticalOpen: number;
  churnAtRisk: number;
  retentionRate: number;
  topCategory: string;
  teamLoads: { teamName: string; caseCount: number }[];
  /** En ilginç / kritik açık vakaların kompakt snapshot'ı (max 30) — AI detaylı sorulara yanıt verebilsin diye. */
  interestingCases?: DashboardCaseSnapshot[];
}

export interface DashboardChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface DashboardChatInput {
  message: string;
  history: DashboardChatHistoryItem[];
  context: DashboardContext;
}

// ---- 5) Çağrı özeti ----

export interface CallSummaryInput {
  callLog: { note?: string; outcome?: string; disposition?: string; transcript?: string; content?: string };
  caseSubject?: string;
  customerName?: string;
}

export const aiService = {
  async suggestCategory(input: CategorySuggestionInput) {
    return postJson<CategorySuggestion>('/suggest-category', input);
  },

  async draftResolution(input: ResolutionDraftInput) {
    return postJson<{ draft: string }>('/draft-resolution', input);
  },

  async supervisorSummary(input: SupervisorSummaryInput) {
    return postJson<SupervisorSummary>('/supervisor-summary', input);
  },

  async churnConversion(input: ChurnConversionInput) {
    return postJson<ChurnConversion>('/churn-conversion', input);
  },

  async callSummary(input: CallSummaryInput) {
    return postJson<{ summary: string }>('/call-summary', input);
  },

  async dashboardChat(input: DashboardChatInput) {
    return postJson<{ reply: string }>('/dashboard-chat', input);
  },
};

/**
 * Toast kullanımı için yardımcı: hata tipine göre kullanıcı dostu mesaj.
 */
export function aiErrorMessage(err: AiError): string {
  switch (err.kind) {
    case 'rate_limited':
      return 'Çok fazla istek, lütfen bekleyin.';
    case 'timeout':
      return 'AI önerisi zaman aşımına uğradı.';
    case 'unconfigured':
      return 'AI servisi yapılandırılmamış (API key gerekli).';
    case 'network':
    case 'server':
    default:
      return 'AI önerisi alınamadı.';
  }
}
