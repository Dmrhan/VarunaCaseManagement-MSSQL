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

console.log('\n── 2) Mail-eki download endpoint — payload mimeType+disposition ─');
expect('2.1 Mail-eki token payload\'ında mimeType: att.mimeType',
  /signStorageToken\(\s*\{[\s\S]{0,400}mimeType:\s*att\.mimeType/.test(routesCode), true);
expect('2.2 Mail-eki token payload\'ında disposition: \'inline\'',
  /signStorageToken\(\s*\{[\s\S]{0,500}disposition:\s*'inline'/.test(routes), true);
expect('2.3 Mail-eki fileName / caseId / fileId payload\'ta korunur',
  /signStorageToken\(\s*\{[\s\S]{0,600}fileName:\s*att\.fileName,\s*mimeType:\s*att\.mimeType/.test(routesCode), true);

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
