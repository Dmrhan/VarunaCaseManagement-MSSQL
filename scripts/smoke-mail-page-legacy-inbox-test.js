/**
 * smoke-mail-page-legacy-inbox-test.js — 2026-07-02
 *
 * İki iş:
 *  1. Mail Entegrasyonu üst kartı sadeleştirme (legacy IMAP alanları
 *     UI'dan kaldırıldı; schema DOKUNULMADI).
 *  2. Inbox-başına IMAP "Bağlantıyı test et" endpoint + UI.
 *
 * Feature freeze uyumlu: UI + 1 endpoint. Schema YOK.
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

const routes = read('server/routes/admin.js');
const routesCode = strip(routes);
const poller = read('server/lib/imapPoller.js');
const svc = read('src/services/adminService.ts');
const page = read('src/features/admin/AdminExternalMailPage.tsx');
const pageCode = strip(page);

console.log('── 1) imapPoller — testInboxConnection helper (reuse) ─');
expect('1.1 export testInboxConnection tanımı',
  /export async function testInboxConnection\(inbox\)/.test(poller), true);
expect('1.2 classifyImapError helper — auth_failed vs connection_failed',
  /function classifyImapError\(err\)[\s\S]{0,600}return 'auth_failed'[\s\S]{0,200}return 'connection_failed'/.test(poller), true);
expect('1.3 authenticationFailed / AUTHENTICATIONFAILED tespiti',
  /authenticationFailed === true[\s\S]{0,300}AUTHENTICATIONFAILED/.test(poller), true);
expect('1.4 config_incomplete — imapHost/username eksik',
  /if \(!inbox\.imapHost \|\| !inbox\.username\)[\s\S]{0,400}code: 'config_incomplete'/.test(poller), true);
expect('1.5 config_incomplete — secret eksik (ERKEN guard, üst level testInboxConnection)',
  /const secret = await externalMailInboxRepo\.getDecryptedSecret[\s\S]{0,800}if \(!secret\)[\s\S]{0,600}code: 'config_incomplete'/.test(poller), true);
expect('1.6 inbox_disabled — isActive=false',
  /if \(inbox\.isActive === false\)[\s\S]{0,400}code: 'inbox_disabled'/.test(poller), true);
expect('1.7 ImapFlow config — pollInbox ile aynı (host/port/secure/auth/timeout)',
  /new ImapFlow\(\{[\s\S]{0,500}host: inbox\.imapHost[\s\S]{0,200}secure: inbox\.imapSecure !== false[\s\S]{0,200}socketTimeout: IMAP_CONNECT_TIMEOUT_MS/.test(poller), true);
expect('1.8 EventEmitter error guard',
  /client\.on\('error', \(\) => \{\}\)/.test(poller), true);
expect('1.9 connect() try/catch → classifyImapError',
  /await client\.connect\(\)[\s\S]{0,500}const code = classifyImapError\(err\)/.test(poller), true);
expect('1.10 INBOX lock + release + logout (mail çekmez, mutate etmez)',
  /getMailboxLock\('INBOX'\)[\s\S]{0,200}lock\.release\(\)[\s\S]{0,300}client\.logout\(\)/.test(poller), true);
expect('1.11 başarı: ok=true code=\'ok\'',
  /return \{[\s\S]{0,300}ok: true[\s\S]{0,100}code: 'ok'/.test(poller), true);
expect('1.12 pollInbox mevcut fonksiyonu KORUNDU (regresyon)',
  /export async function pollInbox\(inbox\)/.test(poller), true);

console.log('\n── 2) admin.js — POST /inboxes/:id/test endpoint ─');
expect('2.1 route kayıtlı',
  /router\.post\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId\/test'/.test(routesCode), true);
expect('2.2 assertCompanyAdmin guard (mail-inbox desen)',
  /'\/external-mail-settings\/:companyId\/inboxes\/:inboxId\/test'[\s\S]{0,600}assertCompanyAdmin\(req, companyId\)/.test(routesCode), true);
expect('2.3 findById scope check',
  /externalMailInboxRepo\.findById\(companyId, inboxId\)/.test(routesCode), true);
expect('2.4 not_found → 404',
  /if \(!inbox\) return res\.status\(404\)[\s\S]{0,100}code: 'not_found'/.test(routesCode), true);
expect('2.5 testInboxConnection çağrısı',
  /const result = await testInboxConnection\(inbox\)/.test(routesCode), true);
expect('2.6 testInboxConnection import',
  /import \{ pollMailbox as imapPollMailbox, testInboxConnection \} from '\.\.\/lib\/imapPoller\.js'/.test(routes), true);

console.log('\n── 3) TS service — InboxTestResult type + inboxes.test ─');
expect('3.1 InboxTestCode union type',
  /export type InboxTestCode =\s*\|\s*'ok'\s*\|\s*'auth_failed'\s*\|\s*'connection_failed'\s*\|\s*'config_incomplete'\s*\|\s*'inbox_disabled'\s*\|\s*'inbox_invalid'\s*\|\s*'not_found'/.test(svc), true);
expect('3.2 InboxTestResult interface',
  /export interface InboxTestResult \{[\s\S]{0,300}ok: boolean;[\s\S]{0,100}code: InboxTestCode;[\s\S]{0,100}message: string;/.test(svc), true);
expect('3.3 inboxes.test wrapper',
  /async test\(companyId: string, inboxId: string\): Promise<InboxTestResult>/.test(svc), true);
expect('3.4 test endpoint URL match',
  /`\$\{ADMIN_BASE\}\/external-mail-settings\/\$\{encodeURIComponent\(companyId\)\}\/inboxes\/\$\{encodeURIComponent\(inboxId\)\}\/test`/.test(svc), true);

console.log('\n── 4) toPatch — legacy alanlar payload\'dan ÇIKARILDI ─');
expect('4.1 inboundAddress payload\'da YOK',
  !/inboundAddress: d\.inboundAddress/.test(page), true);
expect('4.2 imapHost payload\'da YOK',
  !/imapHost: d\.imapHost/.test(page), true);
expect('4.3 imapPort payload\'da YOK',
  !/imapPort: d\.imapPort/.test(page), true);
expect('4.4 authMode payload\'da YOK',
  !/authMode: d\.authMode/.test(page), true);
expect('4.5 SMTP alanları KORUNDU (fromAddress, smtpHost, smtpPort, smtpSecure, username)',
  /fromAddress: d\.fromAddress[\s\S]{0,300}smtpHost: d\.smtpHost[\s\S]{0,100}smtpPort: d\.smtpPort[\s\S]{0,100}smtpSecure: d\.smtpSecure[\s\S]{0,100}username: d\.username/.test(page), true);

console.log('\n── 5) UI üst kart — SMTP odaklı sadeleştirme ─');
expect('5.1 "Sistem Bildirim Mailleri (no-reply)" başlığı (kart başlığı yeniden adlandırıldı 2026-07-02)',
  /Sistem Bildirim Mailleri \(no-reply\)/.test(page), true);
expect('5.2 Kart hint — otomatik bildirim mailleri açıklaması (vaka açıldı / durum güncellendi / çözüldü)',
  /vaka açıldı \/ durum güncellendi \/ çözüldü bildirimlerini bu hesap gönderir/.test(page), true);
expect('5.3 Entegrasyon Aktif — kill switch açıklaması güncellendi',
  /Kill switch[\s\S]{0,300}T[ÜÜÙ]M inbox'lar[\s\S]{0,200}durur/.test(page), true);
expect('5.4 Legacy IMAP açıklama satırı — aşağı yönlendirme',
  /Gelen mail \(IMAP\) tan[ıi]mlar[ıi][\s\S]{0,300}Gelen Mail Inbox'lar[ıi]/.test(page), true);
expect('5.5 Inbound Address input UI\'dan kaldırıldı',
  !/label="Inbound Address/.test(page), true);
expect('5.6 IMAP Host input UI\'dan kaldırıldı',
  !/label="IMAP Host/.test(page), true);
expect('5.7 IMAP Port input UI\'dan kaldırıldı',
  !/label="IMAP Port/.test(page), true);
expect('5.8 Auth Mode input UI\'dan kaldırıldı',
  !/label="Auth Mode/.test(page), true);

console.log('\n── 6) UI inbox listesi — test butonu + badge ─');
expect('6.1 testResults state (id → InboxTestResult)',
  /const \[testResults, setTestResults\] = useState<Record<string, InboxTestResult>>/.test(page), true);
expect('6.2 testingId state (in-flight buton disabled)',
  /const \[testingId, setTestingId\] = useState<string \| null>/.test(page), true);
expect('6.3 handleTest fonksiyonu',
  /async function handleTest\(item: MailInboxItem\)[\s\S]{0,500}adminService\.externalMailSettings\.inboxes\.test\(companyId, item\.id\)/.test(page), true);
expect('6.4 "Bağlantıyı test et" butonu satırda',
  /Ba[ğg]lant[ıi]y[ıi] test et/.test(page), true);
expect('6.5 Buton disabled — busy VEYA testing',
  /disabled=\{busy \|\| isTesting\}/.test(page), true);
expect('6.6 Test button title hint (mail çekmez, mutate etmez)',
  /IMAP ba[ğg]lant[ıi]s[ıi]n[ıi] test eder[\s\S]{0,200}mail [çc]ekmez[\s\S]{0,200}hi[çç]bir [şs]ey de[ğg]i[şs]tirmez/.test(page), true);
expect('6.7 formatInboxTestMessage — 6 code case',
  /case 'ok':[\s\S]{0,500}case 'auth_failed':[\s\S]{0,500}case 'connection_failed':[\s\S]{0,500}case 'config_incomplete':[\s\S]{0,500}case 'inbox_disabled':[\s\S]{0,500}case 'not_found':/.test(page), true);
expect('6.8 Test rozeti — testResult varsa ikili IMAP+SMTP badge shape (FAZ B)',
  /\{testResult &&[\s\S]{0,300}testResult\.imap &&/.test(page)
    && /testResult\.imap &&[\s\S]{0,1500}testResult\.smtp &&/.test(page)
    && /\{!testResult\.imap && !testResult\.smtp &&[\s\S]{0,600}formatInboxTestMessage\(testResult\)/.test(page), true);
expect('6.9 Reload sonrası testResults temizlenir (yanıltıcı geçmiş yok)',
  /const reload = useCallback\(async \(\) => \{[\s\S]{0,400}setTestResults\(\{\}\)/.test(page), true);

console.log('\n── 7) UI Yeni Inbox modal — Kaydet ve Test Et ─');
expect('7.1 persistDraft — save-only helper (id döndürür)',
  /async function persistDraft\(\): Promise<MailInboxItem \| undefined>/.test(page), true);
expect('7.2 handleSaveAndTest — save + test kombinasyonu',
  /async function handleSaveAndTest\(\)[\s\S]{0,500}const testRes = await adminService\.externalMailSettings\.inboxes\.test\(companyId, r\.id\)/.test(page), true);
expect('7.3 Buton "Kaydet ve Test Et"',
  /Kaydet ve Test Et/.test(page), true);
expect('7.4 inlineTest.status "done" → "Kapat" ile onSaved',
  /inlineTest\.status === 'done'[\s\S]{0,600}onSaved\(\)[\s\S]{0,300}Kapat/.test(page), true);
expect('7.5 inlineTest banner — ok/fail renk ayrımı',
  /inlineTest\.result\.ok[\s\S]{0,200}emerald[\s\S]{0,300}rose/.test(page), true);

console.log('\n── 8) Davranış — classifyImapError sim ─');

function classifyImapError(err) {
  if (!err) return 'connection_failed';
  const msg = String(err?.message ?? '').toLowerCase();
  const code = String(err?.code ?? '').toUpperCase();
  const respCode = String(err?.serverResponseCode ?? err?.responseCode ?? '').toUpperCase();
  if (
    err?.authenticationFailed === true
    || respCode === 'AUTHENTICATIONFAILED'
    || code === 'AUTHENTICATIONFAILED'
    || msg.includes('invalid credentials')
    || msg.includes('authentication failed')
    || msg.includes('logon failed')
    || msg.includes('login failed')
  ) {
    return 'auth_failed';
  }
  return 'connection_failed';
}

expect('8.1 authenticationFailed=true → auth_failed',
  classifyImapError({ authenticationFailed: true }), 'auth_failed');
expect('8.2 serverResponseCode AUTHENTICATIONFAILED → auth_failed',
  classifyImapError({ serverResponseCode: 'AUTHENTICATIONFAILED' }), 'auth_failed');
expect('8.3 responseCode AUTHENTICATIONFAILED → auth_failed',
  classifyImapError({ responseCode: 'AUTHENTICATIONFAILED' }), 'auth_failed');
expect('8.4 message "Invalid credentials" → auth_failed',
  classifyImapError({ message: 'Invalid credentials for user' }), 'auth_failed');
expect('8.5 message "Authentication failed" → auth_failed',
  classifyImapError({ message: 'AUTHENTICATION FAILED' }), 'auth_failed');
expect('8.6 message "Login failed" → auth_failed',
  classifyImapError({ message: 'LOGIN failed' }), 'auth_failed');
expect('8.7 ECONNREFUSED → connection_failed',
  classifyImapError({ code: 'ECONNREFUSED', message: 'Connection refused' }), 'connection_failed');
expect('8.8 ETIMEDOUT → connection_failed',
  classifyImapError({ code: 'ETIMEDOUT', message: 'Timed out' }), 'connection_failed');
expect('8.9 ENOTFOUND → connection_failed',
  classifyImapError({ code: 'ENOTFOUND', message: 'DNS lookup failed' }), 'connection_failed');
expect('8.10 null err → connection_failed (defensive)',
  classifyImapError(null), 'connection_failed');
expect('8.11 empty err → connection_failed',
  classifyImapError({}), 'connection_failed');

console.log('\n── 9) Davranış — formatInboxTestMessage sim ─');

function formatInboxTestMessage(result) {
  switch (result.code) {
    case 'ok': return 'Bağlantı başarılı — polling için hazır.';
    case 'auth_failed': return "Kimlik doğrulama başarısız — kullanıcı adı / App Password'ü kontrol et.";
    case 'connection_failed': return "Sunucu/port erişilemiyor — IT'den 993 giden erişimini doğrulat.";
    case 'config_incomplete': return 'IMAP host / kullanıcı adı / şifre eksik.';
    case 'inbox_disabled': return 'Inbox pasif — önce aktifleştir.';
    case 'inbox_invalid': return 'Inbox tanımı geçersiz.';
    case 'not_found': return 'Inbox bulunamadı — listeyi yenile.';
    default: return result.message || 'Bilinmeyen hata.';
  }
}

expect('9.1 ok → başarı mesajı',
  formatInboxTestMessage({ ok: true, code: 'ok', message: '' }).includes('başarılı'), true);
expect('9.2 auth_failed → App Password yönlendirmesi',
  formatInboxTestMessage({ ok: false, code: 'auth_failed', message: '' }).includes('App Password'), true);
expect('9.3 connection_failed → IT / 993 yönlendirmesi',
  formatInboxTestMessage({ ok: false, code: 'connection_failed', message: '' }).includes('993'), true);
expect('9.4 config_incomplete → eksik açıklaması',
  formatInboxTestMessage({ ok: false, code: 'config_incomplete', message: '' }).includes('eksik'), true);
expect('9.5 inbox_disabled → aktifleştir mesajı',
  formatInboxTestMessage({ ok: false, code: 'inbox_disabled', message: '' }).includes('aktifle'), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
