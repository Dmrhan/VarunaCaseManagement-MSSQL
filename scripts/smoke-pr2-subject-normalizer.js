/**
 * smoke-pr2-subject-normalizer.js — 2026-07-04
 *
 * PR-2 FAZ 1 — subject/title normalize util.
 *
 * Kullanıcı direktifi:
 *  - RE:/FW:/FWD:/YNT:/[EXTERNAL]/[EXT] tekrarlı + case-insensitive temizler
 *  - Vaka token [XXX-NNNN] GÖRÜNTÜDE KORUNUR
 *  - Ham VERİ değişmez (görüntü katmanı)
 *  - Sonuç boş kalırsa → orijinal (anlamlı içerik yoktu)
 *  - 4 render yerinde kullanılır (title/CasesList/MailMessageCard/İletişim listesi)
 */

import { existsSync, readFileSync } from 'node:fs';

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

console.log('── 1) Util yapısı ─────────────────────────────');
expectTrue('1.1 normalizeSubject export (raw + optional options)',
  /export function normalizeSubject\(\s*raw:\s*string \| null \| undefined,\s*options\?:\s*\{[\s\S]{0,100}stripCaseToken\?/.test(norm));
expectTrue('1.2 isSubjectNormalized export (tooltip için)',
  /export function isSubjectNormalized/.test(norm));
expectTrue('1.3 PREFIX_RE — re|fw|fwd|ynt|yanıt|yanit (tekrarlı, case-insensitive)',
  /PREFIX_RE\s*=[\s\S]{0,80}re\|fw\|fwd\|ynt\|yanıt\|yanit/.test(norm));
expectTrue('1.4 BRACKET_NOISE_RE — external|ext + Türkçe char class (d[ıi][şs])',
  /BRACKET_NOISE_RE[\s\S]{0,150}external\|ext[\s\S]{0,50}d\[ıi\]\[şs\]/.test(norm));
expectTrue('1.5 R10 B4: CASE_TOKEN_GLOBAL_RE (g) + CASE_TOKEN_FIRST_RE (konum-bağımsız)',
  /CASE_TOKEN_GLOBAL_RE[\s\S]{0,150}\[A-Z\]\{2,5\}-\\d\+[\s\S]{0,100}\/g[\s\S]{0,200}CASE_TOKEN_FIRST_RE/.test(norm));

console.log('\n── 2) Davranış — normalize sim ────────────────');

function normalizeSubject(raw, options) {
  if (raw == null) return '';
  const input = String(raw);
  if (!input.trim()) return input;
  // R10 B4 — konum-bağımsız token
  const CASE_TOKEN_GLOBAL_RE = /\s*\[[A-Z]{2,5}-\d+\]\s*/g;
  const CASE_TOKEN_FIRST_RE = /\[[A-Z]{2,5}-\d+\]/;
  const PREFIX_RE = /^\s*(?:re|fw|fwd|ynt|yanıt|yanit)\s*:\s*/i;
  const BRACKET_NOISE_RE = /^\s*\[(?:external|ext|d[ıi][şs]|har[ıi]c[ıi])\]\s*/i;
  const firstMatch = input.match(CASE_TOKEN_FIRST_RE);
  const token = firstMatch ? firstMatch[0] : '';
  const rest = token ? input.replace(CASE_TOKEN_GLOBAL_RE, ' ') : input;
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

// Kullanıcı örnekleri
expect('2.1 "RE: [EXTERNAL]RE: RE: ...×8 Gib Gönderim Hatası"',
  normalizeSubject('RE: [EXTERNAL]RE: RE: RE: RE: RE: RE: RE: Gib Gönderim Hatası'),
  'Gib Gönderim Hatası');
expect('2.2 "[UNV-1000066] RE: X" → token korunur',
  normalizeSubject('[UNV-1000066] RE: X'),
  '[UNV-1000066] X');
expect('2.3 "YNT: FW: Konu"',
  normalizeSubject('YNT: FW: Konu'), 'Konu');
expect('2.4 "[UNV-1000042] Re:Fw: Ynt: [EXT] Test"',
  normalizeSubject('[UNV-1000042] Re:Fw: Ynt: [EXT] Test'),
  '[UNV-1000042] Test');

// Kenar durumları
expect('2.5 Sadece prefix ("RE: FW:") → orijinal (anlamlı kısım yok)',
  normalizeSubject('RE: FW:'), 'RE: FW:');
expect('2.6 Boş string → boş',
  normalizeSubject(''), '');
expect('2.7 null → boş',
  normalizeSubject(null), '');
expect('2.8 undefined → boş',
  normalizeSubject(undefined), '');
expect('2.9 Whitespace only → whitespace korunur',
  normalizeSubject('   '), '   ');

// Case-insensitive
expect('2.10 "re: konu" (lowercase) → "konu"',
  normalizeSubject('re: konu'), 'konu');
expect('2.11 "RE: KONU" (uppercase) → "KONU"',
  normalizeSubject('RE: KONU'), 'KONU');
expect('2.12 "Fw: konu" (title case)',
  normalizeSubject('Fw: konu'), 'konu');

// Token varyantları
expect('2.13 "[PRM-100] Test"',
  normalizeSubject('[PRM-100] Test'), '[PRM-100] Test');
expect('2.14 "[FR-999999] RE: Test"',
  normalizeSubject('[FR-999999] RE: Test'), '[FR-999999] Test');
expect('2.15 Token olmayan bracket başında ("[EXTERNAL] Konu") → normalize',
  normalizeSubject('[EXTERNAL] Konu'), 'Konu');
expect('2.16 "[EXT] [EXTERNAL] Konu" (çift bracket)',
  normalizeSubject('[EXT] [EXTERNAL] Konu'), 'Konu');
expect('2.17 "[ABC-1234567] Test" (7 haneli token da geçerli)',
  normalizeSubject('[ABC-1234567] Test'), '[ABC-1234567] Test');

// Turkish variants
expect('2.18 "Yanıt: Konu" (Türkçe)',
  normalizeSubject('Yanıt: Konu'), 'Konu');
expect('2.19 "yanit: konu" (i noktasız)',
  normalizeSubject('yanit: konu'), 'konu');
expect('2.20 "[DIŞ] Konu" (Türkçe bracket)',
  normalizeSubject('[DIŞ] Konu'), 'Konu');

// Ham veri değişmez (input mutasyon YOK)
console.log('\n── 3) Immutability — ham veri değişmez ────────');
const raw = 'RE: [EXTERNAL] Test';
const rawCopy = String(raw);
normalizeSubject(raw);
expect('3.1 Input string mutasyona uğramaz', raw, rawCopy);

// isSubjectNormalized
console.log('\n── 4) isSubjectNormalized — tooltip guard ────');

function isSubjectNormalized(raw) {
  if (raw == null) return false;
  const s = String(raw);
  return s.trim() !== normalizeSubject(s);
}
expect('4.1 Normalize edilmiş → true',
  isSubjectNormalized('RE: Test'), true);
expect('4.2 Normalize gerekmeyen → false',
  isSubjectNormalized('Test'), false);
expect('4.3 Token li ama normalize gereksiz → false',
  isSubjectNormalized('[UNV-100] Test'), false);
expect('4.4 Boş → false',
  isSubjectNormalized(''), false);
expect('4.5 null → false',
  isSubjectNormalized(null), false);

console.log('\n── 4b) Composer subject initializer — reply/forward açılışı ──');

const composer = read('src/features/cases/components/MailComposer.tsx');
expectTrue('4b.1 MailComposer normalizeSubject import',
  /import \{ normalizeSubject \} from '@\/lib\/subjectNormalizer'/.test(composer));
expectTrue('4b.2 Subject initializer function — raw → normalize',
  /useState<string>\(\(\)\s*=>\s*\{[\s\S]{0,400}normalizeSubject\(raw\)/.test(composer));
expectTrue('4b.3 initialReplyContext varsa "RE: " prefix (tek başında)',
  /initialReplyContext\)[\s\S]{0,200}clean\.startsWith\('RE:'\)[\s\S]{0,100}`RE: \$\{clean\}`/.test(composer));
expectTrue('4b.4 initialForwardContext varsa "Fwd: " prefix',
  /initialForwardContext\)[\s\S]{0,200}clean\.startsWith\('Fwd:'\)[\s\S]{0,100}`Fwd: \$\{clean\}`/.test(composer));

// Davranış sim: composer subject initializer
function composerSubjectInit(replyCtx, forwardCtx) {
  const raw = replyCtx?.subject ?? forwardCtx?.subject ?? '';
  if (!raw) return '';
  const clean = normalizeSubject(raw);
  if (!clean) return raw;
  if (replyCtx) return clean.startsWith('RE:') ? clean : `RE: ${clean}`;
  if (forwardCtx) return clean.startsWith('Fwd:') ? clean : `Fwd: ${clean}`;
  return clean;
}

// Yığın konu — tek RE: + [UNV-x] korunmalı (kullanıcı direktifi)
expect('4b.5 Yığın: "Re: Re: [EXTERNAL] RE: [UNV-1000066] Konu" → "RE: [UNV-1000066] Konu"',
  composerSubjectInit({ subject: 'Re: Re: [EXTERNAL] RE: [UNV-1000066] Konu' }, null),
  'RE: [UNV-1000066] Konu');

expect('4b.6 Sekiz kat RE: + [EXT] + Gib → "RE: Gib Gönderim Hatası"',
  composerSubjectInit({ subject: 'RE: [EXTERNAL]RE: RE: RE: RE: RE: RE: RE: Gib Gönderim Hatası' }, null),
  'RE: Gib Gönderim Hatası');

expect('4b.7 Reply token\'sız temiz konu → "RE: Konu"',
  composerSubjectInit({ subject: 'Re: Konu' }, null),
  'RE: Konu');

expect('4b.8 Forward: "Fwd: RE: Konu" → "Fwd: Konu"',
  composerSubjectInit(null, { subject: 'Fwd: RE: Konu' }),
  'Fwd: Konu');

expect('4b.9 Forward token korunur: "Fw: [PRM-100] Konu" → "Fwd: [PRM-100] Konu"',
  composerSubjectInit(null, { subject: 'Fw: [PRM-100] Konu' }),
  'Fwd: [PRM-100] Konu');

expect('4b.10 New mail (context yok) → boş',
  composerSubjectInit(null, null), '');

expect('4b.11 Reply prefix zaten var → tek "RE: "',
  composerSubjectInit({ subject: 'RE: [UNV-100] X' }, null),
  'RE: [UNV-100] X');

expect('4b.12 Sadece prefix konu → orijinal (anlamlı içerik yok)',
  composerSubjectInit({ subject: 'RE: FW:' }, null),
  'RE: FW:');

console.log('\n── 5) Kullanım noktaları — 4 render yeri entegrasyonu ─');
expectTrue('5.1 CaseTitleEditable — normalize + tooltip',
  /normalizeSubject\(item\.title\)/.test(read('src/features/cases/components/CaseTitleEditable.tsx')));
expectTrue('5.2 CaseTitleEditable — showTooltip yalnız normalize edilmişse',
  /isSubjectNormalized\(item\.title\)/.test(read('src/features/cases/components/CaseTitleEditable.tsx')));
expectTrue('5.3 CasesListPage — normalize + tooltip',
  /normalizeSubject\(c\.title\)/.test(read('src/features/cases/CasesListPage.tsx')));
// Evidence Preservation (2026-07-09): MailMessageCard silindi (ölü zincir);
// subject render yerleri artık 3: title/ListPane/Reader (5.5 + 5.6 kapsıyor).
expectTrue('5.4 MailMessageCard silindi — subject render MailThreadReader/ListPane üzerinde',
  !existsSync('src/features/cases/components/MailMessageCard.tsx'));
expectTrue('5.5 MailThreadListPane — normalize subject stripCaseToken=true (R9 vaka-içi mod)',
  /normalizeSubject\(e\.subject,\s*\{\s*stripCaseToken:\s*true\s*\}\)/.test(read('src/features/cases/components/MailThreadListPane.tsx')));
// Reader'da da mail konusu normalize
expectTrue('5.6 R13 M2: MailThreadReader normalize subject + stripCaseToken:true (liste ile aynı kural)',
  /normalizeSubject\(email\.subject,\s*\{\s*stripCaseToken:\s*true\s*\}\)/.test(read('src/features/cases/components/MailThreadReader.tsx')));

console.log('\n── 6) R10 B4 — Token konum-bağımsız (gerçek trafik) ─');
// stripCaseToken=true (ListPane vaka-içi mod) — hepsi "E-BELGE GÖNDERİM"
expect('6.1 "E-BELGE GÖNDERİM" (token yok)',
  normalizeSubject('E-BELGE GÖNDERİM', { stripCaseToken: true }),
  'E-BELGE GÖNDERİM');
expect('6.2 "[UNV-1000058] Re: E-BELGE GÖNDERİM" (baş token)',
  normalizeSubject('[UNV-1000058] Re: E-BELGE GÖNDERİM', { stripCaseToken: true }),
  'E-BELGE GÖNDERİM');
expect('6.3 "Re: [UNV-1000058] Re: E-BELGE GÖNDERİM" (token ortada!)',
  normalizeSubject('Re: [UNV-1000058] Re: E-BELGE GÖNDERİM', { stripCaseToken: true }),
  'E-BELGE GÖNDERİM');
expect('6.4 "RE: [UNV-1000058] Re: E-BELGE GÖNDERİM" (RE upper + orta token)',
  normalizeSubject('RE: [UNV-1000058] Re: E-BELGE GÖNDERİM', { stripCaseToken: true }),
  'E-BELGE GÖNDERİM');

// stripCaseToken=false (default) — token varsa başa geri konur
expect('6.5 "Re: [UNV-1000058] Re: E-BELGE GÖNDERİM" (strip=false) → başa token',
  normalizeSubject('Re: [UNV-1000058] Re: E-BELGE GÖNDERİM'),
  '[UNV-1000058] E-BELGE GÖNDERİM');
expect('6.6 Çoklu occurrence: "[UNV-1] Re: [UNV-1] X" (aynı token 2 kez)',
  normalizeSubject('[UNV-1] Re: [UNV-1] X'),
  '[UNV-1] X');
expect('6.7 Immutability korunur: giriş "Re: [UNV-x] Y" bozulmaz',
  (() => {
    const src = 'Re: [UNV-1000058] Re: E-BELGE GÖNDERİM';
    const cpy = String(src);
    normalizeSubject(src, { stripCaseToken: true });
    normalizeSubject(src);
    return src === cpy;
  })(), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
