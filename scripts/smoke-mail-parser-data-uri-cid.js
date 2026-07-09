/**
 * smoke-mail-parser-data-uri-cid.js — 2026-07-04
 *
 * KRİTİK KÖK NEDEN: mailparser inline CID attachment'ları HTML'e
 * `data:image/png;base64,{content}` olarak gömüyor. sanitize `data:`
 * yasak olduğu için src siliniyor → DB'ye src'siz <img> yazılıyor →
 * thread'de kırık img (canlı repro UNV-1000089, UNV-1000093).
 *
 * FIX 1: parser'da ters eşleme — data-URI'leri cid:'e geri çevir.
 * FIX 2: MailMessageCard src'siz <img> heuristic (eski kayıtlar için).
 *
 * Bu smoke GERÇEK simpleParser çağırır — statik değil, e2e davranış.
 *
 * Kapsam:
 *  1. Helper pattern — rewriteDataUrisToCids export edildi mi
 *  2. Parser return'ünde rewriteDataUrisToCids çağrılıyor mu
 *  3. UI src'siz <img> heuristic (alt + fileName eşleşmesi)
 *  4. E2E — simpleParser + reverse-map + sanitize:
 *     - Fixture A: multipart/related + png CID → src="cid:xxx" korundu
 *     - Fixture B: görselsiz mail → regresyon yok
 *     - Fixture C: 2 görsel → ikisi de dönüştürüldü
 *     - Fixture D: bracket'lı contentId (a.cid yok) → yine dönüştürüldü
 */

import { readFileSync } from 'node:fs';
import { simpleParser } from 'mailparser';
import { parseInboundEml } from '../server/lib/inboundMailParser.js';
import { sanitizeIncomingEmailHtml } from '../server/lib/htmlSanitizer.js';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)?.substring(0, 200)} expected=${JSON.stringify(expected)?.substring(0, 200)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const parser = read('server/lib/inboundMailParser.js');
const parserCode = strip(parser);
// Evidence Preservation (2026-07-09): MailMessageCard SİLİNDİ; FIX 2
// heuristic'i MailThreadReader'da yaşıyor — assert'ler oraya uyarlandı.
const card = read('src/features/cases/components/MailThreadReader.tsx');

// PNG (1x1 transparent)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_B64_2 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

console.log('── 1) Helper pattern — rewriteDataUrisToCids ─────');
expectTrue('1.1 rewriteDataUrisToCids helper tanımlandı',
  /function rewriteDataUrisToCids\(html,\s*mpAttachments\)/.test(parserCode));
expectTrue('1.2 needle format: `data:${contentType};base64,${base64}`',
  /const needle\s*=\s*`data:\$\{contentType\};base64,\$\{base64\}`/.test(parser));
expectTrue('1.3 replacement: `cid:${cid}`',
  /out\.split\(needle\)\.join\(`cid:\$\{cid\}`\)/.test(parser));
expectTrue('1.4 a.cid ?? a.contentId fallback',
  /const rawCid\s*=\s*a\.cid\s*\?\?\s*a\.contentId/.test(parserCode));
expectTrue('1.5 normalizeCid ile bracket strip',
  /const cid\s*=\s*normalizeCid\(rawCid\)/.test(parserCode));
expectTrue('1.6 Buffer.isBuffer + length > 0 guard',
  /Buffer\.isBuffer\(a\.content\)\s*\|\|\s*a\.content\.length === 0/.test(parserCode));
expectTrue('1.7 html null/empty guard',
  /if \(typeof html !== 'string' \|\| !html\) return html/.test(parserCode));
expectTrue('1.8 mpAttachments array guard',
  /!Array\.isArray\(mpAttachments\)/.test(parserCode));

console.log('\n── 2) Parser return — html rewrittenHtml\'e bağlanıyor ─');
expectTrue('2.1 rawHtml + rewriteDataUrisToCids call',
  /const rawHtml\s*=\s*parsed\.html === false[\s\S]{0,200}const html\s*=\s*rewriteDataUrisToCids\(rawHtml,\s*attachments\)/.test(parserCode));
expectTrue('2.2 return data.html field rewritten html\'i kullanır',
  /return\s*\{[\s\S]{0,1500}html,/.test(parserCode));
expectTrue('2.3 REGRESYON: eski doğrudan `parsed.html` return YOK',
  !/html:\s*parsed\.html === false \? null : \(parsed\.html \?\? null\),/.test(parser));

console.log('\n── 3) UI — src\'siz <img> heuristic (FIX 2) ─────');
expectTrue('3.1 isEmptySrc branch — src boş ise özel yol',
  /const\s+isEmptySrc\s*=\s*!src/.test(card));
expectTrue('3.2 isCidSrc || isEmptySrc — ikisi de process edilir',
  /if \(!isCidSrc && !isEmptySrc\) continue/.test(card));
expectTrue('3.3 Alt attribute ile inline fileName eşleştirme',
  /candidates\.find\(\(x\)\s*=>\s*x\.fileName === alt\)/.test(card));
expectTrue('3.4 Legacy fallback (tek inline + contentId==null)',
  /candidates\.length === 1 && candidates\[0\]\.contentId == null/.test(card));
expectTrue('3.5 Heuristic match → getAttachmentDownload rewrite',
  /match[\s\S]{0,400}getAttachmentDownload\(caseId,\s*email\.id,\s*m\.id\)/.test(card));
expectTrue('3.6 Placeholder metni "Gömülü görsel — ekte: {names}"',
  /Gömülü görsel — ekte: \$\{inlineNames\}/.test(card));
expectTrue('3.7 Regresyon — Eski mail placeholder korundu',
  /Eski mail — inline görsel desteklenmiyor/.test(card));

console.log('\n── 4) E2E — simpleParser + reverse-map + sanitize ─');

// Yardımcı: multipart/related fixture builder
function buildRelated(html, imgs) {
  const parts = [
    '--B',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ];
  for (const [cid, b64, ct, fn] of imgs) {
    parts.push('--B');
    parts.push(`Content-Type: ${ct}`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(`Content-ID: <${cid}>`);
    parts.push(`Content-Disposition: inline; filename="${fn}"`);
    parts.push('');
    parts.push(b64);
  }
  parts.push('--B--');
  return [
    'From: a@b.com',
    'To: c@d.com',
    'Subject: fx',
    'Content-Type: multipart/related; boundary="B"',
    '',
    ...parts,
  ].join('\r\n');
}

// Fixture A — tek görsel
{
  console.log('\n  ▸ Fixture A: 1 inline PNG (cid=img1@test)');
  const raw = buildRelated(
    '<html><body><p>hi</p><img src="cid:img1@test" alt="image.png"></body></html>',
    [['img1@test', PNG_B64, 'image/png', 'image.png']],
  );
  const parsed = await parseInboundEml(raw);
  expectTrue('A.1 parseInboundEml ok:true', parsed.ok === true);
  const html = parsed.data.html;
  expectTrue('A.2 html içinde `data:image/png` YOK (reverse-map çalıştı)',
    !html.includes('data:image/png'));
  expectTrue('A.3 html içinde `cid:img1@test` VAR',
    html.includes('cid:img1@test'));
  // Sanitize sonrası src="cid:..." korundu
  const clean = sanitizeIncomingEmailHtml(html);
  expectTrue('A.4 sanitize sonrası `src="cid:img1@test"` KORUNDU',
    /src="cid:img1@test"/.test(clean));
  // attachment shape: cid + inline
  expect('A.5 attachment.cid = img1@test',
    parsed.data.attachments[0]?.cid, 'img1@test');
  expect('A.6 attachment.inline = true',
    parsed.data.attachments[0]?.inline, true);
}

// Fixture B — görselsiz mail (regresyon)
{
  console.log('\n  ▸ Fixture B: text-only (regresyon guard)');
  const raw = [
    'From: a@b.com', 'To: c@d.com', 'Subject: t',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<html><body><p>merhaba</p></body></html>',
  ].join('\r\n');
  const parsed = await parseInboundEml(raw);
  expectTrue('B.1 ok:true', parsed.ok === true);
  expectTrue('B.2 html değişmedi (görsel yok, replace no-op)',
    parsed.data.html.includes('<p>merhaba</p>'));
  expect('B.3 attachments boş', parsed.data.attachments.length, 0);
}

// Fixture C — 2 görsel
{
  console.log('\n  ▸ Fixture C: 2 inline görsel (ikisi de dönüşmeli)');
  const raw = buildRelated(
    '<html><body><img src="cid:a@x" alt="a.png"><img src="cid:b@x" alt="b.png"></body></html>',
    [
      ['a@x', PNG_B64, 'image/png', 'a.png'],
      ['b@x', PNG_B64_2, 'image/png', 'b.png'],
    ],
  );
  const parsed = await parseInboundEml(raw);
  const html = parsed.data.html;
  expectTrue('C.1 data:image kalıntısı YOK', !html.includes('data:image/png'));
  expectTrue('C.2 cid:a@x VAR', html.includes('cid:a@x'));
  expectTrue('C.3 cid:b@x VAR', html.includes('cid:b@x'));
  const clean = sanitizeIncomingEmailHtml(html);
  expectTrue('C.4 sanitize sonrası ikisi de KORUNDU',
    /src="cid:a@x"/.test(clean) && /src="cid:b@x"/.test(clean));
}

// Fixture D — sadece contentId (bracket'lı), a.cid shortcut yok simülasyonu
// mailparser bracket'lı contentId'yi zaten set eder; a.cid'i normalizeCid
// yakalar. Bu senaryo sabahki parser fix'i ile bağlantılı.
{
  console.log('\n  ▸ Fixture D: bracket\'lı Content-ID (contentId fallback)');
  const raw = buildRelated(
    '<html><body><img src="cid:foo@bar" alt="foo.png"></body></html>',
    [['foo@bar', PNG_B64, 'image/png', 'foo.png']],
  );
  const parsed = await parseInboundEml(raw);
  const html = parsed.data.html;
  expectTrue('D.1 data:image kalıntısı YOK', !html.includes('data:image/png'));
  expectTrue('D.2 cid:foo@bar VAR', html.includes('cid:foo@bar'));
}

// Fixture E — JPEG (farklı contentType)
{
  console.log('\n  ▸ Fixture E: JPEG (contentType değişikliği regresyonu)');
  const raw = buildRelated(
    '<html><body><img src="cid:jpg1@x" alt="jpg1.jpg"></body></html>',
    [['jpg1@x', PNG_B64, 'image/jpeg', 'jpg1.jpg']],  // içerik PNG ama Content-Type jpeg — test
  );
  const parsed = await parseInboundEml(raw);
  const html = parsed.data.html;
  expectTrue('E.1 data:image/jpeg yok', !html.includes('data:image/jpeg'));
  expectTrue('E.2 cid:jpg1@x var', html.includes('cid:jpg1@x'));
}

console.log('\n── 5) UI FIX 2 pattern — Codex P2 R2/R3 iyileştirmeleri ─');
expectTrue('5.1 consumedAttachmentIds Set tanımlı',
  /const\s+consumed\s*=\s*new\s+Set<string>\(\)/.test(card));
// Codex R3: cid ref pre-scan
expectTrue('5.2 cidReferencedKeys Set — pre-scan tanımlı',
  /const\s+cidReferencedKeys\s*=\s*new\s+Set<string>\(\)/.test(card));
expectTrue('5.3 Pre-scan loop: gövdedeki tüm cid: src\'leri toplar',
  /for \(const img of imgs\)[\s\S]{0,400}s\.toLowerCase\(\)\.startsWith\('cid:'\)[\s\S]{0,300}cidReferencedKeys\.add\(cidRaw\)/.test(card));
expectTrue('5.4 isAttachmentCidReferenced helper',
  /const isAttCidReferenced\s*=[\s\S]{0,600}cidReferencedKeys\.has\(raw\)[\s\S]{0,200}\|\|\s*cidReferencedKeys\.has\(stripped\)/.test(card));
expectTrue('5.5 src\'siz filter — 3 katman (isInline + !consumed + !cidReferenced)',
  /isEmptySrc[\s\S]{0,600}email\.attachments\.filter\([\s\S]{0,400}x\.isInline[\s\S]{0,200}!consumed\.has\(x\.id\)[\s\S]{0,200}!isAttCidReferenced\(x\)/.test(card));
// Codex P2 R4: tek-aday fallback SADECE legacy (contentId==null)
expectTrue('5.6 src\'siz tek-aday fallback — contentId==null şartı GERİ (R4)',
  /!match && candidates\.length === 1 && candidates\[0\]\.contentId == null/.test(card));
expectTrue('5.7 REGRESYON: R2\'nin şartsız tek-aday fallback\'i KALKMIŞ',
  !/!heuristicMatch\s*&&\s*inlineCandidates\.length === 1\s*\)\s*\{[\s\S]{0,150}inlineCandidates\[0\]\.id/.test(card));
expectTrue('5.8 src\'siz match bulundukta consumed.add',
  /if \(match\) \{[\s\S]{0,120}consumed\.add\(match\.id\)/.test(card));
expectTrue('5.9 cid: match bulundukta consumed.add',
  /consumed\.add\(found\.id\)[\s\S]{0,400}jobs\.push/.test(card));
expectTrue('5.10 cid: legacy fallback\'te de consumed filter uygulanır',
  /if \(!found\)[\s\S]{0,1600}email\.attachments\.filter\([\s\S]{0,300}!consumed\.has\(x\.id\)/.test(card));
expectTrue('5.11 Legacy fallback bulundukta consumed.add',
  /const fallback = canUseLegacyFallback[\s\S]{0,200}consumed\.add\(fallback\.id\)/.test(card));

console.log('\n── 6) Davranış sim — Codex P2 R2 senaryoları ─');

function simulateRender(imgs, attachments) {
  const consumed = new Set();
  const cidMap = new Map();
  for (const a of attachments) {
    if (!a.contentId) continue;
    const raw = a.contentId.trim();
    const stripped = raw.replace(/^<|>$/g, '');
    cidMap.set(raw, a);
    cidMap.set(stripped, a);
    cidMap.set(stripped.toLowerCase(), a);
  }
  // Codex R3: Pre-scan cid referanslarını topla
  const cidReferencedKeys = new Set();
  for (const img of imgs) {
    const s = (img.src ?? '').trim();
    if (!s.toLowerCase().startsWith('cid:')) continue;
    const cidRaw = s.slice(4).trim();
    const cidStripped = cidRaw.replace(/^<|>$/g, '');
    cidReferencedKeys.add(cidRaw);
    cidReferencedKeys.add(cidStripped);
    cidReferencedKeys.add(cidStripped.toLowerCase());
  }
  const isAttCidRef = (a) => {
    if (!a.contentId) return false;
    const raw = a.contentId.trim();
    const stripped = raw.replace(/^<|>$/g, '');
    return cidReferencedKeys.has(raw)
      || cidReferencedKeys.has(stripped)
      || cidReferencedKeys.has(stripped.toLowerCase());
  };
  const results = [];
  for (const img of imgs) {
    const src = (img.src ?? '').trim();
    const isCidSrc = src.toLowerCase().startsWith('cid:');
    const isEmptySrc = !src;
    if (!isCidSrc && !isEmptySrc) continue;

    if (isEmptySrc) {
      const alt = (img.alt ?? '').trim();
      // Codex R2 (consumed) + R3 (cid ref) çift filter
      const candidates = attachments.filter(
        (x) => x.isInline && !consumed.has(x.id) && !isAttCidRef(x),
      );
      let match = null;
      if (alt) {
        const byName = candidates.find((x) => x.fileName === alt);
        if (byName) match = byName;
      }
      // Codex R4: tek-aday fallback SADECE legacy (contentId==null)
      if (!match && candidates.length === 1 && candidates[0].contentId == null) {
        match = candidates[0];
      }
      if (match) {
        consumed.add(match.id);
        results.push({ kind: 'heuristic_render', id: match.id, alt });
      } else {
        results.push({ kind: 'placeholder', alt, inlineNames: candidates.map((x) => x.fileName).join(', ') });
      }
      continue;
    }

    // cid: yolu
    const cid = src.slice(4).trim();
    const stripped = cid.replace(/^<|>$/g, '');
    const cidMatch = cidMap.get(cid) ?? cidMap.get(stripped) ?? cidMap.get(stripped.toLowerCase());
    if (cidMatch) {
      consumed.add(cidMatch.id);
      results.push({ kind: 'cid_render', id: cidMatch.id });
      continue;
    }
    // Legacy fallback (Codex R1) — freshInline + contentId==null şartı DEVAM
    const candidates = attachments.filter((x) => x.isInline && !consumed.has(x.id));
    if (candidates.length === 1 && candidates[0].contentId == null) {
      consumed.add(candidates[0].id);
      results.push({ kind: 'legacy_fallback', id: candidates[0].id });
    } else {
      results.push({ kind: 'placeholder' });
    }
  }
  return results;
}

// Fixture F: contentId DOLU tek-inline + src'siz img + ALT EŞLEŞİR → RENDER (UNV-1000093 tipik hali)
// mailparser genelde alt="filename" koyar; byName match uniquely attributable.
{
  const r = simulateRender(
    [{ src: '', alt: 'image.png' }],
    [{ id: 'A1', isInline: true, contentId: 'abc@host', fileName: 'image.png' }],
  );
  expect('6.1 contentId dolu tek-inline + src\'siz + alt EŞLEŞİR → render (byName)',
    r[0].kind, 'heuristic_render');
  expect('6.1b render eki A1', r[0].id, 'A1');
}

// Fixture F2: Codex R4 — contentId DOLU tek-inline + alt YOK → PLACEHOLDER
// Tek aday olsa da img'e uniquely attributable olduğu garanti değil.
{
  const r = simulateRender(
    [{ src: '', alt: '' }],
    [{ id: 'A1', isInline: true, contentId: 'abc@host', fileName: 'ss.png' }],
  );
  expect('6.2 Codex R4: contentId dolu + alt yok → PLACEHOLDER (tek-aday şartsız fallback KAPALI)',
    r[0].kind, 'placeholder');
}

// Fixture F3: LEGACY (contentId==null) tek-inline + alt YOK → RENDER
// UNV-1000089 gibi eski kayıtlar — legacy fallback devrede.
{
  const r = simulateRender(
    [{ src: '', alt: '' }],
    [{ id: 'A1', isInline: true, contentId: null, fileName: 'image.png' }],
  );
  expect('6.2b LEGACY tek-inline + alt yok → heuristic_render (Codex R4 fallback şartı MET)',
    r[0].kind, 'heuristic_render');
}

// Fixture G: çoklu-inline + src'siz + alt eşleşmiyor → placeholder (belirsizlik)
{
  const r = simulateRender(
    [{ src: '', alt: 'unknown.png' }],
    [
      { id: 'A1', isInline: true, contentId: 'a@x', fileName: 'a.png' },
      { id: 'A2', isInline: true, contentId: 'b@x', fileName: 'b.png' },
    ],
  );
  expect('6.3 Çoklu-inline + alt eşleşmiyor → placeholder (regresyon)',
    r[0].kind, 'placeholder');
}

// Fixture G2: çoklu-inline + alt eşleşiyor → fileName eşleşen ek
{
  const r = simulateRender(
    [{ src: '', alt: 'b.png' }],
    [
      { id: 'A1', isInline: true, contentId: 'a@x', fileName: 'a.png' },
      { id: 'A2', isInline: true, contentId: 'b@x', fileName: 'b.png' },
    ],
  );
  expect('6.4 Çoklu-inline + alt fileName eşleşir → o attachment',
    r[0].id, 'A2');
}

// Fixture H: hem cid'li hem src'siz aynı mailde
// cid:X match → A1 consumed → src'siz için başka aday YOK → placeholder
{
  const r = simulateRender(
    [
      { src: 'cid:x@host', alt: 'a.png' },
      { src: '', alt: 'src\'siz' },
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  expect('6.5 cid:X match → cid_render', r[0].kind, 'cid_render');
  expect('6.5b cid:X eki A1', r[0].id, 'A1');
  expect('6.6 Aynı mailde src\'siz img → A1 consumed → placeholder (çift render önlendi)',
    r[1].kind, 'placeholder');
}

// Fixture H2: iki inline + biri cid match + biri src'siz → src'siz kalan eki alır
{
  const r = simulateRender(
    [
      { src: 'cid:a@x', alt: 'a.png' },
      { src: '', alt: 'b.png' },
    ],
    [
      { id: 'A1', isInline: true, contentId: 'a@x', fileName: 'a.png' },
      { id: 'A2', isInline: true, contentId: 'b@x', fileName: 'b.png' },
    ],
  );
  expect('6.7 cid:A match → A1', r[0].id, 'A1');
  expect('6.7b src\'siz alt=b.png → A2 (A1 consumed, filter dışı)',
    r[1].id, 'A2');
  expect('6.7c src\'siz kind heuristic_render', r[1].kind, 'heuristic_render');
}

// Fixture I: 2 src'siz img — ilki tek aday alır, ikinci placeholder
{
  const r = simulateRender(
    [
      { src: '', alt: 'image.png' },
      { src: '', alt: 'image.png' },
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'image.png' }],
  );
  expect('6.8 İlk src\'siz → A1 alır', r[0].id, 'A1');
  expect('6.8b İkinci src\'siz → placeholder (A1 consumed)',
    r[1].kind, 'placeholder');
}

console.log('\n── 7) Codex P2 R3 kritik — src\'siz ÖNCE + cid: SONRA (duplicate önleme) ─');

// CODEX R3 SENARYOSU: src'siz img önce, cid:X img sonra, aynı A1 ek.
// Öncesi (R2): src'siz A1'i consumed'a alırdı, cid:X yine A1 match ederdi
// → duplicate render. R3 fix ile: src'siz filter cid ref'li A1'i exclude
// eder → placeholder; cid:X yine A1 render eder → tek görsel (doğru).
{
  const r = simulateRender(
    [
      { src: '', alt: 'a.png' },        // src'siz ÖNCE
      { src: 'cid:x@host', alt: 'a.png' }, // cid: SONRA
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  expect('7.1 src\'siz ÖNCE → cid ref\'li A1 filter dışı → placeholder (duplicate önlendi)',
    r[0].kind, 'placeholder');
  expect('7.2 cid:x → A1 normal render (otoriter yol)',
    r[1].kind, 'cid_render');
  expect('7.2b render eki A1', r[1].id, 'A1');
}

// R3 karşı-senaryo: sadece src'siz (cid'li img YOK, UNV-1000093) → heuristic devrede
{
  const r = simulateRender(
    [{ src: '', alt: 'a.png' }],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  expect('7.3 Sadece src\'siz + cid\'li img YOK → heuristic AKTİF (UNV-1000093 korunur)',
    r[0].kind, 'heuristic_render');
  expect('7.3b render eki A1', r[0].id, 'A1');
}

// R3 karma: cid:B (unknown, cidMap'te yok) + src'siz (alt=a.png match A1)
// A1 cid ref'li DEĞİL (referans B'ye) → src'siz heuristic A1 alabilir
{
  const r = simulateRender(
    [
      { src: '', alt: 'a.png' },
      { src: 'cid:unknown@x', alt: 'unknown' },
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  // Pre-scan cidReferencedKeys = { 'unknown@x' vs. }
  // A1.contentId='x@host' → cid ref'li DEĞİL (unknown@x ≠ x@host)
  // src'siz filter A1'i dahil eder → heuristic A1 alır
  expect('7.4 cid:unknown ref A1\'i tetiklemez → src\'siz A1 heuristic OK',
    r[0].kind, 'heuristic_render');
  expect('7.4b render eki A1', r[0].id, 'A1');
  // cid:unknown match yok → legacy fallback contentId==null şart, A1 contentId dolu → placeholder
  expect('7.5 cid:unknown eşleşmez + A1 legacy fallback şartı FAİL → placeholder',
    r[1].kind, 'placeholder');
}

// R3 çoklu: 2 src'siz + cid:A (aynı ek) → cid:A otoriter, ikisi de placeholder
{
  const r = simulateRender(
    [
      { src: '', alt: 'a.png' },
      { src: '', alt: 'a.png' },
      { src: 'cid:x@host', alt: 'a.png' },
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  expect('7.6 İlk src\'siz → A1 cid ref\'li → placeholder',
    r[0].kind, 'placeholder');
  expect('7.7 İkinci src\'siz → yine placeholder',
    r[1].kind, 'placeholder');
  expect('7.8 cid:x → A1 render (otoriter)',
    r[2].kind, 'cid_render');
}

// R3 case-insensitive: cid:X (uppercase) + src'siz (att.contentId lower) → filter yakalar
{
  const r = simulateRender(
    [
      { src: '', alt: 'a.png' },
      { src: 'cid:X@HOST', alt: 'a.png' },
    ],
    [{ id: 'A1', isInline: true, contentId: 'x@host', fileName: 'a.png' }],
  );
  expect('7.9 case bypass: cid:X@HOST → cidReferencedKeys lowercase → A1 filter dışı',
    r[0].kind, 'placeholder');
}

console.log('\n── 8) Codex P2 R4 KRİTİK — pre-scan sonrası kalan tek aday img\'e AİT DEĞİL ─');

// CODEX R4 SENARYOSU (birebir): src'siz alt="logo.png" + cid:B img
// Attachment: A1 (cid ref) + A2 (signature.png, contentId dolu, unrelated)
// Pre-scan A1'i exclude eder, kalan tek aday A2.
// Eski davranış: A2 tek-aday fallback → YANLIŞ görsel (signature.png ≠ logo.png)
// R4 fix: A2.contentId dolu → legacy şart FAIL → PLACEHOLDER
{
  const r = simulateRender(
    [
      { src: '', alt: 'logo.png' },
      { src: 'cid:B@x', alt: 'b.png' },
    ],
    [
      { id: 'A1', isInline: true, contentId: 'B@x', fileName: 'b.png' },
      { id: 'A2', isInline: true, contentId: 'X@y', fileName: 'signature.png' },
    ],
  );
  expect('8.1 src\'siz alt=logo.png, A1 cid ref exclude → A2 (signature.png) tek aday KALSA da:',
    r[0].kind, 'placeholder');
  expect('8.1b Codex R4: A2.contentId dolu → tek-aday fallback KAPALI (yanlış görsel önlendi)',
    r[0].id ?? null, null);
  expect('8.2 cid:B → A1 normal render (otoriter yol)',
    r[1].kind, 'cid_render');
  expect('8.2b render eki A1', r[1].id, 'A1');
}

// R4 karşı-senaryo: src'siz alt="signature.png" (aynı senaryo ama alt eşleşir)
// byName MATCH → A2 render (uniquely attributable via name)
{
  const r = simulateRender(
    [
      { src: '', alt: 'signature.png' },
      { src: 'cid:B@x', alt: 'b.png' },
    ],
    [
      { id: 'A1', isInline: true, contentId: 'B@x', fileName: 'b.png' },
      { id: 'A2', isInline: true, contentId: 'X@y', fileName: 'signature.png' },
    ],
  );
  expect('8.3 Alt=signature.png ile A2 byName MATCH → A2 render (isim netliği güvenli)',
    r[0].kind, 'heuristic_render');
  expect('8.3b render eki A2', r[0].id, 'A2');
}

// R4 karşı-senaryo 2: legacy tek-aday (contentId=null) → fallback devrede
// UNV-1000089 tipi — alt yok, tek görsel, contentId=null
{
  const r = simulateRender(
    [{ src: '', alt: '' }],
    [{ id: 'A1', isInline: true, contentId: null, fileName: 'image.png' }],
  );
  expect('8.4 LEGACY tek-aday (contentId=null) + alt yok → fallback DEVREDE (regresyon guard)',
    r[0].kind, 'heuristic_render');
}

// R4 kombine: pre-scan sonrası TEK legacy aday kalırsa fallback devrede
{
  const r = simulateRender(
    [
      { src: '', alt: '' },
      { src: 'cid:B@x', alt: 'b.png' },
    ],
    [
      { id: 'A1', isInline: true, contentId: 'B@x', fileName: 'b.png' },
      { id: 'A2', isInline: true, contentId: null, fileName: 'legacy.png' },
    ],
  );
  expect('8.5 Pre-scan A1 exclude → A2 (legacy, contentId=null) tek aday → fallback OK',
    r[0].kind, 'heuristic_render');
  expect('8.5b Legacy aday render — A2', r[0].id, 'A2');
}

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
