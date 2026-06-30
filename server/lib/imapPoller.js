/**
 * Mail M3 — IMAP polling (Multi-Inbox A2 refactor).
 *
 * REUSE EDİLEN MEVCUT MODÜLLER (yeni parser/intake/config YAZILMADI):
 *  - server/lib/inboundMailParser.js    → parseInboundEml(raw)
 *  - server/lib/inboundMailIntake.js    → intakeInboundEmail({parsed, companyId, ...})
 *  - server/db/externalMailInboxRepository.js
 *      → externalMailInboxRepo.listEnabled() / listEnabledByCompany(companyId)
 *      → getDecryptedSecret(companyId, inboxId)
 *  - server/lib/secretCipher.js (M5 reuse — repo'da decrypt)
 *
 * A2 değişimi:
 *  - Eski: 1 tenant → 1 mailbox (ExternalMailSetting.companyId @unique)
 *  - Yeni: 1 tenant → N inbox (ExternalMailInbox; her biri AYRI IMAP hesabı +
 *    AYRI takım routing). Polling artık inbox-bazlı; aynı tenant'ın iki
 *    inbox'u ayrı IMAP bağlantısı kurar, ayrı quarantine taşır.
 *
 * Davranış:
 *  1) externalMailInboxRepo.listEnabled() → enabled + isActive + imapHost
 *     dolu TÜM inbox'lar (cross-tenant). Her satır bir IMAP hesabı.
 *  2) Her inbox: bağlan → INBOX UNSEEN çek → her mesaj için:
 *     a) Auto-reply/bounce filter → vaka AÇMA, log
 *     b) parseInboundEml(raw) → intakeInboundEmail(parsed, {companyId, inboxId, ...})
 *     c) başarılı intake → \Seen işaretle (idempotency primary)
 *     d) başarısız intake → \Seen YAPMA + in-memory quarantine
 *        (process restart'ta sıfırlanır; sonsuz döngü engellenir)
 *  3) Hata izolasyonu: bir inbox patlarsa AYNI TENANT'IN diğer inbox'ları
 *     ve diğer tenant'lar etkilenmez.
 *
 * Backward compat:
 *  - pollMailbox(companyId) — eski manuel poll endpoint için korunur;
 *    tenant'ın TÜM enabled inbox'larını sıralı poll'lar, aggregate stats döner.
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
import { externalMailInboxRepo } from '../db/externalMailInboxRepository.js';

const RAW_SOURCE = 'imap-poller';

// IMAP bağlantı timeout — host ulaşılamazsa hızlı fail.
const IMAP_CONNECT_TIMEOUT_MS = 15000;

// In-memory quarantine: process lifetime'ı. Map<inboxId, Map<key, retryCount>>
// key = `${uid}:${messageId}`. Aynı poll cycle'ında tekrar gelirse atlanır;
// sonsuz döngü guard'ı.
//
// A2 — Eski: Map<companyId, ...> idi; multi-inbox'ta aynı tenant'ın N inbox'u
// arasında quarantine çakışırdı (UID'ler farklı mailbox'larda olabilir).
// Şimdi: inboxId scope'lu.
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
 * Tek bir inbox'u poll eder (A2 — multi-inbox primitive).
 *
 * @param {object} inbox - externalMailInboxRepo public shape (secret hariç)
 *   { id, companyId, address, imapHost, imapPort, imapSecure, username, ... }
 * @returns {Promise<{
 *   ok: boolean,
 *   companyId: string,
 *   inboxId: string,
 *   address: string,
 *   stats: { fetched: number, intaken: number, skipped: number, failed: number },
 *   error?: { code, message }
 * }>}
 */
export async function pollInbox(inbox) {
  const startedAt = new Date().toISOString();
  const stats = { fetched: 0, intaken: 0, skipped: 0, failed: 0 };

  if (!inbox || !inbox.id || !inbox.companyId) {
    return {
      ok: false,
      companyId: inbox?.companyId ?? null,
      inboxId: inbox?.id ?? null,
      address: inbox?.address ?? null,
      stats,
      error: { code: 'inbox_invalid', message: 'inbox + companyId zorunlu.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  const { id: inboxId, companyId, address } = inbox;

  if (inbox.enabled !== true) {
    return {
      ok: false,
      companyId,
      inboxId,
      address,
      stats,
      error: { code: 'inbox_disabled', message: 'Inbox polling kapalı.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }
  if (!inbox.imapHost || !inbox.username) {
    return {
      ok: false,
      companyId,
      inboxId,
      address,
      stats,
      error: { code: 'imap_config_incomplete', message: 'imapHost + username zorunlu.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  // Secret decrypt — repo getDecryptedSecret(companyId, inboxId).
  // Bu çağrı raw password'ü RAM'e alır; bağlantı kurulana kadar tutulur,
  // sonra GC'ye bırakılır (ImapFlow auth.pass kapsamı dışına çıkar).
  const secret = await externalMailInboxRepo.getDecryptedSecret(companyId, inboxId);
  if (!secret) {
    return {
      ok: false,
      companyId,
      inboxId,
      address,
      stats,
      error: { code: 'imap_secret_missing', message: 'Inbox secret set edilmemiş.' },
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
      inboxId,
      address,
      stats,
      error: { code: 'company_not_found', message: 'Company bulunamadı.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  const client = new ImapFlow({
    host: inbox.imapHost,
    port: inbox.imapPort || 993,
    secure: inbox.imapSecure !== false, // default true (IMAPS 993). false => STARTTLS değil; non-secure çıplak (lab/test only)
    auth: { user: inbox.username, pass: secret },
    logger: false,
    socketTimeout: IMAP_CONNECT_TIMEOUT_MS,
  });

  // Codex hotfix — ImapFlow EventEmitter; 'error' event'i unhandled
  // kalırsa Node process'i crash eder (örn. authenticationFailed sonrası
  // internal close() çağrısı NoConnection throw eder, error emit edilir).
  // Listener ekleyerek process'i koruyoruz; logging defensive.
  client.on('error', (err) => {
    console.warn(`[imap-poll] client error inboxId=${inboxId} companyId=${companyId} address=${address}`,
      err?.code ?? err?.message);
  });

  // Quarantine scope: A2'de companyId yerine inboxId. Aynı tenant'ın
  // farklı inbox'larında UID çakışmasını engeller.
  let quarantine = failedQuarantine.get(inboxId);
  if (!quarantine) {
    quarantine = new Map(); // key → retryCount
    failedQuarantine.set(inboxId, quarantine);
  }

  try {
    await client.connect();
  } catch (err) {
    return {
      ok: false,
      companyId,
      inboxId,
      address,
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
            console.warn(`[imap-poll] parse fail inboxId=${inboxId} companyId=${companyId} uid=${uid}`,
              parseResult.error?.code);
            continue;
          }
          messageId = parseResult.data?.messageId ?? null;
          qKey = `${uid}:${messageId ?? ''}`;

          // Quarantine retry guard: sonsuz döngü engelle
          const retryCount = quarantine.get(qKey) ?? 0;
          if (retryCount >= 3) {
            stats.skipped += 1;
            console.warn(`[imap-poll] quarantined inboxId=${inboxId} uid=${uid} messageId=${messageId} retries=${retryCount}`);
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
            console.log(`[imap-poll] auto-filter inboxId=${inboxId} companyId=${companyId} uid=${uid} reason=${autoFilter.reason}`);
            continue;
          }

          // Intake (M2) — A2: inboxId routing için propagate.
          // A3'te intakeInboundEmail bu inboxId'yi alıp assignedTeamId
          // çözecek (havuz routing).
          const intakeResult = await intakeInboundEmail({
            parsed: parseResult.data,
            companyId,
            companyName: company.name,
            inboxId,
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
            console.warn(`[imap-poll] intake fail inboxId=${inboxId} companyId=${companyId} uid=${uid}`,
              intakeResult.error?.code, intakeResult.error?.message);
          }
        } catch (msgErr) {
          stats.failed += 1;
          if (qKey) quarantine.set(qKey, (quarantine.get(qKey) ?? 0) + 1);
          console.error(`[imap-poll] message error inboxId=${inboxId} companyId=${companyId} uid=${uid}`,
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
      inboxId,
      address,
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
    inboxId,
    address,
    stats,
    meta: { startedAt, rawSource: RAW_SOURCE },
  };
}

/**
 * Tenant'ın TÜM enabled inbox'larını sıralı poll'lar (BACKWARD COMPAT).
 *
 * Eski API — manuel poll endpoint (POST /api/admin/external-mail-settings/:companyId/poll)
 * SystemAdmin guard'lı. A2'den önce 1 tenant = 1 mailbox idi, dolayısıyla
 * tek satır config dönerdi. Şimdi tenant'ın N inbox'u olabilir → hepsi
 * sıralı poll'lanır, sonuçlar liste olarak döner.
 *
 * @param {string} companyId
 * @returns {Promise<{
 *   ok: boolean,
 *   companyId: string,
 *   stats: { fetched, intaken, skipped, failed },  // aggregate
 *   inboxResults: Array<pollInboxReturn>,
 *   error?: { code, message }
 * }>}
 */
export async function pollMailbox(companyId) {
  const startedAt = new Date().toISOString();
  const aggStats = { fetched: 0, intaken: 0, skipped: 0, failed: 0 };

  if (!companyId) {
    return {
      ok: false,
      companyId: null,
      stats: aggStats,
      inboxResults: [],
      error: { code: 'imap_company_required', message: 'companyId zorunlu.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  const inboxes = await externalMailInboxRepo.listEnabledByCompany(companyId);
  if (inboxes.length === 0) {
    return {
      ok: false,
      companyId,
      stats: aggStats,
      inboxResults: [],
      error: { code: 'no_enabled_inboxes', message: 'Tenant\'ın aktif inbox\'ı yok.' },
      meta: { startedAt, rawSource: RAW_SOURCE },
    };
  }

  const inboxResults = [];
  for (const inbox of inboxes) {
    try {
      const r = await pollInbox(inbox);
      inboxResults.push(r);
      if (r.stats) {
        aggStats.fetched += r.stats.fetched;
        aggStats.intaken += r.stats.intaken;
        aggStats.skipped += r.stats.skipped;
        aggStats.failed += r.stats.failed;
      }
    } catch (err) {
      // Hata izolasyonu — bir inbox patlarsa aynı tenant'ın diğer inbox'ları
      // etkilenmez.
      inboxResults.push({
        ok: false,
        companyId,
        inboxId: inbox.id,
        address: inbox.address,
        stats: { fetched: 0, intaken: 0, skipped: 0, failed: 0 },
        error: { code: 'imap_poll_isolation_error', message: err?.message ?? 'isolation error' },
      });
    }
  }

  // Backward-compat ok: en az 1 inbox başarılı ise ok=true
  const ok = inboxResults.some((r) => r.ok === true);

  return {
    ok,
    companyId,
    stats: aggStats,
    inboxResults,
    meta: { startedAt, rawSource: RAW_SOURCE, inboxCount: inboxes.length },
  };
}

/**
 * Tüm enabled inbox'lar için polling (cross-tenant). Hata izolasyonu:
 * bir inbox patlarsa diğerleri etkilenmez.
 *
 * @returns {Promise<{ ok: true, results: Array<pollInboxReturn> }>}
 */
export async function pollAllEnabledMailboxes() {
  const startedAt = new Date().toISOString();
  // enabled=true AND isActive=true AND imapHost dolu TÜM inbox'lar (cross-tenant)
  const enabledInboxes = await externalMailInboxRepo.listEnabled();

  const results = [];
  for (const inbox of enabledInboxes) {
    try {
      const r = await pollInbox(inbox);
      results.push(r);
    } catch (err) {
      results.push({
        ok: false,
        companyId: inbox.companyId,
        inboxId: inbox.id,
        address: inbox.address,
        stats: { fetched: 0, intaken: 0, skipped: 0, failed: 0 },
        error: { code: 'imap_poll_isolation_error', message: err?.message ?? 'isolation error' },
      });
    }
  }

  return {
    ok: true,
    results,
    meta: { startedAt, rawSource: RAW_SOURCE, inboxCount: enabledInboxes.length },
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
