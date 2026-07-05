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

// MSSQL: DB artık enum'ların ASCII identifier'larını saklar (Postgres'teki
// Türkçe @map değerleri yok) — app değerleri = DB değerleri, mapping gerekmez.
const OPEN_STATUS_DB_VALUES = OPEN_STATUSES;
const RETENTION_SUCCESS_DB_VALUE = 'Basarili';
const RETENTION_PENDING_DB_VALUE = 'DevamEdiyor';

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
    byRequestType,
    byOrigin,
    topAtRiskAccounts,
    // Ops Pano v2 FAZ 2 — AI görüş aggregate'leri (aggregate-only, PII yok)
    bySmartTicketPlatform,
    bySmartTicketBusinessProcess,
    bySmartTicketOperationType,
    bySmartTicketAffectedObject,
    bySmartTicketImpact,
    solutionStepSource,
    mailOps,
    patternAlerts,
    qaAverages,
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
    // Aylık Bülten Faz A — A1 yeni breakdown'lar.
    queryByRequestType(scope, filters, periodFrom, periodTo, baseWhere),
    queryByOrigin(scope, filters, periodFrom, periodTo, baseWhere),
    queryTopAtRiskAccounts(scope, filters, baseWhere),
    // Ops Pano v2 FAZ 2
    queryBySmartTicketTaxonomy(scope, filters, periodFrom, periodTo, baseWhere, 'platform'),
    queryBySmartTicketTaxonomy(scope, filters, periodFrom, periodTo, baseWhere, 'businessProcess'),
    queryBySmartTicketTaxonomy(scope, filters, periodFrom, periodTo, baseWhere, 'operationType'),
    queryBySmartTicketTaxonomy(scope, filters, periodFrom, periodTo, baseWhere, 'affectedObject'),
    queryBySmartTicketTaxonomy(scope, filters, periodFrom, periodTo, baseWhere, 'impact'),
    queryBySolutionStepSource(scope, filters, periodFrom, periodTo, baseWhere),
    queryMailOps(scope, filters, periodFrom, periodTo, baseWhere),
    queryPatternAlertSummary(scope),
    queryQaAverages(scope, filters, periodFrom, periodTo, baseWhere),
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
    // Aylık Bülten Faz A — A1 yeni breakdown'lar (Soru/Talep/Hata/Şikayet + Kanal)
    byRequestType,
    byOrigin,
    topAtRiskAccounts,
    // Ops Pano v2 FAZ 2 — AI görüş alanı (aggregate-only; PII yok).
    // qaAverages minSample: n < MIN_SAMPLE.qaScore ise değerler null döner
    // ve violation kaydı düşülür (mevcut desen).
    bySmartTicketPlatform,
    bySmartTicketBusinessProcess,
    bySmartTicketOperationType,
    bySmartTicketAffectedObject,
    bySmartTicketImpact,
    bySolutionStepSource: solutionStepSource.rows,
    kbAssistedResolutionRate: solutionStepSource.kbAssistedResolutionRate,
    mailOps,
    patternAlerts,
    qaAverages: (() => {
      if (qaAverages.sampleCount > 0 && qaAverages.sampleCount < MIN_SAMPLE.qaScore) {
        minSampleViolations.push(minSampleNote('qaAverages', qaAverages.sampleCount, 'qaScore'));
      }
      return qaAverages;
    })(),
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

// ---------- SQL queries (raw, parameterized — MSSQL / @Pn placeholder) ----------

/**
 * baseWhere: `[companyId] IN (...)` + opsiyonel team/productGroup filtreleri.
 * Returns { sql: "...", params: [...] } — append edilebilir clause.
 * MSSQL'de array parametresi yok: IN listesi eleman basina @Pn ile genisletilir.
 * NOT: scope.personIds (self) icin ayrica eklenir.
 */
function buildWhereSql(scope, filters) {
  const params = [];
  const clauses = [];

  const addIn = (col, values) => {
    const placeholders = values.map((v) => {
      params.push(v);
      return `@P${params.length}`;
    });
    clauses.push(`${col} IN (${placeholders.join(', ')})`);
  };

  // companyId — her zaman zorunlu
  if (scope.companyIds.length === 0) {
    // Empty scope -> sorgu sonuc dondurmesin
    clauses.push('1 = 0');
  } else {
    addIn('[companyId]', scope.companyIds);
  }

  if (scope.teamIds && scope.teamIds.length > 0) addIn('[assignedTeamId]', scope.teamIds);
  if (scope.personIds && scope.personIds.length > 0) addIn('[assignedPersonId]', scope.personIds);
  if (filters.productGroups && filters.productGroups.length > 0) addIn('[productGroup]', filters.productGroups);
  if (filters.caseTypes && filters.caseTypes.length > 0) addIn('[caseType]', filters.caseTypes);
  // statuses — DB ASCII identifier saklar, app degerleri dogrudan kullanilir
  if (filters.statuses && filters.statuses.length > 0) addIn('[status]', filters.statuses);

  // Aylık Bülten Faz A — A4 — opsiyonel accountId filter. Bulletin
  // orchestrator computeOperationsOverview'u accountId filter ile çağırır;
  // byStatus / byPriority / byRequestType / byOrigin / byCategory tek
  // account'a kısıtlanır. Diğer endpoint'ler bu alanı göndermez → no-op.
  if (filters.accountId && typeof filters.accountId === 'string') {
    params.push(filters.accountId);
    clauses.push(`[accountId] = @P${params.length}`);
  }

  return { sql: clauses.join(' AND '), params };
}

function withParam(baseWhere, value) {
  const next = [...baseWhere.params, value];
  return { sql: baseWhere.sql, params: next, idx: next.length };
}

/** Array degerini IN listesine genisletir; `list` = "@P5, @P6, ..." */
function withArrayParam(prev, values) {
  const params = [...prev.params];
  const placeholders = values.map((v) => {
    params.push(v);
    return `@P${params.length}`;
  });
  return { sql: prev.sql, params, list: placeholders.join(', ') };
}

/**
 * Snapshot — su an acik + SLA risk altinda kac vaka var (period-independent).
 */
async function queryOpenSnapshot(scope, filters, baseWhere) {
  if (scope.companyIds.length === 0) return { openCount: 0, slaRiskCount: 0 };

  const slaRiskDeadline = new Date(Date.now() + SLA_RISK_HOURS * 3600 * 1000);
  const p1 = withParam(baseWhere, slaRiskDeadline);
  const p2 = withArrayParam(p1, OPEN_STATUS_DB_VALUES);

  const sql = `
    SELECT
      COUNT(CASE WHEN [status] IN (${p2.list}) THEN 1 END) AS open_count,
      COUNT(CASE WHEN [status] IN (${p2.list})
        AND [slaResolutionDueAt] IS NOT NULL
        AND [slaResolutionDueAt] > SYSUTCDATETIME()
        AND [slaResolutionDueAt] <= @P${p1.idx}
        AND [slaViolation] = 0
        AND [slaPausedAt] IS NULL
      THEN 1 END) AS sla_risk_count
    FROM [Case]
    WHERE ${baseWhere.sql}
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
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
      COUNT(CASE WHEN [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx} THEN 1 END) AS total_created,
      COUNT(CASE WHEN [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx} THEN 1 END) AS total_resolved,
      COUNT(CASE WHEN [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
        AND [slaViolation] = 1
      THEN 1 END) AS sla_resolved_count,
      COALESCE(SUM(CASE WHEN [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
        AND [resolvedAt] > [createdAt]
      THEN CAST(DATEDIFF(SECOND, [createdAt], [resolvedAt]) AS bigint) END), 0) AS total_resolution_seconds,
      COUNT(CASE WHEN [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
        AND [escalationLevel] <> 'Yok'
      THEN 1 END) AS escalated_count,
      COUNT(CASE WHEN [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
        AND [transferCount] > 0
      THEN 1 END) AS transferred_count,
      COUNT(CASE WHEN [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
        AND [status] = 'YenidenAcildi'
      THEN 1 END) AS reopened_count,
      COUNT(CASE WHEN [caseType] = 'Churn'
        AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
        AND [retentionStatus] IS NOT NULL
        AND [retentionStatus] <> '${RETENTION_PENDING_DB_VALUE}'
      THEN 1 END) AS retention_decided_count,
      COUNT(CASE WHEN [caseType] = 'Churn'
        AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
        AND [retentionStatus] = '${RETENTION_SUCCESS_DB_VALUE}'
      THEN 1 END) AS retention_success_count
    FROM [Case]
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

  // Gun bucket'i Europe/Istanbul'a gore (§2.6.4). Kolonlar UTC datetime2;
  // 'Turkey Standard Time' (UTC+3, DST yok) Windows/Linux SQL Server'da tanimli.
  // Postgres generate_series yerine recursive CTE ile gun spine'i uretilir.
  const localDay = (col) => `CAST((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Turkey Standard Time' AS date)`;
  const sql = `
    WITH days AS (
      SELECT ${localDay(`@P${p1.idx}`)} AS bucket
      UNION ALL
      SELECT DATEADD(day, 1, bucket) FROM days
      WHERE bucket < ${localDay(`@P${p2.idx}`)}
    ),
    created_agg AS (
      SELECT ${localDay('[createdAt]')} AS bucket, COUNT(*) AS cnt
      FROM [Case]
      WHERE ${baseWhere.sql}
        AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      GROUP BY ${localDay('[createdAt]')}
    ),
    resolved_agg AS (
      SELECT ${localDay('[resolvedAt]')} AS bucket, COUNT(*) AS cnt
      FROM [Case]
      WHERE ${baseWhere.sql}
        AND [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
      GROUP BY ${localDay('[resolvedAt]')}
    ),
    sla_agg AS (
      SELECT ${localDay('[resolvedAt]')} AS bucket, COUNT(*) AS cnt
      FROM [Case]
      WHERE ${baseWhere.sql}
        AND [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
        AND [slaViolation] = 1
      GROUP BY ${localDay('[resolvedAt]')}
    )
    SELECT
      CONVERT(varchar(10), d.bucket, 23) AS bucket,
      COALESCE(c.cnt, 0) AS created,
      COALESCE(r.cnt, 0) AS resolved,
      COALESCE(s.cnt, 0) AS sla_breached
    FROM days d
    LEFT JOIN created_agg  c ON c.bucket = d.bucket
    LEFT JOIN resolved_agg r ON r.bucket = d.bucket
    LEFT JOIN sla_agg      s ON s.bucket = d.bucket
    ORDER BY d.bucket
    OPTION (MAXRECURSION 1000);
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
    SELECT [status] AS [key], COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
    GROUP BY [status]
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
    SELECT [priority] AS [key], COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
    GROUP BY [priority]
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

/**
 * Aylık Bülten Faz A — A1 — Vaka tipi (talep türü) dağılımı.
 *
 * Bilgi/Talep/Hata/Şikayet/Öneri (enumMap M_REQUEST). Müşteri bülteninde
 * "Sorular kaç tane geldi, kaç şikayet" panosu için.
 *
 * Diğer breakdown'larla aynı pattern: createdAt window + companyId scope
 * (baseWhere.sql) + GROUP BY. SQL injection korumalı (parameterized);
 * key alanı raw column ismi, value alanı parametre.
 */
async function queryByRequestType(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT [requestType] AS [key], COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      AND [requestType] IS NOT NULL
    GROUP BY [requestType]
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

/**
 * Aylık Bülten Faz A — A1 — Kanal (origin) dağılımı.
 *
 * E-posta/Telefon/Web/Chatbot/Diğer (enumMap M_ORIGIN). Müşteri bülteninde
 * "vakalar hangi kanaldan geldi" panosu için.
 */
async function queryByOrigin(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT [origin] AS [key], COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      AND [origin] IS NOT NULL
    GROUP BY [origin]
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, count: Number(r.cnt) }));
}

// ══════════════════════════════════════════════════════════════════
// Ops Pano v2 FAZ 2 — AI görüş alanı aggregate'leri (2026-07-05)
// Spec: docs/OPERATIONS_DASHBOARD_V2.md FAZ 2. TÜMÜ aggregate-only
// (count/oran/dakika) — PII YOK (🔒 Sabit Kural 1: customerContact*,
// başlık, kişi adı, mail içeriği HİÇBİR alanda yer almaz).
// Scope guard paritesi: hepsi baseWhere (companyIds + team/person) üstünden.
// ══════════════════════════════════════════════════════════════════

const SMART_TICKET_TAXONOMY_FIELDS = [
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
];

/**
 * 2a — Akıllı Ticket taksonomi dağılımı (tek alan, top-8).
 * customFields NVarChar JSON → JSON_VALUE ile code + Label snapshot okunur
 * (Label yazım anında snapshot'landığı için TaxonomyDef join'ine gerek yok —
 * tenant-safe ve tek sorgu).
 */
async function queryBySmartTicketTaxonomy(scope, filters, from, to, baseWhere, field) {
  if (scope.companyIds.length === 0) return [];
  if (!SMART_TICKET_TAXONOMY_FIELDS.includes(field)) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT TOP 8
      JSON_VALUE([customFields], '$.smartTicket.${field}') AS [key],
      MAX(JSON_VALUE([customFields], '$.smartTicket.${field}Label')) AS [label],
      COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      AND JSON_VALUE([customFields], '$.smartTicket.${field}') IS NOT NULL
    GROUP BY JSON_VALUE([customFields], '$.smartTicket.${field}')
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  return rows.map((r) => ({ key: r.key, label: r.label ?? r.key, count: Number(r.cnt) }));
}

/**
 * 2b — Çözüm kaynağı dağılımı. Dönemde ÇÖZÜLEN vakaların solution-step
 * kaynakları (persisted enum: ai_suggested_step / external_kb /
 * similar_case / manual). Join yerine subquery — baseWhere kolonları
 * [Case] tablosuna göre yazıldığından ambiguity çıkmasın.
 */
async function queryBySolutionStepSource(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return { rows: [], kbAssistedResolutionRate: null };
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT s.[source] AS [key], COUNT(*) AS cnt
    FROM [CaseSolutionStep] s
    WHERE s.[caseId] IN (
      SELECT [id] FROM [Case]
      WHERE ${baseWhere.sql}
        AND [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
    )
    GROUP BY s.[source]
    ORDER BY cnt DESC;
  `;
  const raw = await prisma.$queryRawUnsafe(sql, ...p2.params);
  const rows = raw.map((r) => ({ key: r.key, count: Number(r.cnt) }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  const kb = rows.find((r) => r.key === 'external_kb')?.count ?? 0;
  return {
    rows,
    kbAssistedResolutionRate: total > 0 ? Number((kb / total).toFixed(3)) : null,
  };
}

/**
 * 2c — Mail operasyonu: pending snapshot + dönem hacmi + first response
 * MEDYAN dakika (PERCENTILE_CONT — MSSQL native; window func olduğu için
 * DISTINCT hilesi).
 */
async function queryMailOps(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) {
    return { pendingCustomerReply: 0, inboundVolume: 0, outboundVolume: 0, firstResponseMedianMin: null };
  }
  const pendingSql = `
    SELECT COUNT(*) AS cnt FROM [Case]
    WHERE ${baseWhere.sql} AND [pendingCustomerReply] = 1;
  `;
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const volumeSql = `
    SELECT
      SUM(CASE WHEN e.[direction] = 'inbound'  AND e.[receivedAt] >= @P${p1.idx} AND e.[receivedAt] < @P${p2.idx} THEN 1 ELSE 0 END) AS inboundCnt,
      SUM(CASE WHEN e.[direction] = 'outbound' AND e.[sentAt]     >= @P${p1.idx} AND e.[sentAt]     < @P${p2.idx} THEN 1 ELSE 0 END) AS outboundCnt
    FROM [CaseEmail] e
    WHERE e.[caseId] IN (SELECT [id] FROM [Case] WHERE ${baseWhere.sql});
  `;
  const medianSql = `
    SELECT DISTINCT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY DATEDIFF(minute, [createdAt], [slaResponseMetAt])) OVER () AS med
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      AND [slaResponseMetAt] IS NOT NULL;
  `;
  const [pendingRows, volumeRows, medianRows] = await Promise.all([
    prisma.$queryRawUnsafe(pendingSql, ...baseWhere.params),
    prisma.$queryRawUnsafe(volumeSql, ...p2.params),
    prisma.$queryRawUnsafe(medianSql, ...p2.params),
  ]);
  const med = medianRows[0]?.med;
  return {
    pendingCustomerReply: Number(pendingRows[0]?.cnt ?? 0),
    inboundVolume: Number(volumeRows[0]?.inboundCnt ?? 0),
    outboundVolume: Number(volumeRows[0]?.outboundCnt ?? 0),
    firstResponseMedianMin: med === null || med === undefined ? null : Math.round(Number(med)),
  };
}

/**
 * 2d — Pattern alarm özeti. Alan adı `status` (state DEĞİL — spec Codex R1).
 * Spec sapma notu: "kaç kat" (multiplier) PatternAlert tablosunda persist
 * EDİLMİYOR (patternInsight runtime hesaplıyor) — deterministic aggregate
 * olarak caseCount döndürülür; UI/RUNA "N vakalık küme" der.
 */
async function queryPatternAlertSummary(scope) {
  if (scope.companyIds.length === 0) return { activeCount: 0, largestSpike: null };
  const [activeCount, largest] = await Promise.all([
    prisma.patternAlert.count({
      where: { companyId: { in: scope.companyIds }, status: 'active' },
    }),
    prisma.patternAlert.findFirst({
      where: { companyId: { in: scope.companyIds }, status: 'active' },
      orderBy: { caseCount: 'desc' },
      select: { category: true, caseCount: true },
    }),
  ]);
  return {
    activeCount,
    largestSpike: largest ? { category: largest.category, caseCount: largest.caseCount } : null,
  };
}

/**
 * 2e — QA ortalamaları. Min sample (qaScore=10) altında değerler NULL döner
 * (mevcut minSample deseni; violation kaydını compute tarafı düşer).
 */
async function queryQaAverages(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return { empathy: null, clarity: null, speed: null, sampleCount: 0 };
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT
      COUNT(*) AS n,
      AVG(CAST([qaEmpathyScore] AS FLOAT)) AS emp,
      AVG(CAST([qaClarityScore] AS FLOAT)) AS cla,
      AVG(CAST([qaSpeedScore]   AS FLOAT)) AS spd
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [qaScoredAt] >= @P${p1.idx} AND [qaScoredAt] < @P${p2.idx}
      AND [qaEmpathyScore] IS NOT NULL;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p2.params);
  const n = Number(rows[0]?.n ?? 0);
  if (n < MIN_SAMPLE.qaScore) {
    return { empathy: null, clarity: null, speed: null, sampleCount: n };
  }
  const r1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  return {
    empathy: r1(rows[0]?.emp),
    clarity: r1(rows[0]?.cla),
    speed: r1(rows[0]?.spd),
    sampleCount: n,
  };
}

/**
 * Aylık Bülten Faz A — A2 — Per-account / per-AccountCompany aggregate.
 *
 * Bir müşteri (Account) bültenine veri sağlar. Account birden fazla
 * şirkete (AccountCompany) bağlı olabilir; her şirket için ayrı satır:
 *   - count: dönemde açılan toplam vaka
 *   - resolvedCount: dönemde çözülen
 *   - avgResolutionMinutes: çözülen vakaların ortalama wall-clock süresi
 *     (mevcut avgResolutionWallClockHours paterni — paused-time düşülmez;
 *     tutarlılık için)
 *   - slaResolutionCompliantCount: resolvedAt ≤ slaResolutionDueAt
 *   - slaResponseCompliantCount: slaResponseMetAt ≤ slaResponseDueAt
 *
 * ⚠ CROSS-TENANT SCOPE LEAKAGE KORUMASI (P0):
 *   baseWhere.sql zaten companyId IN scope.companyIds filter'ı içerir.
 *   Account başka companyId'lere de bağlı olabilir; AMA scope dışındaki
 *   companyId'ler bu filter ile elenir. Yani account başka tenant'ta
 *   vaka açmışsa o vakalar bu bültende GÖRÜNMEZ.
 *
 *   accountId raw column parametre ile gider (SQL injection korunma).
 *
 * Frontend tek-şirketli account'ta firma dağılımı bloğunu gizler
 * (return 1 satır → blok render değil).
 */
async function queryByAccount(scope, filters, accountId, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  if (!accountId || typeof accountId !== 'string') return [];

  const p1 = withParam(baseWhere, accountId);
  const p2 = withParam(p1, from);
  const p3 = withParam(p2, to);
  const sql = `
    SELECT
      [companyId]                                        AS [key],
      COUNT(*)                                           AS cnt,
      SUM(CASE WHEN [resolvedAt] IS NOT NULL THEN 1 ELSE 0 END) AS resolvedCnt,
      AVG(CASE WHEN [resolvedAt] IS NOT NULL
               THEN DATEDIFF(MINUTE, [createdAt], [resolvedAt])
               ELSE NULL END)                             AS avgResolutionMin,
      SUM(CASE WHEN [resolvedAt] IS NOT NULL
                    AND [slaResolutionDueAt] IS NOT NULL
                    AND [resolvedAt] <= [slaResolutionDueAt]
               THEN 1 ELSE 0 END)                         AS slaResolutionCompliantCnt,
      SUM(CASE WHEN [slaResponseMetAt] IS NOT NULL
                    AND [slaResponseDueAt] IS NOT NULL
                    AND [slaResponseMetAt] <= [slaResponseDueAt]
               THEN 1 ELSE 0 END)                         AS slaResponseCompliantCnt,
      SUM(CASE WHEN [slaResponseMetAt] IS NOT NULL THEN 1 ELSE 0 END) AS responseMetCnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [accountId] = @P${p1.idx}
      AND [createdAt] >= @P${p2.idx} AND [createdAt] < @P${p3.idx}
    GROUP BY [companyId]
    ORDER BY cnt DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p3.params);
  return rows.map((r) => ({
    companyId: r.key,
    count: Number(r.cnt),
    resolvedCount: Number(r.resolvedCnt),
    avgResolutionMinutes: r.avgResolutionMin == null ? null : Number(r.avgResolutionMin),
    slaResolutionCompliantCount: Number(r.slaResolutionCompliantCnt),
    slaResponseCompliantCount: Number(r.slaResponseCompliantCnt),
    responseMetCount: Number(r.responseMetCnt),
  }));
}

async function queryByCaseType(scope, filters, from, to, baseWhere) {
  if (scope.companyIds.length === 0) return [];
  const p1 = withParam(baseWhere, from);
  const p2 = withParam(p1, to);
  const sql = `
    SELECT [caseType] AS [key], COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
    GROUP BY [caseType]
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
    SELECT [companyId] AS id, [companyName] AS name, COUNT(*) AS cnt
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
    GROUP BY [companyId], [companyName]
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
    SELECT TOP (${TOP_TEAM_LIMIT})
      [assignedTeamId] AS id,
      [assignedTeamName] AS name,
      COUNT(*) AS cnt,
      AVG(CASE WHEN [resolvedAt] IS NOT NULL AND [resolvedAt] > [createdAt]
        THEN CAST(DATEDIFF(SECOND, [createdAt], [resolvedAt]) AS float) / 3600.0 END) AS avg_ttr_hours
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
      AND [assignedTeamId] IS NOT NULL
    GROUP BY [assignedTeamId], [assignedTeamName]
    ORDER BY cnt DESC;
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
  const p3 = withArrayParam(p2, OPEN_STATUS_DB_VALUES);
  const sql = `
    SELECT TOP (${TOP_CATEGORY_LIMIT})
      [category]    AS category,
      [subCategory] AS sub_category,
      COUNT(*)      AS total,
      COUNT(CASE WHEN [status] IN (${p3.list}) THEN 1 END) AS open_count,
      AVG(CASE WHEN [resolvedAt] IS NOT NULL AND [resolvedAt] > [createdAt]
        THEN CAST(DATEDIFF(SECOND, [createdAt], [resolvedAt]) AS float) / 3600.0 END) AS avg_ttr_hours,
      COUNT(CASE WHEN [resolvedAt] >= @P${p1.idx} AND [resolvedAt] < @P${p2.idx}
        AND [slaViolation] = 1
      THEN 1 END) AS sla_breach_count
    FROM [Case]
    WHERE ${baseWhere.sql}
      AND [createdAt] >= @P${p1.idx} AND [createdAt] < @P${p2.idx}
    GROUP BY [category], [subCategory]
    ORDER BY total DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p3.params);
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
  const p1 = withArrayParam(baseWhere, OPEN_STATUS_DB_VALUES);

  const sql = `
    SELECT TOP (${TOP_AT_RISK_LIMIT})
      [accountId]   AS account_id,
      [accountName] AS account_name,
      [companyId]   AS company_id,
      COUNT(CASE WHEN [status] IN (${p1.list}) THEN 1 END) AS open_count,
      COUNT(CASE WHEN [slaViolation] = 1 THEN 1 END) AS sla_breach_count,
      COUNT(CASE WHEN [escalationLevel] <> 'Yok' THEN 1 END) AS escalated_count
    FROM [Case]
    WHERE ${baseWhere.sql}
    GROUP BY [accountId], [accountName], [companyId]
    HAVING
      COUNT(CASE WHEN [status] IN (${p1.list}) THEN 1 END) > 0
      OR COUNT(CASE WHEN [slaViolation] = 1 THEN 1 END) > 0
    ORDER BY
      COUNT(CASE WHEN [slaViolation] = 1 THEN 1 END) DESC,
      COUNT(CASE WHEN [status] IN (${p1.list}) THEN 1 END) DESC;
  `;
  const rows = await prisma.$queryRawUnsafe(sql, ...p1.params);
  return rows.map((r) => ({
    accountId: r.account_id,
    accountName: r.account_name,
    companyId: r.company_id,
    openCount: Number(r.open_count),
    slaBreachCount: Number(r.sla_breach_count),
    escalatedCount: Number(r.escalated_count),
  }));
}

// ---------- Aylık Bülten Faz A — public exports ----------

/**
 * Aylık Bülten A2/A3 — Account bazlı aggregate (frontend bulletin endpoint).
 *
 * scope: { companyIds: string[], canCrossCompanyAgg: bool }
 * accountId: bültenin müşterisi
 * from/to: dönem
 *
 * Return: queryByAccount sonucu (per-AccountCompany aggregate).
 *
 * Cross-tenant koruması: scope.companyIds filter baseWhere'de uygulanır;
 * account başka tenant'a ait companyId'lerde vakaya sahipse o satırlar
 * GÖRÜNMEZ.
 *
 * Bu helper aggregate() ana orchestrator'unu BYPASS eder — account-spesifik
 * bir kesit; cross-tenant overall hesabıyla karışmaz.
 */
export async function computeAccountBulletinAggregate({ scope, accountId, from, to }) {
  if (!scope || !Array.isArray(scope.companyIds) || scope.companyIds.length === 0) {
    return { perAccountCompany: [], totals: emptyAccountTotals() };
  }
  if (!accountId) {
    return { perAccountCompany: [], totals: emptyAccountTotals() };
  }
  const filters = { from, to };
  const baseWhere = buildWhereSql(scope, filters);
  const perAccountCompany = await queryByAccount(scope, filters, accountId, from, to, baseWhere);

  // Totals — frontend'de "tüm AccountCompany'ler toplam" satırı için.
  const totals = perAccountCompany.reduce((acc, row) => {
    acc.count += row.count;
    acc.resolvedCount += row.resolvedCount;
    acc.slaResolutionCompliantCount += row.slaResolutionCompliantCount;
    acc.slaResponseCompliantCount += row.slaResponseCompliantCount;
    acc.responseMetCount += row.responseMetCount;
    // avgResolutionMinutes weighted by resolvedCount
    if (row.avgResolutionMinutes != null && row.resolvedCount > 0) {
      acc._weightedSum += row.avgResolutionMinutes * row.resolvedCount;
      acc._weightCount += row.resolvedCount;
    }
    return acc;
  }, {
    count: 0,
    resolvedCount: 0,
    slaResolutionCompliantCount: 0,
    slaResponseCompliantCount: 0,
    responseMetCount: 0,
    _weightedSum: 0,
    _weightCount: 0,
  });
  const avgResolutionMinutes = totals._weightCount > 0
    ? totals._weightedSum / totals._weightCount
    : null;
  // SLA compliance % (A3 — paydaya yalnız set'li alanları al)
  const slaResolutionCompliancePct = totals.resolvedCount > 0
    ? (totals.slaResolutionCompliantCount / totals.resolvedCount) * 100
    : null;
  const slaResponseCompliancePct = totals.responseMetCount > 0
    ? (totals.slaResponseCompliantCount / totals.responseMetCount) * 100
    : null;

  return {
    perAccountCompany,
    totals: {
      count: totals.count,
      resolvedCount: totals.resolvedCount,
      avgResolutionMinutes,
      slaResolutionCompliantCount: totals.slaResolutionCompliantCount,
      slaResponseCompliantCount: totals.slaResponseCompliantCount,
      responseMetCount: totals.responseMetCount,
      slaResolutionCompliancePct,
      slaResponseCompliancePct,
    },
  };
}

function emptyAccountTotals() {
  return {
    count: 0,
    resolvedCount: 0,
    avgResolutionMinutes: null,
    slaResolutionCompliantCount: 0,
    slaResponseCompliantCount: 0,
    responseMetCount: 0,
    slaResolutionCompliancePct: null,
    slaResponseCompliancePct: null,
  };
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
