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
