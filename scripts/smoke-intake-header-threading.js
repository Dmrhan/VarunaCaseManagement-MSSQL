/**
 * smoke-intake-header-threading.js — 2026-07-03
 *
 * Mail intake header threading fix'i:
 *   Müşteri konu satırında [PREFIX-xxx] token'ı OLMADAN Re: ile cevap
 *   verdiğinde (ek unutma senaryosu), In-Reply-To + References
 *   header'larındaki Message-ID'lerle mevcut vaka thread'ine bağlanır.
 *
 * Kapsam:
 *  1. collectHeaderMessageIds helper — inReplyTo + references parse
 *  2. Intake token akışı DOKUNULMADI (regresyonsuz)
 *  3. Header threading branch: token yoksa devrede
 *  4. companyId scoped lookup (cross-tenant guard)
 *  5. Terminal + k3Enabled → K3 (yeni vaka)
 *  6. Değilse → append + return 'appended_via_header'
 *
 * Test: pattern doğrulama + saf davranış simülasyonu.
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

const intake = read('server/lib/inboundMailIntake.js');
const intakeCode = strip(intake);

console.log('── 1) collectHeaderMessageIds helper ─────────────');
expect('1.1 helper tanımı',
  /function collectHeaderMessageIds\(parsed\)/.test(intake), true);
expect('1.2 inReplyTo string trim',
  /parsed\?\.inReplyTo && typeof parsed\.inReplyTo === 'string'[\s\S]{0,200}\.trim\(\)/.test(intakeCode), true);
expect('1.3 references array iteration',
  /Array\.isArray\(refs\)[\s\S]{0,300}typeof r === 'string' && r\.trim\(\)/.test(intakeCode), true);
expect('1.4 references string split whitespace (defensive)',
  /typeof refs === 'string' && refs\.trim\(\)[\s\S]{0,300}refs\.split\(\/\\s\+\/\)/.test(intakeCode), true);
expect('1.5 Set ile dedupe',
  /const ids = new Set\(\)[\s\S]{0,600}return \[\.\.\.ids\]/.test(intakeCode), true);

console.log('\n── 2) Header threading branch — intake flow ────');
expect('2.1 A2 branch başlığı (2026-07-03 fix)',
  /A2\) HEADER THREADING \(2026-07-03 fix\)/.test(intake), true);
// 2026-07-16 fix (mükerrer zincir): eski subjectTokenResolvedCase gate'i
// KALDIRILDI — token TERMINAL vakaya çıktığında da header threading koşar
// (token AÇIK vakaya append eden yol zaten erken return ediyor).
expect('2.2 Gate kaldırıldı: header threading token-terminal K3 yolunda da devrede',
  !/subjectTokenResolvedCase/.test(intake)
  && /token terminal[\s\S]{0,900}collectHeaderMessageIds\(parsed\)/.test(intake), true);
expect('2.2b Regresyon — `if (!token)` guard\'ı A2 branch\'inden KALDIRILDI',
  !/A2\) HEADER THREADING[\s\S]{0,600}if \(!token\)/.test(intake), true);
expect('2.3 companyId scoped lookup (cross-tenant guard) — findMany (2026-07-16: açık-öncelikli seçim)',
  /prisma\.caseEmail\.findMany\(\{[\s\S]{0,400}where: \{ companyId, messageId: \{ in: headerIds \} \}/.test(intakeCode), true);
expect('2.4 inbound + outbound satırlar — direction filter YOK (guard: müşteri bizim ACK\'e de cevap verir)',
  !/direction:\s*'inbound'/.test(intake.substring(intake.indexOf('A2) HEADER THREADING'), intake.indexOf('YENİ VAKA'))), true);
expect('2.5 En yeni eşleşme (deterministic) — orderBy createdAt desc',
  /messageId: \{ in: headerIds \}[\s\S]{0,400}orderBy: \{ createdAt: 'desc' \}/.test(intakeCode), true);
expect('2.6 Case scope — vaka durumu tenant-kapsamlı sorgunun relation select\'inden gelir (2026-07-16)',
  /case: \{ select: \{ id: true, status: true, caseNumber: true, isArchived: true \} \}/.test(intakeCode), true);
expect('2.7 Açık-öncelikli seçim (2026-07-16): terminal olmayan + arşivsiz eşleşme önce; yoksa en yeni',
  /!TERMINAL_FOR_PICK\.has\(m\.case\.status\) && !m\.case\.isArchived/.test(intakeCode)
  && /\?\? matchedEmails\[0\] \?\? null/.test(intakeCode), true);

console.log('\n── 3) K3 terminal kuralı — header branch ───────');
expect('3.1 TERMINAL_STATUSES_DB Set (\'Cozuldu\',\'IptalEdildi\') reuse',
  /collectHeaderMessageIds\(parsed\)[\s\S]{0,6000}TERMINAL_STATUSES_DB = new Set\(\['Cozuldu', 'IptalEdildi'\]\)/.test(intakeCode), true);
expect('3.2 k3Enabled env flag reuse — M6_K3_NEW_TICKET_ON_TERMINAL',
  /collectHeaderMessageIds\(parsed\)[\s\S]{0,6500}process\.env\.M6_K3_NEW_TICKET_ON_TERMINAL/.test(intakeCode), true);
expect('3.3 Terminal + k3Enabled → fall through (yeni vaka)',
  /if \(TERMINAL_STATUSES_DB\.has\(existing\.status\) && k3Enabled\)[\s\S]{0,400}headerMatchedMessageId = matchedEmail\.messageId/.test(intakeCode), true);
expect('3.4 K3 branch audit — headerMatchedMessageId set',
  /headerMatchedMessageId = matchedEmail\.messageId/.test(intake), true);

console.log('\n── 4) Append branch — appendInbound + return ────');
expect('4.1 caseEmailRepository.appendInbound çağrısı',
  /collectHeaderMessageIds\(parsed\)[\s\S]{0,7500}caseEmailRepository\.appendInbound\(\{[\s\S]{0,300}caseId: existing\.id/.test(intakeCode), true);
expect('4.2 inReplyTo + refs geçirilir',
  /caseEmailRepository\.appendInbound\(\{[\s\S]{0,1200}inReplyTo: parsed\.inReplyTo \?\? null/.test(intake), true);
expect('4.3 persistAttachmentsForCase — deduped ise SKIP',
  /collectHeaderMessageIds\(parsed\)[\s\S]{0,9000}if \(!inboundEmail\.deduped\)[\s\S]{0,400}persistAttachmentsForCase/.test(intakeCode), true);
expect('4.4 return action: appended_via_header (teşhis)',
  /action: inboundEmail\.deduped \? 'appended_deduped' : 'appended_via_header'/.test(intake), true);
expect('4.5 return headerMatch.messageId (audit)',
  /headerMatch: \{ messageId: matchedEmail\.messageId \}/.test(intake), true);
expect('4.6 return token: null (header eşleşmesi, token yok)',
  /collectHeaderMessageIds\(parsed\)[\s\S]{0,10000}token: null,\s*\n\s*headerMatch/.test(intakeCode), true);

console.log('\n── 5) Yeni vaka return — K3 headerMatch audit ────');
expect('5.1 created return — headerMatchedMessageId varsa audit alanı ekle',
  /\.\.\.\(headerMatchedMessageId \? \{ headerMatch: \{ messageId: headerMatchedMessageId, k3: true \} \} : \{\}\)/.test(intake), true);

console.log('\n── 6) Regresyon — token flow dokunulmadı ────────');
expect('6.1 A) THREAD eşleşmesi (subject token\'ları) korundu',
  /A\) THREAD eşleşmesi \(subject token'ları\)/.test(intake), true);
expect('6.2 extractCaseTokensFromSubject korundu',
  /const tokens = extractCaseTokensFromSubject\(parsed\.subject\)/.test(intake), true);
expect('6.3 token flow K3 kontrolü korundu',
  /A\) THREAD eşleşmesi[\s\S]{0,3000}K3 OVERRIDE \(M6\.1\)/.test(intake), true);
expect('6.4 token flow appendInbound korundu',
  /A\) THREAD eşleşmesi[\s\S]{0,4000}caseEmailRepository\.appendInbound/.test(intake), true);

console.log('\n── 6b) 2026-07-16 zincir-devamlılığı — flag/gate kaldırıldı ───');
expect('6b.1 subjectTokenResolvedCase flag\'i tamamen kaldırıldı (ölü değer yok)',
  !/subjectTokenResolvedCase/.test(intake), true);
expect('6b.2 fix niyeti belgeli: zincirde açık vaka varsa cevap oraya eklenir',
  /zincirde açık vaka varsa/.test(intake), true);
expect('6b.3 K3 davranışı korunuyor: terminal + k3Enabled fall-through hâlâ mevcut',
  /TERMINAL_STATUSES_DB\.has\(existing\.status\) && k3Enabled/.test(intake), true);

console.log('\n── 7) Davranış — collectHeaderMessageIds sim ──');

function collectHeaderMessageIds(parsed) {
  const ids = new Set();
  if (parsed?.inReplyTo && typeof parsed.inReplyTo === 'string') {
    const clean = parsed.inReplyTo.trim();
    if (clean) ids.add(clean);
  }
  const refs = parsed?.references;
  if (Array.isArray(refs)) {
    for (const r of refs) {
      if (typeof r === 'string' && r.trim()) ids.add(r.trim());
    }
  } else if (typeof refs === 'string' && refs.trim()) {
    for (const r of refs.split(/\s+/)) {
      if (r.trim()) ids.add(r.trim());
    }
  }
  return [...ids];
}

expect('7.1 inReplyTo tek → tek ID',
  JSON.stringify(collectHeaderMessageIds({ inReplyTo: '<abc@host>' })),
  '["<abc@host>"]');
expect('7.2 inReplyTo boş → boş',
  JSON.stringify(collectHeaderMessageIds({ inReplyTo: '' })),
  '[]');
expect('7.3 references array — 3 ID',
  JSON.stringify(collectHeaderMessageIds({ references: ['<a@h>', '<b@h>', '<c@h>'] })),
  '["<a@h>","<b@h>","<c@h>"]');
expect('7.4 inReplyTo + references — dedupe',
  JSON.stringify(collectHeaderMessageIds({ inReplyTo: '<a@h>', references: ['<a@h>', '<b@h>'] })),
  '["<a@h>","<b@h>"]');
expect('7.5 references space-separated string',
  JSON.stringify(collectHeaderMessageIds({ references: '<a@h> <b@h> <c@h>' })),
  '["<a@h>","<b@h>","<c@h>"]');
expect('7.6 parsed null → boş',
  JSON.stringify(collectHeaderMessageIds(null)), '[]');
expect('7.7 parsed boş obje → boş',
  JSON.stringify(collectHeaderMessageIds({})), '[]');
expect('7.8 references array + boş string filter',
  JSON.stringify(collectHeaderMessageIds({ references: ['<a@h>', '', '  ', '<b@h>'] })),
  '["<a@h>","<b@h>"]');
expect('7.9 inReplyTo whitespace trim',
  JSON.stringify(collectHeaderMessageIds({ inReplyTo: '  <x@h>  ' })),
  '["<x@h>"]');

console.log('\n── 8) Davranış — end-to-end senaryo simülasyonu ──');

// Simüle edilmiş CaseEmail deposu
const caseEmailsDb = [
  { id: 'ce1', companyId: 'UNIVERA', caseId: 'case-alpha', direction: 'inbound', messageId: '<msg-1@ext.com>' },
  { id: 'ce2', companyId: 'UNIVERA', caseId: 'case-alpha', direction: 'outbound', messageId: '<varuna-out-1@varuna.local>' },
  { id: 'ce3', companyId: 'PARAM', caseId: 'case-beta', direction: 'inbound', messageId: '<msg-cross@ext.com>' },
];
const casesDb = [
  { id: 'case-alpha', companyId: 'UNIVERA', status: 'Acik', caseNumber: 'UNV-1000042' },
  { id: 'case-beta', companyId: 'PARAM', status: 'Acik', caseNumber: 'PRM-1000010' },
  { id: 'case-terminal', companyId: 'UNIVERA', status: 'Cozuldu', caseNumber: 'UNV-1000050' },
];

async function findMatchedEmail(companyId, headerIds) {
  return caseEmailsDb.find(
    (e) => e.companyId === companyId && headerIds.includes(e.messageId),
  ) ?? null;
}
async function findCase(id, companyId) {
  return casesDb.find((c) => c.id === id && c.companyId === companyId) ?? null;
}

async function simulateHeaderThreading(parsed, companyId) {
  const ids = collectHeaderMessageIds(parsed);
  if (ids.length === 0) return { action: 'no_headers', decision: 'new_case' };
  const matched = await findMatchedEmail(companyId, ids);
  if (!matched) return { action: 'no_match', decision: 'new_case' };
  const existing = await findCase(matched.caseId, companyId);
  if (!existing) return { action: 'case_gone', decision: 'new_case' };
  const TERMINAL = new Set(['Cozuldu', 'IptalEdildi']);
  const k3Enabled = true;
  if (TERMINAL.has(existing.status) && k3Enabled) {
    return { action: 'terminal_k3', decision: 'new_case', existingCaseId: existing.id };
  }
  return { action: 'appended_via_header', decision: 'append', existingCaseId: existing.id, matchedMessageId: matched.messageId };
}

// Senaryo 1: Mail#1 ilk kez gelir (In-Reply-To yok) → yeni vaka
const s1 = await simulateHeaderThreading({}, 'UNIVERA');
expect('8.1 Mail#1 (In-Reply-To yok) → yeni vaka', s1.decision, 'new_case');
expect('8.1b action=no_headers', s1.action, 'no_headers');

// Senaryo 2: Mail#2 (In-Reply-To=Mail#1.messageId) → aynı vakaya append
const s2 = await simulateHeaderThreading({ inReplyTo: '<msg-1@ext.com>' }, 'UNIVERA');
expect('8.2 Mail#2 header eşleşir → append', s2.decision, 'append');
expect('8.2b caseId = case-alpha', s2.existingCaseId, 'case-alpha');

// Senaryo 3: Müşteri bizim outbound ACK'imize cevap verir → yine append
const s3 = await simulateHeaderThreading({ inReplyTo: '<varuna-out-1@varuna.local>' }, 'UNIVERA');
expect('8.3 Bizim outbound ACK\'e cevap → append', s3.decision, 'append');
expect('8.3b caseId = case-alpha', s3.existingCaseId, 'case-alpha');

// Senaryo 4: Cross-tenant messageId → eşleşmez
const s4 = await simulateHeaderThreading({ inReplyTo: '<msg-cross@ext.com>' }, 'UNIVERA');
expect('8.4 UNIVERA scoped lookup + PARAM messageId → no_match', s4.action, 'no_match');
expect('8.4b decision: new_case', s4.decision, 'new_case');

// Senaryo 5: References'ta 3 ID, ortadaki eşleşiyor → bulunur
const s5 = await simulateHeaderThreading({
  references: ['<no-match-1@x.com>', '<msg-1@ext.com>', '<no-match-2@y.com>'],
}, 'UNIVERA');
expect('8.5 References ortada eşleşme → append', s5.decision, 'append');
expect('8.5b caseId = case-alpha', s5.existingCaseId, 'case-alpha');

// Senaryo 6: Terminal vakaya header-eşleşen cevap → K3 (yeni vaka)
// case-terminal için önce bir CaseEmail ekleyelim
caseEmailsDb.push({ id: 'ce4', companyId: 'UNIVERA', caseId: 'case-terminal', direction: 'inbound', messageId: '<msg-terminal@ext.com>' });
const s6 = await simulateHeaderThreading({ inReplyTo: '<msg-terminal@ext.com>' }, 'UNIVERA');
expect('8.6 Terminal (Cozuldu) + k3Enabled → K3 yeni vaka', s6.decision, 'new_case');
expect('8.6b action=terminal_k3 (audit için existing.id taşınır)', s6.action, 'terminal_k3');
expect('8.6c existing case referansı korundu (headerMatchedMessageId audit)', s6.existingCaseId, 'case-terminal');

// Senaryo 7: Boş In-Reply-To + boş references → new_case
const s7 = await simulateHeaderThreading({ inReplyTo: '', references: [] }, 'UNIVERA');
expect('8.7 boş header → new_case', s7.decision, 'new_case');
expect('8.7b action=no_headers', s7.action, 'no_headers');

console.log('\n── 9) Codex P2 R1 — token candidate resolve OLMADI + header eşleşti ──');

// Bug öncesi senaryo:
//   Subject: "Re: [ABC-1234567] Konu"   (dış ticket referansı, Varuna'da YOK)
//   In-Reply-To: <msg-1@ext.com>        (case-alpha'ya ait, gerçek)
// Önceki guard `if (!token)` — tokens[0] = 'ABC-1234567' set edilirdi
// (candidate resolve olmasa bile) → !token = false → header threading atlanır
// → **mükerrer vaka** açılırdı.

function simulateTokenFlow(subject) {
  const rx = /\[([A-Z]{2,4}-\d{2,})\]/g;
  const tokens = [];
  let m;
  while ((m = rx.exec(subject)) !== null) tokens.push(m[1]);
  const token = tokens[0] ?? null;
  const resolvedCaseNumbers = new Set(['UNV-1000042', 'UNV-1000050', 'PRM-1000010']);
  let subjectTokenResolvedCase = false;
  for (const cand of tokens) {
    if (resolvedCaseNumbers.has(cand)) { subjectTokenResolvedCase = true; break; }
  }
  return { token, subjectTokenResolvedCase };
}

// Bug senaryosu — ESKI guard davranışı vs YENİ guard davranışı
const bug = simulateTokenFlow('Re: [ABC-1234567] Konu');
expect('9.1 tokens[0] = ABC-1234567 (unresolved external ref)', bug.token, 'ABC-1234567');
expect('9.2 subjectTokenResolvedCase = false (Varuna\'da yok)', bug.subjectTokenResolvedCase, false);
expect('9.3 ESKI guard `!token` = false → header threading ATLANIR (BUG)', !bug.token, false);
expect('9.4 YENİ guard `!subjectTokenResolvedCase` = true → header threading ÇALIŞIR (FIX)',
  !bug.subjectTokenResolvedCase, true);

// Şimdi header eşleşmesi simülasyonu (In-Reply-To valid)
const bugFix = await simulateHeaderThreading({ inReplyTo: '<msg-1@ext.com>' }, 'UNIVERA');
expect('9.5 Header lookup case-alpha bulur (YENİ guard sayesinde çalışır)',
  bugFix.existingCaseId, 'case-alpha');
expect('9.6 decision = append (mükerrer vaka önlendi)',
  bugFix.decision, 'append');

// Karşı-senaryo: token gerçekten resolve → header threading ATLANIR (K3 gereksiz iş)
const ok = simulateTokenFlow('Re: [UNV-1000042] Konu');
expect('9.7 tokens[0] = UNV-1000042 (Varuna\'da var)', ok.token, 'UNV-1000042');
expect('9.8 subjectTokenResolvedCase = true → header threading atlanır (gereksiz DB query yok)',
  ok.subjectTokenResolvedCase, true);
expect('9.9 YENİ guard `!subjectTokenResolvedCase` = false → header threading SKIP (doğru)',
  !ok.subjectTokenResolvedCase, false);

// Çoklu token: dış + Varuna karışık
const mixed = simulateTokenFlow('Re: [ABC-1234567] [UNV-1000042] Konu');
expect('9.10 tokens[0] dış (ilk match), ama existing var → resolve = true',
  mixed.subjectTokenResolvedCase, true);
expect('9.11 Header threading atlanır (token flow zaten çözdü)',
  !mixed.subjectTokenResolvedCase, false);

// Hiç token yok + header valid → header threading (klasik senaryo)
const noToken = simulateTokenFlow('Re: Konu ek unutmuşum');
expect('9.12 token = null (hiç bracket yok)', noToken.token, null);
expect('9.13 subjectTokenResolvedCase = false', noToken.subjectTokenResolvedCase, false);
expect('9.14 Header threading çalışır', !noToken.subjectTokenResolvedCase, true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
