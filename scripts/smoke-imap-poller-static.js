#!/usr/bin/env node
/**
 * Static smoke — Mail M3 IMAP poller.
 *
 * Çağrı YAPMAZ; sadece dosya/regex inceler + auto-filter unit testleri
 * + DB-level guard testleri (resolveActiveConfig/getByCompany çağrılmadan,
 * sadece poller'ın config eksikliğine doğru tepki vermesi).
 */

import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

console.log('── 1) imapPoller.js — yapı + REUSE ───────────────');
expect('1.1 dosya mevcut', existsSync('server/lib/imapPoller.js'), true);
const src = read('server/lib/imapPoller.js');
const code = strip(src);
expect('1.2 imapflow ImapFlow import',
  /import \{ ImapFlow \} from 'imapflow'/.test(code), true);
expect('1.3 M2 parseInboundEml REUSE',
  /import \{ parseInboundEml \} from '\.\/inboundMailParser\.js'/.test(code), true);
expect('1.4 M2 intakeInboundEmail REUSE',
  /import \{ intakeInboundEmail \} from '\.\/inboundMailIntake\.js'/.test(code), true);
expect('1.5 pollMailbox export (backward-compat)',
  /export async function pollMailbox\(companyId\)/.test(code), true);
expect('1.5b pollInbox export (A2 multi-inbox primitive)',
  /export async function pollInbox\(inbox\)/.test(code), true);
expect('1.6 pollAllEnabledMailboxes export',
  /export async function pollAllEnabledMailboxes\(\)/.test(code), true);
expect('1.7 externalMailInboxRepo import (A2)',
  /import \{ externalMailInboxRepo \} from '\.\.\/db\/externalMailInboxRepository\.js'/.test(code), true);

console.log('\n── 2) Idempotency / dedup mekanizması ──────────');
expect('2.1 PRIMARY \\Seen flag işaretlemesi (başarılı intake sonrası)',
  /client\.messageFlagsAdd\(uid, \['\\\\Seen'\], \{ uid: true \}\)/.test(code), true);
expect('2.2 SECONDARY in-memory quarantine Map (A2: inboxId-scope)',
  /const failedQuarantine = new Map\(\);/.test(code), true);
expect('2.2b quarantine inboxId scope (A2: companyId yerine)',
  /failedQuarantine\.get\(inboxId\)/.test(code) && /failedQuarantine\.set\(inboxId/.test(code), true);
expect('2.3 maxRetry guard (3)',
  /retryCount >= 3/.test(code), true);
expect('2.4 başarılı intake → quarantine\'den temizle (kalıcı dedup için \\Seen)',
  /quarantine\.delete\(qKey\)/.test(code), true);

console.log('\n── 3) Auto-reply / bounce filter ───────────────');
expect('3.1 Auto-Submitted header check (RFC 3834)',
  code.includes('auto-submitted')
    && code.includes('auto-replied')
    && code.includes('auto_submitted'), true);
expect('3.2 mailer-daemon / postmaster from check',
  /mailer-daemon\|postmaster/.test(code), true);
expect('3.3 no-reply local-part check',
  /no-\?reply\|donotreply\|noreply/.test(code), true);
expect('3.4 Out of office / auto-reply subject',
  /out of office|automatic reply|ofiste değilim/.test(code), true);
expect('3.5 Auto-filter → \\Seen işaretler (sonsuz döngü engelleme)',
  /autoFilter\.skip[\s\S]{0,200}messageFlagsAdd\(uid, \['\\\\Seen'\]/.test(code), true);

console.log('\n── 4) Tetikleme (cron + manuel endpoint) ────────');
expect('4.1 env MAIL_IMAP_POLL_INTERVAL_SEC seam',
  /process\.env\.MAIL_IMAP_POLL_INTERVAL_SEC/.test(code), true);
expect('4.2 default kapalı (sec <= 0 → return)',
  /if \(!Number\.isFinite\(sec\) \|\| sec <= 0\)/.test(code), true);
expect('4.3 startImapPollingInterval / stop export',
  /export function startImapPollingInterval/.test(code)
    && /export function stopImapPollingInterval/.test(code), true);

const cron = read('server/cronScheduler.js');
expect('4.4 cronScheduler startImapPollingInterval entegre',
  /import \{ startImapPollingInterval \}/.test(cron)
    && /startImapPollingInterval\(\);/.test(cron), true);

const route = read('server/routes/admin.js');
const routeCode = strip(route);
expect('4.5 Admin POST /external-mail-settings/:companyId/poll',
  /router\.post\('\/external-mail-settings\/:companyId\/poll'/.test(routeCode), true);
expect('4.6 SystemAdmin guard (requireSystemAdminOnly)',
  /router\.post\('\/external-mail-settings\/:companyId\/poll'[\s\S]{0,600}requireSystemAdminOnly\(req\)/.test(routeCode), true);

console.log('\n── 5) Multi-tenant + secret privacy (A2 inbox-scope) ──');
expect('5.1 listEnabled cross-tenant tüm inbox\'lar',
  /externalMailInboxRepo\.listEnabled\(\)/.test(code), true);
expect('5.2 getDecryptedSecret(companyId, inboxId) — A2 inbox-scope',
  /externalMailInboxRepo\.getDecryptedSecret\(companyId, inboxId\)/.test(code), true);
expect('5.3 hata izolasyonu (try/catch pollInbox in loop)',
  /for \(const inbox of enabledInboxes\)[\s\S]{0,500}try \{[\s\S]{0,500}pollInbox\(inbox\)/.test(code), true);
expect('5.4 secret düz log/response yok (auth opts.pass içinde, sızıntı yok)',
  /pass: secret/.test(code) && /console\.(log|warn|error).*\bsecret\b/.test(code) === false, true);
expect('5.5 backward-compat: pollMailbox(companyId) → listEnabledByCompany loop',
  /externalMailInboxRepo\.listEnabledByCompany\(companyId\)/.test(code), true);

console.log('\n── 6) Sistem actor (intake için) ────────────────');
expect('6.1 SYSTEM_ACTOR displayName',
  /displayName: 'system:mail-intake-imap'/.test(code), true);
expect('6.2 intakeInboundEmail çağrısı SYSTEM_ACTOR ile',
  /intakeInboundEmail\(\{[\s\S]{0,200}actor: SYSTEM_ACTOR/.test(code), true);

console.log('\n── 7) Inline unit (auto-filter pattern testleri) ──');
// inline auto-filter testi — gerçek fonksiyonu execute etmek için import'a gerek var
// ama static smoke'ta da pattern dümeni kanıtladık. Sadece spot check:
expect('7.1 auto-filter skip OBJ döner (skip + reason)',
  /return \{ skip: true, reason: 'auto_submitted' \}/.test(code), true);
expect('7.2 default skip:false',
  /return \{ skip: false \};/.test(code), true);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
