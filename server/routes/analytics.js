import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { verifyJwt, requireRole } from '../db/auth.js';
import { computeOperationsOverview } from '../analytics/operationsAggregator.js';
import { computeMonthlyBulletin } from '../analytics/bulletinAggregator.js';
import { FORMULA_VERSION } from '../analytics/metricFormulas.js';
import {
  deriveAnalyticsScope,
  describeScope,
  scopeFingerprint,
  filterFingerprint,
} from '../analytics/scopeDerivation.js';
import {
  validateDrilldownBucket,
  buildDrilldownWhere,
  buildDrilldownOrderBy,
  mapDrilldownCase,
  bucketLabel,
} from '../analytics/drilldownQuery.js';

/**
 * /api/analytics/* — supervisor + admin + sysadmin ROI panoları.
 * Faz 1.5 Madde 7: AI Kullanım Panosu.
 */

const router = Router();

router.use(verifyJwt);

const requireSupervisorAnalytics = requireRole('Supervisor', 'Admin', 'SystemAdmin');
const requireOverviewAnalytics = requireRole(
  'Agent',
  'Backoffice',
  'CSM',
  'Supervisor',
  'Admin',
  'SystemAdmin',
);

// Manuel aksiyon ortalama süresi (s) — kategori önerme/manuel arama vb. için
// kabaca tahmin. ROI raporu "tasarruf edilen dakika" hesabında kullanılır.
const SECONDS_PER_MANUAL_ACTION = 28;

/**
 * GET /api/analytics/ai-usage?period=7d|30d
 * Response: { totalCalls, byEndpoint[], acceptanceRate, avgResponseMs,
 *             dailyTrend[], estimatedTimeSavedMin }
 *
 * Multi-tenant: req.user.allowedCompanyIds scope filter (SystemAdmin için
 * verifyJwt zaten tüm aktif şirketlerle dolduruyor).
 */
router.get('/ai-usage', requireSupervisorAnalytics, async (req, res) => {
  try {
    const period = req.query.period === '30d' ? 30 : 7;
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    const scope = { companyId: { in: req.user.allowedCompanyIds }, createdAt: { gte: since } };

    // Toplu metrikler
    const [totalCalls, decidedCount, acceptedCount, avgRespAgg, byEndpointRaw, byEndpointAccepted, dailyRaw] =
      await Promise.all([
        prisma.aIUsageLog.count({ where: scope }),
        prisma.aIUsageLog.count({ where: { ...scope, accepted: { not: null } } }),
        prisma.aIUsageLog.count({ where: { ...scope, accepted: true } }),
        prisma.aIUsageLog.aggregate({
          where: { ...scope, responseTimeMs: { not: null } },
          _avg: { responseTimeMs: true },
        }),
        prisma.aIUsageLog.groupBy({
          by: ['endpoint'],
          where: scope,
          _count: { _all: true },
          _avg: { responseTimeMs: true },
        }),
        // Endpoint başına accepted sayıları (ayrı sorgu — Prisma'da nested
        // accepted=true filter groupBy'da desteklenmiyor)
        prisma.aIUsageLog.groupBy({
          by: ['endpoint'],
          where: { ...scope, accepted: true },
          _count: { _all: true },
        }),
        prisma.aIUsageLog.groupBy({
          by: ['createdAt'],
          where: scope,
          _count: { _all: true },
        }),
      ]);

    // Endpoint başına acceptedDecided ekle
    const acceptedByEndpoint = await prisma.aIUsageLog.groupBy({
      by: ['endpoint'],
      where: { ...scope, accepted: { not: null } },
      _count: { _all: true },
    });
    const acceptedMap = new Map(acceptedByEndpoint.map((r) => [r.endpoint, r._count._all]));
    const acceptedTrueMap = new Map(byEndpointAccepted.map((r) => [r.endpoint, r._count._all]));

    const byEndpoint = byEndpointRaw
      .map((r) => {
        const decided = acceptedMap.get(r.endpoint) ?? 0;
        const accepted = acceptedTrueMap.get(r.endpoint) ?? 0;
        return {
          endpoint: r.endpoint,
          count: r._count._all,
          acceptRate: decided > 0 ? Math.round((accepted / decided) * 100) : null,
          avgResponseMs: r._avg.responseTimeMs ? Math.round(r._avg.responseTimeMs) : null,
        };
      })
      .sort((a, b) => b.count - a.count);

    // Daily trend — gün bazında bucketle
    const buckets = new Map();
    for (let i = 0; i < period; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const r of dailyRaw) {
      const key = new Date(r.createdAt).toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + r._count._all);
    }
    const dailyTrend = Array.from(buckets.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      totalCalls,
      acceptanceRate: decidedCount > 0 ? Math.round((acceptedCount / decidedCount) * 100) : null,
      avgResponseMs: avgRespAgg._avg.responseTimeMs ? Math.round(avgRespAgg._avg.responseTimeMs) : null,
      estimatedTimeSavedMin: Math.round((acceptedCount * SECONDS_PER_MANUAL_ACTION) / 60),
      byEndpoint,
      dailyTrend,
    });
  } catch (e) {
    console.error('[analytics:ai-usage]', e);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * GET /api/analytics/qa-scores?period=7d|30d
 * Faz 1.5 Madde 4 — agent başına ortalama empati/clarity/speed + companyAvg
 * + top/bottom agent. allowedCompanyIds scope.
 */
router.get('/qa-scores', requireSupervisorAnalytics, async (req, res) => {
  try {
    const period = req.query.period === '30d' ? 30 : 7;
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

    const rows = await prisma.case.findMany({
      where: {
        companyId: { in: req.user.allowedCompanyIds },
        qaScoredAt: { gte: since, not: null },
      },
      select: {
        assignedPersonId: true,
        assignedPersonName: true,
        qaEmpathyScore: true,
        qaClarityScore: true,
        qaSpeedScore: true,
      },
    });

    if (rows.length === 0) {
      return res.json({
        scoredCaseCount: 0,
        byAgent: [],
        companyAvg: { empathy: null, clarity: null, speed: null, overall: null },
        topAgent: null,
        bottomAgent: null,
      });
    }

    // Agent groupBy + ortalama (JS-side; Prisma groupBy multi-field _avg sınırlı)
    const byAgentMap = new Map();
    let totalEmp = 0, totalCla = 0, totalSpd = 0;
    for (const c of rows) {
      const emp = c.qaEmpathyScore ?? 0;
      const cla = c.qaClarityScore ?? 0;
      const spd = c.qaSpeedScore ?? 0;
      totalEmp += emp; totalCla += cla; totalSpd += spd;
      const k = c.assignedPersonId ?? '__unassigned__';
      if (!byAgentMap.has(k)) {
        byAgentMap.set(k, {
          agentId: c.assignedPersonId,
          agentName: c.assignedPersonName ?? 'Atanmamış',
          caseCount: 0,
          empSum: 0,
          claSum: 0,
          spdSum: 0,
        });
      }
      const a = byAgentMap.get(k);
      a.caseCount++;
      a.empSum += emp;
      a.claSum += cla;
      a.spdSum += spd;
    }
    const byAgent = [...byAgentMap.values()].map((a) => ({
      agentId: a.agentId,
      agentName: a.agentName,
      caseCount: a.caseCount,
      avgEmpathy: round1(a.empSum / a.caseCount),
      avgClarity: round1(a.claSum / a.caseCount),
      avgSpeed: round1(a.spdSum / a.caseCount),
      avgOverall: round1((a.empSum + a.claSum + a.spdSum) / (a.caseCount * 3)),
    })).sort((a, b) => b.avgOverall - a.avgOverall);

    const n = rows.length;
    const companyAvg = {
      empathy: round1(totalEmp / n),
      clarity: round1(totalCla / n),
      speed: round1(totalSpd / n),
      overall: round1((totalEmp + totalCla + totalSpd) / (n * 3)),
    };

    res.json({
      scoredCaseCount: n,
      byAgent,
      companyAvg,
      topAgent: byAgent[0] ?? null,
      bottomAgent: byAgent.length > 1 ? byAgent[byAgent.length - 1] : null,
    });
  } catch (e) {
    console.error('[analytics:qa-scores]', e);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * GET /api/analytics/patterns?status=active|all
 * Default: status=active. allowedCompanyIds scope. Faz 1.5 Madde 5.
 */
router.get('/patterns', requireSupervisorAnalytics, async (req, res) => {
  try {
    const status = req.query.status === 'all' ? undefined : 'active';
    const where = { companyId: { in: req.user.allowedCompanyIds } };
    if (status) where.status = status;
    const items = await prisma.patternAlert.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take: 100,
    });
    res.json({ value: items, '@odata.count': items.length });
  } catch (e) {
    console.error('[analytics:patterns]', e);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * PATCH /api/analytics/patterns/:id/dismiss — yönetici alarmı kapatır.
 * Yetki: companyId scope (Supervisor/Admin/SystemAdmin guard zaten router'da).
 */
router.patch('/patterns/:id/dismiss', requireSupervisorAnalytics, async (req, res) => {
  try {
    const target = await prisma.patternAlert.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Alarm bulunamadı.' });
    if (!req.user.allowedCompanyIds.includes(target.companyId)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (target.status === 'dismissed') {
      return res.json({ id: target.id, status: target.status, alreadyDismissed: true });
    }
    const updated = await prisma.patternAlert.update({
      where: { id: req.params.id },
      data: {
        status: 'dismissed',
        dismissedBy: req.user.id,
        dismissedAt: new Date(),
      },
    });
    res.json({ id: updated.id, status: updated.status });
  } catch (e) {
    console.error('[analytics:patterns:dismiss]', e);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Operations Intelligence Dashboard — Phase 1
// docs/OPERATIONS_DASHBOARD_DESIGN.md §2.1, §2.6
// ─────────────────────────────────────────────────────────────────

const MAX_PERIOD_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DRILLDOWN_PAGE_SIZE = 200;

/**
 * POST /api/analytics/cases/overview
 *
 * Body:
 *  {
 *    from:   ISO UTC,   // zorunlu
 *    to:     ISO UTC,   // zorunlu
 *    companies?: string[],   // opsiyonel — scope icinde daraltma
 *    teams?:     string[],   // opsiyonel
 *    productGroups?: string[],
 *    caseTypes?: string[],
 *    statuses?:  string[],
 *    granularity?: 'day'
 *  }
 *
 * Response (§2.1 + §2.6.6):
 *  - asOf, asOfLocal, formulaVersion, timezone
 *  - scope (silent-narrow ve metadata icerir)
 *  - appliedFilters echo
 *  - kpis, breakdown'lar, timeSeries
 *  - minSampleViolations, notAvailable, approximations
 *  - metricAuditId
 */
router.post('/cases/overview', requireOverviewAnalytics, async (req, res) => {
  const t0 = Date.now();
  try {
    const body = req.body ?? {};

    // 1) Validation — from/to zorunlu + 90 gun cap
    const validation = validateOverviewBody(body);
    if (validation.error) {
      return res.status(400).json({ error: 'invalid_input', message: validation.error });
    }
    const { from, to } = validation;

    // 2) Scope derivation (§2.2A) — server-side, body filter genisletemez
    const scope = deriveAnalyticsScope(req.user, body);

    const filters = {
      from: from.toISOString(),
      to: to.toISOString(),
      productGroups: sanitizeStringArray(body.productGroups),
      caseTypes:     sanitizeStringArray(body.caseTypes),
      statuses:      sanitizeStringArray(body.statuses),
      granularity:   body.granularity === 'hour' ? 'hour' : 'day',
    };

    // 3) Aggregator cagrisi (deterministic)
    const payload = await computeOperationsOverview({ scope, filters });

    // 4) Audit
    const fpScope = scopeFingerprint(scope);
    const fpFilter = filterFingerprint({
      from: filters.from,
      to: filters.to,
      companies: scope.companyIds,
      teams: scope.teamIds,
      productGroups: filters.productGroups,
      caseTypes: filters.caseTypes,
      statuses: filters.statuses,
      granularity: filters.granularity,
    });
    const durationMs = Date.now() - t0;
    const responseHash = hashResponse(payload);

    let metricAuditId = null;
    try {
      const audit = await prisma.metricQueryAudit.create({
        data: {
          userId: req.user.id,
          userRole: req.user.role,
          endpoint: 'cases-overview',
          scopeFingerprint: fpScope,
          scopeKind: scope.scopeKind,
          filterFingerprint: fpFilter,
          formulaVersion: FORMULA_VERSION,
          durationMs,
          responseHash,
        },
        select: { id: true },
      });
      metricAuditId = audit.id;
    } catch (err) {
      // Audit yazimi ana akisi durdurmaz
      console.warn('[analytics:overview] audit write failed:', err?.message ?? err);
    }

    // 5) Response — scope metadata + audit id
    res.json({
      ...payload,
      scope: {
        kind: scope.scopeKind,
        companyIds: scope.companyIds,
        teamIds: scope.teamIds,
        personIds: scope.personIds,
        canExport: scope.canExport,
        canCrossCompanyAgg: scope.canCrossCompanyAgg,
        narrowedFromBody: scope.narrowedFromBody,
        narrative: describeScope(scope),
        effectiveScopeReason: scope.effectiveScopeReason,
      },
      metricAuditId,
    });
  } catch (err) {
    console.error('[analytics:cases-overview]', err);
    res.status(500).json({
      error: 'internal',
      message: err?.message ?? 'Operasyon ozeti hesaplanamadi',
    });
  }
});

/**
 * POST /api/analytics/cases/drilldown
 *
 * Aynı overview filter set'i + bucket alır ve scope-bound vaka listesi döner.
 * Phase 3: dashboard drawer/table için deterministic evidence listesi.
 */
router.post('/cases/drilldown', requireOverviewAnalytics, async (req, res) => {
  const t0 = Date.now();
  try {
    const body = req.body ?? {};
    const validation = validateOverviewBody(body);
    if (validation.error) {
      return res.status(400).json({ error: 'invalid_input', message: validation.error });
    }
    const bucket = validateDrilldownBucket(body.bucket);
    if (bucket.error) {
      return res.status(400).json({ error: 'invalid_bucket', message: bucket.error });
    }

    const { from, to } = validation;
    const scope = deriveAnalyticsScope(req.user, body);
    const filters = {
      from: from.toISOString(),
      to: to.toISOString(),
      productGroups: sanitizeStringArray(body.productGroups),
      caseTypes:     sanitizeStringArray(body.caseTypes),
      statuses:      sanitizeStringArray(body.statuses),
      granularity:   body.granularity === 'hour' ? 'hour' : 'day',
    };
    const page = sanitizePositiveInt(body.page, 1);
    const pageSize = Math.min(sanitizePositiveInt(body.pageSize, 50), MAX_DRILLDOWN_PAGE_SIZE);
    const sortBy = sanitizeSortBy(body.sortBy);
    const sortDir = body.sortDir === 'asc' ? 'asc' : 'desc';

    const where = buildDrilldownWhere({
      scope,
      filters,
      from,
      to,
      bucket: bucket.value,
    });
    const orderBy = buildDrilldownOrderBy(sortBy, sortDir);

    const [total, rows] = await Promise.all([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priority: true,
          companyName: true,
          accountName: true,
          category: true,
          subCategory: true,
          assignedTeamName: true,
          assignedPersonName: true,
          createdAt: true,
          slaResolutionDueAt: true,
          slaViolation: true,
        },
      }),
    ]);

    const fpScope = scopeFingerprint(scope);
    const fpFilter = filterFingerprint({
      from: filters.from,
      to: filters.to,
      companies: scope.companyIds,
      teams: scope.teamIds,
      productGroups: filters.productGroups,
      caseTypes: filters.caseTypes,
      statuses: filters.statuses,
      bucket: bucket.value,
      page,
      pageSize,
      sortBy,
      sortDir,
    });
    const durationMs = Date.now() - t0;
    let metricAuditId = null;
    try {
      const audit = await prisma.metricQueryAudit.create({
        data: {
          userId: req.user.id,
          userRole: req.user.role,
          endpoint: 'cases-drilldown',
          scopeFingerprint: fpScope,
          scopeKind: scope.scopeKind,
          filterFingerprint: fpFilter,
          formulaVersion: FORMULA_VERSION,
          durationMs,
          responseHash: crypto.createHash('sha256').update(`${total}:${bucket.value.kind}`).digest('hex').slice(0, 16),
        },
        select: { id: true },
      });
      metricAuditId = audit.id;
    } catch (err) {
      console.warn('[analytics:drilldown] audit write failed:', err?.message ?? err);
    }

    res.json({
      items: rows.map(mapDrilldownCase),
      total,
      page,
      pageSize,
      sortBy,
      sortDir,
      appliedBucket: {
        ...bucket.value,
        label: bucketLabel(bucket.value),
      },
      scope: {
        kind: scope.scopeKind,
        companyIds: scope.companyIds,
        teamIds: scope.teamIds,
        personIds: scope.personIds,
        canExport: scope.canExport,
        canCrossCompanyAgg: scope.canCrossCompanyAgg,
        narrowedFromBody: scope.narrowedFromBody,
        narrative: describeScope(scope),
        effectiveScopeReason: scope.effectiveScopeReason,
      },
      metricAuditId,
      durationMs,
    });
  } catch (err) {
    console.error('[analytics:cases-drilldown]', err);
    res.status(500).json({
      error: 'internal',
      message: err?.message ?? 'Drill-down listesi hesaplanamadi',
    });
  }
});

// ---------- helpers (overview) ----------

function validateOverviewBody(body) {
  if (!body.from || !body.to) {
    return { error: '`from` ve `to` ISO tarihi zorunlu.' };
  }
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: '`from`/`to` gecerli ISO tarih degil.' };
  }
  if (from.getTime() >= to.getTime()) {
    return { error: '`from` `to`dan kucuk olmali.' };
  }
  const diffDays = (to.getTime() - from.getTime()) / ONE_DAY_MS;
  if (diffDays > MAX_PERIOD_DAYS) {
    return { error: `Periyot max ${MAX_PERIOD_DAYS} gun olabilir.` };
  }
  return { from, to };
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return null;
  const clean = value.filter((v) => typeof v === 'string' && v.length > 0).slice(0, 100);
  return clean.length > 0 ? clean : null;
}

function sanitizePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

function sanitizeSortBy(value) {
  return ['createdAt', 'priority', 'slaResolutionDueAt', 'ageHours'].includes(value)
    ? value
    : 'createdAt';
}

// drilldown bucket validator + Prisma where + map fonksiyonlari shared module:
// server/analytics/drilldownQuery.js. Tek allowlist + tek query mantigi —
// Phase 4b AI drilldown-assist endpoint'i ile birlikte ayni dosyayi kullanir.

function hashResponse(payload) {
  // Sadece KPI degerlerinin hash'i — replay/diff icin yeterli
  const subset = JSON.stringify(payload.kpis ?? {});
  return crypto.createHash('sha256').update(subset).digest('hex').slice(0, 16);
}

// ──────────────────────────────────────────────────────────────────
// Aylık Müşteri Bülteni (Faz A — A4) endpoint
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/analytics/monthly-bulletin
 *
 * Body: { accountId, from (ISO), to (ISO) }
 *
 * Response: computeMonthlyBulletin payload (account-scoped byStatus4 +
 * byPriority + byRequestType + byOrigin + byCategory + perAccountCompany
 * + totals + snoozedActiveCount + meta).
 *
 * Yetki: Agent/Backoffice/CSM/Supervisor/Admin/SystemAdmin — overview
 * paneli ile aynı (mevcut requireOverviewAnalytics).
 *
 * Cross-tenant scope leakage koruması:
 *   - deriveAnalyticsScope req.user.allowedCompanyIds'i baz alır
 *   - aggregator baseWhere.sql [companyId] IN scope.companyIds zorunlu
 *   - account başka tenant'a bağlı vakalara sahipse o satırlar görünmez
 *
 * Privacy: response'ta customerContact* veya customerCompanyName YOK
 * (mevcut aggregator zaten bunları döndürmez; sadece aggregate sayımlar).
 */
router.post('/monthly-bulletin', requireOverviewAnalytics, async (req, res) => {
  const t0 = Date.now();
  try {
    const body = req.body ?? {};

    // 1) Validation — accountId + from/to + 90-gün cap (mevcut helper reuse)
    if (!body.accountId || typeof body.accountId !== 'string') {
      return res.status(400).json({ error: 'invalid_input', message: 'accountId zorunlu.' });
    }
    const validation = validateOverviewBody(body);
    if (validation.error) {
      return res.status(400).json({ error: 'invalid_input', message: validation.error });
    }
    const { from, to } = validation;

    // 2) Scope derivation (§2.2A) — server-side
    //
    // Codex P1 — Bülten "müşteri için" bir rapor; "agent'ın baktığı vakalar"
    // DEĞİL. deriveAnalyticsScope CSM/Agent için scopeKind='self' +
    // personIds=[user.personId] döndürür ve buildWhereSql
    // [assignedPersonId] IN scope.personIds filter ekler — bu durumda
    // müşterinin BAŞKA agent'ların baktığı vakaları sızar (SILENT eksik
    // bülten).
    //
    // Fix: bulletin endpoint'inde personIds + teamIds filter'ını BYPASS et.
    // Cross-tenant koruması scope.companyIds + account.companyId ∩ scope
    // intersection ile zaten yerinde (4-katmanlı guard).
    //
    // Supervisor için aynı: teamIds=[supervisedTeams] filter müşterinin
    // başka takım vakalarını sızdırır → temizle.
    const rawScope = deriveAnalyticsScope(req.user, body);
    const scope = {
      ...rawScope,
      personIds: [],
      teamIds: [],
      // scopeKind sadece audit log'da kullanılır; bilgi amaçlı korunur.
    };

    // 3) Account scope check — accountId kullanıcının erişim alanında mı?
    //    Account.companyId scope.companyIds içinde olmalı (cross-tenant
    //    bülten engeli). Account birden fazla companyId'ye bağlı olabilir;
    //    en az birinin scope'ta olması yeterli.
    const account = await prisma.account.findUnique({
      where: { id: body.accountId },
      select: {
        id: true,
        name: true,
        companyId: true, // legacy ana companyId
        accountCompanies: {
          select: { companyId: true },
        },
      },
    });
    if (!account) {
      return res.status(404).json({ error: 'account_not_found' });
    }
    const accountCompanyIds = [
      account.companyId,
      ...account.accountCompanies.map((ac) => ac.companyId),
    ].filter(Boolean);
    const scopeIntersection = accountCompanyIds.filter((cid) =>
      scope.companyIds.includes(cid),
    );
    if (scopeIntersection.length === 0) {
      // Cross-tenant erişim engellendi — account'un bağlı olduğu hiç
      // şirket kullanıcının scope'unda değil.
      return res.status(403).json({ error: 'account_out_of_scope' });
    }

    // 4) Orchestrator çağrısı (deterministic; tüm breakdown'lar account-scoped)
    const payload = await computeMonthlyBulletin({
      scope,
      accountId: body.accountId,
      from: from.toISOString(),
      to: to.toISOString(),
    });

    // 5) Response — account meta + payload
    res.json({
      ...payload,
      account: {
        ...payload.account,
        name: account.name,
      },
      scope: {
        kind: scope.scopeKind,
        companyIds: scope.companyIds,
        canExport: scope.canExport,
        narrative: describeScope(scope),
      },
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[analytics:monthly-bulletin]', err?.message, err?.stack);
    res.status(500).json({ error: 'internal_error', message: err?.message ?? 'beklenmeyen hata' });
  }
});

export default router;
