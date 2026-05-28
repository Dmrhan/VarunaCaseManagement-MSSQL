import { prisma } from '../db/client.js';

/**
 * ActionItem soft archive (Half-Shipped Audit PR-3 / OD-073).
 *
 * Eligibility rule:
 *   state IN ('Done', 'Dismissed', 'Expired')   -- terminal states
 *   AND archivedAt IS NULL                       -- not already archived
 *   AND updatedAt < cutoff                       -- 30 days from last
 *                                                   state change
 *
 * Davranis:
 *  - Uygun satirlar `archivedAt = now()` ile soft-archive edilir.
 *    **Asla DELETE yapilmaz.** Satirlar veritabaninda kalir; sadece
 *    aktif inbox queries `archivedAt: null` filtresiyle bunlari
 *    gizler. Deep-link veya audit replay scenario'larinda `findUnique`
 *    hala calisir.
 *  - `updatedAt` cutoff alani olarak kullanilir cunku:
 *    - `Done`/`Dismissed` satirlari hem `doneAt` hem `updatedAt`
 *      yazar (markDone/dismiss yollari)
 *    - `Expired` satirlari yalniz `state` guncellemesi yapar
 *      (`expireSiblingActionItemsForApproval`); `doneAt` set
 *      etmez ama `@updatedAt` otomatik kalksir. updatedAt evrensel.
 *  - Idempotent: ikinci run hicbir satiri tekrar archive etmez
 *    (archivedAt IS NULL filtresi).
 *
 * Tetikleme:
 *  - POST /api/cron/actionitem-archive (CRON_SECRET ile)
 *  - Onerilen periyot: gunluk 03:20 UTC
 *    (notification-cleanup 03:00 UTC'den sonra).
 */
const RETENTION_DAYS = 30;

export async function runActionItemArchive() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const result = await prisma.actionItem.updateMany({
      where: {
        state: { in: ['Done', 'Dismissed', 'Expired'] },
        archivedAt: null,
        updatedAt: { lt: cutoff },
      },
      data: { archivedAt: new Date() },
    });
    console.log(
      `[cron:actionitem-archive] archived=${result.count} cutoff=${cutoff.toISOString()}`,
    );
    return { ok: true, archived: result.count, cutoff: cutoff.toISOString() };
  } catch (err) {
    console.error('[cron:actionitem-archive]', err);
    return { ok: false, error: err?.message ?? 'archive_failed' };
  }
}
