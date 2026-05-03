import { caseRepository } from '../db/caseRepository.js';

/**
 * Snooze wakeup cron — her 5 dakikada bir çağrılır.
 *
 * snoozeUntil <= now olan vakaları toplar, status=Acik'e döner (Cozuldu/
 * IptalEdildi olanları korur), CaseActivity'ye log üretir, snooze alanlarını
 * temizler. Sonuç { woken, ids } olarak döner — log/monitor için.
 *
 * Tetikleme:
 *  - Production: Vercel Cron (vercel.json'da `*\/5 * * * *`) → POST
 *    /api/cases/cron/snooze-wakeup, x-cron-secret header'ıyla.
 *  - Local dev/manuel: bu fonksiyon doğrudan çağrılabilir
 *    (`tsx server/cron/snoozeWakeup.js` veya admin paneli).
 *
 * Idempotent: snoozeUntil null olanlar where'de eşleşmez; aynı dakika içinde
 * iki kez tetiklenirse ikincisi 0 vaka uyandırır.
 */
export async function runSnoozeWakeup() {
  const result = await caseRepository.processSnoozeWakeups();
  if (result.woken > 0) {
    console.log(`[cron:snooze-wakeup] woke ${result.woken} cases:`, result.ids);
  }
  return result;
}

// CLI runner: `node server/cron/snoozeWakeup.js` ile manuel çalıştırma.
if (import.meta.url === `file://${process.argv[1]}`) {
  runSnoozeWakeup()
    .then((r) => {
      console.log('[cron:snooze-wakeup] done', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[cron:snooze-wakeup] failed', err);
      process.exit(1);
    });
}
