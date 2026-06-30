/**
 * Aylık Müşteri Bülteni — Aggregator orchestrator (Faz A — A4).
 *
 * computeOperationsOverview + computeAccountBulletinAggregate + snoozedCount
 * + 7→4 status map'i birleştirip frontend'in tek API çağrısıyla bülten için
 * gerekli tüm verileri almasını sağlar.
 *
 * Sorumluluk:
 *  - operationsAggregator (REUSE) — byStatus/byPriority/byRequestType/byOrigin/
 *    byCategory account-scoped (filters.accountId)
 *  - computeAccountBulletinAggregate (REUSE) — perAccountCompany + SLA totals
 *  - snoozedActiveCount — Case.snoozeUntil > now sayısı (Bekletiliyor kovası)
 *  - 7→4 status map (kullanıcı dostu kova):
 *      Açık       = Acik + YenidenAcildi
 *      Üstlenildi = Incelemede + Eskalasyon
 *      Bekletiliyor = ThirdPartyWaiting + snoozedActiveCount
 *      Kapalı     = Cozuldu + IptalEdildi
 *
 * Cross-tenant scope leakage P0: scope endpoint katmanında derive edilir;
 * tüm query'ler scope.companyIds filter'ı baseWhere üzerinden uygular.
 */

import { prisma } from '../db/client.js';
import {
  computeOperationsOverview,
  computeAccountBulletinAggregate,
} from './operationsAggregator.js';

// 7→4 status kova map'i (frontend de hesaplayabilir ama backend authoritative
// — TR label literal'leri bir yerden geliyor olmalı, audit/test deterministic).
const STATUS_BUCKET_MAP = {
  Acik: 'open',
  YenidenAcildi: 'open',
  Incelemede: 'inProgress',
  Eskalasyon: 'inProgress',
  ThirdPartyWaiting: 'waiting',
  Cozuldu: 'closed',
  IptalEdildi: 'closed',
};

const BUCKET_LABELS = {
  open: 'Açık',
  inProgress: 'Üstlenildi',
  waiting: 'Bekletiliyor',
  closed: 'Kapalı',
};

/**
 * Snoozed-active count — Case.snoozeUntil > now sayısı.
 *
 * Bekletiliyor kovasının PARÇASI. Mantık: snooze, statüden bağımsız bir
 * geçici durdurma; admin "ertele" dediyse vaka snoozeUntil'a kadar
 * Bekletiliyor görünür. unsnooze cron snoozeUntil'da vakayı geri açar.
 *
 * Kullanıcı bültenine "Bekletiliyor = ThirdPartyWaiting + active snooze"
 * şeklinde yansıtılır.
 */
async function querySnoozedActiveCount(scope, accountId, from, to) {
  if (!scope || scope.companyIds.length === 0) return 0;
  if (!accountId) return 0;

  // Açık parametre: from/to dönem + accountId + scope companyId IN list.
  const params = [];
  const companyPlaceholders = scope.companyIds.map((v) => {
    params.push(v);
    return `@P${params.length}`;
  });
  params.push(accountId);
  const accountIdx = params.length;
  params.push(from);
  const fromIdx = params.length;
  params.push(to);
  const toIdx = params.length;

  // Aktif snooze: snoozeUntil > now AND createdAt window içinde.
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM [Case]
    WHERE [companyId] IN (${companyPlaceholders.join(', ')})
      AND [accountId] = @P${accountIdx}
      AND [createdAt] >= @P${fromIdx} AND [createdAt] < @P${toIdx}
      AND [snoozeUntil] IS NOT NULL
      AND [snoozeUntil] > sysutcdatetime();
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  return Number(rows?.[0]?.cnt ?? 0);
}

/**
 * 7→4 status map türetimi.
 *
 * @param {Array<{key, count}>} byStatus — operationsAggregator çıktısı
 * @param {number} snoozedActive — querySnoozedActiveCount sonucu
 */
function build4BucketStatus(byStatus, snoozedActive) {
  const buckets = { open: 0, inProgress: 0, waiting: 0, closed: 0 };
  for (const row of byStatus ?? []) {
    const bucket = STATUS_BUCKET_MAP[row.key];
    if (!bucket) continue; // bilinmeyen status — sessiz skip
    buckets[bucket] += row.count;
  }
  // Snooze waiting kovasına ekle (ThirdPartyWaiting + snooze birlikte)
  buckets.waiting += snoozedActive;

  return [
    { key: 'open', label: BUCKET_LABELS.open, count: buckets.open },
    { key: 'inProgress', label: BUCKET_LABELS.inProgress, count: buckets.inProgress },
    { key: 'waiting', label: BUCKET_LABELS.waiting, count: buckets.waiting },
    { key: 'closed', label: BUCKET_LABELS.closed, count: buckets.closed },
  ];
}

/**
 * Aylık Bülten orchestrator — frontend'in tek çağrı ile tüm bülten verisini
 * alması için.
 *
 * @param {Object} args
 * @param {Object} args.scope — { companyIds, teamIds, personIds, canCrossCompanyAgg }
 * @param {string} args.accountId — bültenin müşterisi
 * @param {string} args.from — ISO date
 * @param {string} args.to — ISO date
 * @returns {Promise<{
 *   account: { id, byStatus4, byPriority, byCaseType, byRequestType, byOrigin, byCategory },
 *   perAccountCompany: Array<{companyId, count, resolvedCount, avgResolutionMinutes, slaResolutionCompliantCount, slaResponseCompliantCount, responseMetCount}>,
 *   totals: { count, resolvedCount, avgResolutionMinutes, slaResolutionCompliancePct, slaResponseCompliancePct, ... },
 *   meta: { from, to, scope: { companyIds } }
 * }>}
 */
export async function computeMonthlyBulletin({ scope, accountId, from, to }) {
  if (!scope || !Array.isArray(scope.companyIds) || scope.companyIds.length === 0) {
    return emptyBulletinPayload({ accountId, from, to });
  }
  if (!accountId) {
    return emptyBulletinPayload({ accountId, from, to });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  // 1) operationsAggregator — account-scoped breakdown'lar (filters.accountId
  //    additive; mevcut endpoint davranışı etkilenmez)
  //    Scope'u kopyala, narrowedFromBody sinyalini koru
  const overview = await computeOperationsOverview({
    scope,
    filters: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      accountId, // additive filter — buildWhereSql tarafından okunur
      granularity: 'day',
    },
  });

  // 2) Per-AccountCompany aggregate (resolution time + SLA counts)
  const accountAgg = await computeAccountBulletinAggregate({
    scope,
    accountId,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });

  // 3) Snooze active count (Bekletiliyor kovasının parçası)
  const snoozedActive = await querySnoozedActiveCount(scope, accountId, fromDate, toDate);

  // 4) 7→4 status map
  const byStatus4 = build4BucketStatus(overview.byStatus, snoozedActive);

  return {
    account: {
      id: accountId,
      byStatus4,                     // 4-kova kullanıcı dostu
      byStatusRaw: overview.byStatus, // 7-kova ham (debug/audit)
      byPriority: overview.byPriority,
      byCaseType: overview.byCaseType,
      byRequestType: overview.byRequestType, // A1
      byOrigin: overview.byOrigin,           // A1
      byCategory: overview.byCategory,
      timeSeries: overview.timeSeries,
      snoozedActiveCount: snoozedActive,
    },
    perAccountCompany: accountAgg.perAccountCompany,
    totals: accountAgg.totals,
    meta: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      scope: {
        companyIds: scope.companyIds,
        canCrossCompanyAgg: scope.canCrossCompanyAgg,
      },
      formulaVersion: overview.formulaVersion,
    },
  };
}

function emptyBulletinPayload({ accountId, from, to }) {
  return {
    account: {
      id: accountId ?? null,
      byStatus4: build4BucketStatus([], 0),
      byStatusRaw: [],
      byPriority: [],
      byCaseType: [],
      byRequestType: [],
      byOrigin: [],
      byCategory: [],
      timeSeries: [],
      snoozedActiveCount: 0,
    },
    perAccountCompany: [],
    totals: {
      count: 0,
      resolvedCount: 0,
      avgResolutionMinutes: null,
      slaResolutionCompliantCount: 0,
      slaResponseCompliantCount: 0,
      responseMetCount: 0,
      slaResolutionCompliancePct: null,
      slaResponseCompliancePct: null,
    },
    meta: {
      from: from ?? null,
      to: to ?? null,
      scope: { companyIds: [], canCrossCompanyAgg: false },
      formulaVersion: null,
    },
  };
}

export const _internal = {
  STATUS_BUCKET_MAP,
  BUCKET_LABELS,
  build4BucketStatus,
};
