import { Router } from 'express';
import { prisma } from '../db/client.js';
import { verifyJwt, requireRole } from '../db/auth.js';

/**
 * /api/analytics/* — supervisor + admin + sysadmin ROI panoları.
 * Faz 1.5 Madde 7: AI Kullanım Panosu.
 */

const router = Router();

router.use(verifyJwt, requireRole('Supervisor', 'Admin', 'SystemAdmin'));

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
router.get('/ai-usage', async (req, res) => {
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
router.get('/qa-scores', async (req, res) => {
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
router.get('/patterns', async (req, res) => {
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
router.patch('/patterns/:id/dismiss', async (req, res) => {
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

export default router;
