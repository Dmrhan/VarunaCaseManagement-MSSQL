import { prisma } from '../db/client.js';
import { caseRepository } from '../db/caseRepository.js';
import { fetchConnections, isTeamViewerConfigured } from '../lib/teamviewerClient.js';

/**
 * Uzak Destek reconcile — "Bağlantı Al" işaretlerini TeamViewer gerçek süresiyle eşler.
 *
 * pending/ambiguous CaseRemoteSession satırlarını, TeamViewer bağlantı raporuyla
 * (deviceid == customerTvId + temsilci + başlangıç ± pencere) eşleyip gerçek
 * start/end/durationSec'i yazar. TeamViewer hesap-genelinde tek raporu bir kez
 * çekip tüm şirketlere paylaşır.
 *
 * Tetikleme:
 *  - Zamanlanmış: her gün 03:20 (Europe/Istanbul) — cronScheduler.js
 *  - Manuel: POST /api/cron/remote-session-reconcile?dryRun=1 (CRON_SECRET)
 *
 * NOT: TeamViewer erişimi TEAMVIEWER_API_TOKEN (+ "View connection reports"
 * scope) gerektirir. Token yoksa no-op döner.
 */
export async function runRemoteSessionReconcile({ dryRun = false, lookbackHours = 72 } = {}) {
  const t0 = Date.now();
  if (!isTeamViewerConfigured()) {
    return { ok: true, note: 'TEAMVIEWER_API_TOKEN yok — atlandı' };
  }
  try {
    const since = new Date(Date.now() - lookbackHours * 3600 * 1000);
    // Bekleyen işareti olan şirketler
    const rows = await prisma.caseRemoteSession.findMany({
      where: { matchState: { in: ['pending', 'ambiguous'] }, startedAt: { gte: since } },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    if (rows.length === 0) {
      return { ok: true, note: 'bekleyen uzak oturum yok', companies: 0, durationMs: Date.now() - t0 };
    }
    // TeamViewer raporunu bir kez çek (hesap-geneli)
    const conn = await fetchConnections({ from: since, to: new Date() });
    if (!conn.ok) {
      return { ok: false, error: conn.error?.message ?? 'teamviewer_fetch_failed' };
    }
    const agg = { ok: true, dryRun, companies: rows.length, matched: 0, ambiguous: 0, stillPending: 0, unmatched: 0, errors: [] };
    for (const { companyId } of rows) {
      try {
        const s = await caseRepository.reconcileRemoteSessions(companyId, { dryRun, lookbackHours, connections: conn.records });
        agg.matched += s.matched; agg.ambiguous += s.ambiguous;
        agg.stillPending += s.stillPending; agg.unmatched += s.unmatched;
      } catch (err) {
        agg.errors.push({ companyId, message: String(err?.message ?? err).slice(0, 120) });
      }
    }
    agg.durationMs = Date.now() - t0;
    console.log(`[cron:remote-session-reconcile] ${JSON.stringify({ ...agg, errors: agg.errors.length }).slice(0, 300)}`);
    return agg;
  } catch (err) {
    console.error('[cron:remote-session-reconcile]', err?.message ?? err);
    return { ok: false, error: err?.message ?? 'remote_session_reconcile_failed' };
  }
}
