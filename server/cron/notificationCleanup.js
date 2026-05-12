import { prisma } from '../db/client.js';

/**
 * CaseNotification retention cleanup.
 *
 * Davranis:
 *  - readAt NOT NULL ve 30 gunden eski olan satirlar silinir.
 *  - Okunmamis (readAt = null) satirlar ne kadar eski olursa olsun KORUNUR;
 *    kullanici hala drawer'da gormeli.
 *  - Tek bir DELETE; idempotent, hata sessiz dondurulur ve loglanir.
 *
 * Tetikleme:
 *  - POST /api/cron/notification-cleanup (CRON_SECRET ile)
 *  - Onerilen periyot: gunluk (02:30 UTC, qa-score-batch'ten sonra)
 *
 * Smoke Audit P2.4 / Phase 5a.
 */
const RETENTION_DAYS = 30;

export async function runNotificationCleanup() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const result = await prisma.caseNotification.deleteMany({
      where: {
        readAt: { not: null, lt: cutoff },
      },
    });
    console.log(
      `[cron:notification-cleanup] deleted=${result.count} cutoff=${cutoff.toISOString()}`,
    );
    return { ok: true, deleted: result.count, cutoff: cutoff.toISOString() };
  } catch (err) {
    console.error('[cron:notification-cleanup]', err);
    return { ok: false, error: err?.message ?? 'cleanup_failed' };
  }
}
