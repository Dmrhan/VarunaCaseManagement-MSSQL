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
// Evidence Preservation (2026-07-09): MailMessageCard SİLİNDİ (ölü zincir);
// cid çözüm mantığı MailThreadReader'da yaşıyor — assert'ler oraya uyarlandı.
const card = read('src/features/cases/components/MailThreadReader.tsx');
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
// R2 review fix (2026-07-09): isInline artık parser bayrağı DEĞİL,
// gövde-referans gerçeği (bodyCidSet) — Outlook'un referanssız Content-ID'li
// gerçek ekleri isInline=false persist edilir (fix B ↔ fix C hizası).
expect('3.1 persistAttachmentsForCase içinde contentId: a?.cid + gövde-referanslı isInline',
  /contentId:\s*a\?\.cid\s*\?\?\s*null,[\s\S]{0,700}isInline:\s*!!cidCanon && bodyCidSet\.has\(cidCanon\)/.test(intake), true);
expect('3.2 Yeni vaka yolunda emailId geçer',
  /persistAttachmentsForCase\(\{[\s\S]{0,400}caseId:\s*created\.id,[\s\S]{0,300}emailId:\s*firstEmail\.id/.test(intakeCode), true);
expect('3.3 Token flow append yolunda emailId geçer',
  /persistAttachmentsForCase\(\{[\s\S]{0,400}caseId:\s*existing\.id,[\s\S]{0,300}emailId:\s*inboundEmail\.id/.test(intakeCode), true);
// Header threading yolunda append (aynı persistAttachmentsForCase caller)
const hthreadCount = (intakeCode.match(/persistAttachmentsForCase\(\{[\s\S]{0,400}emailId:\s*inboundEmail\.id/g) ?? []).length;
expect('3.4 Token + Header threading — İKİSİ de emailId geçen persist çağrısı',
  hthreadCount >= 2, true);

console.log('\n── 4) UI — zarif düşüş placeholder (Codex R1: legacy-only heuristic) ─');
expect('4.1 Eşleşmeyen cid için inline aday heuristic',
  /x\.isInline && !consumed\.has\(x\.id\)/.test(card), true);
// Codex R1 fix: heuristic sadece contentId==null (legacy) durumda devrede
expect('4.2 Heuristic guard — canUseLegacyFallback (contentId==null gerekli)',
  /canUseLegacyFallback = !looksLikePath[\s\S]{0,60}candidates\.length === 1 && candidates\[0\]\.contentId == null/.test(card), true);
expect('4.3 REGRESYON: eski koşulsuz `length === 1 ? [0] : null` KALDIRILDI',
  !/const\s+fallback\s*=\s*inlineCandidates\.length === 1 \? inlineCandidates\[0\] : null/.test(card), true);
expect('4.4 Fallback flag canUseLegacyFallback\'e bağlanır',
  /candidates\.length === 1 && candidates\[0\]\.contentId == null\)[\s\S]{0,160}match = \{ id: candidates\[0\]\.id/.test(card), true);
expect('4.5 Fallback aday yoksa → net placeholder metni ("Gömülü görsel — ekte: {names}")',
  /Gömülü görsel — ekte: \$\{inlineNames\}/.test(card), true);
expect('4.6 Regresyon — "Eski mail" placeholder yolu korundu',
  /Eski mail — inline görsel desteklenmiyor/.test(card), true);
expect('4.7 Regresyon — "cid eşleşmedi" son çare placeholder korundu',
  /görsel alınamadı \(neden için vaka aktivitesine bakın|ekte gelmedi \(gönderici tarafında kaldı\)/.test(card), true);

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

console.log('\n── 8) Davranış — heuristic fallback restriction (Codex R1) ─');

// canUseLegacyFallback semantik — MailMessageCard yeni koşul.
function canUseLegacyFallback(attachments) {
  const inline = attachments.filter((a) => a.isInline);
  return inline.length === 1 && inline[0].contentId == null;
}

// Legacy senaryo — parser fix'i öncesi (contentId=null yazılmış eski mail)
expect('8.1 LEGACY: 1 inline aday + contentId null → heuristic AKTİF',
  canUseLegacyFallback([{ id: 'a1', isInline: true, contentId: null }]), true);

// Yeni kayıt — contentId dolu
expect('8.2 YENİ: 1 inline aday + contentId dolu → heuristic KAPALI',
  canUseLegacyFallback([{ id: 'a1', isInline: true, contentId: 'abc@host' }]), false);

// Codex R1 kritik senaryo — 1 resolved inline (X match ediliyor) + gövdede
// başka unknown cid: Y. Eski heuristic X'i Y için de fallback yapardı →
// duplicate. Yeni koşul kapatır.
expect('8.3 R1 KRİTİK: 1 inline contentId dolu (X resolved) → unknown cid:Y için heuristic KAPALI (duplicate önlendi)',
  canUseLegacyFallback([{ id: 'X', isInline: true, contentId: 'x@host' }]), false);

// Birden fazla inline aday — heuristic zaten kapalı (belirsizlik)
expect('8.4 2 inline aday → heuristic KAPALI (ambiguous)',
  canUseLegacyFallback([
    { id: 'a1', isInline: true, contentId: null },
    { id: 'a2', isInline: true, contentId: null },
  ]), false);

// 0 inline aday
expect('8.5 0 inline aday → heuristic KAPALI',
  canUseLegacyFallback([{ id: 'a1', isInline: false, contentId: null }]), false);

// Karışık: 1 inline legacy + 1 inline yeni → toplam 2 → kapalı
expect('8.6 1 legacy + 1 yeni inline → toplam 2 → KAPALI',
  canUseLegacyFallback([
    { id: 'legacy', isInline: true, contentId: null },
    { id: 'yeni', isInline: true, contentId: 'yeni@host' },
  ]), false);

console.log('\n── 9) Davranış — end-to-end: yeni resolved + unknown = duplicate önlenir ─');

// Senaryo: mail'de 2 img — src="cid:X" (contentId=X ile eşleşir) + src="cid:Y" (unknown).
// cidMap X'i içerir; Y için canUseLegacyFallback FALSE (X'in contentId'si dolu).
// Sonuç: X normal render, Y → placeholder ("Gömülü görsel — ekte: X.png").
// R1 fix ÖNCESİ: Y de X'in URL'ine yönlendirilirdi (duplicate).

const attachments = [{ id: 'X', isInline: true, contentId: 'x@host', fileName: 'ss.png' }];
const cidMap = new Map();
for (const a of attachments) {
  if (!a.contentId) continue;
  const raw = a.contentId.trim();
  const stripped = raw.replace(/^<|>$/g, '');
  cidMap.set(raw, { id: a.id });
  cidMap.set(stripped, { id: a.id });
  cidMap.set(stripped.toLowerCase(), { id: a.id });
}

function renderCid(cidSrc, cidMap, attachments) {
  const cid = cidSrc.slice(4).trim();
  const stripped = cid.replace(/^<|>$/g, '');
  const match = cidMap.get(cid) ?? cidMap.get(stripped) ?? cidMap.get(stripped.toLowerCase());
  if (match) return { kind: 'resolved', id: match.id };
  const inline = attachments.filter((a) => a.isInline);
  const canLegacy = inline.length === 1 && inline[0].contentId == null;
  if (canLegacy) return { kind: 'legacy_fallback', id: inline[0].id };
  return { kind: 'placeholder' };
}

const r1 = renderCid('cid:x@host', cidMap, attachments);
expect('9.1 X (resolved) → normal render att X', r1.id, 'X');

const r2 = renderCid('cid:y@unknown', cidMap, attachments);
expect('9.2 Y (unknown) → PLACEHOLDER (R1 fix — duplicate önlendi)',
  r2.kind, 'placeholder');
expect('9.2b Y için X\'in URL\'ine YÖNLENDİRME YOK (kritik)',
  r2.id, undefined);

// Karşı-senaryo: LEGACY mail (contentId=null) + unknown cid → heuristic devrede
const legacyAtt = [{ id: 'LEG', isInline: true, contentId: null, fileName: 'ss.png' }];
const legacyMap = new Map();
const r3 = renderCid('cid:whatever@host', legacyMap, legacyAtt);
expect('9.3 LEGACY mail (contentId=null) + unknown cid → heuristic AKTİF',
  r3.kind, 'legacy_fallback');
expect('9.3b Fallback attachment = tek inline aday',
  r3.id, 'LEG');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
