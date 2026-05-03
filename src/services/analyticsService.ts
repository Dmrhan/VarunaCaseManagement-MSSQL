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

export const analyticsService = {
  async getAIUsage(period: AIUsagePeriod): Promise<AIUsageReport | undefined> {
    return apiFetch<AIUsageReport>(
      `/api/analytics/ai-usage?period=${period}`,
      undefined,
      'AI kullanım raporu yüklenemedi',
    );
  },
};
