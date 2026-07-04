/**
 * smoke-pr2-r9-list-anatomy.js — 2026-07-04
 *
 * PR-2 R9 — Mesaj listesi Gmail bilgi mimarisi:
 *   1. 2-satırlı satır (yön+gönderen+tarih / snippet+ek)
 *   2. Konu satırda tekrar YOK; token ([UNV-xxx]) da yok
 *   3. Konu-değişti istisnası ("Konu değişti: X — snippet")
 *   4. Gönderen ("Siz · <name>" / "Varuna · Otomatik" / kişi adı)
 *   5. Akıllı tarih (bugün HH:mm / bu yıl "3 Tem" / eski dd.MM.yyyy)
 *   6. Sıralama toggle (default YENİ→ESKİ, localStorage)
 *   7. Yön ayrımı zemin (giden hafif soluk)
 *   8. Tek bileşen — iki listede aynı davranış (çatal yok)
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }

const norm = read('src/lib/subjectNormalizer.ts');
const smart = read('src/lib/smartDate.ts');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── 1) normalizeSubject stripCaseToken option ─');
expectTrue('1.1 Signature: options?: { stripCaseToken?: boolean }',
  /options\?:\s*\{\s*stripCaseToken\?:\s*boolean\s*\}/.test(norm));
expectTrue('1.2 strip true → cleaned (token atlanır)',
  /if \(strip\) return cleaned/.test(norm));
expectTrue('1.3 Empty result + strip → rest (token\'sız)',
  /if \(strip\) return rest\.trim\(\)/.test(norm));

console.log('\n── 2) Davranış — stripCaseToken sim ─────────');
function normalizeSubject(raw, options) {
  if (raw == null) return '';
  const input = String(raw);
  if (!input.trim()) return input;
  const CASE_TOKEN_RE = /^\s*(\[[A-Z]{2,5}-\d+\])\s*/;
  const PREFIX_RE = /^\s*(?:re|fw|fwd|ynt|yanıt|yanit)\s*:\s*/i;
  const BRACKET_NOISE_RE = /^\s*\[(?:external|ext|d[ıi][şs]|har[ıi]c[ıi])\]\s*/i;
  const t = input.match(CASE_TOKEN_RE);
  let token = '', rest = input;
  if (t) { token = t[1]; rest = input.slice(t[0].length); }
  let prev = '', cleaned = rest, iter = 0;
  while (cleaned !== prev && iter < 32) {
    prev = cleaned;
    cleaned = cleaned.replace(PREFIX_RE, '').replace(BRACKET_NOISE_RE, '');
    iter++;
  }
  cleaned = cleaned.trim();
  const strip = options?.stripCaseToken === true;
  if (!cleaned) {
    if (strip) return rest.trim();
    return token ? `${token} ${rest.trim()}`.trim() : input.trim();
  }
  if (strip) return cleaned;
  return token ? `${token} ${cleaned}` : cleaned;
}

expect('2.1 "[UNV-1000066] RE: X" stripCaseToken=true → "X"',
  normalizeSubject('[UNV-1000066] RE: X', { stripCaseToken: true }), 'X');
expect('2.2 stripCaseToken=false (default) → "[UNV-1000066] X"',
  normalizeSubject('[UNV-1000066] RE: X'), '[UNV-1000066] X');
expect('2.3 Token yok + strip → normalize',
  normalizeSubject('RE: Konu', { stripCaseToken: true }), 'Konu');
expect('2.4 Token yok + strip=false → normalize',
  normalizeSubject('RE: Konu'), 'Konu');
expect('2.5 Regresyon: mevcut çağırılar default davranışta',
  normalizeSubject('RE: [EXTERNAL]RE: RE: X'), 'X');

console.log('\n── 3) smartDate util ────────────────────────');
expectTrue('3.1 formatSmartDate export',
  /export function formatSmartDate/.test(smart));
expectTrue('3.2 formatSmartDateFull export (tooltip)',
  /export function formatSmartDateFull/.test(smart));
expectTrue('3.3 Türkçe ay kısaltmaları (12 ay)',
  /TR_MONTHS_SHORT\s*=\s*\[[\s\S]{0,300}'Tem'[\s\S]{0,200}'Ara'/.test(smart));

console.log('\n── 4) Davranış — formatSmartDate sim ────────');
const TR_M = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function formatSmartDate(iso, now) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return `${d.getDate()} ${TR_M[d.getMonth()]}`;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const NOW = new Date('2026-07-04T15:00:00Z');
// Bugün → HH:mm (UTC saati local'de değişebilir; test için basit)
const todayLater = new Date(NOW);
todayLater.setHours(14); todayLater.setMinutes(5);
expect('4.1 Bugün → HH:mm',
  formatSmartDate(todayLater.toISOString(), NOW), `${pad2(todayLater.getHours())}:05`);
// Bu yıl (farklı gün) → "3 Tem"
expect('4.2 Bu yıl (3 Temmuz 2026) → "3 Tem"',
  formatSmartDate('2026-07-03T10:00:00', NOW), '3 Tem');
// Daha eski → "dd.MM.yyyy"
expect('4.3 Eski yıl → "10.05.2025"',
  formatSmartDate('2025-05-10T10:00:00', NOW), '10.05.2025');
// Geçersiz → boş
expect('4.4 Geçersiz iso → ""',
  formatSmartDate('not-a-date', NOW), '');
expect('4.5 null → ""',
  formatSmartDate(null, NOW), '');

console.log('\n── 5) MailThreadListPane R9 pattern ─────────');
expectTrue('5.1 caseTitle?: string prop (Konu değişti karşılaştırma için)',
  /caseTitle\?:\s*string/.test(listPane));
expectTrue('5.2 sortOrder state ("newest" | "oldest") + localStorage',
  /type SortOrder\s*=\s*'newest'\s*\|\s*'oldest'[\s\S]{0,300}SORT_STORAGE_KEY\s*=\s*'pr2\.commTab\.listSortOrder'/.test(listPane));
expectTrue('5.3 Default YENİ→ESKİ',
  /return v === 'oldest' \? 'oldest' : 'newest'/.test(listPane));
expectTrue('5.4 R9.1: computeSenderDisplay ortak util\'den import (yerel tanım YOK)',
  /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(listPane)
  && !/function computeSenderDisplay\(email:\s*CaseEmailItem\)/.test(listPane));
expectTrue('5.5 computeSnippet helper (bodyText ilk satır)',
  /function computeSnippet[\s\S]{0,200}bodyText[\s\S]{0,100}\.split\('\\n'\)\[0\]/.test(listPane));

console.log('\n── 6) Sender davranış sim (R9.1 kural setine göre) ─');
// R9.1 sonrası kural — detay smoke: smoke-pr2-r9-1-sender-name-chain.js
// Burada sadece 2 kritik satır: inbound/outbound ayrımı hâlâ ListPane'in
// gösterim satırında canlı — ortak util üstünden.
function computeSenderDisplay(email, currentUserId) {
  if (email.direction === 'inbound') {
    const name = email.from.name?.trim();
    if (name) return name;
    return email.from.address.split('@')[0] || email.from.address;
  }
  if (email.source === 'notification_dispatch') return 'Varuna · Otomatik';
  if (email.sentByUserId && currentUserId && email.sentByUserId === currentUserId) return 'Siz';
  const sentByName = email.sentByName?.trim();
  if (sentByName) return sentByName;
  return email.from.name?.trim() || 'Varuna';
}

expect('6.1 Gelen ad var → ad',
  computeSenderDisplay({ direction: 'inbound', from: { name: 'Burçin Başaran', address: 'burcin@x.com' } }, 'u-me'),
  'Burçin Başaran');
expect('6.2 Gelen ad yok → adres local kısmı',
  computeSenderDisplay({ direction: 'inbound', from: { name: null, address: 'hulya.ozbey@univera.com.tr' } }, 'u-me'),
  'hulya.ozbey');
expect('6.3 R9.1: Giden + kendi mailim → "Siz" (label DÜŞTÜ)',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'agent@x.com' }, sentByUserId: 'u-me', sentByName: 'Demirhan' }, 'u-me'),
  'Siz');
expect('6.4 R9.1: Giden + başka agent → agent adı düz',
  computeSenderDisplay({ direction: 'outbound', source: 'manual_send', from: { name: 'Varuna', address: 'x@y' }, sentByUserId: 'u-other', sentByName: 'Ayşe Yılmaz' }, 'u-me'),
  'Ayşe Yılmaz');
expect('6.5 Giden otomatik/sistem → "Varuna · Otomatik"',
  computeSenderDisplay({ direction: 'outbound', source: 'notification_dispatch', from: { name: 'X', address: 'y@z' }, sentByUserId: null, sentByName: null }, 'u-me'),
  'Varuna · Otomatik');

console.log('\n── 7) UI — 2-satırlı anatomi + token yok + snippet ─');
expectTrue('7.1 stripCaseToken=true her satırda',
  /normalizeSubject\(e\.subject,\s*\{\s*stripCaseToken:\s*true\s*\}\)/.test(listPane));
expectTrue('7.2 Konu değişti istisnası — "Konu değişti: ${subjectClean}"',
  /Konu değişti: \$\{subjectClean\}/.test(listPane));
expectTrue('7.3 subjectChanged: subject !== caseTitle (both non-empty, tr-TR case-insensitive)',
  /subjectChanged\s*=[\s\S]{0,200}subjectClean\.length > 0[\s\S]{0,200}caseTitleClean\.length > 0[\s\S]{0,200}toLocaleLowerCase\('tr-TR'\)/.test(listPane));
expectTrue('7.4 1. satır: senderDisplay flex-1 + smartDate sağa',
  /senderDisplay[\s\S]{0,400}shrink-0 text-\[11px\][\s\S]{0,200}smartDate\}/.test(listPane));
expectTrue('7.5 2. satır: snippet flex-1 + 📎N shrink-0',
  /snippet[\s\S]{0,400}Paperclip[\s\S]{0,100}attachments\.length/.test(listPane));
expectTrue('7.6 Tooltip smartDateFull',
  /title=\{smartDateFull\}/.test(listPane));
expectTrue('7.7 REGRESYON: eski normalizeSubject(e.subject) tek arg KALKMIŞ (tüm satırda strip zorunlu)',
  !/normalizeSubject\(e\.subject\)(?!\s*,)/.test(listPane));

console.log('\n── 8) Sıralama toggle + başlık ──────────────');
expectTrue('8.1 Başlık: "Yazışma · N mesaj"',
  /Yazışma · <span className="font-medium">\{emails\.length\}<\/span> mesaj/.test(listPane));
expectTrue('8.2 Toggle button — ArrowUpDown icon + label',
  /ArrowUpDown[\s\S]{0,400}Yeni → Eski[\s\S]{0,100}Eski → Yeni/.test(listPane));
expectTrue('8.3 sortedEmails: newest → reverse (backend eskiden yeniye)',
  /sortOrder === 'newest' \? \[\.\.\.emails\]\.reverse\(\) : emails/.test(listPane));
expectTrue('8.4 toggleSort — save\'e persist',
  /saveSortOrder\(next\)/.test(listPane));

console.log('\n── 9) Yön ayrımı zemin (giden hafif soluk) ─');
expectTrue('9.1 outboundRowBg — inbound false ise bg-slate-*/60',
  /const outboundRowBg\s*=\s*!inbound[\s\S]{0,300}bg-slate-100\/60[\s\S]{0,200}bg-slate-50\/60/.test(listPane));

console.log('\n── 10) İki liste aynı bileşen (çatal yok) ──');
expectTrue('10.1 CommunicationTab sekme içi: caseTitle prop',
  /<MailThreadListPane[\s\S]{0,300}caseTitle=\{item\.title\}/.test(tab));
expectTrue('10.2 CommunicationTab fullscreen: caseTitle + variant',
  /<MailThreadListPane[\s\S]{0,300}variant="fullscreen"[\s\S]{0,200}caseTitle=\{item\.title\}/.test(tab));

console.log('\n── 11) Davranış — snippet + Konu değişti sim ─');
function makeSnippet(email, caseTitleClean) {
  const raw = (email.bodyText ?? '').split('\n')[0]?.trim() ?? '';
  const subjectClean = normalizeSubject(email.subject, { stripCaseToken: true }).trim();
  const subjectChanged =
    subjectClean.length > 0 &&
    caseTitleClean.length > 0 &&
    subjectClean.toLocaleLowerCase('tr-TR') !== caseTitleClean;
  return subjectChanged
    ? `Konu değişti: ${subjectClean}${raw ? ' — ' + raw : ''}`
    : raw;
}

const caseT = 'gib gönderim hatası';
// Aynı konu → snippet olduğu gibi
expect('11.1 Konu aynı (normalize) → düz snippet',
  makeSnippet({ subject: '[UNV-100] RE: Gib Gönderim Hatası', bodyText: 'Merhaba, sorun devam ediyor' }, caseT),
  'Merhaba, sorun devam ediyor');
// Konu farklı → "Konu değişti: X — snippet"
expect('11.2 Konu farklı → "Konu değişti: X — snippet"',
  makeSnippet({ subject: '[UNV-100] RE: Yeni bir konu', bodyText: 'Ek soru var' }, caseT),
  'Konu değişti: Yeni bir konu — Ek soru var');
// Konu aynı ama snippet boş → boş
expect('11.3 Snippet boş + konu aynı → boş',
  makeSnippet({ subject: 'Gib Gönderim Hatası', bodyText: '' }, caseT),
  '');
// caseTitle boş → istisna tetiklenmez
expect('11.4 caseTitle yok → snippet olduğu gibi (istisna yok)',
  makeSnippet({ subject: 'X Y Z', bodyText: 'snippet' }, ''),
  'snippet');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
