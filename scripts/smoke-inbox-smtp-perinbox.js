/**
 * smoke-inbox-smtp-perinbox.js — FAZ B (2026-07-02)
 *
 * Per-inbox SMTP + IMAP tam kredi. Fallback yolu (tenant-ortak) mevcut
 * davranış birebir korunur.
 *
 * Kapsam:
 *  1. Schema: ExternalMailInbox 4 yeni nullable alan
 *  2. Migration: additive DDL + backfill (SMTP tenant kopya + fromAddress inbox)
 *  3. Repo: SELECTABLE_PUBLIC + shape + upsert data mapping + resolveInboxSmtpByFrom
 *  4. mailProvider: resolveConfig({companyId, from}) + inbox source vs tenant fallback
 *  5. testInboxConnection: IMAP + SMTP ayrı sonuç
 *  6. FromAlias auto-bridge (ensureForInboxAddress + admin.js route çağrısı)
 *  7. UI: TS type genişletmesi + modal SMTP alanları + layout swap + rozet
 *  8. Davranış simülasyonu: From resolution, fallback kararı, dokunulmama testi
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260702_inbox_smtp_perinbox/migration.sql');
const inboxRepo = read('server/db/externalMailInboxRepository.js');
const inboxRepoCode = strip(inboxRepo);
const fromAliasRepo = read('server/db/externalMailFromAliasRepository.js');
const mailProvider = read('server/lib/mailProvider.js');
const mailProviderCode = strip(mailProvider);
const poller = read('server/lib/imapPoller.js');
const pollerCode = strip(poller);
const routes = read('server/routes/admin.js');
const routesCode = strip(routes);
const svc = read('src/services/adminService.ts');
const page = read('src/features/admin/AdminExternalMailPage.tsx');
const pageCode = strip(page);

console.log('── 1) Schema (additive) ────────────────────────');
expect('1.1 smtpHost String?', /model ExternalMailInbox \{[\s\S]{0,3000}smtpHost\s+String\?/.test(schema), true);
expect('1.2 smtpPort Int?', /model ExternalMailInbox \{[\s\S]{0,3000}smtpPort\s+Int\?/.test(schema), true);
expect('1.3 smtpSecure Boolean?', /model ExternalMailInbox \{[\s\S]{0,3000}smtpSecure\s+Boolean\?/.test(schema), true);
expect('1.4 fromAddress String?', /model ExternalMailInbox \{[\s\S]{0,3000}fromAddress\s+String\?/.test(schema), true);
expect('1.5 IMAP alanları KORUNDU', /imapHost\s+String\?[\s\S]{0,100}imapPort\s+Int\?[\s\S]{0,100}imapSecure\s+Boolean/.test(schema), true);

console.log('\n── 2) Migration additive + backfill ────────────');
expect('2.1 ALTER ADD smtpHost/smtpPort/smtpSecure/fromAddress NULL',
  /ALTER TABLE \[dbo\]\.\[ExternalMailInbox\][\s\S]{0,600}smtpHost.*NULL[\s\S]{0,100}smtpPort.*NULL[\s\S]{0,100}smtpSecure.*NULL[\s\S]{0,100}fromAddress.*NULL/.test(migration), true);
expect('2.2 Backfill — tenant setting SMTP kopya (LEFT JOIN + COALESCE)',
  /UPDATE i[\s\S]{0,400}COALESCE\(i\.smtpHost,\s*s\.smtpHost\)[\s\S]{0,300}LEFT JOIN \[dbo\]\.\[ExternalMailSetting\] s/.test(migration), true);
expect('2.3 Backfill — fromAddress = inbox\'un KENDİ adresi (tenant fromAddress KOPYALANMAZ)',
  /UPDATE \[dbo\]\.\[ExternalMailInbox\][\s\S]{0,500}displayName.*address[\s\S]{0,100}ELSE address[\s\S]{0,200}WHERE fromAddress IS NULL/.test(migration), true);
expect('2.4 BEGIN TRY/CATCH + ROLLBACK guard',
  /BEGIN TRY[\s\S]+BEGIN TRAN[\s\S]+COMMIT TRAN[\s\S]+ROLLBACK TRAN/.test(migration), true);
expect('2.5 Mevcut satır SİLİNMEZ (DELETE yok, DROP yok)',
  !/DELETE FROM \[dbo\]\.\[ExternalMailInbox\]/.test(migration)
    && !/DROP TABLE \[dbo\]\.\[ExternalMailInbox\]/.test(migration), true);

console.log('\n── 3) Repo — SELECTABLE + shape + upsert ───────');
expect('3.1 SELECTABLE_PUBLIC: smtpHost/smtpPort/smtpSecure/fromAddress',
  /SELECTABLE_PUBLIC = \{[\s\S]{0,800}smtpHost: true[\s\S]{0,100}smtpPort: true[\s\S]{0,100}smtpSecure: true[\s\S]{0,100}fromAddress: true/.test(inboxRepo), true);
expect('3.2 shapeForPublic — smtp alanları döner',
  /shapeForPublic\(row\)[\s\S]{0,1500}smtpHost: row\.smtpHost \?\? null[\s\S]{0,200}smtpPort: row\.smtpPort \?\? null[\s\S]{0,200}smtpSecure: row\.smtpSecure \?\? null[\s\S]{0,200}fromAddress: row\.fromAddress \?\? null/.test(inboxRepo), true);
expect('3.3 upsert data mapping — 4 SMTP alanı',
  /if \(draft\.smtpHost !== undefined\)[\s\S]{0,300}if \(draft\.smtpPort !== undefined\)[\s\S]{0,300}if \(draft\.smtpSecure !== undefined\)[\s\S]{0,300}if \(draft\.fromAddress !== undefined\)/.test(inboxRepoCode), true);
expect('3.4 create default fromAddress — "displayName <address>" veya çıplak',
  /createData = \{[\s\S]{0,1200}fromAddress: data\.fromAddress !== undefined[\s\S]{0,400}displayName \? .+ : data\.address/.test(inboxRepoCode), true);
expect('3.5 validation — smtpHost + smtpPort + fromAddress',
  /patch\.smtpHost !== undefined && patch\.smtpHost !== null[\s\S]{0,400}patch\.smtpPort !== undefined && patch\.smtpPort !== null[\s\S]{0,400}patch\.fromAddress !== undefined && patch\.fromAddress !== null/.test(inboxRepoCode), true);

console.log('\n── 4) Repo — resolveInboxSmtpByFrom ────────────');
expect('4.1 export edildi (externalMailInboxRepo içinde)',
  /externalMailInboxRepo = \{[\s\S]{0,600}resolveInboxSmtpByFrom/.test(inboxRepo), true);
expect('4.2 case-insensitive normalize (trim + toLowerCase)',
  /resolveInboxSmtpByFrom[\s\S]{0,600}emailPart\.trim\(\)\.toLowerCase\(\)/.test(inboxRepo), true);
expect('4.3 hem inbox.address hem inbox.fromAddress ile eşleşir',
  /addr === normalized[\s\S]{0,300}extractEmailPart\(r\.fromAddress\)/.test(inboxRepo), true);
expect('4.4 smtpHost yoksa NULL döner (fallback)',
  /if \(!match\.smtpHost \|\| !match\.username\) return null/.test(inboxRepo), true);
expect('4.5 secret yoksa NULL döner (fallback)',
  /if \(!match\.secretCiphertext[\s\S]{0,150}return null/.test(inboxRepo), true);
expect('4.6 decrypt secret → RAM\'de dön; response\'a inmez',
  /pass = decrypt\(\{[\s\S]{0,300}return \{[\s\S]{0,300}pass,/.test(inboxRepo), true);
expect('4.7 port default 587, secure default false (STARTTLS)',
  /port: match\.smtpPort \|\| 587[\s\S]{0,200}secure: match\.smtpSecure === true/.test(inboxRepo), true);

console.log('\n── 5) mailProvider — inbox source vs tenant fallback ─');
expect('5.1 resolveConfig signature — from parametre eklendi',
  /async function resolveConfig\(\{ companyId, from \} = \{\}\)/.test(mailProvider), true);
expect('5.2 inbox lookup — resolveInboxSmtpByFrom çağrısı',
  /if \(from\)[\s\S]{0,600}inboxRepo\.resolveInboxSmtpByFrom\(companyId, from\)/.test(mailProviderCode), true);
expect('5.3 inbox match → source=\'inbox\' döner',
  /source: 'inbox'/.test(mailProviderCode), true);
expect('5.4 inbox match yok → tenant-ortak fallback (mevcut yol)',
  /if \(dbConfig && dbConfig\.enabled === true\)[\s\S]{0,1500}source: 'db'/.test(mailProviderCode), true);
expect('5.5 sendMail resolveConfig\'e from geçirir',
  /resolveConfig\(\{ companyId: opts\.companyId, from \}\)/.test(mailProvider), true);
expect('5.6 response meta.inboxId eklendi (teşhis)',
  /config\.inboxId \? \{ inboxId: config\.inboxId \} : \{\}/.test(mailProviderCode), true);

console.log('\n── 6) testInboxConnection — IMAP + SMTP ayrı ────');
expect('6.1 testImapOnly ayrı fonksiyon',
  /async function testImapOnly\(inbox, secret\)/.test(pollerCode), true);
expect('6.2 testSmtpOnly ayrı fonksiyon',
  /async function testSmtpOnly\(inbox, secret\)/.test(pollerCode), true);
expect('6.3 SMTP config yoksa fallbackAvailable: true (hata değil)',
  /if \(!inbox\.smtpHost \|\| !inbox\.username\)[\s\S]{0,400}fallbackAvailable: true/.test(pollerCode), true);
expect('6.4 SMTP: nodemailer.verify() ile test',
  /createTransport\(\{[\s\S]{0,400}await transport\.verify\(\)/.test(pollerCode), true);
expect('6.5 SMTP: auth failed classification (responseCode 535 + EAUTH)',
  /responseCode === 535[\s\S]{0,200}EAUTH[\s\S]{0,200}auth_failed/.test(pollerCode), true);
expect('6.6 Paralel test — Promise.all(imap, smtp)',
  /await Promise\.all\(\[[\s\S]{0,200}testImapOnly[\s\S]{0,100}testSmtpOnly/.test(pollerCode), true);
expect('6.7 totalOk = imap.ok && (smtp.ok || smtp.fallbackAvailable)',
  /const totalOk = imap\.ok && \(smtp\.ok \|\| smtp\.fallbackAvailable === true\)/.test(pollerCode), true);
expect('6.8 result → { imap, smtp } her ikisi de döner',
  /return \{[\s\S]{0,400}imap,[\s\S]{0,100}smtp,/.test(pollerCode), true);

console.log('\n── 7) FromAlias auto-bridge ────────────────────');
expect('7.1 ensureForInboxAddress export',
  /externalMailFromAliasRepo = \{[\s\S]{0,600}ensureForInboxAddress/.test(fromAliasRepo), true);
expect('7.2 Mevcut alias VARSA dokunma (idempotent)',
  /findUnique[\s\S]{0,400}if \(existing\) return \{ ok: true, alreadyExisted: true \}/.test(fromAliasRepo), true);
expect('7.3 Yeni alias — isActive: true, isDefault: false (mevcut default\'a dokunma)',
  /create\(\{[\s\S]{0,600}isDefault: false[\s\S]{0,100}isActive: true/.test(fromAliasRepo), true);
expect('7.4 admin.js POST inbox — ensureForInboxAddress çağrısı',
  /router\.post\('\/external-mail-settings\/:companyId\/inboxes'[\s\S]{0,2000}externalMailFromAliasRepo\.ensureForInboxAddress\(/.test(routesCode), true);
expect('7.5 admin.js PATCH inbox — ensureForInboxAddress çağrısı',
  /router\.patch\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId'[\s\S]{0,2000}externalMailFromAliasRepo\.ensureForInboxAddress\(/.test(routesCode), true);

console.log('\n── 8) TS types (adminService) ──────────────────');
expect('8.1 MailInboxItem SMTP alanları',
  /MailInboxItem \{[\s\S]{0,800}smtpHost: string \| null[\s\S]{0,100}smtpPort: number \| null[\s\S]{0,100}smtpSecure: boolean \| null[\s\S]{0,100}fromAddress: string \| null/.test(svc), true);
expect('8.2 MailInboxDraft SMTP alanları (opsiyonel)',
  /MailInboxDraft \{[\s\S]{0,800}smtpHost\?: string \| null[\s\S]{0,100}smtpPort\?: number \| null[\s\S]{0,100}smtpSecure\?: boolean \| null[\s\S]{0,100}fromAddress\?: string \| null/.test(svc), true);
expect('8.3 InboxTestChannelResult tipi',
  /InboxTestChannelResult \{[\s\S]{0,300}ok: boolean;[\s\S]{0,100}code: InboxTestCode;[\s\S]{0,200}fallbackAvailable\?: boolean/.test(svc), true);
expect('8.4 InboxTestResult — imap + smtp alanları',
  /InboxTestResult \{[\s\S]{0,400}imap\?: InboxTestChannelResult \| null[\s\S]{0,100}smtp\?: InboxTestChannelResult \| null/.test(svc), true);

console.log('\n── 9) UI — Modal SMTP alanları ──────────────────');
expect('9.1 state smtpHost/smtpPort/smtpSecure/fromAddress',
  /useState<string>\(initial\?\.smtpHost \?\? 'smtp\.gmail\.com'\)[\s\S]{0,400}useState<number>\(initial\?\.smtpPort \?\? 587\)[\s\S]{0,400}useState<boolean>\(initial\?\.smtpSecure === true\)[\s\S]{0,400}useState<string>\(initial\?\.fromAddress \?\? ''\)/.test(page), true);
expect('9.2 Modal — GİDEN MAİL (SMTP) grubu',
  /GİDEN MAİL \(SMTP\)/.test(page), true);
expect('9.3 SMTP dropdown/input 3-column grid',
  /SMTP sunucusu[\s\S]{0,800}Port[\s\S]{0,300}SSL\/TLS/.test(page), true);
expect('9.4 From adresi input + auto-suggest placeholder',
  /label="From adresi"[\s\S]{0,600}"Görünen ad <mail adresi>"[\s\S]{0,300}fromAddress \|\| null/.test(page)
    || /label="From adresi"[\s\S]{0,600}placeholder=\{[\s\S]{0,300}displayName\.trim\(\)/.test(page), true);
expect('9.5 persistDraft — SMTP alanları payload\'a giriyor',
  /draft: MailInboxDraft = \{[\s\S]{0,1200}smtpHost: smtpHost\.trim\(\) \|\| null[\s\S]{0,200}smtpPort: Number\(smtpPort\) \|\| null[\s\S]{0,200}smtpSecure,[\s\S]{0,200}fromAddress: finalFromAddress \|\| null/.test(page), true);
expect('9.6 finalFromAddress fallback — "Display <address>" veya çıplak',
  /finalFromAddress = trimmedFromAddress[\s\S]{0,300}trimmedDisplayName \? `\$\{trimmedDisplayName\} <\$\{addr\}>` : addr/.test(page), true);

console.log('\n── 10) UI — Layout swap ──────────────────────');
expect('10.1 MailInboxManager sayfa yukarısında (SMTP kartından ÖNCE)',
  /FAZ B[\s\S]{0,500}MailInboxManager companyId=\{companyId\}[\s\S]{0,3000}Giden Mail \(SMTP\) — Ortak Fallback/.test(page), true);
expect('10.2 SMTP kart collapse (details/summary)',
  /<details[\s\S]{0,600}Giden Mail \(SMTP\) — Ortak Fallback/.test(page)
    && /<\/details>/.test(page), true);
expect('10.3 SMTP kart hint — fallback açıklaması',
  /SMTP'si tanımlı olmayan inbox'lar buradan gönderir/.test(page), true);

console.log('\n── 11) UI — Test rozeti IMAP+SMTP ayrı ─────────');
expect('11.1 testResult.imap rozet',
  /testResult\.imap && \(\s*<span[\s\S]{0,600}IMAP:/.test(page), true);
expect('11.2 testResult.smtp rozet',
  /testResult\.smtp && \(\s*<span[\s\S]{0,2000}SMTP:/.test(page), true);
expect('11.3 SMTP fallbackAvailable → gri renk (hata değil)',
  /testResult\.smtp\.fallbackAvailable[\s\S]{0,400}slate/.test(page), true);
expect('11.4 formatChannelTestMessage helper',
  /function formatChannelTestMessage\([\s\S]{0,200}channel: 'imap' \| 'smtp'/.test(page), true);
expect('11.5 formatChannelTestMessage — fallback msg',
  /fallbackAvailable[\s\S]{0,200}tenant fallback devrede/.test(page), true);

console.log('\n── 12) Davranış — extractEmailPart + resolve simülasyon ─');

function extractEmailPart(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const angle = s.match(/<([^>]+)>/);
  if (angle) return angle[1].trim();
  if (s.includes('@')) return s;
  return null;
}
expect('12.1 "Ali <a@b.com>" → a@b.com', extractEmailPart('Ali <a@b.com>'), 'a@b.com');
expect('12.2 "a@b.com" → a@b.com', extractEmailPart('a@b.com'), 'a@b.com');
expect('12.3 "Ali" (no @) → null', extractEmailPart('Ali'), null);
expect('12.4 null → null', extractEmailPart(null), null);
expect('12.5 "" → null', extractEmailPart(''), null);
expect('12.6 "  Ali <a@b.com>  " (whitespace) → a@b.com',
  extractEmailPart('  Ali <a@b.com>  '), 'a@b.com');

// resolveInboxSmtpByFrom simülasyonu — case-insensitive + fromAddress match
function resolveSim(inboxes, from) {
  const emailPart = extractEmailPart(from);
  if (!emailPart) return null;
  const normalized = emailPart.trim().toLowerCase();
  const match = inboxes.find((r) => {
    const addr = String(r.address ?? '').trim().toLowerCase();
    if (addr === normalized) return true;
    const fromEmail = extractEmailPart(r.fromAddress);
    return fromEmail && fromEmail.toLowerCase() === normalized;
  });
  if (!match) return null;
  if (!match.smtpHost || !match.username || !match.secretIsSet) return null;
  return { inboxId: match.id, host: match.smtpHost };
}

const inboxes = [
  { id: 'i1', address: 'destek@univera.com.tr', fromAddress: 'Destek <destek@univera.com.tr>', smtpHost: 'smtp.gmail.com', username: 'destek@univera.com.tr', secretIsSet: true },
  { id: 'i2', address: 'satis@univera.com.tr', fromAddress: 'satis@univera.com.tr', smtpHost: 'smtp.gmail.com', username: 'satis@univera.com.tr', secretIsSet: true },
  { id: 'i3', address: 'nosmtp@univera.com.tr', fromAddress: 'nosmtp@univera.com.tr', smtpHost: null, username: 'nosmtp@univera.com.tr', secretIsSet: true },
];

expect('12.7 "destek@univera.com.tr" → inbox i1',
  resolveSim(inboxes, 'destek@univera.com.tr')?.inboxId, 'i1');
expect('12.8 "Destek@Univera.COM.TR" (case) → inbox i1',
  resolveSim(inboxes, 'Destek@Univera.COM.TR')?.inboxId, 'i1');
expect('12.9 "Destek <destek@univera.com.tr>" (formatted) → inbox i1',
  resolveSim(inboxes, 'Destek <destek@univera.com.tr>')?.inboxId, 'i1');
expect('12.10 fromAddress match — "Destek <destek@univera.com.tr>" body\'sinden çekilir',
  resolveSim(inboxes, 'Destek <destek@univera.com.tr>')?.inboxId, 'i1');
expect('12.11 SMTP\'si NULL olan inbox — resolve NULL (fallback)',
  resolveSim(inboxes, 'nosmtp@univera.com.tr'), null);
expect('12.12 Eşleşmeyen adres → NULL (fallback)',
  resolveSim(inboxes, 'baska@example.com'), null);

console.log('\n── 13) Davranış — SMTP test fallback semantiği ─');

function shouldFailSmtp(inbox, secret) {
  if (!inbox.smtpHost || !inbox.username) return { code: 'config_incomplete', fallbackAvailable: true };
  if (!secret) return { code: 'config_incomplete', fallbackAvailable: false };
  return null; // real IMAP verify test would run
}

expect('13.1 SMTP host YOK → fallback devrede (hata değil)',
  shouldFailSmtp({ smtpHost: null, username: 'x' }, 'pass')?.fallbackAvailable, true);
expect('13.2 SMTP host VAR, secret YOK → config_incomplete (hata)',
  shouldFailSmtp({ smtpHost: 'smtp.gmail.com', username: 'x' }, null)?.fallbackAvailable, false);
expect('13.3 SMTP + secret dolu → null (test verify yapar)',
  shouldFailSmtp({ smtpHost: 'smtp.gmail.com', username: 'x' }, 'pass'), null);

console.log('\n── 14) Kontrat — notification (M4.1) sender dokunulmadı ─');
expect('14.1 caseEmailSender.js payload\'da from ve companyId geçirmeye devam',
  /from: sendFrom,[\s\S]{0,300}companyId: caseRow\.companyId/.test(read('server/lib/caseEmailSender.js')), true);
expect('14.2 mailProvider signature backward-compat (from opsiyonel)',
  /async function resolveConfig\(\{ companyId, from \} = \{\}\)/.test(mailProvider), true);
expect('14.3 opts.from verilmezse (compose-new dispatch) inbox lookup YOK',
  /if \(from\) \{/.test(mailProviderCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
