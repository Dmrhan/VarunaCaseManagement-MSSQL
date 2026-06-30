/**
 * Aylık Müşteri Bülteni (Faz A) — frontend service.
 *
 * Tek endpoint: POST /api/analytics/monthly-bulletin
 *
 * Cross-tenant koruma backend'de (account.companyId ∩ scope.companyIds);
 * frontend privacy concern'u: response'da customerContact* YOK (mevcut
 * aggregator zaten sadece aggregate döndürür).
 */

import { apiFetch } from './caseService';

export interface BulletinBucketRow {
  key: string;
  label?: string;
  count: number;
}

export interface BulletinByAccountCompanyRow {
  companyId: string;
  count: number;
  resolvedCount: number;
  avgResolutionMinutes: number | null;
  slaResolutionCompliantCount: number;
  slaResponseCompliantCount: number;
  responseMetCount: number;
}

export interface BulletinTotals {
  count: number;
  resolvedCount: number;
  avgResolutionMinutes: number | null;
  slaResolutionCompliantCount: number;
  slaResponseCompliantCount: number;
  responseMetCount: number;
  slaResolutionCompliancePct: number | null;
  slaResponseCompliancePct: number | null;
}

export interface BulletinPayload {
  account: {
    id: string;
    name?: string;
    byStatus4: BulletinBucketRow[];      // 4-kova kullanıcı dostu (label dahil)
    byStatusRaw: BulletinBucketRow[];    // 7-kova ham
    byPriority: BulletinBucketRow[];
    byCaseType: BulletinBucketRow[];
    byRequestType: BulletinBucketRow[];  // A1
    byOrigin: BulletinBucketRow[];        // A1
    byCategory: BulletinBucketRow[];
    snoozedActiveCount: number;
    timeSeries?: Array<{ date: string; created: number; resolved: number }>;
  };
  perAccountCompany: BulletinByAccountCompanyRow[];
  totals: BulletinTotals;
  meta: {
    from: string;
    to: string;
    scope: { companyIds: string[]; canCrossCompanyAgg: boolean };
    formulaVersion?: string | null;
  };
  scope?: {
    kind: string;
    companyIds: string[];
    canExport: boolean;
    narrative: string;
  };
}

export const bulletinService = {
  /**
   * Aylık bülten verisini çek.
   *
   * @param accountId — bültenin müşterisi
   * @param from — ISO date (ay başı)
   * @param to — ISO date (ay sonu, exclusive)
   */
  async getMonthlyBulletin(
    accountId: string,
    from: string,
    to: string,
  ): Promise<BulletinPayload | undefined> {
    return apiFetch<BulletinPayload>(
      '/api/analytics/monthly-bulletin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, from, to }),
      },
      'Bülten verisi yüklenemedi',
    );
  },
};
