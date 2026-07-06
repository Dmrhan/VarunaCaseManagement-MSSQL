import { fromDb } from '../db/enumMap.js';
import { OPEN_STATUSES } from './metricFormulas.js';

/**
 * Drill-down query helpers — Phase 3 (cases/drilldown) + Phase 4b
 * (AI drilldown-assist) icin tek kaynak.
 *
 * Ayni bucket allowlist + Prisma where + map fonksiyonu iki route'da paylasilir
 * ki ileride bir bucket eklenip biri unutulmasin.
 */

export const DRILLDOWN_BUCKET_KINDS = Object.freeze(new Set([
  'totalCases',
  'createdInPeriod',
  'resolvedInPeriod',
  'openCases',
  'slaRiskCount',
  'slaBreached',
  'slaViolationRatePct',
  'reopened',
  'reopenRatePct',
  'escalationRatePct',
  'transferRatePct',
  'retentionSuccessPct',
  'status',
  'priority',
  'caseType',
  'team',
  'company',
  'category',
  'atRiskAccount',
]));

export const DRILLDOWN_KEY_REQUIRED = Object.freeze(new Set([
  'status', 'priority', 'caseType', 'team', 'company', 'atRiskAccount',
]));

/**
 * Bucket girdisini dogrula + temiz versiyonu don.
 * @returns { error?: string, value?: object }
 */
export function validateDrilldownBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return { error: '`bucket` zorunlu.' };
  if (typeof bucket.kind !== 'string' || !DRILLDOWN_BUCKET_KINDS.has(bucket.kind)) {
    return { error: '`bucket.kind` gecersiz.' };
  }
  if (DRILLDOWN_KEY_REQUIRED.has(bucket.kind) && (typeof bucket.key !== 'string' || bucket.key.length === 0)) {
    return { error: `\`bucket.key\` zorunlu (${bucket.kind}).` };
  }
  if (bucket.kind === 'category' && typeof bucket.category !== 'string' && typeof bucket.key !== 'string') {
    return { error: '`bucket.category` zorunlu.' };
  }
  return {
    value: {
      kind: bucket.kind,
      key: typeof bucket.key === 'string' ? bucket.key : undefined,
      category: typeof bucket.category === 'string' ? bucket.category : undefined,
      subCategory: typeof bucket.subCategory === 'string' ? bucket.subCategory : undefined,
      label: typeof bucket.label === 'string' ? bucket.label : undefined,
    },
  };
}

/**
 * Scope + filters + bucket'i Prisma `where` agacina cevir.
 * Out-of-scope bir bucket.key icin sonuc bos donsun diye scope clause'lari
 * AND-zincirinin basinda; bucket-ozel filtre cakisirsa bos sonuc cikar.
 */
export function buildDrilldownWhere({ scope, filters, from, to, bucket }) {
  // 2026-07-06 — arşivli vakalar drilldown listesine girmez (aggregator
  // buildWhereSql paritesi; kart sayısı ile drilldown listesi tutarlı kalır).
  const and = [{ companyId: { in: scope.companyIds } }, { isArchived: false }];
  if (scope.teamIds && scope.teamIds.length > 0) and.push({ assignedTeamId: { in: scope.teamIds } });
  if (scope.personIds && scope.personIds.length > 0) and.push({ assignedPersonId: { in: scope.personIds } });
  if (filters.productGroups && filters.productGroups.length > 0) {
    and.push({ productGroup: { in: filters.productGroups } });
  }
  if (filters.caseTypes && filters.caseTypes.length > 0) {
    and.push({ caseType: { in: filters.caseTypes } });
  }
  if (filters.statuses && filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses } });
  }
  // Ops Pano v2 FAZ 1 — müşteri lensi: accountId filtresi (route scope-guard'lı
  // gönderir; aggregator paritesi — drilldown listesi de aynı daraltmayı görür).
  if (typeof filters.accountId === 'string' && filters.accountId) {
    and.push({ accountId: filters.accountId });
  }

  const periodCreated = { createdAt: { gte: from, lt: to } };
  const periodResolved = { resolvedAt: { gte: from, lt: to } };

  switch (bucket.kind) {
    case 'totalCases':
    case 'createdInPeriod':
      and.push(periodCreated);
      break;
    case 'resolvedInPeriod':
      and.push(periodResolved);
      break;
    case 'openCases':
      and.push({ status: { in: OPEN_STATUSES } });
      break;
    case 'slaRiskCount': {
      const riskDeadline = new Date(Date.now() + 4 * 3600 * 1000);
      and.push({
        status: { in: OPEN_STATUSES },
        slaResolutionDueAt: { gt: new Date(), lte: riskDeadline },
        slaViolation: false,
        slaPausedAt: null,
      });
      break;
    }
    case 'slaBreached':
    case 'slaViolationRatePct':
      and.push(periodResolved, { slaViolation: true });
      break;
    case 'reopened':
    case 'reopenRatePct':
      and.push(periodResolved, { status: 'YenidenAcildi' });
      break;
    case 'escalationRatePct':
      and.push(periodCreated, { escalationLevel: { not: 'Yok' } });
      break;
    case 'transferRatePct':
      and.push(periodCreated, { transferCount: { gt: 0 } });
      break;
    case 'retentionSuccessPct':
      and.push(periodCreated, { caseType: 'Churn', retentionStatus: 'Basarili' });
      break;
    case 'status':
      and.push(periodCreated, { status: String(bucket.key ?? '') });
      break;
    case 'priority':
      and.push(periodCreated, { priority: String(bucket.key ?? '') });
      break;
    case 'caseType':
      and.push(periodCreated, { caseType: String(bucket.key ?? '') });
      break;
    case 'team':
      and.push(periodCreated, { assignedTeamId: String(bucket.key ?? '') });
      break;
    case 'company':
      and.push(periodCreated, { companyId: String(bucket.key ?? '') });
      break;
    case 'category':
      and.push(periodCreated, { category: String(bucket.category ?? bucket.key ?? '') });
      if (bucket.subCategory) and.push({ subCategory: String(bucket.subCategory) });
      break;
    case 'atRiskAccount':
      and.push({
        accountId: String(bucket.key ?? ''),
        OR: [
          { status: { in: OPEN_STATUSES } },
          { slaViolation: true },
        ],
      });
      break;
    default:
      // Bilinmeyen kind allowlist'ten gecmemis olur — yine de bos sonuc don.
      and.push({ id: { in: [] } });
      break;
  }

  return { AND: and };
}

export function buildDrilldownOrderBy(sortBy, sortDir) {
  if (sortBy === 'priority') {
    return [{ priority: sortDir }, { createdAt: 'desc' }];
  }
  if (sortBy === 'slaResolutionDueAt') {
    return [{ slaResolutionDueAt: sortDir }, { createdAt: 'desc' }];
  }
  if (sortBy === 'ageHours') {
    return [{ createdAt: sortDir === 'asc' ? 'desc' : 'asc' }];
  }
  return [{ createdAt: sortDir }];
}

/** Prisma row -> drilldown response row (API kontratina uygun). */
export function mapDrilldownCase(row) {
  const mapped = fromDb({ status: row.status });
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    title: row.title,
    status: mapped.status,
    priority: row.priority,
    companyName: row.companyName,
    accountName: row.accountName,
    category: row.category,
    subCategory: row.subCategory,
    assignedTeamName: row.assignedTeamName,
    assignedPersonName: row.assignedPersonName,
    createdAt: row.createdAt.toISOString(),
    slaResolutionDueAt: row.slaResolutionDueAt ? row.slaResolutionDueAt.toISOString() : null,
    slaViolation: row.slaViolation,
    ageHours: Math.round(((Date.now() - row.createdAt.getTime()) / 3600000) * 10) / 10,
  };
}

export function bucketLabel(bucket) {
  if (bucket.label) return bucket.label;
  if (bucket.kind === 'status') return `Statü: ${bucket.key}`;
  if (bucket.kind === 'priority') return `Öncelik: ${bucket.key}`;
  if (bucket.kind === 'caseType') return `Vaka tipi: ${bucket.key}`;
  if (bucket.kind === 'team') return 'Takım vakaları';
  if (bucket.kind === 'company') return 'Şirket vakaları';
  if (bucket.kind === 'category') {
    return bucket.subCategory ? `${bucket.category} / ${bucket.subCategory}` : String(bucket.category ?? bucket.key);
  }
  if (bucket.kind === 'atRiskAccount') return 'Riskli müşteri vakaları';
  const labels = {
    totalCases: 'Dönemdeki vakalar',
    createdInPeriod: 'Dönemde açılan vakalar',
    resolvedInPeriod: 'Dönemde çözülen vakalar',
    openCases: 'Açık vakalar',
    slaRiskCount: 'SLA riski olan vakalar',
    slaBreached: 'SLA ihlalli vakalar',
    slaViolationRatePct: 'SLA ihlalli çözümler',
    reopened: 'Yeniden açılan vakalar',
    reopenRatePct: 'Yeniden açılan çözümler',
    escalationRatePct: 'Eskalasyonlu vakalar',
    transferRatePct: 'Aktarılan vakalar',
    retentionSuccessPct: 'Başarılı retention vakaları',
  };
  return labels[bucket.kind] ?? 'Vaka listesi';
}
