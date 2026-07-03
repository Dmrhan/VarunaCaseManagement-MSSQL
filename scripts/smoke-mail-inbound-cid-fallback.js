/**
 * smoke-mail-inbound-cid-fallback.js — 2026-07-03
 *
 * Bug: Gelen mailin gövde-içi (cid) görselleri thread'de görünmüyor
 * (canlı repro UNV-1000089, 2026-07-03). Ek listesinde "image.png (inline)"
 * gösteriliyor ama gövdede yok.
 *
 * Kök neden: server/lib/inboundMailParser.js `cid: a.cid ? String(a.cid) : null`
 *   → mailparser bazı sürümlerde `a.cid` (bracket-strip shortcut) set etmez,
 *     sadece `a.contentId` (RFC 2392 `<abc@host>`) döner
 *   → parser cid=null yazar
 *   → intake CaseEmailAttachment.contentId=null
 *   → MailMessageCard.cidMap boş
 *   → gövdedeki <img src="cid:xxx"> render edilemez
 *
 * Fix:
 *  1. Parser: `a.cid ?? a.contentId` fallback + `normalizeCid` (bracket strip)
 *  2. UI: eşleşmeyen cid için zarif düşüş (inline aday varsa ona yönlendir;
 *     yoksa "gömülü görsel — ekte: {names}")
 *
 * Kapsam:
 *  1. Parser pattern: fallback + normalizeCid helper
 *  2. normalizeCid davranış sim (bracket strip, whitespace, null-safety)
 *  3. Intake payload pariteni — 3 yol (yeni-vaka, token append, header-threading)
 *     parsed.attachments'ı persistAttachmentsForCase'e geçiriyor
 *  4. UI zarif düşüş — inline aday varsa fallback, yoksa net placeholder
 *  5. Regresyon — sanitize cid img korunuyor
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

const parser = read('server/lib/inboundMailParser.js');
const parserCode = strip(parser);
const intake = read('server/lib/inboundMailIntake.js');
const intakeCode = strip(intake);
const card = read('src/features/cases/components/MailMessageCard.tsx');
const sanitizer = read('server/lib/htmlSanitizer.js');

console.log('── 1) Parser: cid fallback + normalizeCid helper ─');
expect('1.1 normalizeCid helper tanımlandı',
  /function normalizeCid\(raw\)/.test(parserCode), true);
expect('1.2 normalizeCid null guard',
  /function normalizeCid\(raw\)[\s\S]{0,200}if \(raw == null\) return null/.test(parserCode), true);
expect('1.3 normalizeCid bracket strip + trim',
  /String\(raw\)\.trim\(\)\.replace\(\/\^<\|>\$\/g,\s*''\)\.trim\(\)/.test(parserCode), true);
expect('1.4 normalizeCid boş string → null',
  /s\.length > 0 \? s : null/.test(parserCode), true);
expect('1.5 attachments.cid — fallback (a.cid ?? a.contentId) + normalizeCid',
  /cid:\s*normalizeCid\(a\.cid\s*\?\?\s*a\.contentId\)/.test(parserCode), true);
expect('1.6 attachments.inline — fallback ile de tetiklenir',
  /inline:\s*a\.contentDisposition === 'inline' \|\| !!\(a\.cid\s*\?\?\s*a\.contentId\)/.test(parserCode), true);
// REGRESYON — eski buglu şekil kalkmış
expect('1.7 REGRESYON: eski `a.cid ? String(a.cid) : null` KALDIRILDI',
  !/cid:\s*a\.cid\s*\?\s*String\(a\.cid\)\s*:\s*null/.test(parser), true);
expect('1.8 REGRESYON: eski `inline: ... || !!a.cid` KALDIRILDI',
  !/inline:\s*a\.contentDisposition === 'inline' \|\| !!a\.cid,/.test(parser), true);

console.log('\n── 2) Davranış — normalizeCid ───────────────────');

function normalizeCid(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^<|>$/g, '').trim();
  return s.length > 0 ? s : null;
}

expect('2.1 undefined → null', normalizeCid(undefined), null);
expect('2.2 null → null', normalizeCid(null), null);
expect('2.3 boş string → null', normalizeCid(''), null);
expect('2.4 sadece whitespace → null', normalizeCid('   '), null);
expect('2.5 sadece bracket → null', normalizeCid('<>'), null);
expect('2.6 bracket\'lı → strip', normalizeCid('<abc@host>'), 'abc@host');
expect('2.7 bracket\'sız → aynen',
  normalizeCid('abc@host'), 'abc@host');
expect('2.8 whitespace + bracket → strip + trim',
  normalizeCid('  <abc@host>  '), 'abc@host');
expect('2.9 farklı case korunur (cidMap zaten lowercase\'i de tutuyor)',
  normalizeCid('<AbC@HoSt>'), 'AbC@HoSt');
expect('2.10 sadece iç bracket (< ortada) — orta karakter etkilenmez',
  normalizeCid('<a<b>c>'), 'a<b>c');

console.log('\n── 3) Intake — 3 yol contentId payload pariteni ─');
// Tüm çağrılar parsed.attachments ?? [] geçiyor → parser fix hepsini kapsar.
// persistAttachmentsForCase içinde contentId: a?.cid ?? null (parser çıktısı)
expect('3.1 persistAttachmentsForCase içinde contentId: a?.cid',
  /contentId:\s*a\?\.cid\s*\?\?\s*null,\s*isInline:\s*!!a\?\.inline/.test(intake), true);
expect('3.2 Yeni vaka yolunda emailId geçer',
  /persistAttachmentsForCase\(\{[\s\S]{0,400}caseId:\s*created\.id,[\s\S]{0,300}emailId:\s*firstEmail\.id/.test(intakeCode), true);
expect('3.3 Token flow append yolunda emailId geçer',
  /persistAttachmentsForCase\(\{[\s\S]{0,400}caseId:\s*existing\.id,[\s\S]{0,300}emailId:\s*inboundEmail\.id/.test(intakeCode), true);
// Header threading yolunda append (aynı persistAttachmentsForCase caller)
const hthreadCount = (intakeCode.match(/persistAttachmentsForCase\(\{[\s\S]{0,400}emailId:\s*inboundEmail\.id/g) ?? []).length;
expect('3.4 Token + Header threading — İKİSİ de emailId geçen persist çağrısı',
  hthreadCount >= 2, true);

console.log('\n── 4) UI — zarif düşüş placeholder ─────────────');
expect('4.1 Eşleşmeyen cid için inline aday heuristic',
  /email\.attachments\.filter\(\(x\)\s*=>\s*x\.isInline\)/.test(card), true);
expect('4.2 Tek inline aday → getAttachmentDownload ile fallback render',
  /inlineCandidates\.length === 1 \? inlineCandidates\[0\] : null/.test(card), true);
expect('4.3 Fallback aday yoksa → net placeholder metni ("Gömülü görsel — ekte: {names}")',
  /Gömülü görsel — ekte: \$\{inlineNames\}/.test(card), true);
expect('4.4 Regresyon — "Eski mail" placeholder yolu korundu',
  /Eski mail — inline görsel desteklenmiyor/.test(card), true);
expect('4.5 Regresyon — "cid eşleşmedi" son çare placeholder korundu',
  /\(cid eşleşmedi\)/.test(card), true);

console.log('\n── 5) Regresyon — sanitize cid img koruyor ─────');
expect('5.1 sanitize allowedSchemesByTag img cid dahil',
  /allowedSchemesByTag:\s*\{[\s\S]{0,200}img:\s*\[[^\]]*'cid'/.test(sanitizer), true);

console.log('\n── 6) Davranış — attachment payload sim (parser output) ─');

function parseAttachment(mp) {
  // mailparser output simülasyonu
  return {
    filename: mp.filename ?? null,
    contentType: mp.contentType ?? null,
    size: Number.isFinite(mp.size) ? mp.size : 0,
    content: null,  // Buffer test kapsamı dışı
    cid: normalizeCid(mp.cid ?? mp.contentId),
    inline: mp.contentDisposition === 'inline' || !!(mp.cid ?? mp.contentId),
  };
}

// Senaryo A: mailparser HEM cid HEM contentId set eder (yeni sürüm)
const a1 = parseAttachment({
  filename: 'image.png',
  contentType: 'image/png',
  contentDisposition: 'inline',
  cid: 'abc@host',
  contentId: '<abc@host>',
});
expect('6.1a bracket-strip shortcut cid varsa onu tercih',
  a1.cid, 'abc@host');
expect('6.1b inline true', a1.inline, true);

// Senaryo B (BUG SENARYOSU): mailparser sadece contentId set eder
const a2 = parseAttachment({
  filename: 'image.png',
  contentType: 'image/png',
  contentDisposition: 'inline',
  contentId: '<xyz@example.com>',
  // cid: undefined
});
expect('6.2a Fallback: contentId üzerinden çekilir + bracket strip',
  a2.cid, 'xyz@example.com');
expect('6.2b inline true (contentDisposition)', a2.inline, true);

// Senaryo C: sadece cid var (contentId yok — bazı test fixture'ları)
const a3 = parseAttachment({
  filename: 'logo.png',
  contentType: 'image/png',
  cid: 'logo123@company.com',
});
expect('6.3a cid alanı doğrudan', a3.cid, 'logo123@company.com');
expect('6.3b inline true (cid presence)', a3.inline, true);

// Senaryo D: normal attachment — cid yok, disposition attachment
const a4 = parseAttachment({
  filename: 'rapor.pdf',
  contentType: 'application/pdf',
  contentDisposition: 'attachment',
});
expect('6.4a cid null', a4.cid, null);
expect('6.4b inline false', a4.inline, false);

// Senaryo E: bracket'lı contentId - inline false ama cid dolu
// (bazı istemciler contentId koyar ama disposition attachment olur)
const a5 = parseAttachment({
  filename: 'inline-ref.png',
  contentType: 'image/png',
  contentDisposition: 'attachment',
  contentId: '<ref@host>',
});
expect('6.5a cid parse edilir', a5.cid, 'ref@host');
expect('6.5b inline true (cid presence, disposition attachment olsa da)',
  a5.inline, true);

console.log('\n── 7) Davranış — cidMap resolution (MailMessageCard uyumluluğu) ─');

// cidMap 3 varyant tutar. Parser artık stripped versiyonu yazar; bodyHtml'deki
// cid src'i angle bracket'lı olsa (bazı e-postalarda) da 3-varyant lookup
// hâlâ yakalar.
function buildCidMap(attachments) {
  const m = new Map();
  for (const a of attachments) {
    if (!a.contentId) continue;
    const raw = a.contentId.trim();
    const stripped = raw.replace(/^<|>$/g, '');
    m.set(raw, { id: a.id });
    m.set(stripped, { id: a.id });
    m.set(stripped.toLowerCase(), { id: a.id });
  }
  return m;
}

function resolveCid(cidSrc, cidMap) {
  const cid = cidSrc.slice(4).trim();
  const stripped = cid.replace(/^<|>$/g, '');
  return cidMap.get(cid) ?? cidMap.get(stripped) ?? cidMap.get(stripped.toLowerCase());
}

// Parser bracket-strip + lowercase-uyumlu yazdığında (normalizeCid sonrası)
const attList = [{ id: 'att1', contentId: 'abc@host' }];
const map1 = buildCidMap(attList);
// NOT: bracket'sız + zaten lowercase olduğu için Map 3 aynı anahtar ile
// tek entry tutar (Map.set overwrite). Kritik olan lookup — 3 varyantla
// da matchlemeli (aşağıda test).
expect('7.1 cidMap boş değil (contentId doldu)', map1.size > 0, true);
expect('7.2 body <img src="cid:abc@host"> → match',
  resolveCid('cid:abc@host', map1)?.id, 'att1');
expect('7.3 body <img src="cid:<abc@host>"> → bracket strip match',
  resolveCid('cid:<abc@host>', map1)?.id, 'att1');
expect('7.4 body <img src="cid:ABC@HOST"> → lowercase match',
  resolveCid('cid:ABC@HOST', map1)?.id, 'att1');

// Bracket'lı + mixed case attachment senaryosu (parser bracket-strip yapsa
// bile mailparser bazen bracket bırakır — 3 varyant tam kullanılır)
const attListMixed = [{ id: 'att2', contentId: '<AbC@Host>' }];
const map2 = buildCidMap(attListMixed);
expect('7.5 cidMap bracket\'lı + mixed case → 3 anahtar',
  map2.size, 3);
expect('7.6 body <img src="cid:abc@host"> (lowercase) → match via lower key',
  resolveCid('cid:abc@host', map2)?.id, 'att2');

// BUG öncesi durum (contentId null yazılırdı)
const buggyList = [{ id: 'att-buggy', contentId: null }];
const mapBuggy = buildCidMap(buggyList);
expect('7.7 BUG öncesi: contentId null → cidMap boş',
  mapBuggy.size, 0);
expect('7.8 BUG öncesi: hiçbir cid src eşleşmez',
  resolveCid('cid:abc@host', mapBuggy), undefined);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
