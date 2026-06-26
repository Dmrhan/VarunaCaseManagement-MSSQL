/**
 * Mail M3 — IMAP polling.
 *
 * REUSE EDİLEN MEVCUT MODÜLLER (yeni parser/intake/config YAZILMADI):
 *  - server/lib/inboundMailParser.js    → parseInboundEml(raw)
 *  - server/lib/inboundMailIntake.js    → intakeInboundEmail({parsed, companyId, ...})
 *  - server/db/externalMailSettingRepository.js
 *      → resolveActiveConfig(companyId) (M5 — secret decrypt + imap config)
 *  - server/lib/secretCipher.js (M5 reuse — repo'da decrypt)
 *
 * Davranış:
 *  1) enabled + imapHost dolu ExternalMailSetting'leri al (her biri bir tenant).
 *  2) Her mailbox: bağlan → INBOX UNSEEN çek → her mesaj için:
 *     a) Auto-reply/bounce filter → vaka AÇMA, log
 *     b) parseInboundEml(raw) → intakeInboundEmail(parsed, {companyId, ...})
 *     c) başarılı intake → \Seen işaretle (idempotency primary)
 *     d) başarısız intake → \Seen YAPMA + in-memory quarantine
 *        (process restart'ta sıfırlanır; sonsuz döngü engellenir)
 *  3) Hata izolasyonu: bir mailbox/mail patlarsa diğerleri etkilenmez.
 *
 * Idempotency:
 *  - PRIMARY: IMAP \Seen flag — UNSEEN search zaten \Seen olmayanları çeker.
 *    Başarılı intake sonrası \Seen → sonraki poll'de görmez.
 *  - SECONDARY: in-memory failedQuarantine (uid+messageId). Başarısız intake
 *    poll içinde tekrar gelirse retry sayacı artar; maxRetry sonrası bu poll
 *    cycle'ında atlanır. Process restart sonrası sıfır (kabul: \Seen primary
 *    dedup).
 *
 * Tetikleme: scripts/cron veya server/cronScheduler.js'den periyodik;
 * env MAIL_IMAP_POLL_INTERVAL_SEC > 0 → cron aktif, default kapalı.
 * Manuel tetik: POST /api/admin/external-mail-settings/:companyId/poll
 * (SystemAdmin guard'lı).
 *
 * Stil: server/lib/mailProvider.js + devopsClient.js ile aynı.
 */

import { ImapFlow } from 'imapflow';
import { parseInboundEml } from './inboundMailParser.js';
import { intakeInboundEmail } from './inboundMailIntake.js';
import { prisma } from '../db/client.js';

const RAW_SOURCE = 'imap-poller';

// IMAP bağlantı timeout — host ulaşılamazsa hızlı fail.
const IMAP_CONNECT_TIMEOUT_MS = 15000;

// In-memory quarantine: process lifetime'ı. Map<companyId, Set<key>>
// key = `${uid}:${messageId}`. Aynı poll cycle'ında tekrar gelirse atlanır;
// sonsuz döngü guard'ı.
const failedQuarantine = new Map();

// İşleme limiti: tek poll'de en fazla N mesaj (DoS koruması).
const MAX_MESSAGES_PER_POLL = 100;

// Sistem actor (intake için zorunlu).
const SYSTEM_ACTOR = Object.freeze({
  userId: null,
  personId: null,
  fullName: 'Mail Intake Bot (IMAP)',
  email: null,
  role: null,
  displayName: 'system:mail-intake-imap',
});

export class ImapPollerError extends Error {
  constructor(message, { code = 'imap_poller_error', status = 500 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Auto-reply / bounce / no-reply filter — vaka AÇMA, log.
 *
 * Sinyaller:
 *  - Auto-Submitted header (auto-replied / auto-generated)
 *  - From: mailer-daemon / postmaster
 *  - From: no-reply / noreply local-part
 *  - Subject: 'Auto:', 'Out of office', 'Delivery Status Notification'
 *
 * Agresif allowlist M3.1 — şimdilik conservative.
 */
function isAutoReplyOrBounce(parsed, rawHeaders) {
  const fromEmail = (parsed?.from?.email ?? '').toLowerCase();
  const subject = (parsed?.subject ?? '').toLowerCase();
  const headers = String(rawHeaders ?? '').toLowerCase();

  // Auto-Submitted header (RFC 3834)
  if (/^auto-submitted:\s*(auto-replied|auto-generated|auto-notified)/m.test(headers)) {
    return { skip: true, reason: 'auto_submitted' };
  }
  // mailer-daemon / postmaster bounce
  if (/^(mailer-daemon|postmaster)@/.test(fromEmail)) {
    return { skip: true, reason: 'bounce_sender' };
  }
  // no-reply local-part
  if (/^(no-?reply|donotreply|noreply)@/.test(fromEmail)) {
    return { skip: true, reason: 'no_reply_sender' };
  }
  // Common auto-reply subjects (TR + EN)
  if (
    subject.startsWith('auto:')
    || subject.includes('out of office')
    || subject.includes('ofiste değilim')
    || subject.includes('automatic reply')
    || subject.includes('delivery status notification')
    || subject.includes('undeliverable')
  ) {
    return { skip: true, reason: 'auto_reply_subject' };
  }
  return { skip: false };
}

/**
 * Tek bir tenant mailbox'unu poll eder.
 *
 * @param {string} companyId
 * @returns {Promise<{
 *   ok: boolean,
 *   companyId: string,
 *   stats: { fetched: number, intaken: number, skipped: number, failed: number },
 *   error?: { code, message }
 * }>}
 */
export async function pollMailbox(companyId) {
  const startedAt = new Date().toISOString();
  const stats = { fetched: 0, intaken: 0, skipped: 0, failed: 0 };

  if (!companyId) {
    return {
      ok: false,
      companyId: null,
      stats,
      error: { code: 'imap_company_required', message: 'companyId zorunlu.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  // Lazy import: cross-circular kaçınma (mailProvider zaten dynamic eder).
  const repoMod = await import('../db/externalMailSettingRepository.js');
  const repo = repoMod.externalMailSettingRepo;
  const config = await repo.resolveActiveConfig(companyId);
  if (!config) {
    return {
      ok: false,
      companyId,
      stats,
      error: { code: 'mail_config_missing', message: 'ExternalMailSetting bulunamadı.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }
  if (config.enabled !== true) {
    return {
      ok: false,
      companyId,
      stats,
      error: { code: 'mail_integration_disabled', message: 'Mail entegrasyonu kapalı.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }
  if (!config.imapHost || !config.username || !config.secret) {
    return {
      ok: false,
      companyId,
      stats,
      error: { code: 'imap_config_incomplete', message: 'imapHost + username + secret zorunlu.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  // Company adı intake için zorunlu.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true },
  });
  if (!company) {
    return {
      ok: false,
      companyId,
      stats,
      error: { code: 'company_not_found', message: 'Company bulunamadı.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort || 993,
    secure: true, // M3 — IMAPS standart 993; STARTTLS desteği M3.1
    auth: { user: config.username, pass: config.secret },
    logger: false,
    socketTimeout: IMAP_CONNECT_TIMEOUT_MS,
  });

  // Codex hotfix — ImapFlow EventEmitter; 'error' event'i unhandled
  // kalırsa Node process'i crash eder (örn. authenticationFailed sonrası
  // internal close() çağrısı NoConnection throw eder, error emit edilir).
  // Listener ekleyerek process'i koruyoruz; logging defensive.
  client.on('error', (err) => {
    console.warn(`[imap-poll] client error companyId=${companyId}`,
      err?.code ?? err?.message);
  });

  let quarantine = failedQuarantine.get(companyId);
  if (!quarantine) {
    quarantine = new Map(); // key → retryCount
    failedQuarantine.set(companyId, quarantine);
  }

  try {
    await client.connect();
  } catch (err) {
    return {
      ok: false,
      companyId,
      stats,
      error: {
        code: 'imap_connect_failed',
        message: err?.message ?? 'IMAP bağlantı hatası.',
      },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // UNSEEN search — { uid: true } ZORUNLU.
      //
      // Codex #205 P1 (kritik) — search default'u SEQUENCE numarası döndürür;
      // mailbox dolu/silme/expunge sonrası sequence ≠ UID olur. Aşağıda
      // fetchOne(uid, { uid: true }) ve messageFlagsAdd(uid, ..., { uid: true })
      // UID modunda çalışıyor → search da UID modunda olmalı. Aksi halde
      // yanlış mesaj `\Seen` işaretlenir, işlenen mail UNSEEN kalır → her
      // poll'de DUPLICATE vaka açılır.
      const uids = await client.search({ seen: false }, { uid: true });
      const limited = (uids ?? []).slice(0, MAX_MESSAGES_PER_POLL);
      stats.fetched = limited.length;

      for (const uid of limited) {
        let rawSource = null;
        let messageId = null;
        let qKey = null;
        try {
          // Önce minimal fetch ile message-id'yi al; quarantine kontrolü.
          //
          // Codex #205 P1 follow-up (kritik) — ImapFlow.fetchOne signature:
          //   fetchOne(range, query, options)
          // UID modu **3. argüman** (options). Önceki kullanım:
          //   fetchOne(uid, { uid: true, source: true })
          // burada query objesindeki `uid: true` SILENTLY IGNORE oluyor →
          // range default sequence number gibi yorumlanıyor → UID modunda
          // gelen search sonucuyla uyuşmaz → yanlış/eksik mesaj fetch'i +
          // doğru UID `\Seen` işaretlenir → kaybolan ya da yanlış intake.
          const headerFetch = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!headerFetch || !headerFetch.source) {
            stats.skipped += 1;
            continue;
          }
          rawSource = headerFetch.source;

          // Parse (parser headers'ı normalize eder)
          const parseResult = await parseInboundEml(rawSource);
          if (!parseResult.ok) {
            stats.skipped += 1;
            console.warn(`[imap-poll] parse fail companyId=${companyId} uid=${uid}`,
              parseResult.error?.code);
            continue;
          }
          messageId = parseResult.data?.messageId ?? null;
          qKey = `${uid}:${messageId ?? ''}`;

          // Quarantine retry guard: sonsuz döngü engelle
          const retryCount = quarantine.get(qKey) ?? 0;
          if (retryCount >= 3) {
            stats.skipped += 1;
            console.warn(`[imap-poll] quarantined uid=${uid} messageId=${messageId} retries=${retryCount}`);
            continue;
          }

          // Auto-reply / bounce filter
          // Ham source string olabilir veya Buffer; ilk 2KB header için yeterli
          const headerSlice = Buffer.isBuffer(rawSource)
            ? rawSource.slice(0, 2048).toString('utf8')
            : String(rawSource).slice(0, 2048);
          const autoFilter = isAutoReplyOrBounce(parseResult.data, headerSlice);
          if (autoFilter.skip) {
            // Auto-reply olarak \Seen işaretle (vaka açma); idempotency için.
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
            stats.skipped += 1;
            console.log(`[imap-poll] auto-filter companyId=${companyId} uid=${uid} reason=${autoFilter.reason}`);
            continue;
          }

          // Intake (M2)
          const intakeResult = await intakeInboundEmail({
            parsed: parseResult.data,
            companyId,
            companyName: company.name,
            actor: SYSTEM_ACTOR,
          });

          if (intakeResult.ok) {
            // Başarılı → \Seen
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            stats.intaken += 1;
            // Başarılıysa quarantine'den temizle
            quarantine.delete(qKey);
          } else {
            // Başarısız → \Seen YAPMA + retry counter
            quarantine.set(qKey, retryCount + 1);
            stats.failed += 1;
            console.warn(`[imap-poll] intake fail companyId=${companyId} uid=${uid}`,
              intakeResult.error?.code, intakeResult.error?.message);
          }
        } catch (msgErr) {
          stats.failed += 1;
          if (qKey) quarantine.set(qKey, (quarantine.get(qKey) ?? 0) + 1);
          console.error(`[imap-poll] message error companyId=${companyId} uid=${uid}`,
            msgErr?.message);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    return {
      ok: false,
      companyId,
      stats,
      error: {
        code: 'imap_poll_error',
        message: err?.message ?? 'IMAP poll hatası.',
      },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    ok: true,
    companyId,
    stats,
    meta: { startedAt, rawSource: RAW_SOURCE },
  };
}

/**
 * Tüm enabled tenant'lar için polling. Hata izolasyonu: bir mailbox patlarsa
 * diğerleri etkilenmez.
 *
 * @returns {Promise<{ ok: true, results: Array<{companyId, ok, stats, error?}> }>}
 */
export async function pollAllEnabledMailboxes() {
  const startedAt = new Date().toISOString();
  // enabled=true AND imapHost dolu tenant'ları al
  const enabledTenants = await prisma.externalMailSetting.findMany({
    where: { enabled: true, imapHost: { not: null } },
    select: { companyId: true },
  });

  const results = [];
  for (const t of enabledTenants) {
    try {
      const r = await pollMailbox(t.companyId);
      results.push(r);
    } catch (err) {
      results.push({
        ok: false,
        companyId: t.companyId,
        stats: { fetched: 0, intaken: 0, skipped: 0, failed: 0 },
        error: { code: 'imap_poll_isolation_error', message: err?.message ?? 'isolation error' },
      });
    }
  }

  return {
    ok: true,
    results,
    meta: { startedAt, rawSource: RAW_SOURCE, tenantCount: enabledTenants.length },
  };
}

/**
 * Periyodik polling başlatma seam'i (cronScheduler içinden çağrılır).
 * env MAIL_IMAP_POLL_INTERVAL_SEC > 0 → setInterval aktif. Default kapalı.
 */
let intervalHandle = null;

export function startImapPollingInterval() {
  if (intervalHandle) return; // zaten aktif
  const sec = Number.parseInt(process.env.MAIL_IMAP_POLL_INTERVAL_SEC ?? '0', 10);
  if (!Number.isFinite(sec) || sec <= 0) {
    console.log('[imap-poll] interval kapalı (MAIL_IMAP_POLL_INTERVAL_SEC=0 veya tanımsız).');
    return;
  }
  console.log(`[imap-poll] interval aktif — her ${sec} saniyede pollAllEnabledMailboxes`);
  intervalHandle = setInterval(() => {
    pollAllEnabledMailboxes()
      .then((r) => {
        const summary = (r.results ?? []).map((x) => ({
          c: x.companyId,
          ok: x.ok,
          ...x.stats,
        }));
        console.log('[imap-poll:tick]', JSON.stringify(summary).slice(0, 500));
      })
      .catch((err) => {
        console.error('[imap-poll:tick] hata:', err?.message);
      });
  }, sec * 1000);
}

export function stopImapPollingInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// Test'ler için iç state'i resetlemek üzere export.
export function _resetQuarantineForTest() {
  failedQuarantine.clear();
}

export const imapPoller = {
  pollMailbox,
  pollAllEnabledMailboxes,
  startImapPollingInterval,
  stopImapPollingInterval,
};
