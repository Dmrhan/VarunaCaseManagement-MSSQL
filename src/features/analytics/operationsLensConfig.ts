import type { UserRole } from '@/services/AuthContext';

/**
 * Operations Dashboard — Persona Lens config (Phase 6a §2.10).
 *
 * Lens YALNIZCA sunum katmaninda calisir: section sirasi, KPI sirasi, gizli
 * sectionlar, AI tone'u, Report Studio defaultlari. Backend scope/yetki
 * davranisini DEGISTIRMEZ. byCompany hala scope.canCrossCompanyAgg
 * sayesinde gizlenir; lens onu tekrar acmaz.
 */

export type LensKey = 'operations' | 'customer' | 'executive' | 'personal';

export type DashboardSectionKey =
  | 'kpiGrid'
  | 'timeSeries'
  | 'statusPriorityGroup'   // composite: byStatus + byPriority (2-col)
  | 'byCaseType'
  | 'requestOriginGroup'      // Ops Pano v2 FAZ 1 — composite: byRequestType + byOrigin (2-col)
  | 'aiDataGroup'             // Ops Pano v2 FAZ 2 — AI görüş mini kartları (5'li)
  | 'byCompany'
  | 'byTeam'
  | 'byCategory'
  | 'atRiskAccounts';

export type KpiKey =
  | 'totalCases'
  | 'openCases'
  | 'createdInPeriod'
  | 'resolvedInPeriod'
  | 'slaRiskCount'
  | 'slaViolationRatePct'
  | 'avgResolutionWallClockHours'
  | 'reopenRatePct'
  | 'escalationRatePct'
  | 'transferRatePct'
  | 'retentionSuccessPct';

export interface ReportSectionDefaults {
  kpis: boolean;
  timeSeries: boolean;
  breakdowns: boolean;
  riskAccounts: boolean;
  aiNarrative: boolean;
  appendix: boolean;
}

export interface LensConfig {
  key: LensKey;
  label: string;
  description: string;
  kpiOrder: KpiKey[];
  sectionOrder: DashboardSectionKey[];
  hiddenSections: DashboardSectionKey[];
  /** AI prompt'a eklenen tek satirlik tone instruction. */
  aiTone: string;
  reportTitle: string;
  reportDefaults: ReportSectionDefaults;
}

const FULL_KPI_ORDER: KpiKey[] = [
  'totalCases',
  'openCases',
  'createdInPeriod',
  'resolvedInPeriod',
  'slaRiskCount',
  'slaViolationRatePct',
  'avgResolutionWallClockHours',
  'reopenRatePct',
  'escalationRatePct',
  'transferRatePct',
  'retentionSuccessPct',
];

export const OPERATIONS_LENS: LensConfig = {
  key: 'operations',
  label: 'Operasyon',
  description: 'Günlük operasyon: SLA, açık vaka, takım yükü.',
  kpiOrder: FULL_KPI_ORDER,
  sectionOrder: [
    'kpiGrid',
    'timeSeries',
    'statusPriorityGroup',
    'byCaseType',
    'requestOriginGroup',
    'aiDataGroup',
    'byCompany',
    'byTeam',
    'byCategory',
    'atRiskAccounts',
  ],
  hiddenSections: [],
  aiTone: 'Tonlama: Taktik, kuyrukla ilgili, SLA odakli. Acik vakalar ve aktif riskler oncelikli.',
  reportTitle: 'Operasyon Raporu',
  reportDefaults: {
    kpis: true,
    timeSeries: true,
    breakdowns: true,
    riskAccounts: true,
    aiNarrative: true,
    appendix: true,
  },
};

export const CUSTOMER_LENS: LensConfig = {
  key: 'customer',
  label: 'Müşteri',
  description: 'Müşteri riskleri, tekrar eden sorunlar, hesap bazlı yoğunluk.',
  kpiOrder: [
    'retentionSuccessPct',
    'escalationRatePct',
    'reopenRatePct',
    'slaViolationRatePct',
    'slaRiskCount',
    'openCases',
    'totalCases',
    'createdInPeriod',
    'resolvedInPeriod',
    'avgResolutionWallClockHours',
    'transferRatePct',
  ],
  sectionOrder: [
    'atRiskAccounts',
    'byCategory',
    'byCompany',
    'timeSeries',
    'statusPriorityGroup',
    'kpiGrid',
  ],
  hiddenSections: ['byCaseType', 'byTeam', 'requestOriginGroup', 'aiDataGroup'],
  aiTone:
    'Tonlama: Musteri risk kumelerine, tekrar eden kategori sorunlarina ve hesap bazli aksiyonlara odaklan. ' +
    'Bireysel agent performansi yargilama; iletisim ve hesap koruma aksiyonlari oner.',
  reportTitle: 'Müşteri Risk Raporu',
  reportDefaults: {
    kpis: false,
    timeSeries: true,
    breakdowns: true,    // byCategory + byCompany aktif
    riskAccounts: true,
    aiNarrative: true,
    appendix: true,
  },
};

export const EXECUTIVE_LENS: LensConfig = {
  key: 'executive',
  label: 'Yönetici',
  description: 'Üst düzey özet: KPI trend, riskler, aksiyonlar.',
  kpiOrder: [
    'totalCases',
    'openCases',
    'slaViolationRatePct',
    'avgResolutionWallClockHours',
    'escalationRatePct',
    'retentionSuccessPct',
    'reopenRatePct',
    'slaRiskCount',
    'createdInPeriod',
    'resolvedInPeriod',
    'transferRatePct',
  ],
  sectionOrder: [
    'kpiGrid',
    'timeSeries',
    'byCompany',
    'atRiskAccounts',
  ],
  hiddenSections: ['statusPriorityGroup', 'byCaseType', 'byTeam', 'byCategory', 'requestOriginGroup', 'aiDataGroup'],
  aiTone:
    'Tonlama: Karar-destekli, ozet, sayisal. Yonetici icin 3-5 kritik hareket noktasi belirle; ' +
    'gunluk operasyonel detay (statu adetleri, takim bazli yuk) verme.',
  reportTitle: 'Yönetici Özet Raporu',
  reportDefaults: {
    kpis: true,
    timeSeries: true,
    breakdowns: false,
    riskAccounts: true,
    aiNarrative: true,
    appendix: true,
  },
};

export const PERSONAL_LENS: LensConfig = {
  key: 'personal',
  label: 'Kişisel',
  description: 'Kendi iş yükün — açık vakalarınız, SLA riskiniz, çözüm hızınız.',
  kpiOrder: [
    'openCases',
    'slaRiskCount',
    'createdInPeriod',
    'resolvedInPeriod',
    'avgResolutionWallClockHours',
    'slaViolationRatePct',
    'reopenRatePct',
    'escalationRatePct',
    'transferRatePct',
    'totalCases',
    'retentionSuccessPct',
  ],
  sectionOrder: [
    'kpiGrid',
    'timeSeries',
    'statusPriorityGroup',
  ],
  hiddenSections: ['byCaseType', 'byCompany', 'byTeam', 'byCategory', 'atRiskAccounts'],
  aiTone:
    'Tonlama: Sadece kullanicinin yapabilecegi sirada yapilacaklar uzerinden konus. ' +
    'Takim/organizasyon dusey aksiyonu (rebalance, kapasite planlama, kadro) ASLA onerme. ' +
    'Onerilen aksiyonlar: kullanicinin atandigi vakalarda gelecek 2-3 somut adim.',
  reportTitle: 'Kişisel İş Yükü Raporu',
  reportDefaults: {
    kpis: true,
    timeSeries: true,
    breakdowns: true,
    riskAccounts: false,
    aiNarrative: true,
    appendix: true,
  },
};

export const LENS_BY_KEY: Record<LensKey, LensConfig> = {
  operations: OPERATIONS_LENS,
  customer: CUSTOMER_LENS,
  executive: EXECUTIVE_LENS,
  personal: PERSONAL_LENS,
};

/**
 * Role bazli default lens.
 *
 * Karar (Phase 6a):
 *  - Agent/Backoffice/CSM       -> Personal (server-side scope=self zaten kisisel veri verir)
 *  - Supervisor / Admin         -> Operations (taktik default)
 *  - SystemAdmin                -> Executive (cross-company stratejik bakis daha anlamli)
 */
export function defaultLensForRole(role: UserRole | undefined): LensKey {
  if (!role) return 'operations';
  if (role === 'Agent' || role === 'Backoffice') return 'personal';
  if (role === 'CSM') return 'personal';
  if (role === 'SystemAdmin') return 'executive';
  return 'operations';
}

/**
 * Bir lens kullaniciya gosterilebilir mi?
 *
 * Karar:
 *  - personal      -> tum roller (her kullanici kendi scope'unu kisisel olarak gorebilir)
 *  - operations    -> tum roller (taktik gorus zararsiz; server scope yine de daraltir)
 *  - customer      -> CSM / Supervisor / Admin / SystemAdmin (musteri-odakli rol)
 *  - executive     -> Supervisor / Admin / SystemAdmin (karar mercii icin; conservative gate)
 */
export function isLensAvailable(lens: LensKey, role: UserRole | undefined): boolean {
  if (!role) return lens === 'operations';
  if (lens === 'personal') return true;
  if (lens === 'operations') return true;
  if (lens === 'customer') {
    return role === 'CSM' || role === 'Supervisor' || role === 'Admin' || role === 'SystemAdmin';
  }
  if (lens === 'executive') {
    return role === 'Supervisor' || role === 'Admin' || role === 'SystemAdmin';
  }
  return false;
}

/** Role icin gosterilebilir tum lensleri default sirayla don. */
export function availableLensesForRole(role: UserRole | undefined): LensConfig[] {
  const order: LensKey[] = ['operations', 'customer', 'executive', 'personal'];
  return order.filter((k) => isLensAvailable(k, role)).map((k) => LENS_BY_KEY[k]);
}
