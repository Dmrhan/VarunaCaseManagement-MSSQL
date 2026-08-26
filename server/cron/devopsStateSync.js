import { prisma } from '../db/client.js';
import { caseRepository } from '../db/caseRepository.js';

/**
 * DevOps state mirror — toplu gece senkronu.
 *
 * CSM'e bağlanan (customFields.devops) Azure DevOps / TFS work item'larının
 * CANLI state'ini çeker ve vakadaki saklı snapshot'ı günceller — böylece
 * "DevOps'ta ne durumdaysa (Closed/Resolved/…) vakada da o görünür". Per-case
 * canlı okuma (listDevopsLive) persist etmediği için saklı state bayatlıyordu;
 * bu job onu tazeler.
 *
 * KRİTİK: CSM vaka STATÜSÜNE dokunmaz (kapanış guard / SLA / bildirim
 * tetiklenmez) — yalnız bağlı work item snapshot'ını mirror'lar. State değişen
 * her item için CaseActivity düşer.
 *
 * Kapsam: ExternalDevOpsSetting.enabled=true olan her şirket. Varsayılan yalnız
 * terminal olmayan vakalar (onlyOpen) — "burada açık" kümesi.
 *
 * Tetikleme:
 *  - Zamanlanmış: her gün 03:15 (Europe/Istanbul) — cronScheduler.js
 *  - Manuel: POST /api/cron/devops-state-sync?dryRun=1&all=1 (CRON_SECRET)
 *
 * NOT: TFS erişimi PROD sunucunun DEVOPS_PAT_ENC_KEY + ağ erişimini gerektirir;
 * yerelden çalışmaz. İlk çalıştırmayı dryRun=1 ile yapıp changes listesini
 * gözden geçirmek önerilir.
 */
export async function runDevopsStateSync({ onlyOpen = true, dryRun = false } = {}) {
  const t0 = Date.now();
  try {
    const companies = await prisma.externalDevOpsSetting.findMany({
      where: { enabled: true },
      select: { companyId: true },
    });
    if (companies.length === 0) {
      return { ok: true, note: 'DevOps entegrasyonu açık şirket yok', companies: 0 };
    }
    const agg = { ok: true, dryRun, onlyOpen, companies: companies.length, scanned: 0, casesUpdated: 0, changes: 0, stale: false, errors: [] };
    for (const { companyId } of companies) {
      try {
        const s = await caseRepository.syncDevopsStates(companyId, { onlyOpen, dryRun });
        agg.scanned += s.scanned;
        agg.casesUpdated += s.casesUpdated;
        agg.changes += s.changes.length;
        if (s.stale) agg.stale = true;
        if (s.errors.length) agg.errors.push({ companyId, errors: s.errors.slice(0, 5) });
      } catch (err) {
        agg.errors.push({ companyId, code: 'company_sync_failed', message: String(err?.message ?? err).slice(0, 120) });
      }
    }
    agg.durationMs = Date.now() - t0;
    console.log(`[cron:devops-state-sync] ${JSON.stringify({ ...agg, errors: agg.errors.length }).slice(0, 300)}`);
    return agg;
  } catch (err) {
    console.error('[cron:devops-state-sync]', err?.message ?? err);
    return { ok: false, error: err?.message ?? 'devops_state_sync_failed' };
  }
}
