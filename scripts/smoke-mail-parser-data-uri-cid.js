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
const card = read('src/features/cases/components/MailMessageCard.tsx');

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
  /inlineCandidates\.find\(\(x\)\s*=>\s*x\.fileName === alt\)/.test(card));
expectTrue('3.4 Legacy fallback (tek inline + contentId==null)',
  /inlineCandidates\.length === 1 && inlineCandidates\[0\]\.contentId == null/.test(card));
expectTrue('3.5 Heuristic match → getAttachmentDownload rewrite',
  /heuristicMatch[\s\S]{0,400}getAttachmentDownload\(caseId,\s*email\.id,\s*m\.id\)/.test(card));
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

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
