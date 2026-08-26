import { prisma } from '../db/client.js';

/**
 * rpt_TicketLifecycle materialized rapor tablosunu yeniler.
 *
 * Monitoring + Raporlama ekranları `dbo.rpt_TicketLifecycle` tablosundan okur
 * (bkz. server/routes/monitoring.js, reportViews.js). Tablo `dbo.usp_Refresh_
 * rpt_TicketLifecycle` (parametresiz) proc'u ile baştan doldurulur; son-refresh
 * damgası `dbo.rpt_TicketLifecycle_meta`'da tutulur.
 *
 * Eskiden yenileme gecelik bir SQL Agent job'ına bırakılmıştı — job koşmayınca
 * (SQL Agent yok/durmuş) veri takılı kalıyordu (ör. ekranlar 3 gün eski veriyi
 * gösterdi). Bu cron yenilemeyi doğrudan uygulama sürecinden garanti eder, SQL
 * Agent'a bağımlılığı kaldırır.
 *
 * Tetikleme: gecelik 04:00 (Europe/Istanbul), diğer gece job'larından sonra.
 * Proc tam yeniden-dolum yapar (~1 dk, ~160k satır) ve idempotenttir.
 */
export async function runRefreshTicketLifecycle() {
  const t0 = Date.now();
  try {
    await prisma.$executeRawUnsafe('EXEC dbo.usp_Refresh_rpt_TicketLifecycle');
    const meta = await prisma.$queryRawUnsafe(
      'SELECT refreshedAt, satirSayisi FROM dbo.rpt_TicketLifecycle_meta WHERE id = 1',
    );
    const row = Array.isArray(meta) ? meta[0] : null;
    const durationMs = Date.now() - t0;
    const satir = row?.satirSayisi != null ? Number(row.satirSayisi) : null;
    console.log(`[cron:rpt-lifecycle-refresh] ok satir=${satir ?? '?'} ${durationMs}ms`);
    return { ok: true, durationMs, satirSayisi: satir, refreshedAt: row?.refreshedAt ?? null };
  } catch (err) {
    console.error('[cron:rpt-lifecycle-refresh]', err);
    return { ok: false, error: err?.message ?? 'refresh_failed', durationMs: Date.now() - t0 };
  }
}
