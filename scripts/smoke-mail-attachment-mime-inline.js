/**
 * smoke-mail-attachment-mime-inline.js — 2026-07-03
 *
 * Bug: Gelen mailin cid görseli thread'de KIRIK IMG olarak render oluyor
 * (canlı repro UNV-1000093, 2026-07-03 17:05, Gmail'den csmtest'e).
 * Gmail'de görsel gövdede TAM, Varuna'da kırık ikonu.
 *
 * Teşhis: cid çözümü OK (sabahki parser fix + cidMap resolution), URL
 * üretimi OK, ancak /files/:fileId/raw endpoint Content-Type'ı hard-coded
 * `application/octet-stream` set ediyordu → <img src="..."> browser
 * octet-stream'i image olarak render EDEMEZ → kırık img.
 *
 * Fix:
 *  1. Raw endpoint Content-Type payload.mimeType ?? 'application/octet-stream'
 *  2. Mail-eki download endpoint token payload'a mimeType + disposition='inline'
 *  3. Case attachment download (createDownloadUrl) mimeType opsiyonel param
 *
 * Kapsam:
 *  1. Raw endpoint pattern — Content-Type payload'dan alınıyor
 *  2. Mail-eki endpoint — mimeType + disposition='inline' payload'a eklendi
 *  3. Case attachment createDownloadUrl — mimeType opsiyonel param
 *  4. Davranış — signStorageToken payload roundtrip + Content-Type kararı
 *  5. Regresyon — payload.mimeType yoksa octet-stream (backward compat)
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

const routes = read('server/routes/cases.js');
const routesCode = strip(routes);
const storage = read('server/db/storage.js');
const storageCode = strip(storage);
const caseRepo = read('server/db/caseRepository.js');
const caseRepoCode = strip(caseRepo);

console.log('── 1) Raw endpoint — Content-Type payload.mimeType ─');
expect('1.1 Content-Type payload.mimeType\'dan alınır (fallback octet-stream)',
  /res\.setHeader\('Content-Type',\s*payload\.mimeType\s*\|\|\s*'application\/octet-stream'\)/.test(routesCode), true);
// REGRESYON — eski hard-coded kalkmış
expect('1.2 REGRESYON: eski `Content-Type\', \'application/octet-stream\'` KALKMIŞ',
  !/res\.setHeader\('Content-Type',\s*'application\/octet-stream'\)/.test(routes), true);
expect('1.3 Content-Disposition — payload.disposition\'a bağlı (inline/attachment)',
  /const\s+disposition\s*=\s*payload\.disposition === 'inline' \? 'inline' : 'attachment'/.test(routesCode), true);
expect('1.4 Content-Disposition header disposition variable\'ı kullanır',
  /Content-Disposition['"]\s*,\s*`\$\{disposition\}/.test(routes), true);
// REGRESYON — eski hard-coded 'attachment; filename=' kalkmış
expect('1.5 REGRESYON: eski `attachment; filename=` hard-code KALKMIŞ',
  !/Content-Disposition['"]\s*,\s*`attachment; filename=/.test(routes), true);

console.log('\n── 2) Mail-eki download endpoint — payload (Codex R2 P1: safe MIME allowlist) ─');
// Codex R2 P1 (GÜVENLİK): inline sadece safe raster-image MIME için
expect('2.1 INLINE_SAFE_MIME allowlist — 5 raster image mime',
  /INLINE_SAFE_MIME\s*=\s*new\s+Set\(\[\s*'image\/png',\s*'image\/jpeg',\s*'image\/jpg',\s*'image\/gif',\s*'image\/webp',?\s*\]\)/.test(routesCode), true);
expect('2.2 INLINE_SAFE_MIME içinde image/svg+xml YOK (script XSS)',
  !/INLINE_SAFE_MIME[\s\S]{0,300}image\/svg/.test(routesCode), true);
expect('2.3 INLINE_SAFE_MIME içinde text/html YOK (XSS)',
  !/INLINE_SAFE_MIME[\s\S]{0,300}text\/html/.test(routesCode), true);
expect('2.4 mimeLower ile case-insensitive kontrol',
  /const\s+mimeLower\s*=\s*String\(att\.mimeType\s*\|\|\s*''\)\.toLowerCase\(\)/.test(routesCode), true);
expect('2.5 isSafeRasterImage = allowlist lookup',
  /const\s+isSafeRasterImage\s*=\s*INLINE_SAFE_MIME\.has\(mimeLower\)/.test(routesCode), true);
// Codex R1 (mevcut) — disposition att.isInline branch VE safe MIME
expect('2.6 isInlineSafe = att.isInline && isSafeRasterImage (İKİ koşul)',
  /const\s+isInlineSafe\s*=\s*att\.isInline\s*&&\s*isSafeRasterImage/.test(routesCode), true);
expect('2.7 disposition isInlineSafe\'e bağlı (SAFE ise inline, aksi attachment)',
  /const\s+disposition\s*=\s*isInlineSafe\s*\?\s*'inline'\s*:\s*'attachment'/.test(routesCode), true);
// Defensive: inline claim + unsafe MIME → octet-stream fallback
expect('2.8 tokenMimeType — inline+unsafe → octet-stream fallback',
  /const\s+tokenMimeType\s*=\s*isInlineSafe[\s\S]{0,200}application\/octet-stream/.test(routesCode), true);
expect('2.9 signStorageToken payload — tokenMimeType + disposition variables',
  /signStorageToken\(\s*\{[\s\S]{0,700}mimeType:\s*tokenMimeType,\s*disposition,\s*\}/.test(routesCode), true);
// REGRESYON — eski (Codex R1 sonrası) att.isInline'a doğrudan bağlı ternary KALKMIŞ
expect('2.10 REGRESYON: eski `disposition = att.isInline ? \'inline\' : \'attachment\'` (safe check\'siz) KALKMIŞ',
  !/const\s+disposition\s*=\s*att\.isInline\s*\?\s*'inline'\s*:\s*'attachment'/.test(routesCode), true);
expect('2.11 REGRESYON: payload\'a `mimeType: att.mimeType` (safe-check\'siz) KALKMIŞ',
  !/signStorageToken\(\s*\{[\s\S]{0,700}mimeType:\s*att\.mimeType,\s*disposition/.test(routesCode), true);

// getAttachmentForRaw isInline döndürüyor mu
console.log('\n── 2b) getAttachmentForRaw — isInline dönüş alanı ─');
const emailRepo = read('server/db/caseEmailRepository.js');
expect('2b.1 getAttachmentForRaw return\'ünde isInline: !!row.isInline',
  /isInline:\s*!!row\.isInline/.test(emailRepo), true);

console.log('\n── 3) storage.createDownloadUrl — mimeType opsiyonel param ─');
expect('3.1 createDownloadUrl signature mimeType parametresi (default null)',
  /export function createDownloadUrl\(caseId,\s*fileId,\s*relPath,\s*fileName,\s*expiresInSec\s*=\s*DOWNLOAD_TOKEN_TTL_SEC,\s*mimeType\s*=\s*null\)/.test(storage), true);
expect('3.2 mimeType payload\'a conditional eklenir (null ise atlanır)',
  /if\s*\(mimeType\)\s*payload\.mimeType\s*=\s*mimeType/.test(storageCode), true);
expect('3.3 Regresyon — token oluşumu aynen',
  /const token = signStorageToken\(payload,\s*expiresInSec\)/.test(storageCode), true);

console.log('\n── 4) caseRepository.getDownloadUrl — mimeType geçirir ─');
expect('4.1 createDownloadUrl çağrısında target.mimeType geçer',
  /createDownloadUrl\([^)]{0,200}target\.mimeType\)/.test(caseRepoCode), true);

console.log('\n── 5) Davranış — Content-Type resolution ─');

function resolveContentType(payload) {
  return payload.mimeType || 'application/octet-stream';
}
function resolveDisposition(payload) {
  return payload.disposition === 'inline' ? 'inline' : 'attachment';
}

expect('5.1 Mail-eki payload (image/png + inline)',
  resolveContentType({ mimeType: 'image/png', disposition: 'inline' }),
  'image/png');
expect('5.1b disposition inline',
  resolveDisposition({ mimeType: 'image/png', disposition: 'inline' }),
  'inline');

expect('5.2 Case attachment (mimeType var, disposition yok → attachment)',
  resolveDisposition({ mimeType: 'application/pdf' }), 'attachment');
expect('5.2b Content-Type gerçek mime',
  resolveContentType({ mimeType: 'application/pdf' }), 'application/pdf');

expect('5.3 Legacy payload (mimeType yok — geriye uyum)',
  resolveContentType({}), 'application/octet-stream');
expect('5.3b disposition default attachment',
  resolveDisposition({}), 'attachment');

expect('5.4 Malicious disposition rejection (unknown → attachment)',
  resolveDisposition({ disposition: 'evil' }), 'attachment');
expect('5.5 Empty mimeType → fallback',
  resolveContentType({ mimeType: '' }), 'application/octet-stream');
expect('5.6 null mimeType → fallback',
  resolveContentType({ mimeType: null }), 'application/octet-stream');

console.log('\n── 6) Davranış — end-to-end cid render sim ────');

// Bug öncesi: Content-Type = octet-stream → <img> kırık
// Bug sonrası: Content-Type = image/png → <img> render

function simulateImgRender(contentType) {
  // Browser <img> element sadece image/* MIME'lerini render eder
  return contentType.startsWith('image/');
}

// Mail-eki (fix sonrası)
const mailPayload = { mimeType: 'image/png', disposition: 'inline' };
expect('6.1 FIX SONRASI: mail-eki image/png → <img> render eder',
  simulateImgRender(resolveContentType(mailPayload)), true);

// Bug öncesi — payload.mimeType yoktu
const buggyPayload = {};
expect('6.2 BUG ÖNCESİ: mimeType yok → octet-stream → <img> KIRIK',
  simulateImgRender(resolveContentType(buggyPayload)), false);

// Case attachment (non-image)
const casePdfPayload = { mimeType: 'application/pdf' };
expect('6.3 Case attachment PDF → <img> render etmez (beklenen, bu path\'te img.src\'ye koyulmaz)',
  simulateImgRender(resolveContentType(casePdfPayload)), false);

// Farklı image formatları
expect('6.4 image/jpeg render OK', simulateImgRender('image/jpeg'), true);
expect('6.5 image/gif render OK', simulateImgRender('image/gif'), true);
expect('6.6 image/webp render OK', simulateImgRender('image/webp'), true);

console.log('\n── 6b) Davranış — Codex R2 P1: safe MIME allowlist ─');

const INLINE_SAFE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

function pickDisposition(att) {
  const mimeLower = String(att.mimeType || '').toLowerCase();
  const isSafeRasterImage = INLINE_SAFE_MIME.has(mimeLower);
  return (att.isInline && isSafeRasterImage) ? 'inline' : 'attachment';
}
function pickTokenMime(att) {
  const mimeLower = String(att.mimeType || '').toLowerCase();
  const isSafeRasterImage = INLINE_SAFE_MIME.has(mimeLower);
  const isInlineSafe = att.isInline && isSafeRasterImage;
  return isInlineSafe ? att.mimeType
    : (att.isInline ? 'application/octet-stream' : att.mimeType);
}

// cid inline image (Ctrl+V yapıştırma / Outlook inline logo)
expect('6b.1 isInline=true → \'inline\' (cid render)',
  pickDisposition({ isInline: true, mimeType: 'image/png' }), 'inline');

// Normal mail-eki (PDF)
expect('6b.2 isInline=false → \'attachment\' (download prompt)',
  pickDisposition({ isInline: false, mimeType: 'application/pdf' }), 'attachment');

// Normal image ek (kullanıcı ek olarak eklemiş ama disposition attachment)
expect('6b.3 isInline=false + image mime → \'attachment\' (yine download)',
  pickDisposition({ isInline: false, mimeType: 'image/jpeg' }), 'attachment');
// Normal ek — mimeType raw kalır (safe MIME olsa da olmasa da)
expect('6b.3b isInline=false + image mime → tokenMime gerçek mime kalır',
  pickTokenMime({ isInline: false, mimeType: 'image/jpeg' }), 'image/jpeg');
expect('6b.3c isInline=false + PDF → tokenMime application/pdf (normal download)',
  pickTokenMime({ isInline: false, mimeType: 'application/pdf' }), 'application/pdf');

// isInline undefined → 'attachment' (defensive)
expect('6b.4 isInline undefined → \'attachment\' (default konservatif)',
  pickDisposition({ mimeType: 'image/png' }), 'attachment');
expect('6b.5 isInline null → \'attachment\'',
  pickDisposition({ isInline: null, mimeType: 'image/png' }), 'attachment');

console.log('\n── 6b2) Codex R2 P1 attacker senaryoları ─');

// Attacker: dış mail'de text/html contentType + Content-Disposition: inline
const htmlXssAttack = { isInline: true, mimeType: 'text/html' };
expect('6b2.1 XSS ATTACK: text/html + inline → disposition attachment (BLOCKED)',
  pickDisposition(htmlXssAttack), 'attachment');
expect('6b2.2 XSS ATTACK: text/html → tokenMime octet-stream (browser aktif render EDEMEZ)',
  pickTokenMime(htmlXssAttack), 'application/octet-stream');

// Attacker: SVG + script (SVG raster değil, script içerebilir)
const svgXssAttack = { isInline: true, mimeType: 'image/svg+xml' };
expect('6b2.3 XSS ATTACK: image/svg+xml + inline → disposition attachment (BLOCKED)',
  pickDisposition(svgXssAttack), 'attachment');
expect('6b2.4 XSS ATTACK: image/svg+xml → tokenMime octet-stream',
  pickTokenMime(svgXssAttack), 'application/octet-stream');

// Attacker: application/xhtml+xml (script'li XML)
const xhtmlAttack = { isInline: true, mimeType: 'application/xhtml+xml' };
expect('6b2.5 XSS ATTACK: application/xhtml+xml + inline → attachment (BLOCKED)',
  pickDisposition(xhtmlAttack), 'attachment');

// Attacker: text/javascript
const jsAttack = { isInline: true, mimeType: 'text/javascript' };
expect('6b2.6 XSS ATTACK: text/javascript + inline → attachment (BLOCKED)',
  pickDisposition(jsAttack), 'attachment');
expect('6b2.7 XSS ATTACK: text/javascript → tokenMime octet-stream',
  pickTokenMime(jsAttack), 'application/octet-stream');

// Attacker: case sensitivity bypass
const uppercaseAttack = { isInline: true, mimeType: 'TEXT/HTML' };
expect('6b2.8 XSS ATTACK: TEXT/HTML case bypass → toLowerCase yakalar, attachment',
  pickDisposition(uppercaseAttack), 'attachment');
expect('6b2.9 XSS ATTACK: TEXT/HTML → tokenMime octet-stream',
  pickTokenMime(uppercaseAttack), 'application/octet-stream');

// Safe: image/png + inline → OK
const safeImage = { isInline: true, mimeType: 'image/png' };
expect('6b2.10 SAFE: image/png + inline → inline + gerçek mime',
  pickDisposition(safeImage), 'inline');
expect('6b2.11 SAFE: image/png tokenMime image/png',
  pickTokenMime(safeImage), 'image/png');

// Safe: image/webp inline → OK
const webpImage = { isInline: true, mimeType: 'image/webp' };
expect('6b2.12 SAFE: image/webp + inline → inline',
  pickDisposition(webpImage), 'inline');

// Empty mime + inline flag → attachment (defensive)
const emptyMime = { isInline: true, mimeType: '' };
expect('6b2.13 boş mime + inline → attachment (allowlist\'te değil)',
  pickDisposition(emptyMime), 'attachment');
expect('6b2.14 boş mime + inline → tokenMime octet-stream',
  pickTokenMime(emptyMime), 'application/octet-stream');

// Null/undefined mime → attachment
expect('6b2.15 undefined mime + inline → attachment',
  pickDisposition({ isInline: true }), 'attachment');
expect('6b2.16 null mime + inline → attachment',
  pickDisposition({ isInline: true, mimeType: null }), 'attachment');

console.log('\n── 6c) Codex R1 adversary — /download kontratı korunur ─');

// Codex senaryosu: kullanıcı normal PDF ek için signed URL'i kopyalayıp
// tarayıcıda açar → browser Content-Disposition'a bakar → 'attachment'
// olduğu için download prompt. 'inline' olsaydı app origin'de PDF preview
// olurdu (kontrat ihlali).
const normalPdf = { isInline: false, mimeType: 'application/pdf' };
expect('6c.1 Normal PDF ek → disposition attachment (download prompt korunur)',
  pickDisposition(normalPdf), 'attachment');

// Normal PNG ek (kullanıcı manual ekledi, cid ref bodyHtml'de YOK)
const normalPng = { isInline: false, mimeType: 'image/png' };
expect('6c.2 Normal PNG ek → disposition attachment (app origin\'de preview değil, download)',
  pickDisposition(normalPng), 'attachment');

// Cid inline (Ctrl+V yapıştırma) → app origin preview OK, isInline=true
const cidImage = { isInline: true, mimeType: 'image/png' };
expect('6c.3 CID inline image → \'inline\' (mail thread\'de gövde-içi render)',
  pickDisposition(cidImage), 'inline');

console.log('\n── 7) Regresyon — case attachment normal download ─');

// Case attachment download prompt (Content-Disposition: attachment) — browser
// download prompt açar; kullanıcı dosyayı kaydeder. Content-Type doğru olsa
// bile disposition attachment olduğu için download flow'u dokunulmadı.
const caseDlPayload = { mimeType: 'application/pdf' };
expect('7.1 Case attachment disposition = attachment (regresyonsuz)',
  resolveDisposition(caseDlPayload), 'attachment');
expect('7.2 Case attachment Content-Type doğru mime (bonus, sonraya)',
  resolveContentType(caseDlPayload), 'application/pdf');

// Legacy caller (mimeType geçmeyen) — hâlâ octet-stream + attachment
const legacyPayload = {};
expect('7.3 Legacy caller — octet-stream fallback (regresyonsuz)',
  resolveContentType(legacyPayload), 'application/octet-stream');
expect('7.4 Legacy caller — attachment fallback',
  resolveDisposition(legacyPayload), 'attachment');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
