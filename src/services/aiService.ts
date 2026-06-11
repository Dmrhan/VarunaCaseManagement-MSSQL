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
    const { getAccessToken } = await import('./authClient');
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

// ---- 1b) Başlık önerisi ----

export interface TitleSuggestionInput {
  description: string;
  caseType?: CaseType;
  companyId?: string;
}

export interface TitleSuggestion {
  title: string;
  confidence: number;
  usageLogId: string | null;
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

// ---- 7) Vaka aktarımı önerisi (FAZ 2 §20.2) ----

export type TransferReasonCode =
  | 'wrong_team'
  | 'expertise'
  | 'workload'
  | 'escalation'
  | 'customer_request'
  | 'other';

export interface TransferSuggestion {
  suggestedTeamId: string;
  suggestedTeamName: string;
  reasonCode: TransferReasonCode;
  reasonText: string;
  confidence: number;
  usageLogId: string | null;
}

export const aiService = {
  async suggestCategory(input: CategorySuggestionInput) {
    return postJson<CategorySuggestion>('/suggest-category', input);
  },

  async suggestTitle(input: TitleSuggestionInput) {
    return postJson<TitleSuggestion>('/suggest-title', input);
  },

  /**
   * Linked Cases suggestion (FAZ 2 Collab). BFF candidate'ları kendi seçer
   * (companyId scope, son 30 gün, aynı kategori/müşteri); UI yalnız caseId
   * gönderir. Max 3 öneri.
   */
  async suggestLinks(caseId: string) {
    return postJson<{ suggestions: import('@/features/cases/types').LinkSuggestion[] }>(
      '/suggest-links',
      { caseId },
    );
  },

  /**
   * Customer Pulse AI özet upgrade — deterministic pulse'dan üretilen
   * numerik/kategorik veriyi alır, AI ile daha doğal özet + öneri üretir.
   * RAW note/call içeriği GÖNDERMEZ (KVKK uyumlu). Başarısız olursa
   * frontend deterministic summary'i korur.
   */
  async customerPulseSummary(input: {
    caseId: string;
    accountName: string;
    state: string;
    metrics: Record<string, number>;
    repeatedIssues: { category: string; subCategory?: string; count: number }[];
    evidence: string[];
  }) {
    return postJson<{ summary: string; recommendedAction: string; evidence: string[] }>(
      '/customer-pulse-summary',
      input,
    );
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

  /**
   * Vaka aktarımı önerisi — RUNA AI mevcut takım dışında en uygun takımı seçer
   * + reasonCode + reasonText + confidence döner. usageLogId,
   * `markUsageAccepted` ile Uygula/Yoksay telemetrisini doldurur
   * (PATCH /usage/:id/accept → AIUsagePage.acceptanceRate).
   */
  async transferSuggest(caseId: string) {
    return postJson<TransferSuggestion>('/transfer-suggest', { caseId });
  },

  /**
   * AI önerisinin uygulandı/yoksayıldı durumunu kaydeder
   * (PATCH /api/ai/usage/:id/accept). AIUsagePage.acceptanceRate buradan
   * beslenir. Fire-and-forget: ana akışı asla bloklamaz, hata yutulur
   * (sadece console.warn). Eldeki `usageLogId` null/undefined ise no-op.
   */
  async markUsageAccepted(
    usageLogId: string | null | undefined,
    accepted: boolean,
  ): Promise<boolean> {
    if (!usageLogId) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const { getAccessToken } = await import('./authClient');
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(
        `${API_BASE}/usage/${encodeURIComponent(usageLogId)}/accept`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ accepted }),
          signal: ctrl.signal,
        },
      );
      if (!r.ok) {
        console.warn(`[ai] usage accept ← ${r.status}`);
        return false;
      }
      return true;
    } catch (e) {
      const isAbort = (e as { name?: string })?.name === 'AbortError';
      console.warn(`[ai] usage accept ${isAbort ? 'TIMEOUT' : 'ERROR'}`, e);
      return false;
    } finally {
      clearTimeout(timer);
    }
  },

  async operationsBrief(input: OperationsBaseRequest) {
    return postJson<OperationsBriefResponse>('/operations-brief', input);
  },

  async operationsInsights(input: OperationsBaseRequest) {
    return postJson<OperationsInsightsResponse>('/operations-insights', input);
  },

  async operationsExplainMetric(input: OperationsExplainRequest) {
    return postJson<OperationsExplainResponse>('/operations-explain-metric', input);
  },

  async operationsReportDraft(input: OperationsBaseRequest) {
    return postJson<OperationsReportResponse>('/operations-report-draft', input);
  },

  async operationsDrilldownAssist(input: DrilldownAssistRequest) {
    return postJson<DrilldownAssistResponse>('/operations-drilldown-assist', input);
  },
};

// ---- 8) Operations Intelligence — AI Analyst (Phase 4a) ----

export type LensKey = 'operations' | 'customer' | 'executive' | 'personal';

export interface OperationsBaseRequest {
  from: string;
  to: string;
  productGroups?: string[];
  caseTypes?: string[];
  statuses?: string[];
  companies?: string[];
  granularity?: 'day' | 'hour';
  /** Phase 6a: AI prompt tonu (operations|customer|executive|personal). Veri/yetkilendirme degistirmez. */
  lens?: LensKey;
}

export interface OperationsAiScope {
  kind: 'self' | 'team' | 'company' | 'cross-company';
  companyIds: string[];
  teamIds: string[] | null;
  personIds: string[] | null;
  canExport: boolean;
  canCrossCompanyAgg: boolean;
  narrowedFromBody: boolean;
  narrative: string;
  effectiveScopeReason: string;
}

export interface OperationsBrief {
  title: string;
  summary: string;
  bullets: string[];
  risks: string[];
  recommendedActions: string[];
}

export interface OperationsBriefResponse {
  brief: OperationsBrief;
  scope: OperationsAiScope;
  formulaVersion: string;
  generatedAt: string;
  usageLogId: string | null;
  sourceMetricAuditId: string | null;
}

export type OperationsInsightType =
  | 'sla-anomaly'
  | 'backlog-buildup'
  | 'repeated-issue'
  | 'customer-risk-cluster'
  | 'workload-imbalance';
export type OperationsInsightSeverity = 'info' | 'warning' | 'critical';

export interface OperationsInsightBucket {
  kind: string;
  key?: string;
  category?: string;
  subCategory?: string;
  label?: string;
}

export interface OperationsInsightEvidence {
  label: string;
  value: string;
  bucket: OperationsInsightBucket | null;
}

export interface OperationsInsight {
  id: string;
  type: OperationsInsightType;
  severity: OperationsInsightSeverity;
  title: string;
  narrative: string;
  evidence: OperationsInsightEvidence[];
  suggestedAction: string;
  drilldown: OperationsInsightBucket | null;
}

export interface OperationsInsightsResponse {
  insights: OperationsInsight[];
  scope: OperationsAiScope;
  generatedAt: string;
  usageLogId: string | null;
}

export interface OperationsExplainRequest extends OperationsBaseRequest {
  metricKey: string;
}

export interface OperationsExplainSuggestedDrilldown {
  label: string;
  bucket: OperationsInsightBucket;
}

export interface OperationsExplainResponse {
  metricKey: string;
  explanation: string;
  formula: string;
  whatChanged: string;
  watchouts: string[];
  suggestedDrilldowns: OperationsExplainSuggestedDrilldown[];
  scope: OperationsAiScope;
  generatedAt: string;
  usageLogId: string | null;
}

export interface OperationsReportResponse {
  markdown: string;
  sections: {
    summary: string;
    risks: string;
    actions: string;
  };
  scope: OperationsAiScope;
  generatedAt: string;
  usageLogId: string | null;
}

// ---- 9) Operations Drill-down AI Assistant (Phase 4b) ----

export type DrilldownAssistMode = 'summarize' | 'prioritize' | 'rootCause' | 'nextAction' | 'custom';

export interface DrilldownAssistRequest extends OperationsBaseRequest {
  bucket: OperationsInsightBucket;
  mode: DrilldownAssistMode;
  customPrompt?: string;
}

export interface DrilldownAssistEvidence {
  label: string;
  value: string;
  caseNumbers: string[];
  drilldown: OperationsInsightBucket | null;
}

export interface DrilldownAssistAnswer {
  title: string;
  summary: string;
  bullets: string[];
  risks: string[];
  recommendedActions: string[];
  evidence: DrilldownAssistEvidence[];
}

export interface DrilldownAssistResponse {
  answer: DrilldownAssistAnswer;
  scope: OperationsAiScope;
  bucket: OperationsInsightBucket;
  mode: DrilldownAssistMode;
  rowCount: number;
  total: number;
  generatedAt: string;
  usageLogId: string | null;
}

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
