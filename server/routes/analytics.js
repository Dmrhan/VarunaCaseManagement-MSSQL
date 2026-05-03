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

export default router;
