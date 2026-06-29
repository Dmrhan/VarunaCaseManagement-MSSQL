import cron from 'node-cron';
import { runSnoozeWakeup } from './cron/snoozeWakeup.js';
import { runPatternDetect } from './cron/patternDetect.js';
import { runQaScoreBatch } from './cron/qaScoreBatch.js';
import { runNotificationCleanup } from './cron/notificationCleanup.js';
import { runActionItemArchive } from './cron/actionItemArchive.js';
import { runSlaBreachSweep } from './cron/slaBreachSweep.js';
import { startImapPollingInterval } from './lib/imapPoller.js';

/**
 * On-prem cron scheduler (Faz 5) — Vercel Cron / UptimeRobot / GitHub Actions
 * tetiklerinin yerini alır: job'lar doğrudan Express sürecinde zamanlanır.
 *
 * - Tüm job'lar idempotent (mevcut tasarım) — restart sonrası çakışma riski yok.
 * - HTTP cron endpoint'leri (routes/cron.js, CRON_SECRET ile) manuel tetik
 *   için duruyor; bu scheduler onların zamanlanmış karşılığı.
 * - Kapatmak için: CRON_SCHEDULER_ENABLED=false (örn. job'ları harici bir
 *   zamanlayıcıdan — Windows Task Scheduler — tetiklemek istersen).
 *
 * Zamanlama (Europe/Istanbul):
 *   her 5 dk   → snooze-wakeup        (ertelenen vakaları uyandır)
 *   her 15 dk  → pattern-detect       (vaka kümeleri → PatternAlert)
 *   02:00      → qa-score-batch       (AI QA skorlama; OPENAI_API_KEY yoksa no-op)
 *   03:00      → notification-cleanup (30 günden eski okunmuş bildirimler)
 *   03:30      → actionitem-archive   (kapanmış eylem öğelerini arşivle)
 */

const TZ = 'Europe/Istanbul';

function schedule(name, expr, fn) {
  cron.schedule(
    expr,
    async () => {
      try {
        const result = await fn();
        console.log(`[cron:${name}]`, JSON.stringify(result ?? {}).slice(0, 300));
      } catch (err) {
        console.error(`[cron:${name}] hata:`, err?.message ?? err);
      }
    },
    { timezone: TZ },
  );
}

export function startCronScheduler() {
  if (String(process.env.CRON_SCHEDULER_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.log('[cron] scheduler kapalı (CRON_SCHEDULER_ENABLED=false).');
    return;
  }
  schedule('snooze-wakeup', '*/5 * * * *', runSnoozeWakeup);
  schedule('pattern-detect', '*/15 * * * *', runPatternDetect);
  schedule('sla-breach-sweep', '*/5 * * * *', runSlaBreachSweep);
  schedule('qa-score-batch', '0 2 * * *', runQaScoreBatch);
  schedule('notification-cleanup', '0 3 * * *', runNotificationCleanup);
  schedule('actionitem-archive', '30 3 * * *', runActionItemArchive);
  // Mail M3 — IMAP polling. env MAIL_IMAP_POLL_INTERVAL_SEC > 0 → aktif;
  // default kapalı. imapPoller.js içinde setInterval yönetimi (manuel
  // tetik admin POST /external-mail-settings/:companyId/poll).
  startImapPollingInterval();
  console.log('[cron] scheduler aktif: snooze 5dk, pattern 15dk, sla-breach 5dk, qa 02:00, cleanup 03:00, archive 03:30 (Europe/Istanbul).');
}
