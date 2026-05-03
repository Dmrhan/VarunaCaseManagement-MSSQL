import { prisma } from '../db/client.js';

/**
 * Pattern detection cron — Faz 1.5 Madde 5 (Bekçi rolü §5.5).
 *
 * Her 15 dk'da bir çalışır. Son 60 dk'daki vakaları companyId + category ile
 * gruplar, eşik (5) üstü ise PatternAlert üretir.
 *
 * Dedupe: aynı company+category için son 60 dk'da `active` alarm varsa
 * yeni alarm yaratılmaz — kullanıcı kapatana kadar tek alarm. Bu cron her 15
 * dk'da yeniden tetiklenmesin diye gerekli.
 *
 * Read-only: bu fonksiyon yalnızca alarm kaydı yazar; otomatik parent vaka
 * açma yok. Yönetici "Vakaları Gör" ile detayları inceler, dismiss eder.
 *
 * Tetikleme:
 *  - Production: GitHub Actions her 15 dk POST /api/cron/pattern-detect
 *    (Authorization: Bearer ${CRON_SECRET}). UptimeRobot ya da Vercel Cron
 *    da aynı endpoint'i tetikleyebilir.
 *  - Local/CLI: `node server/cron/patternDetect.js`
 */

const WINDOW_MINUTES = 60;
const THRESHOLD = 5;

export async function runPatternDetect() {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  // Aynı şirket + kategori için son N dk'daki vaka sayısı
  const groups = await prisma.case.groupBy({
    by: ['companyId', 'category'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const triggered = groups.filter((g) => g._count._all >= THRESHOLD);
  if (triggered.length === 0) {
    return { detected: 0, alerts: [] };
  }

  const created = [];
  for (const g of triggered) {
    // Dedupe: aynı company+category için son window içinde active alarm yoksa yarat
    const existing = await prisma.patternAlert.findFirst({
      where: {
        companyId: g.companyId,
        category: g.category,
        status: 'active',
        detectedAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) continue;

    // Tetikleyici vaka id'lerini topla (read-only audit için)
    const caseRows = await prisma.case.findMany({
      where: {
        companyId: g.companyId,
        category: g.category,
        createdAt: { gte: since },
      },
      select: { id: true },
      take: 100, // pratik üst sınır (alarm noise değil veri)
    });

    const alert = await prisma.patternAlert.create({
      data: {
        companyId: g.companyId,
        category: g.category,
        caseCount: g._count._all,
        windowMinutes: WINDOW_MINUTES,
        caseIds: caseRows.map((c) => c.id),
      },
    });
    created.push({
      id: alert.id,
      companyId: alert.companyId,
      category: alert.category,
      caseCount: alert.caseCount,
    });
  }

  if (created.length > 0) {
    console.log(`[cron:pattern-detect] ${created.length} new alert(s):`, created);
  }
  return { detected: created.length, alerts: created };
}

// CLI runner — manuel test için
if (import.meta.url === `file://${process.argv[1]}`) {
  runPatternDetect()
    .then((r) => {
      console.log('[cron:pattern-detect] done', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[cron:pattern-detect] failed', err);
      process.exit(1);
    });
}
