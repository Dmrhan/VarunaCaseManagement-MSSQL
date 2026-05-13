import { prisma } from '../db/client.js';
import {
  FORMULA_VERSION,
  OPEN_STATUSES,
  computeAvgResolutionWallClockHours,
  computeDelta,
  computeEscalationRatePct,
  computeOpenCases,
  computeReopenRatePct,
  computeRetentionSuccessPct,
  computeSlaViolationRatePct,
  computeTotalCases,
  computeTransferRatePct,
  isInsufficientSample,
  minSampleNote,
  roundInt,
  MIN_SAMPLE,
} from './metricFormulas.js';

/**
 * Operations Intelligence — Aggregator (Phase 1)
 *
 * docs/OPERATIONS_DASHBOARD_DESIGN.md §2.1, §2.4, §2.6
 *
 * Tek kaynak: bu modul UI, export, drilldown ve AI'in besledigi snapshot'i
 * uretir. Ayri SQL yazilmaz (§2.6.8). Tum metric'ler deterministic; AI
 * hesaplamaz.
 *
 * Phase 1 metrics (§2.6.2 + kullanici kararlari):
 *   - totalCases, openCases
 *   - createdInPeriod, resolvedInPeriod
 *   - slaViolationRatePct (resolved-based)
 *   - avgResolutionWallClockHours (wall-clock, pause cikarilmaz)
 *   - reopenRatePct (resolved-based payda)
 *   - escalationRatePct, transferRatePct
 *   - retentionSuccessPct
 *
 *   firstResponseTimeMin -> 'not_available' (instrumentation yok)
 *   backlogChangePct     -> Phase 1'de 'approximate' (BacklogSnapshot yok)
 *
 * Breakdown'lar: byStatus, byPriority, byCaseType, byCompany, byTeam (top 10),
 * byCategory (top 20). Time series gun bazli (Europe/Istanbul).
 */

const TZ = 'Europe/Istanbul';
const TOP_TEAM_LIMIT = 10;
const TOP_CATEGORY_LIMIT = 20;
const TOP_AT_RISK_LIMIT = 10;

const SLA_RISK_HOURS = 4; // SLA dolmadan once "risk" sayilir (yaklasan ihlal)

/**
 * Ana giris noktasi. Scope + applied filters alir, deterministic overview
 * payload'u dondurur. AI'a verilecek snapshot icin de bu sonuc kullanilir.
 *
 * @param {object} args
 * @param {object} args.scope         §2.2A turetilmis scope
 * @param {object} args.filters       { from, to, productGroups, caseTypes, granularity }
 * @returns {Promise<object>}         §2.1'deki overview response payload
 */
export async function computeOperationsOverview({ scope, filters }) {
  const t0 = Date.now();

  // Empty scope -> hizli donus
  if (scope.companyIds.length === 0) {
    return emptyOverviewPayload({ scope, filters, durationMs: Date.now() - t0 });
  }

  const periodFrom = new Date(filters.from);
  const periodTo = new Date(filters.to);

  // Onceki donem (period-over-period delta icin) — ayni uzunluk, hemen oncesi
  const periodMs = periodTo.getTime() - periodFrom.getTime();
  const prevFrom = new Date(periodFrom.getTime() - periodMs);
  const prevTo = new Date(periodFrom.getTime());

  // SQL WHERE building helpers
  const baseWhere = buildWhereSql(scope, filters);

  // Tum sorgular parallel
  const [
    snapshotMetrics,
    periodMetrics,
    prevPeriodMetrics,
    timeSeries,
    byStatus,
    byPriority,
    byCaseType,
    byCompany,
    byTeam,
    byCategory,
    topAtRiskAccounts,
  ] = await Promise.all([
    queryOpenSnapshot(scope, filters, baseWhere),
    queryPeriodMetrics(scope, filters, periodFrom, periodTo, baseWhere),
    queryPeriodMetrics(scope, filters, prevFrom, prevTo, baseWhere),
    queryTimeSeries(scope, filters, periodFrom, periodTo, baseWhere),
    queryByStatus(scope, filters, periodFrom, periodTo, baseWhere),
    queryByPriority(scope, filters, periodFrom, periodTo, baseWhere),
    queryByCaseType(scope, filters, periodFrom, periodTo, baseWhere),
    queryByCompany(scope, filters, periodFrom, periodTo, baseWhere),
    queryByTeam(scope, filters, periodFrom, periodTo, baseWhere),
    queryByCategory(scope, filters, periodFrom, periodTo, baseWhere),
    queryTopAtRiskAccounts(scope, filters, baseWhere),
  ]);

  // KPI'lari topla
  const minSampleViolations = [];
  const kpis = assembleKpis({
    snapshot: snapshotMetrics,
    period: periodMetrics,
    prev: prevPeriodMetrics,
    minSampleViolations,
  });

  return {
    asOf: new Date().toISOString(),
    asOfLocal: formatIstanbul(new Date()),
    formulaVersion: FORMULA_VERSION,
    timezone: TZ,
    appliedFilters: {
      from: periodFrom.toISOString(),
      to: periodTo.toISOString(),
      companies: scope.companyIds,
      teams: scope.teamIds,
      productGroups: filters.productGroups ?? null,
      caseTypes: filters.caseTypes ?? null,
      statuses: filters.statuses ?? null,
      granularity: filters.granularity ?? 'day',
    },
    approximations: [], // Phase 1: backlogChangePct simdilik UI'da yok
    minSampleViolations,
    notAvailable: ['firstResponseTimeMin'], // §2.6.2 — instrumentation yok
    kpis,
    timeSeries,
    byStatus,
    byPriority,
    byCaseType,
    // SystemAdmin disindaki rollerde byCompany gizli (§2.2A)
    byCompany: scope.canCrossCompanyAgg ? byCompany : null,
    byTeam,
    byCategory,
    topAtRiskAccounts,
    durationMs: Date.now() - t0,
  };
}

// ---------- KPI assembly ----------

function assembleKpis({ snapshot, period, prev, minSampleViolations }) {
  const totalCases = computeTotalCases({ totalCount: period.totalCreated });
  const openCases = computeOpenCases({ openCount: snapshot.openCount });
  const createdInPeriod = roundInt(period.totalCreated);
  const resolvedInPeriod = roundInt(period.totalResolved);

  // SLA risk: snapshot — su an SLA dolmaya yakin acik vakalar
  const slaRiskCount = roundInt(snapshot.slaRiskCount);

  // SLA violation rate
  let slaViolationRatePct = computeSlaViolationRatePct({
    slaResolvedCount: period.slaResolvedCount,
    totalResolvedCount: period.totalResolved,
  });
  if (slaViolationRatePct == null && period.totalResolved !== null) {
    if (isInsufficientSample(period.totalResolved, 'default')) {
      minSampleViolations.push(minSampleNote('slaViolationRatePct', period.totalResolved, 'default'));
    }
  }
  const slaViolationRatePctPrev = computeSlaViolationRatePct({
    slaResolvedCount: prev.slaResolvedCount,
    totalResolvedCount: prev.totalResolved,
  });

  // Avg TTR (wall-clock)
  let avgTtrHours = computeAvgResolutionWallClockHours({
    totalResolutionSeconds: period.totalResolutionSeconds,
    resolvedSampleSize: period.totalResolved,
  });
  if (avgTtrHours == null && isInsufficientSample(period.totalResolved, 'default')) {
    minSampleViolations.push(minSampleNote('avgResolutionWallClockHours', period.totalResolved, 'default'));
  }
  const avgTtrHoursPrev = computeAvgResolutionWallClockHours({
    totalResolutionSeconds: prev.totalResolutionSeconds,
    resolvedSampleSize: prev.totalResolved,
  });

  // Reopen rate (resolved-based payda)
  let reopenRatePct = computeReopenRatePct({
    reopenedAfterResolutionCount: period.reopenedCount,
    totalResolvedCount: period.totalResolved,
  });
  if (reopenRatePct == null && isInsufficientSample(period.totalResolved, 'default')) {
    minSampleViolations.push(minSampleNote('reopenRatePct', period.totalResolved, 'default'));
  }
  const reopenRatePctPrev = computeReopenRatePct({
    reopenedAfterResolutionCount: prev.reopenedCount,
    totalResolvedCount: prev.totalResolved,
  });

  // Escalation rate (created-based)
  const escalationRatePct = computeEscalationRatePct({
    escalatedCount: period.escalatedCount,
    totalCreatedCount: period.totalCreated,
  });
  const escalationRatePctPrev = computeEscalationRatePct({
    escalatedCount: prev.escalatedCount,
    totalCreatedCount: prev.totalCreated,
  });

  // Transfer rate
  const transferRatePct = computeTransferRatePct({
    transferredCount: period.transferredCount,
    totalCreatedCount: period.totalCreated,
  });
  const transferRatePctPrev = computeTransferRatePct({
    transferredCount: prev.transferredCount,
    totalCreatedCount: prev.totalCreated,
  });

  // Retention success
  const retentionSuccessPct = computeRetentionSuccessPct({
    successCount: period.retentionSuccessCount,
    decidedChurnCount: period.retentionDecidedCount,
  });
  const retentionSuccessPctPrev = computeRetentionSuccessPct({
    successCount: prev.retentionSuccessCount,
    decidedChurnCount: prev.retentionDecidedCount,
  });

  return {
    totalCases:                  withDelta(totalCases, prev.totalCreated, 'totalCases'),
    openCases:                   withDelta(openCases, null, 'openCases'), // snapshot — PoP yok
    slaRiskCount:                withDelta(slaRiskCount, null, 'slaRiskCount'),
    createdInPeriod:             withDelta(createdInPeriod, prev.totalCreated, 'createdInPeriod'),
    resolvedInPeriod:            withDelta(resolvedInPeriod, prev.totalResolved, 'resolvedInPeriod'),
    slaViolationRatePct:         withDelta(slaViolationRatePct, slaViolationRatePctPrev, 'slaViolationRatePct'),
    avgResolutionWallClockHours: withDelta(avgTtrHours, avgTtrHoursPrev, 'avgResolutionWallClockHours'),
    reopenRatePct:               withDelta(reopenRatePct, reopenRatePctPrev, 'reopenRatePct'),
    escalationRatePct:           withDelta(escalationRatePct, escalationRatePctPrev, 'escalationRatePct'),
    transferRatePct:             withDelta(transferRatePct, transferRatePctPrev, 'transferRatePct'),
    retentionSuccessPct:         withDelta(retentionSuccessPct, retentionSuccessPctPrev, 'retentionSuccessPct'),
  };
}

function withDelta(value, previous, key) {
  return {
    key,
    value,
    delta: computeDelta(value, previous),
  };
}

// ---------- SQL queries (raw, parameterized) ----------

/**
 * baseWhere: `companyId = ANY($1)` + opsiyonel team/productGroup filtreleri.
 * Returns { sql: "AND ...", params: [...] } — append edilebilir clause.
 * NOT: scope.personIds (self) icin ayrica eklenir.
 */
function buildWhereSql(scope, filters) {
  const params = [];
  const clauses = [];

  // companyId — her zaman zorunlu
  if (scope.companyIds.length === 0) {
    // Empty scope -> sorgu sonuc dondurmesin
    params.push([]);
    clauses.push(`"companyId" = ANY($${params.length}::text[])`);
  } else {
    params.push(scope.companyIds);
    clauses.push(`"companyId" = ANY($${params.length}::text[])`);
  }

  // teamIds
  if (scope.teamIds && scope.teamIds.length > 0) {
    params.push(scope.teamIds);
    clauses.push(`"assignedTeamId" = ANY($${params.length}::text[])`);
  }

  // personIds (self scope)
  if (scope.personIds && scope.personIds.length > 0) {
    params.push(scope.personIds);
    clauses.push(`"assignedPersonId" = ANY($${params.length}::text[])`);
  }

  // productGroups (filter)
  if (filters.productGroups && filters.productGroups.length > 0) {
    params.push(filters.productGroups);
    clauses.push(`"productGroup" = ANY($${params.length}::text[])`);
  }

  // caseTypes (filter) — Prisma enum identifier
  if (filters.caseTypes && filters.caseTypes.length > 0) {
    params.push(filters.caseTypes);
    clauses.push(`"caseType"::text = ANY($${params.length}::text[])`);
  }

  return { sql: clauses.join(' AND '), params };
}

function withParam(baseWhere, value) {
  const next = [...baseWhere.params, value];
  return { sql: baseWhere.sql, params: next, idx: next.length };
}

/**
 * Snapshot — su an acik + SLA risk altinda kac vaka var (period-independent).
 */
async function queryOpenSnapshot(scope, filters, baseWhere) {
  if (scope.companyIds.length === 0) return { openCount: 0, slaRiskCount: 0 };

  const slaRiskDeadline = new Date(Date.now() + SLA_RISK_HOURS * 3600 * 1000);
  const p1 = withParam(baseWhere, slaRiskDeadline);

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi'])) AS open_count,
      COUNT(*) FILTER (
        WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi'])
        AND "slaResolutionDueAt" IS NOT NULL
        AND "slaResolutionDueAt" > NOW()
        AND "slaResolutionDueAt" <= $${p1.idx}::timestamp
        AND "slaViolation" = false
        AND "slaPausedAt" IS NULL
      ) AS sla_risk_count
    FROM "Case"
    WHERE ${baseWhere.sql}
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p1.params);
  const r = rows[0] || {};
  return {
    openCount: Number(r.open_count ?? 0),
    slaRiskCount: Number(r.sla_risk_count ?? 0),
  };
}

/**
 * Period metric'ler: created/resolved sayilari, SLA breach count, TTR toplami,
 * escalation, transfer, reopen, retention.
 */
async function queryPeriodMetrics(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) {
    return {
      totalCreated: 0,
      totalResolved: 0,
      slaResolvedCount: 0,
      totalResolutionSeconds: 0,
      escalatedCount: 0,
      transferredCount: 0,
      reopenedCount: 0,
      retentionDecidedCount: 0,
      retentionSuccessCount: 0,
    };
  }
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp) AS total_created,
      COUNT(*) FILTER (WHERE "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp) AS total_resolved,
      COUNT(*) FILTER (
        WHERE "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
        AND "slaViolation" = true
      ) AS sla_resolved_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))) FILTER (
        WHERE "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
        AND "resolvedAt" > "createdAt"
      ), 0) AS total_resolution_seconds,
      COUNT(*) FILTER (
        WHERE "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
        AND "escalationLevel"::text <> 'Yok'
      ) AS escalated_count,
      COUNT(*) FILTER (
        WHERE "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
        AND "transferCount" > 0
      ) AS transferred_count,
      COUNT(*) FILTER (
        WHERE "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
        AND "status"::text = 'YenidenAcildi'
      ) AS reopened_count,
      COUNT(*) FILTER (
        WHERE "caseType"::text = 'Churn'
        AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
        AND "retentionStatus"::text IS NOT NULL
        AND "retentionStatus"::text <> 'DevamEdiyor'
      ) AS retention_decided_count,
      COUNT(*) FILTER (
        WHERE "caseType"::text = 'Churn'
        AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
        AND "retentionStatus"::text = 'Basarili'
      ) AS retention_success_count
    FROM "Case"
    WHERE ${baseWhere.sql}
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  const r = rows[0] || {};
  return {
    totalCreated:            Number(r.total_created ?? 0),
    totalResolved:           Number(r.total_resolved ?? 0),
    slaResolvedCount:        Number(r.sla_resolved_count ?? 0),
    totalResolutionSeconds:  Number(r.total_resolution_seconds ?? 0),
    escalatedCount:          Number(r.escalated_count ?? 0),
    transferredCount:        Number(r.transferred_count ?? 0),
    reopenedCount:           Number(r.reopened_count ?? 0),
    retentionDecidedCount:   Number(r.retention_decided_count ?? 0),
    retentionSuccessCount:   Number(r.retention_success_count ?? 0),
  };
}

/**
 * Time series — gun bazli (Europe/Istanbul) created vs resolved vs sla breach.
 */
async function queryTimeSeries(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);

  // DATE_TRUNC AT TIME ZONE Europe/Istanbul (§2.6.4)
  const sql = `
    WITH days AS (
      SELECT generate_series(
        DATE_TRUNC('day', $${p1.idx}::timestamptz AT TIME ZONE 'Europe/Istanbul')::date,
        DATE_TRUNC('day', $${p2.idx}::timestamptz AT TIME ZONE 'Europe/Istanbul')::date,
        '1 day'::interval
      )::date AS bucket
    ),
    created_agg AS (
      SELECT DATE_TRUNC('day', "createdAt" AT TIME ZONE 'Europe/Istanbul')::date AS bucket, COUNT(*) AS cnt
      FROM "Case"
      WHERE ${baseWhere.sql}
        AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
      GROUP BY 1
    ),
    resolved_agg AS (
      SELECT DATE_TRUNC('day', "resolvedAt" AT TIME ZONE 'Europe/Istanbul')::date AS bucket, COUNT(*) AS cnt
      FROM "Case"
      WHERE ${baseWhere.sql}
        AND "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
      GROUP BY 1
    ),
    sla_agg AS (
      SELECT DATE_TRUNC('day', "resolvedAt" AT TIME ZONE 'Europe/Istanbul')::date AS bucket, COUNT(*) AS cnt
      FROM "Case"
      WHERE ${baseWhere.sql}
        AND "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
        AND "slaViolation" = true
      GROUP BY 1
    )
    SELECT
      to_char(d.bucket, 'YYYY-MM-DD') AS bucket,
      COALESCE(c.cnt, 0) AS created,
      COALESCE(r.cnt, 0) AS resolved,
      COALESCE(s.cnt, 0) AS sla_breached
    FROM days d
    LEFT JOIN created_agg  c ON c.bucket = d.bucket
    LEFT JOIN resolved_agg r ON r.bucket = d.bucket
    LEFT JOIN sla_agg      s ON s.bucket = d.bucket
    ORDER BY d.bucket;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((row) => ({
    bucket: row.bucket,
    created: Number(row.created),
    resolved: Number(row.resolved),
    slaBreached: Number(row.sla_breached),
  }));
}

async function queryByStatus(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT "status"::text AS key, COUNT(*) AS cnt
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
    GROUP BY "status"
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

async function queryByPriority(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT "priority"::text AS key, COUNT(*) AS cnt
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
    GROUP BY "priority"
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

async function queryByCaseType(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT "caseType"::text AS key, COUNT(*) AS cnt
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
    GROUP BY "caseType"
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

async function queryByCompany(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT "companyId" AS id, "companyName" AS name, COUNT(*) AS cnt
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
    GROUP BY "companyId", "companyName"
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.cnt) }));
}

async function queryByTeam(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT
      "assignedTeamId" AS id,
      "assignedTeamName" AS name,
      COUNT(*) AS cnt,
      COALESCE(AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600.0)
        FILTER (WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" > "createdAt"), NULL) AS avg_ttr_hours
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
      AND "assignedTeamId" IS NOT NULL
    GROUP BY "assignedTeamId", "assignedTeamName"
    ORDER BY cnt DESC
    LIMIT ${TOP_TEAM_LIMIT};
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? r.id,
    count: Number(r.cnt),
    avgTtrHours: r.avg_ttr_hours == null ? null : Math.round(Number(r.avg_ttr_hours) * 10) / 10,
  }));
}

async function queryByCategory(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT
      "category"    AS category,
      "subCategory" AS sub_category,
      COUNT(*)      AS total,
      COUNT(*) FILTER (WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi'])) AS open_count,
      COALESCE(AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600.0)
        FILTER (WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" > "createdAt"), NULL) AS avg_ttr_hours,
      COUNT(*) FILTER (
        WHERE "resolvedAt" >= $${p1.idx}::timestamp AND "resolvedAt" < $${p2.idx}::timestamp
        AND "slaViolation" = true
      ) AS sla_breach_count
    FROM "Case"
    WHERE ${baseWhere.sql}
      AND "createdAt" >= $${p1.idx}::timestamp AND "createdAt" < $${p2.idx}::timestamp
    GROUP BY "category", "subCategory"
    ORDER BY total DESC
    LIMIT ${TOP_CATEGORY_LIMIT};
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({
    category: r.category,
    subCategory: r.sub_category,
    total: Number(r.total),
    open: Number(r.open_count),
    avgTtrHours: r.avg_ttr_hours == null ? null : Math.round(Number(r.avg_ttr_hours) * 10) / 10,
    slaBreachCount: Number(r.sla_breach_count),
  }));
}

/**
 * Top at-risk accounts (snapshot). Customer Pulse mantigi ile uyumlu:
 * en cok acik vakasi olan ya da SLA ihlal eden hesaplar.
 * NOT: Phase 1 — Customer Pulse state hesaplamasi yapilmaz (ayri endpoint var);
 * sadece raw signal'lar (openCount, slaBreachCount) dondurulur.
 */
async function queryTopAtRiskAccounts(scope, filters, baseWhere) {
  if (scope.companyIds.length === 0) return [];

  const sql = `
    SELECT
      "accountId"   AS account_id,
      "accountName" AS account_name,
      "companyId"   AS company_id,
      COUNT(*) FILTER (WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi'])) AS open_count,
      COUNT(*) FILTER (WHERE "slaViolation" = true) AS sla_breach_count,
      COUNT(*) FILTER (WHERE "escalationLevel"::text <> 'Yok') AS escalated_count
    FROM "Case"
    WHERE ${baseWhere.sql}
    GROUP BY "accountId", "accountName", "companyId"
    HAVING
      COUNT(*) FILTER (WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi'])) > 0
      OR COUNT(*) FILTER (WHERE "slaViolation" = true) > 0
    ORDER BY
      (COUNT(*) FILTER (WHERE "slaViolation" = true)) DESC,
      (COUNT(*) FILTER (WHERE "status"::text = ANY (ARRAY['Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi']))) DESC
    LIMIT ${TOP_AT_RISK_LIMIT};
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...baseWhere.params);
  return rows.map((r) => ({
    accountId: r.account_id,
    accountName: r.account_name,
    companyId: r.company_id,
    openCount: Number(r.open_count),
    slaBreachCount: Number(r.sla_breach_count),
    escalatedCount: Number(r.escalated_count),
  }));
}

// ---------- yardimcilar ----------

function emptyOverviewPayload({ scope, filters, durationMs }) {
  const periodFrom = new Date(filters.from);
  const periodTo = new Date(filters.to);
  return {
    asOf: new Date().toISOString(),
    asOfLocal: formatIstanbul(new Date()),
    formulaVersion: FORMULA_VERSION,
    timezone: TZ,
    appliedFilters: {
      from: periodFrom.toISOString(),
      to: periodTo.toISOString(),
      companies: [],
      teams: null,
      productGroups: filters.productGroups ?? null,
      caseTypes: filters.caseTypes ?? null,
      statuses: filters.statuses ?? null,
      granularity: filters.granularity ?? 'day',
    },
    approximations: [],
    minSampleViolations: [],
    notAvailable: ['firstResponseTimeMin'],
    kpis: {
      totalCases:                  { key: 'totalCases', value: 0, delta: { value: null, direction: null, sourceMissing: true } },
      openCases:                   { key: 'openCases',  value: 0, delta: { value: null, direction: null, sourceMissing: true } },
      slaRiskCount:                { key: 'slaRiskCount', value: 0, delta: { value: null, direction: null, sourceMissing: true } },
      createdInPeriod:             { key: 'createdInPeriod', value: 0, delta: { value: null, direction: null, sourceMissing: true } },
      resolvedInPeriod:            { key: 'resolvedInPeriod', value: 0, delta: { value: null, direction: null, sourceMissing: true } },
      slaViolationRatePct:         { key: 'slaViolationRatePct', value: null, delta: { value: null, direction: null, sourceMissing: true } },
      avgResolutionWallClockHours: { key: 'avgResolutionWallClockHours', value: null, delta: { value: null, direction: null, sourceMissing: true } },
      reopenRatePct:               { key: 'reopenRatePct', value: null, delta: { value: null, direction: null, sourceMissing: true } },
      escalationRatePct:           { key: 'escalationRatePct', value: null, delta: { value: null, direction: null, sourceMissing: true } },
      transferRatePct:             { key: 'transferRatePct', value: null, delta: { value: null, direction: null, sourceMissing: true } },
      retentionSuccessPct:         { key: 'retentionSuccessPct', value: null, delta: { value: null, direction: null, sourceMissing: true } },
    },
    timeSeries: [],
    byStatus: [],
    byPriority: [],
    byCaseType: [],
    byCompany: null,
    byTeam: [],
    byCategory: [],
    topAtRiskAccounts: [],
    durationMs,
  };
}

function formatIstanbul(date) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
