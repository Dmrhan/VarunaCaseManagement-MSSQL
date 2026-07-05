import { apiFetch } from './caseService';

/**
 * Analytics service — Faz 1.5 Madde 7 (AI Kullanım Panosu) ile başlangıç.
 * Multi-tenant scope tüm endpoint'lerde backend'de uygulanır (req.user.allowedCompanyIds).
 */

export interface AIUsageEndpointStat {
  endpoint: string;
  count: number;
  acceptRate: number | null; // %; null = henüz kabul/red kararı verilmemiş
  avgResponseMs: number | null;
}

export interface AIUsageReport {
  totalCalls: number;
  acceptanceRate: number | null;
  avgResponseMs: number | null;
  estimatedTimeSavedMin: number;
  byEndpoint: AIUsageEndpointStat[];
  dailyTrend: { date: string; count: number }[];
}

export type AIUsagePeriod = '7d' | '30d';

// QA scores — Faz 1.5 Madde 4 (Smart QA Lite)
export interface QAAgentRow {
  agentId: string | null;
  agentName: string;
  caseCount: number;
  avgEmpathy: number;
  avgClarity: number;
  avgSpeed: number;
  avgOverall: number;
}

export interface QAScoresReport {
  scoredCaseCount: number;
  byAgent: QAAgentRow[];
  companyAvg: {
    empathy: number | null;
    clarity: number | null;
    speed: number | null;
    overall: number | null;
  };
  topAgent: QAAgentRow | null;
  bottomAgent: QAAgentRow | null;
}

// Pattern alerts — Faz 1.5 Madde 5 (Bekçi rolü §5.5)
// PR-1 (Pattern Triage) — insight enrichment shape.
export interface PatternThreadValue {
  id: string;
  name: string;
  count: number;
  total: number;
  dominance: number;
}
export interface PatternThreadKeyword {
  word: string;
  count: number;
  total: number;
  dominance: number;
}
export interface PatternInsight {
  commonThread: {
    topAnaFirma: PatternThreadValue | null;
    topProduct: PatternThreadValue | null;
    topKeyword: PatternThreadKeyword | null;
  };
  spike: {
    value: number | null;
    isNew: boolean;
    baselinePerHour: number;
    currentPerHour: number;
  };
  impact: {
    distinctAccounts: number;
    slaAtRisk: number;
    openCount: number;
    totalTriggerCases: number;
    missingCases: number;
  };
  severity: 'critical' | 'warning' | 'info';
}

export interface PatternAlert {
  id: string;
  companyId: string;
  category: string;
  caseCount: number;
  windowMinutes: number;
  detectedAt: string;
  caseIds: string[];
  // PR-2 — known_issue ekleniyor (status enum string field; migration yok)
  status: 'active' | 'dismissed' | 'known_issue';
  dismissedBy: string | null;
  dismissedAt: string | null;
  // PR-1 — Triage enrichment (graceful: backend enrichment fail ederse null)
  insight?: PatternInsight | null;
}

// Operations Overview — POST /api/analytics/cases/overview (Phase 1 backend, Phase 2 UI)
// Tek kaynak: docs/OPERATIONS_DASHBOARD_DESIGN.md §2.1 + §2.6
export type OverviewGranularity = 'day' | 'hour';

export interface OverviewRequest {
  from: string;                // ISO UTC
  to: string;                  // ISO UTC
  companies?: string[];
  teams?: string[];
  productGroups?: string[];
  caseTypes?: string[];
  statuses?: string[];
  granularity?: OverviewGranularity;
  /**
   * Ops Pano v2 FAZ 1 — müşteri lensi. Verilirse tüm kart/kırılım/trend
   * yalnız bu müşterinin vakalarını sayar. Backend scope-guard'lıdır
   * (scope dışı account → 403 account_out_of_scope).
   */
  accountId?: string;
}

export type DrilldownBucket =
  | { kind: 'totalCases' | 'createdInPeriod' | 'resolvedInPeriod' | 'openCases' | 'slaRiskCount' | 'slaBreached' | 'slaViolationRatePct' | 'reopened' | 'reopenRatePct' | 'escalationRatePct' | 'transferRatePct' | 'retentionSuccessPct'; label?: string }
  | { kind: 'status' | 'priority' | 'caseType' | 'team' | 'company' | 'atRiskAccount'; key: string; label?: string }
  | { kind: 'category'; category: string; subCategory?: string | null; label?: string };

export interface DrilldownRequest extends OverviewRequest {
  bucket: DrilldownBucket;
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours';
  sortDir?: 'asc' | 'desc';
}

export interface OverviewDelta {
  value: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  sourceMissing: boolean;
}

export interface OverviewKpi {
  key: string;
  value: number | null;
  delta: OverviewDelta;
}

export interface OverviewKpis {
  totalCases: OverviewKpi;
  openCases: OverviewKpi;
  slaRiskCount: OverviewKpi;
  createdInPeriod: OverviewKpi;
  resolvedInPeriod: OverviewKpi;
  slaViolationRatePct: OverviewKpi;
  avgResolutionWallClockHours: OverviewKpi;
  reopenRatePct: OverviewKpi;
  escalationRatePct: OverviewKpi;
  transferRatePct: OverviewKpi;
  retentionSuccessPct: OverviewKpi;
}

export interface OverviewMinSampleViolation {
  metric: string;
  sampleSize: number;
  minimum: number;
  reason: string;
}

export interface OverviewTimeSeriesPoint {
  bucket: string;        // YYYY-MM-DD
  created: number;
  resolved: number;
  slaBreached: number;
}

export interface OverviewCountPair { key: string; count: number }
export interface OverviewCompanyRow { id: string; name: string; count: number }
export interface OverviewTeamRow {
  id: string;
  name: string;
  count: number;
  avgTtrHours: number | null;
}
export interface OverviewCategoryRow {
  category: string;
  subCategory: string | null;
  total: number;
  open: number;
  avgTtrHours: number | null;
  slaBreachCount: number;
}
export interface OverviewAtRiskAccount {
  accountId: string;
  accountName: string;
  companyId: string;
  openCount: number;
  slaBreachCount: number;
  escalatedCount: number;
}

export type OverviewScopeKind = 'self' | 'team' | 'company' | 'cross-company';

export interface OverviewScope {
  kind: OverviewScopeKind;
  companyIds: string[];
  teamIds: string[] | null;
  personIds: string[] | null;
  canExport: boolean;
  canCrossCompanyAgg: boolean;
  narrowedFromBody: boolean;
  narrative: string;
  effectiveScopeReason: string;
}

export interface OverviewTaxonomyRow {
  key: string;
  label: string;
  count: number;
}

export interface OperationsOverviewResponse {
  asOf: string;
  asOfLocal: string;
  formulaVersion: string;
  timezone: string;
  appliedFilters: {
    from: string;
    to: string;
    companies: string[];
    teams: string[] | null;
    productGroups: string[] | null;
    caseTypes: string[] | null;
    statuses: string[] | null;
    granularity: OverviewGranularity;
  };
  approximations: unknown[];
  minSampleViolations: OverviewMinSampleViolation[];
  notAvailable: string[];
  kpis: OverviewKpis;
  timeSeries: OverviewTimeSeriesPoint[];
  byStatus: OverviewCountPair[];
  byPriority: OverviewCountPair[];
  byCaseType: OverviewCountPair[];
  /** Ops Pano v2 FAZ 1 — Talep Türü kırılımı (aggregate hazırdı, UI'a bağlandı). */
  byRequestType: OverviewCountPair[];
  /** Ops Pano v2 FAZ 1 — Kanal (origin) kırılımı. */
  byOrigin: OverviewCountPair[];
  /** Ops Pano v2 FAZ 2 — AI görüş alanı (aggregate-only; PII yok). */
  bySmartTicketPlatform: OverviewTaxonomyRow[];
  bySmartTicketBusinessProcess: OverviewTaxonomyRow[];
  bySmartTicketOperationType: OverviewTaxonomyRow[];
  bySmartTicketAffectedObject: OverviewTaxonomyRow[];
  bySmartTicketImpact: OverviewTaxonomyRow[];
  bySolutionStepSource: OverviewCountPair[];
  /** external_kb adım oranı 0-1; hiç adım yoksa null. */
  kbAssistedResolutionRate: number | null;
  mailOps: {
    pendingCustomerReply: number;
    inboundVolume: number;
    outboundVolume: number;
    firstResponseMedianMin: number | null;
  };
  patternAlerts: {
    activeCount: number;
    largestSpike: { category: string; caseCount: number } | null;
  };
  qaAverages: {
    empathy: number | null;
    clarity: number | null;
    speed: number | null;
    sampleCount: number;
  };
  byCompany: OverviewCompanyRow[] | null;
  byTeam: OverviewTeamRow[];
  byCategory: OverviewCategoryRow[];
  topAtRiskAccounts: OverviewAtRiskAccount[];
  scope: OverviewScope;
  metricAuditId: string | null;
  durationMs: number;
}

export interface DrilldownCaseRow {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  companyName: string;
  accountName: string;
  category: string;
  subCategory: string | null;
  assignedTeamName: string | null;
  assignedPersonName: string | null;
  createdAt: string;
  slaResolutionDueAt: string | null;
  slaViolation: boolean;
  ageHours: number;
}

export interface DrilldownResponse {
  items: DrilldownCaseRow[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: 'createdAt' | 'priority' | 'slaResolutionDueAt' | 'ageHours';
  sortDir: 'asc' | 'desc';
  appliedBucket: DrilldownBucket & { label: string };
  scope: OverviewScope;
  metricAuditId: string | null;
  durationMs: number;
}

export const analyticsService = {
  async getAIUsage(period: AIUsagePeriod): Promise<AIUsageReport | undefined> {
    return apiFetch<AIUsageReport>(
      `/api/analytics/ai-usage?period=${period}`,
      undefined,
      'AI kullanım raporu yüklenemedi',
    );
  },

  async getQAScores(period: AIUsagePeriod): Promise<QAScoresReport | undefined> {
    return apiFetch<QAScoresReport>(
      `/api/analytics/qa-scores?period=${period}`,
      undefined,
      'QA skorları yüklenemedi',
    );
  },

  async listPatterns(status: 'active' | 'all' = 'active'): Promise<PatternAlert[]> {
    const data = await apiFetch<{ value: PatternAlert[] }>(
      `/api/analytics/patterns?status=${status}`,
      undefined,
      'Örüntü alarmları yüklenemedi',
    );
    return data?.value ?? [];
  },

  async dismissPattern(id: string): Promise<{ id: string; status: string } | undefined> {
    return apiFetch(
      `/api/analytics/patterns/${id}/dismiss`,
      { method: 'PATCH' },
      'Alarm kapatılamadı',
    );
  },

  // PR-2 — 3 aksiyon endpoint'i
  async linkPatternCases(
    id: string,
    body: { masterCaseId?: string } = {},
  ): Promise<{ ok: boolean; masterCaseId: string; linkedCount: number; skipped: Array<{ caseId: string; reason: string }> } | undefined> {
    return apiFetch(
      `/api/analytics/patterns/${id}/link-cases`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Vakalar ana vakaya bağlanamadı',
    );
  },

  async notifyPatternTeam(
    id: string,
    body: { teamId: string; message?: string },
  ): Promise<{ ok: boolean; dispatchId: string; teamName: string } | undefined> {
    return apiFetch(
      `/api/analytics/patterns/${id}/notify-team`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Takıma bildirim gönderilemedi',
    );
  },

  async setPatternStatus(
    id: string,
    status: 'active' | 'dismissed' | 'known_issue',
  ): Promise<{ id: string; status: string } | undefined> {
    return apiFetch(
      `/api/analytics/patterns/${id}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
      'Durum güncellenemedi',
    );
  },

  // PR-3 — AI hipotezi (lazy + cache 24h)
  async getPatternHypothesis(
    id: string,
    options: { force?: boolean } = {},
  ): Promise<{
    ok: boolean;
    cached: boolean;
    hypothesis: string | null;
    suggestedAction: string | null;
    error?: string;
    generatedAt?: string;
  } | undefined> {
    return apiFetch(
      `/api/analytics/patterns/${id}/hypothesis`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
      'AI hipotezi alınamadı',
    );
  },

  async getOperationsOverview(
    body: OverviewRequest,
  ): Promise<OperationsOverviewResponse | undefined> {
    return apiFetch<OperationsOverviewResponse>(
      '/api/analytics/cases/overview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Operasyon panosu yüklenemedi',
    );
  },

  async getOperationsDrilldown(
    body: DrilldownRequest,
  ): Promise<DrilldownResponse | undefined> {
    return apiFetch<DrilldownResponse>(
      '/api/analytics/cases/drilldown',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Drill-down listesi yüklenemedi',
    );
  },
};
