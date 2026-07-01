/**
 * smoke-notification-rule-channel-priority.js
 *
 * BULGU (2026-07-01 üretim tespit):
 *   R3 case_closed / customer_primary_contact — Email kanalı seçili AMA
 *   sistem müşteri iletişim tercihini (AccountCompany.preferredResponseChannel='phone')
 *   öncelikli kabul edip telefon numarası döndürüyordu; executor
 *   isLikelyEmail(phone)=false → Pending kayıp.
 *
 *   R2 status_changed / requester — customerContactEmail boş (manuel açılan
 *   vakalarda) → sentinel "manual" → Pending kayıp. Müşterinin gerçek
 *   email adresi Account/AccountContact'ta OLMASINA rağmen bakılmıyordu.
 *
 * FIX (sistemsel):
 *   1. resolveCustomerCommunication(preferChannel) — kural kanalı EN YÜKSEK
 *      öncelik (rule_channel > case_override > accountCompany.pref >
 *      contact.pref > account fallback).
 *   2. requester case — customerContactEmail boş + ruleChannel='Email' →
 *      AccountContact.email → Account.email fallback (opt-out akışı
 *      korundu; suppressionReason semantiği bozulmadı).
 *   3. resolveAudienceRow + emitEvent — ruleChannel signature'a eklendi;
 *      customer_primary_contact ve requester case'lerinde propagate.
 *
 * KAPSAM (static + davranış):
 *   - Fonksiyon imzaları güncel
 *   - Kanal seçim öncelik zinciri (rule_channel > diğerleri)
 *   - Requester fallback koşulu (ruleChannel==='Email' + accountId)
 *   - Opt-out akışı korundu (regression)
 *   - Backward-compat: preferChannel/ruleChannel verilmezse eski davranış
 */

import { readFileSync } from 'node:fs';

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

const src = read('server/db/notificationRepository.js');
const code = strip(src);

// ─── 1) Signature değişimleri ────────────────────────────────────
console.log('── 1) Signature — preferChannel + ruleChannel ────');
expect('1.1 resolveCustomerCommunication({ caseRow, preferChannel = null })',
  /export async function resolveCustomerCommunication\(\{\s*caseRow,\s*preferChannel\s*=\s*null\s*\}\)/.test(code), true);
expect('1.2 resolveAudienceRow({ row, caseRow, approval, ruleChannel = null })',
  /async function resolveAudienceRow\(\{\s*row,\s*caseRow,\s*approval,\s*ruleChannel\s*=\s*null\s*\}\)/.test(code), true);
expect('1.3 emitEvent caller ruleChannel: rule.channel geçirir',
  /resolveAudienceRow\(\{\s*row: audienceRow,\s*caseRow,\s*approval: approvalContext,\s*ruleChannel: rule\.channel/.test(code), true);
expect('1.4 customer_primary_contact case → resolveCustomerCommunication preferChannel: ruleChannel geçirir',
  /await resolveCustomerCommunication\(\{[\s\S]{0,200}caseRow,[\s\S]{0,100}preferChannel: ruleChannel[\s\S]{0,100}\}\)/.test(code), true);

// ─── 2) Kanal seçim önceliği ─────────────────────────────────────
console.log('\n── 2) Kanal seçim — rule_channel EN ÜST öncelik ──');
expect('2.1 preferredByRule ilk kontrol → source=rule_channel',
  /if \(preferredByRule\) \{[\s\S]{0,300}channel = preferredByRule[\s\S]{0,200}source = 'rule_channel'/.test(code), true);
expect('2.2 caseOverride artık !channel guard\'lı (rule\'a düşük öncelik)',
  /if \(!channel && caseOverride\) \{[\s\S]{0,200}source = 'case_override'/.test(code), true);
expect('2.3 accountCompany.preferredResponseChannel !channel guard\'lı',
  /if \(!channel && accountCompany\?\.preferredResponseChannel\)/.test(code), true);
expect('2.4 primaryContact.preferredChannel !channel guard\'lı',
  /if \(!channel && primaryContact\?\.preferredChannel\)/.test(code), true);
expect('2.5 preferredByRule = normalizeCustomerChannel(preferChannel)',
  /const preferredByRule = normalizeCustomerChannel\(preferChannel\)/.test(code), true);

// ─── 3) Requester fallback (customerContactEmail boş + rule=Email) ───
console.log('\n── 3) Requester fallback — AccountContact + Account.email ──');
expect('3.1 ruleAsksEmail bool türetimi',
  /const ruleAsksEmail = String\(ruleChannel \?\? ''\)\.toLowerCase\(\) === 'email'/.test(code), true);
expect('3.2 Fallback yalnız ruleAsksEmail + caseRow.accountId iken',
  /if \(ruleAsksEmail && caseRow\?\.accountId\) \{/.test(code), true);
expect('3.3 AccountContact.email (primary) sorgusu',
  /accountContact\.findFirst\(\{[\s\S]{0,400}isPrimary: true, isActive: true[\s\S]{0,300}select: \{ email: true/.test(code), true);
expect('3.4 Account.email sorgusu',
  /account\.findUnique\(\{[\s\S]{0,300}where: \{ id: caseRow\.accountId \}[\s\S]{0,200}select: \{ email: true \}/.test(code), true);
expect('3.5 fallbackEmail = primaryContact.email || account.email',
  /fallbackEmail\s*=[\s\S]{0,300}primaryContact\?\.email[\s\S]{0,200}account\?\.email/.test(code), true);
expect('3.6 fallbackEmail bulunduysa audienceIdentifier: fallbackEmail (Sent yolu açılır)',
  /if \(fallbackEmail\) \{[\s\S]{0,500}audienceIdentifier: fallbackEmail[\s\S]{0,300}resolvedChannel: 'email'/.test(code), true);
expect('3.7 resolutionSource — primary contact varsa "account_contact", yoksa "account_fallback"',
  /primaryContact\?\.email \? 'account_contact' : 'account_fallback'/.test(code), true);

// ─── 4) Regression — opt-out + "manual" fallback korundu ────────
console.log('\n── 4) Regression — opt-out + manual korundu ────');
expect('4.1 AccountCompany.allowCustomerNotifications=false → opted_out (requester)',
  /case 'requester'[\s\S]{0,2000}allowCustomerNotifications === false[\s\S]{0,400}audienceIdentifier: 'opted_out'/.test(code), true);
expect('4.2 email dolu erken return (mevcut mail intake akışı)',
  /if \(email\) \{[\s\S]{0,500}audienceIdentifier: email[\s\S]{0,200}resolutionSource: 'case_override'/.test(code), true);
expect('4.3 Fallback bulamadıysa manual sentinel + keepPending korundu',
  /audienceIdentifier: 'manual'[\s\S]{0,400}suppressionReason: 'no_channel_available'[\s\S]{0,200}keepPending: true/.test(code), true);
expect('4.4 resolveCustomerCommunication — ruleChannel yoksa (undefined) eski davranış',
  /preferChannel\s*=\s*null/.test(code)
    && /if \(preferredByRule\)/.test(code), true);

// ─── 5) Fonksiyon runtime davranış — pure conditions ─────────────
console.log('\n── 5) Davranış simülasyonu (pure) ─────────────────');

// Pure recreate: normalizeCustomerChannel
const CUSTOMER_CHANNEL_VALUES = ['email', 'phone', 'manual', 'portal'];
function normalizeCustomerChannel(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return CUSTOMER_CHANNEL_VALUES.includes(s) ? s : null;
}

// Kanal seçim algoritması — src'deki mantığı birebir taklit
function pickChannel({ preferChannel, caseOverride, acPref, contactPref, accountEmail, accountPhone }) {
  const preferredByRule = normalizeCustomerChannel(preferChannel);
  let channel = null;
  let source = 'none';
  if (preferredByRule) { channel = preferredByRule; source = 'rule_channel'; }
  const co = normalizeCustomerChannel(caseOverride);
  if (!channel && co) { channel = co; source = 'case_override'; }
  if (!channel && acPref) {
    const v = normalizeCustomerChannel(acPref);
    if (v) { channel = v; source = 'account_company'; }
  }
  if (!channel && contactPref) {
    const v = normalizeCustomerChannel(contactPref);
    if (v) { channel = v; source = 'account_contact'; }
  }
  if (!channel) {
    if (accountEmail) { channel = 'email'; source = 'account_fallback'; }
    else if (accountPhone) { channel = 'phone'; source = 'account_fallback'; }
    else { channel = 'manual'; source = 'none'; }
  }
  return { channel, source };
}

// R3 bulgusu: rule=Email + AC.pref=phone → şimdi rule öncelikli
expect('5.1 rule=Email + AC.pref=phone → email (rule_channel)',
  JSON.stringify(pickChannel({ preferChannel: 'Email', acPref: 'phone', accountEmail: 'x@y.com' })),
  JSON.stringify({ channel: 'email', source: 'rule_channel' }));

// rule=Email + AC.pref=email → email (rule)
expect('5.2 rule=Email + AC.pref=email → email (rule_channel)',
  JSON.stringify(pickChannel({ preferChannel: 'Email', acPref: 'email' })),
  JSON.stringify({ channel: 'email', source: 'rule_channel' }));

// rule=InApp (customer resolver çağrılmasa da) — rule kanalı iletişim
// tercihi olarak geçmezse eski davranış:
expect('5.3 rule yok (null) + AC.pref=phone → phone (account_company, backward-compat)',
  JSON.stringify(pickChannel({ preferChannel: null, acPref: 'phone' })),
  JSON.stringify({ channel: 'phone', source: 'account_company' }));

expect('5.4 rule=Email + case_override=phone → email (rule > case_override)',
  JSON.stringify(pickChannel({ preferChannel: 'Email', caseOverride: 'phone', acPref: 'email' })),
  JSON.stringify({ channel: 'email', source: 'rule_channel' }));

expect('5.5 rule=null + case_override=phone → phone (case_override backward)',
  JSON.stringify(pickChannel({ preferChannel: null, caseOverride: 'phone', acPref: 'email' })),
  JSON.stringify({ channel: 'phone', source: 'case_override' }));

expect('5.6 rule=null + hiçbir pref yok + account.phone dolu → phone (account_fallback)',
  JSON.stringify(pickChannel({ accountPhone: '+900' })),
  JSON.stringify({ channel: 'phone', source: 'account_fallback' }));

expect('5.7 rule=null + hiçbir pref/data yok → manual (none)',
  JSON.stringify(pickChannel({})),
  JSON.stringify({ channel: 'manual', source: 'none' }));

expect('5.8 rule=EMAIL (uppercase) — normalize edilir → email',
  JSON.stringify(pickChannel({ preferChannel: 'EMAIL' })),
  JSON.stringify({ channel: 'email', source: 'rule_channel' }));

// Requester fallback koşulu
function requesterFallbackShouldFire({ email, ruleChannel, accountId }) {
  if (email) return { path: 'email_ok', identifier: email };
  const ruleAsksEmail = String(ruleChannel ?? '').toLowerCase() === 'email';
  if (ruleAsksEmail && accountId) return { path: 'fallback_try' };
  return { path: 'manual_sentinel', identifier: 'manual' };
}

console.log('\n── 6) Requester fallback koşulu ────────────────');
expect('6.1 email dolu → doğrudan email',
  JSON.stringify(requesterFallbackShouldFire({ email: 'a@b.com' })),
  JSON.stringify({ path: 'email_ok', identifier: 'a@b.com' }));
expect('6.2 email boş + rule=Email + accountId → fallback try',
  JSON.stringify(requesterFallbackShouldFire({ email: '', ruleChannel: 'Email', accountId: 'acc1' })),
  JSON.stringify({ path: 'fallback_try' }));
expect('6.3 email boş + rule=Email + accountId YOK → manual (fallback yapamıyor)',
  JSON.stringify(requesterFallbackShouldFire({ email: '', ruleChannel: 'Email' })),
  JSON.stringify({ path: 'manual_sentinel', identifier: 'manual' }));
expect('6.4 email boş + rule=InApp → manual (fallback devre dışı; email göndermiyor zaten)',
  JSON.stringify(requesterFallbackShouldFire({ email: '', ruleChannel: 'InApp', accountId: 'acc1' })),
  JSON.stringify({ path: 'manual_sentinel', identifier: 'manual' }));
expect('6.5 email boş + rule=null (eski çağrı) → manual (backward-compat)',
  JSON.stringify(requesterFallbackShouldFire({ email: '' })),
  JSON.stringify({ path: 'manual_sentinel', identifier: 'manual' }));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
