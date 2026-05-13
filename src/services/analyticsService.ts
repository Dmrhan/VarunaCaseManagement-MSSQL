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
export interface PatternAlert {
  id: string;
  companyId: string;
  category: string;
  caseCount: number;
  windowMinutes: number;
  detectedAt: string;
  caseIds: string[];
  status: 'active' | 'dismissed';
  dismissedBy: string | null;
  dismissedAt: string | null;
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
  byCompany: OverviewCompanyRow[] | null;
  byTeam: OverviewTeamRow[];
  byCategory: OverviewCategoryRow[];
  topAtRiskAccounts: OverviewAtRiskAccount[];
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
};
