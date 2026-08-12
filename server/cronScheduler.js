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

// Sistem Sağlığı (2026-07-10) — in-memory son-çalışma kaydı. schedule()
// sarmalayıcısı her koşuda günceller; /api/system/health bunu okuyup
// "cron X gündür koşmadı" tespitini mümkün kılar. Süreç restart'ında
// sıfırlanır (bilinçli: kayıt sadece canlı sürecin gözlemi, kalıcı audit
// değil). Job mantığına SIFIR dokunuş — yalnızca gözlem.
const cronRuns = new Map(); // name -> { expr, lastStartAt, lastEndAt, ok, note }

export function getCronRuns() {
  return Array.from(cronRuns.entries()).map(([name, r]) => ({ name, ...r }));
}

function schedule(name, expr, fn) {
  cronRuns.set(name, { expr, lastStartAt: null, lastEndAt: null, ok: null, note: 'henüz koşmadı (süreç yeni)' });
  cron.schedule(
    expr,
    async () => {
      const rec = cronRuns.get(name) ?? { expr };
      rec.lastStartAt = new Date().toISOString();
      try {
        const result = await fn();
        rec.ok = true;
        rec.note = JSON.stringify(result ?? {}).slice(0, 120);
        console.log(`[cron:${name}]`, JSON.stringify(result ?? {}).slice(0, 300));
      } catch (err) {
        rec.ok = false;
        rec.note = String(err?.message ?? err).slice(0, 120);
        console.error(`[cron:${name}] hata:`, err?.message ?? err);
      } finally {
        rec.lastEndAt = new Date().toISOString();
        cronRuns.set(name, rec);
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
