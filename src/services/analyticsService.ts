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
};
