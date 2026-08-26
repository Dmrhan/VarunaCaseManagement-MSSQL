import { prisma } from '../db/client.js';

/**
 * Monitoring (Yönetici Raporlama) snapshot yenileme.
 *
 * Monitoring panosu `dbo.rpt_TicketLifecycle` fiziksel snapshot tablosundan
 * okur (canlı view her sorguda linked-server TFS + cross-DB KA join'ini
 * tekrarladığı için 30-40sn sürüyordu; indeksli snapshot milisaniye). Snapshot
 * kendi kendine tazelenmez — bu job onu geceleri yeniden kurar.
 *
 * Davranış:
 *  - `EXEC dbo.usp_Refresh_rpt_TicketLifecycle` çağrılır (TRUNCATE + rebuild +
 *    dbo.rpt_TicketLifecycle_meta.refreshedAt/satirSayisi güncelle). Proc
 *    idempotent; her koşu tam yeniden kurar.
 *  - Tamamlanınca meta'dan refreshedAt + satırSayısı okunup loglanır.
 *  - Hata sessiz döndürülür ve loglanır (ana süreç etkilenmez).
 *
 * Tetikleme:
 *  - Zamanlanmış: her gün 03:00 (Europe/Istanbul) — cronScheduler.js
 *  - Manuel: POST /api/cron/monitoring-snapshot (CRON_SECRET ile, routes/cron.js)
 *
 * NOT: Rebuild ~1-2 dk sürebilir (cross-DB/linked-server join). Gece penceresi
 * bu yüzden seçildi; eşzamanlı ikinci tetik proc içinde TRUNCATE'e denk gelirse
 * geçici tutarsız okuma olabilir — bu yüzden manuel tetiği job saatine yakın
 * çalıştırmaktan kaçının.
 */
export async function runMonitoringSnapshot() {
  const t0 = Date.now();
  try {
    await prisma.$executeRawUnsafe('EXEC dbo.usp_Refresh_rpt_TicketLifecycle');
    const meta = await prisma.$queryRawUnsafe(
      'SELECT CONVERT(varchar(19), refreshedAt, 120) AS refreshedAt, satirSayisi FROM dbo.rpt_TicketLifecycle_meta WHERE id = 1',
    );
    const row = meta?.[0] ?? {};
    const satir = typeof row.satirSayisi === 'bigint' ? Number(row.satirSayisi) : row.satirSayisi;
    const durationMs = Date.now() - t0;
    console.log(
      `[cron:monitoring-snapshot] ok refreshedAt=${row.refreshedAt} rows=${satir} ${(durationMs / 1000).toFixed(1)}s`,
    );
    return { ok: true, refreshedAt: row.refreshedAt ?? null, rows: satir ?? null, durationMs };
  } catch (err) {
    console.error('[cron:monitoring-snapshot]', err?.message ?? err);
    return { ok: false, error: err?.message ?? 'monitoring_snapshot_failed' };
  }
}
