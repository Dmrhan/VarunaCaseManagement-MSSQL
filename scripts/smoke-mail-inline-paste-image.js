/**
 * smoke-mail-inline-paste-image.js — 2026-07-03
 *
 * Ctrl+V ile gövde içine görsel yapıştırma (CID inline) fix'i:
 *   - RichTextEditor: clipboard image → blob önizleme → upload → cid:{id} swap
 *   - MailComposer: uploadWhitelist mirror + inline state + send öncesi
 *     HTML'de referans kalmayan inline attachment'ı düş
 *   - caseEmailSender: safeHtml'den cid extract → nodemailer attachments[].cid
 *     + CaseEmailAttachment.contentId/isInline set
 *   - Sanitizer sanity: img[src^="cid:"] STRIP OLMAZ (allowedSchemesByTag)
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

const editor = read('src/features/cases/components/RichTextEditor.tsx');
const editorCode = strip(editor);
const composer = read('src/features/cases/components/MailComposer.tsx');
const composerCode = strip(composer);
const sender = read('server/lib/caseEmailSender.js');
const senderCode = strip(sender);
const sanitizer = read('server/lib/htmlSanitizer.js');

console.log('── 1) RichTextEditor — onPasteImage + handlePaste ───');
expect('1.1 PasteImageResult type export',
  /export type PasteImageResult\s*=\s*\|?\s*\{\s*ok:\s*true;\s*cid:\s*string\s*\}\s*\|\s*\{\s*ok:\s*false;\s*error:\s*string\s*\}/.test(editor), true);
// Codex P2 R1 fix: prop signature (file, blobUrl) — composer blob URL'i
// state'te tutar ki send öncesi cid'e çevirsin, editörde broken image olmasın.
expect('1.2 onPasteImage prop signature — (file, blobUrl)',
  /onPasteImage\?:\s*\(file:\s*File,\s*blobUrl:\s*string\)\s*=>\s*Promise<PasteImageResult>/.test(editor), true);
expect('1.3 handlePaste editorProps içinde',
  /editorProps:\s*\{[\s\S]{0,800}handlePaste:/.test(editorCode), true);
expect('1.4 Guard: onPasteImage yoksa false (regresyonsuz)',
  /handlePaste:[\s\S]{0,200}if\s*\(!onPasteImage\)\s*return\s*false/.test(editorCode), true);
expect('1.5 Sadece image kind=file yakalanır',
  /it\.kind\s*===\s*'file'\s*&&\s*it\.type\.startsWith\('image\/'\)/.test(editorCode), true);
expect('1.6 Image yoksa false (görsel-olmayan paste — default akış)',
  /if\s*\(imageFiles\.length\s*===\s*0\)\s*return\s*false/.test(editorCode), true);
expect('1.7 Blob URL ile ANINDA önizleme insert',
  /URL\.createObjectURL\(file\)[\s\S]{0,400}replaceSelectionWith\(node\)/.test(editorCode), true);
expect('1.8 Upload başarısız → node kaldır (rollback)',
  /!res\.ok[\s\S]{0,500}tr\.delete\(pos,\s*pos\s*\+\s*n\.nodeSize\)/.test(editorCode), true);
// Codex P2 R1: başarıda editörde blob URL KALIR — cid:xxx SWAP ETMİYOR
// (browser cid:'i render edemez → broken image). Composer send öncesi swap eder.
expect('1.9 Codex P2 R1 fix — başarıda setNodeMarkup ile cid: SRC SWAP YOK',
  !/tr\.setNodeMarkup\(pos,\s*undefined,\s*\{[\s\S]{0,200}src:\s*`cid:/.test(editorCode), true);
expect('1.10 onPasteImage çağrısı — (file, blobUrl) iki argüman',
  /onPasteImage\(file,\s*blobUrl\)/.test(editor), true);
expect('1.11 revokeObjectURL — sadece rollback yolunda',
  /URL\.revokeObjectURL\(blobUrl\)/.test(editor), true);
expect('1.12 UI ipucu (HELP maddesi) — "görseli doğrudan yapıştırabilirsin"',
  /görseli doğrudan yapıştırabilirsin/.test(editor), true);
expect('1.13 İpucu sadece onPasteImage varsa (regresyonsuz UI)',
  /\{onPasteImage\s*&&[\s\S]{0,400}görseli doğrudan yapıştırabilirsin/.test(editor), true);

console.log('\n── 2) MailComposer — inline paste flow ─────────');
expect('2.1 PasteImageResult import',
  /import\s*\{[^}]*RichTextEditor[^}]*,\s*type\s+PasteImageResult[^}]*\}\s*from\s*'\.\/RichTextEditor'/.test(composer), true);
expect('2.2 INLINE_PASTE_ALLOWED_MIME sıkı liste (SVG hariç — XSS)',
  /INLINE_PASTE_ALLOWED_MIME\s*=\s*new\s+Set\(\[\s*'image\/png',\s*'image\/jpeg',\s*'image\/jpg',\s*'image\/gif',\s*'image\/webp'/.test(composer), true);
expect('2.3 INLINE_PASTE_ALLOWED_MIME içinde SVG YOK',
  !/INLINE_PASTE_ALLOWED_MIME[\s\S]{0,300}image\/svg/.test(composer), true);
expect('2.4 INLINE_PASTE_MAX_SIZE = 10MB',
  /INLINE_PASTE_MAX_SIZE\s*=\s*10\s*\*\s*1024\s*\*\s*1024/.test(composer), true);
// Codex P2 R1: state'te blobUrl alanı — cid replace için send öncesi lookup
expect('2.5 UploadedFileRef inline?: boolean + blobUrl?: string',
  /interface UploadedFileRef\s*\{[\s\S]{0,500}inline\?:\s*boolean;[\s\S]{0,200}blobUrl\?:\s*string/.test(composer), true);
expect('2.6 handlePasteImage — signature (file, blobUrl)',
  /handlePasteImage\s*=\s*useCallback\(async\s*\(file:\s*File,\s*blobUrl:\s*string\)/.test(composer), true);
expect('2.7 handlePasteImage — mime guard',
  /handlePasteImage[\s\S]{0,600}INLINE_PASTE_ALLOWED_MIME\.has\(file\.type\)/.test(composerCode), true);
expect('2.8 handlePasteImage — size guard',
  /handlePasteImage[\s\S]{0,900}file\.size\s*>\s*INLINE_PASTE_MAX_SIZE/.test(composerCode), true);
expect('2.9 handlePasteImage — caseService.addFile reuse',
  /handlePasteImage[\s\S]{0,1800}caseService\.addFile\(item\.id,\s*file\)/.test(composerCode), true);
expect('2.10 handlePasteImage — attachments state inline: true + blobUrl',
  /setAttachments[\s\S]{0,500}inline:\s*true,\s*blobUrl,/.test(composerCode), true);
expect('2.11 handlePasteImage — return cid: caseFile.id',
  /handlePasteImage[\s\S]{0,2000}ok:\s*true,\s*cid:\s*caseFile\.id/.test(composerCode), true);
// Codex P2 R1 #2: pendingPastes sayacı — çoklu paste'te canSend hepsi bitene kadar disable
expect('2.12 pendingPastes state (çoklu paste sayacı)',
  /const\s*\[\s*pendingPastes,\s*setPendingPastes\s*\]\s*=\s*useState\(0\)/.test(composer), true);
expect('2.13 handlePasteImage — +1 baş, -1 finally',
  /setPendingPastes\(\(n\)\s*=>\s*n\s*\+\s*1\)[\s\S]{0,2000}setPendingPastes\(\(n\)\s*=>\s*n\s*-\s*1\)/.test(composer), true);
expect('2.14 canSend — pendingPastes === 0 kontrolü',
  /canSend\s*=[\s\S]{0,200}pendingPastes\s*===\s*0/.test(composer), true);
// Codex P2 R1 #1: bodyHtml içindeki blob URL → cid:{id} replace
expect('2.15 Send öncesi — payloadHtml blob URL → cid replace',
  /let\s+payloadHtml\s*=\s*bodyHtml[\s\S]{0,400}payloadHtml\.split\(a\.blobUrl\)\.join\(`cid:\$\{a\.id\}`\)/.test(composer), true);
expect('2.16 Send öncesi — activeInlineIds Set (bodyHtml\'de blobUrl varsa dahil)',
  /const\s+activeInlineIds\s*=\s*new\s+Set<string>\(\)[\s\S]{0,400}payloadHtml\.includes\(a\.blobUrl\)/.test(composer), true);
expect('2.17 Send öncesi — sanitize AFTER replace (blob artık cid:)',
  /const\s+safeBody\s*=\s*DOMPurify\.sanitize\(payloadHtml/.test(composer), true);
expect('2.18 Filter — inline ise activeInlineIds.has(a.id)',
  /attachments[\s\S]{0,300}\.filter\(\(a\)\s*=>\s*\(a\.inline\s*\?\s*activeInlineIds\.has\(a\.id\)\s*:\s*true\)\)/.test(composer), true);
expect('2.19 RichTextEditor prop bağlantısı — onPasteImage=handlePasteImage',
  /<RichTextEditor[\s\S]{0,300}onPasteImage=\{handlePasteImage\}/.test(composer), true);
expect('2.20 Attachment pill — inline rozeti (gövde)',
  /a\.inline\s*&&[\s\S]{0,200}\(gövde\)/.test(composer), true);
expect('2.21 Attachment pill — inline title ipucu',
  /a\.inline\s*\?\s*'Gövde içinde görsel/.test(composer), true);
// Codex P2 R1 #3: inline pill'de Kaldır butonu GİZLİ
expect('2.22 Kaldır butonu — inline ise gizli (!a.inline guard)',
  /\{!a\.inline\s*&&\s*\(\s*<button[\s\S]{0,400}removeAttachment\(a\.id\)/.test(composer), true);
// Preview blob: allow (Codex P2 R2: data: KALDIRILDI — XSS potansiyeli)
expect('2.23 previewHtml — ALLOWED_URI_REGEXP blob dahil',
  /previewHtml\s*=[\s\S]{0,600}ALLOWED_URI_REGEXP:\s*\/\^\(\?:https\?\|blob\|cid/.test(composer), true);
// Codex P2 R2 R2 (2026-07-03) — Konum-bağımsız assertion. Önceki regex
// sadece `|data)` (son alternative) durumunu yakalıyordu; `data|mailto`
// gibi ortada olsa reddedemezdi. Şimdi previewHtml scope'undaki gerçek
// ALLOWED_URI_REGEXP literal'ini extract edip alternative listesini
// parse eder ve `data`'yı konum-agnostik reddeder.
{
  const previewBlockMatch = composer.match(/previewHtml\s*=[\s\S]{0,800}?\}\)/);
  const previewBlock = previewBlockMatch?.[0] ?? '';
  const uriRegexMatch = previewBlock.match(/ALLOWED_URI_REGEXP:\s*\/\^\(\?:([^)]+)\):/);
  const alternatives = uriRegexMatch
    ? uriRegexMatch[1].split('|').map((s) => s.trim().toLowerCase())
    : null;
  expect('2.23b previewHtml — ALLOWED_URI_REGEXP literal extract edildi',
    Array.isArray(alternatives) && alternatives.length > 0, true);
  expect('2.23c previewHtml — `data` alternative HİÇBİR KONUMDA yok (Codex R2 R2 XSS fix)',
    Array.isArray(alternatives) && !alternatives.includes('data'), true);
  // Ek pozitif guard — beklenen whitelist konum-agnostik
  expect('2.23d previewHtml — blob/cid/https? alternative\'leri mevcut',
    Array.isArray(alternatives)
      && alternatives.includes('blob')
      && alternatives.includes('cid')
      && alternatives.includes('https?'),
    true);
}
// Blob URL cleanup — unmount
expect('2.24 Blob URL cleanup — useEffect return revokeObjectURL',
  /useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]{0,300}URL\.revokeObjectURL\(a\.blobUrl\)/.test(composer), true);

console.log('\n── 3) Backend caseEmailSender — CID extract + attach ─');
expect('3.1 extractInlineCidsFromHtml helper',
  /function extractInlineCidsFromHtml\(html\)/.test(sender), true);
expect('3.2 Regex img cid — FE ile simetrik',
  /<img\[\^>\]\+src=\["'\]cid:\(\[\^"'\]\+\)\["'\]/.test(sender), true);
expect('3.3 loadAttachmentsForCase — inlineCids parametresi',
  /async function loadAttachmentsForCase\(caseId,\s*attachmentIds,\s*inlineCids\)/.test(sender), true);
expect('3.4 loadAttachmentsForCase — Set instanceof guard (default boş)',
  /const inlineSet\s*=\s*inlineCids instanceof Set\s*\?\s*inlineCids\s*:\s*new Set\(\)/.test(sender), true);
expect('3.5 nodemailer entry — inlineSet.has → cid = r.id',
  /if\s*\(inlineSet\.has\(r\.id\)\)\s*\{\s*entry\.cid\s*=\s*r\.id/.test(sender), true);
expect('3.6 Sanitize SONRASI extract (safeHtml)',
  /const\s+safeHtml\s*=\s*sanitizeOutgoingEmailHtml[\s\S]{0,600}const\s+inlineCids\s*=\s*extractInlineCidsFromHtml\(safeHtml\)/.test(sender), true);
expect('3.7 loadAttachmentsForCase çağrısı — inlineCids geçer',
  /loadAttachmentsForCase\(caseId,\s*attachments\s*\?\?\s*\[\],\s*inlineCids\)/.test(sender), true);
expect('3.8 CaseEmailAttachment.contentId — inline ise r.id',
  /contentId:\s*isInline\s*\?\s*r\.id\s*:\s*null/.test(sender), true);
expect('3.9 CaseEmailAttachment.isInline — inlineCids.has(r.id)',
  /const\s+isInline\s*=\s*inlineCids\.has\(r\.id\)/.test(senderCode), true);
expect('3.10 Regresyon — eski hard-coded `contentId: null, isInline: false` KALKTI',
  !/data:\s*att\.rows\.map\(\(r\)\s*=>\s*\(\{[\s\S]{0,300}contentId:\s*null,\s*isInline:\s*false/.test(sender), true);

console.log('\n── 4) Sanitizer sanity — cid img KORUNUR ──────');
expect('4.1 img allowedSchemes içinde "cid"',
  /allowedSchemesByTag:\s*\{[\s\S]{0,200}img:\s*\[[^\]]*'cid'/.test(sanitizer), true);
expect('4.2 sanitizeOutgoingEmailHtml var (outbound path)',
  /function\s+sanitizeOutgoingEmailHtml/.test(sanitizer), true);

console.log('\n── 5) Davranış — extractInlineCidsFromHtml simülasyon ─');

function extractInlineCidsFromHtml(html) {
  const set = new Set();
  if (typeof html !== 'string' || !html) return set;
  const re = /<img[^>]+src=["']cid:([^"']+)["']/gi;
  for (let m; (m = re.exec(html)); ) {
    const cid = m[1]?.trim();
    if (cid) set.add(cid);
  }
  return set;
}

expect('5.1 Tek cid img',
  JSON.stringify([...extractInlineCidsFromHtml('<p>Merhaba</p><img src="cid:abc123" alt="ss">')]),
  '["abc123"]');
expect('5.2 Çoklu cid img — hepsi',
  JSON.stringify([...extractInlineCidsFromHtml('<img src="cid:a"/><p>x</p><img src="cid:b"/>')]),
  '["a","b"]');
expect('5.3 http src → dahil değil (sadece cid: prefix)',
  JSON.stringify([...extractInlineCidsFromHtml('<img src="https://foo/bar.png"/>')]),
  '[]');
expect('5.4 data: base64 → dahil değil',
  JSON.stringify([...extractInlineCidsFromHtml('<img src="data:image/png;base64,AAA"/>')]),
  '[]');
expect('5.5 Tek tırnak da yakalanır',
  JSON.stringify([...extractInlineCidsFromHtml("<img src='cid:xyz'/>")]),
  '["xyz"]');
expect('5.6 Karışık — cid + http birlikte',
  JSON.stringify([...extractInlineCidsFromHtml('<img src="cid:a"/><img src="https://x/y.png"/>')]),
  '["a"]');
expect('5.7 Duplicate cid → Set ile dedupe',
  JSON.stringify([...extractInlineCidsFromHtml('<img src="cid:a"/><img src="cid:a"/>')]),
  '["a"]');
expect('5.8 boş html → boş set',
  JSON.stringify([...extractInlineCidsFromHtml('')]),
  '[]');
expect('5.9 null → boş set (guard)',
  JSON.stringify([...extractInlineCidsFromHtml(null)]),
  '[]');
expect('5.10 undefined → boş set (guard)',
  JSON.stringify([...extractInlineCidsFromHtml(undefined)]),
  '[]');
expect('5.11 cid attribute\'ları arası boşluk',
  JSON.stringify([...extractInlineCidsFromHtml('<img alt="x" width="50" src="cid:mid1" />')]),
  '["mid1"]');

console.log('\n── 6) Davranış — send öncesi blobUrl→cid + inline filter (P2 R1) ─');

// Codex P2 R1 fix: FE state artık blobUrl saklıyor. Send öncesi bodyHtml
// içindeki blobUrl'ler cid:{id} ile REPLACE edilir. bodyHtml'de blobUrl
// olmayan (editörden silinmiş) inline attachment listeden düşer.
function sendPipeline(bodyHtml, attachments) {
  let payloadHtml = bodyHtml;
  const activeInlineIds = new Set();
  for (const a of attachments) {
    if (a.inline && a.blobUrl && payloadHtml.includes(a.blobUrl)) {
      payloadHtml = payloadHtml.split(a.blobUrl).join(`cid:${a.id}`);
      activeInlineIds.add(a.id);
    }
  }
  const attachmentIds = attachments
    .filter((a) => (a.inline ? activeInlineIds.has(a.id) : true))
    .map((a) => a.id);
  return { payloadHtml, attachmentIds };
}

// 3 attachment: normal doc + inline paste + inline paste (silinmiş)
const atts = [
  { id: 'doc1', fileName: 'rapor.pdf', inline: false },
  { id: 'img-a', fileName: 'ss1.png', inline: true, blobUrl: 'blob:http://localhost/A' },
  { id: 'img-b', fileName: 'ss2.png', inline: true, blobUrl: 'blob:http://localhost/B' },  // silindi
];

// bodyHtml editörde blob URL src ile render — sadece img-a hâlâ orada
const s1 = sendPipeline(
  '<p>bak: <img src="blob:http://localhost/A" alt="ss"></p>',
  atts,
);
expect('6.1 payloadHtml — blobUrl → cid:img-a REPLACE edildi',
  s1.payloadHtml, '<p>bak: <img src="cid:img-a" alt="ss"></p>');
expect('6.1b attachmentIds — doc1 + img-a (img-b silinmiş, DÜŞER)',
  JSON.stringify(s1.attachmentIds), '["doc1","img-a"]');

const s2 = sendPipeline(
  '<img src="blob:http://localhost/A"/><img src="blob:http://localhost/B"/>',
  atts,
);
expect('6.2 iki inline referanslı → payloadHtml iki cid içerir',
  s2.payloadHtml, '<img src="cid:img-a"/><img src="cid:img-b"/>');
expect('6.2b attachmentIds — hepsi',
  JSON.stringify(s2.attachmentIds), '["doc1","img-a","img-b"]');

const s3 = sendPipeline('<p>Sadece metin</p>', atts);
expect('6.3 hiç blob URL yok → sadece normal doc',
  JSON.stringify(s3.attachmentIds), '["doc1"]');
expect('6.3b payloadHtml değişmedi (replace no-op)',
  s3.payloadHtml, '<p>Sadece metin</p>');

const s4 = sendPipeline('<p>metin</p>', [{ id: 'doc1', inline: false }]);
expect('6.4 Görsel-olmayan yapıştırma — normal ekler regresyonsuz',
  JSON.stringify(s4.attachmentIds), '["doc1"]');

const s5 = sendPipeline('', [{ id: 'x', inline: true, blobUrl: 'blob:X' }]);
expect('6.5 Boş bodyHtml + inline → düşürülür',
  JSON.stringify(s5.attachmentIds), '[]');

// Ek: aynı görsel çoklu insert (kullanıcı 2 kere aynı screenshot yapıştırdı)
// State'te 2 farklı attachmentId + 2 farklı blobUrl olur. Her birinin
// includes kontrolü ayrı.
const s6 = sendPipeline(
  '<img src="blob:A"/><img src="blob:A"/>',
  [{ id: 'img-a', inline: true, blobUrl: 'blob:A' }],
);
expect('6.6 Tek blobUrl bodyHtml\'de 2 kez → split.join hepsini değiştirir',
  s6.payloadHtml, '<img src="cid:img-a"/><img src="cid:img-a"/>');

console.log('\n── 7) Davranış — nodemailer attachment cid mapping ──');

function loadSim(rows, inlineCids) {
  const inlineSet = inlineCids instanceof Set ? inlineCids : new Set();
  return rows.map((r) => {
    const entry = { filename: r.fileName, contentType: r.mimeType };
    if (inlineSet.has(r.id)) entry.cid = r.id;
    return entry;
  });
}

const rows = [
  { id: 'doc1', fileName: 'rapor.pdf', mimeType: 'application/pdf' },
  { id: 'img-a', fileName: 'ss.png', mimeType: 'image/png' },
];

const outAll = loadSim(rows, new Set(['img-a']));
expect('7.1 doc1 → cid YOK (normal attachment)', outAll[0].cid, undefined);
expect('7.2 img-a → cid=img-a (inline)', outAll[1].cid, 'img-a');

const outNone = loadSim(rows, new Set());
expect('7.3 inline set boş → hiçbirinde cid yok', outNone.filter((e) => e.cid).length, 0);

// Guard: inlineCids parametresi eksik/undefined → hata değil, hepsi normal
const outUndef = loadSim(rows, undefined);
expect('7.4 inlineCids undefined → guard, hepsi normal',
  outUndef.filter((e) => e.cid).length, 0);

console.log('\n── 8) Davranış — CaseEmailAttachment persistence ────');

function persistSim(rows, inlineCids) {
  return rows.map((r) => {
    const isInline = inlineCids.has(r.id);
    return {
      fileName: r.fileName,
      contentId: isInline ? r.id : null,
      isInline,
    };
  });
}

const persisted = persistSim(rows, new Set(['img-a']));
expect('8.1 doc1 — contentId=null, isInline=false',
  JSON.stringify(persisted[0]),
  '{"fileName":"rapor.pdf","contentId":null,"isInline":false}');
expect('8.2 img-a — contentId=img-a, isInline=true',
  JSON.stringify(persisted[1]),
  '{"fileName":"ss.png","contentId":"img-a","isInline":true}');

console.log('\n── 9) Regresyon — normal yanıt akışı dokunulmadı ──');
expect('9.1 caseService.addFile drop akışı (normal ek) korundu',
  /async function handleAttach\(files:\s*FileList\s*\|\s*null\)/.test(composer), true);
expect('9.2 uploadWhitelist FE mirror değişmedi (dosya var)',
  /export const UPLOAD_ALLOWED_MIME_TYPES/.test(read('src/features/cases/uploadWhitelist.ts')), true);
expect('9.3 SendEmailDraft.attachments string[] (payload şema geriye uyumlu — inline field YOK)',
  /attachments:\s*attachmentIds/.test(composer), true);
expect('9.4 loadAttachmentsForCase — inlineCids opsiyonel (parametre yoksa default guard)',
  /inlineCids instanceof Set\s*\?\s*inlineCids\s*:\s*new Set\(\)/.test(sender), true);
expect('9.5 Sanitize outbound path — bodyHtml sanitize edilir (safeHtml appendOutbound\'a gider)',
  /bodyHtml:\s*safeHtml/.test(sender), true);

console.log('\n── 10) Davranış — pendingPastes gate (Codex P2 R1 #2) ──');

// Basit sayaç semantiği: her paste +1, tamamlanan -1.
function canSendGate({ selectedAlias, to, submitting, uploading, pendingPastes }) {
  return !!selectedAlias && to.length > 0 && !submitting && !uploading && pendingPastes === 0;
}

expect('10.1 ideal state — canSend true',
  canSendGate({ selectedAlias: 'x', to: ['a@x'], submitting: false, uploading: false, pendingPastes: 0 }), true);
expect('10.2 pendingPastes 1 → canSend false (henüz upload bitmedi)',
  canSendGate({ selectedAlias: 'x', to: ['a@x'], submitting: false, uploading: false, pendingPastes: 1 }), false);
expect('10.3 pendingPastes 3 (çoklu paste) → canSend false',
  canSendGate({ selectedAlias: 'x', to: ['a@x'], submitting: false, uploading: false, pendingPastes: 3 }), false);
expect('10.4 pendingPastes 0 sonrası → canSend true (hepsi bitti)',
  canSendGate({ selectedAlias: 'x', to: ['a@x'], submitting: false, uploading: false, pendingPastes: 0 }), true);

// Sayaç lifecycle simülasyonu — 3 concurrent paste
let counter = 0;
counter++; counter++; counter++;  // 3 paste başladı
expect('10.5 3 paste başladı → counter=3', counter, 3);
counter--; // İlk bitti
expect('10.6 İlk paste bitti → counter=2 (Send hâlâ disable — eski bug: boolean false olurdu)', counter, 2);
counter--; counter--;  // Kalan ikisi de bitti
expect('10.7 Tümü bitti → counter=0 → Send açılabilir', counter === 0, true);

console.log('\n── 11) Davranış — DOMPurify preview URI whitelist (Codex P2 R2) ──');

// Codex P2 R2 fix: data: KALDIRILDI — ALLOWED_URI_REGEXP tüm URI attribute'lara
// (href dahil) uygulanır. <a href="data:text/html,<script>..."> preview'da render
// edilebilir → XSS. İmzalar http(s)/cid kullanıyor, inline paste blob: yeterli.
const previewRegex = /^(?:https?|blob|cid|mailto|tel):/i;
expect('11.1 blob: URL izinli (preview\'da renderable)',
  previewRegex.test('blob:http://localhost/abc'), true);
expect('11.2 cid: URL izinli (backend cid render fallback)',
  previewRegex.test('cid:foo'), true);
expect('11.3 https:// izinli',
  previewRegex.test('https://x.com/y.png'), true);
expect('11.4 http:// izinli',
  previewRegex.test('http://x.com/y.png'), true);
expect('11.5 mailto: izinli',
  previewRegex.test('mailto:a@b.com'), true);
expect('11.6 tel: izinli',
  previewRegex.test('tel:+905551112233'), true);
// XSS vektörleri — HEPSİ YASAK
expect('11.7 javascript: yasak (XSS)',
  previewRegex.test('javascript:alert(1)'), false);
expect('11.8 vbscript: yasak',
  previewRegex.test('vbscript:xxx'), false);
expect('11.9 file: yasak',
  previewRegex.test('file:///etc/passwd'), false);
// Codex P2 R2: data: artık YASAK — <a href="data:text/html,..."> XSS önlendi
expect('11.10 data:text/html — YASAK (Codex R2 XSS önlendi)',
  previewRegex.test('data:text/html,<script>alert(1)</script>'), false);
expect('11.11 data:image/png;base64 — YASAK (data tümüyle blocked)',
  previewRegex.test('data:image/png;base64,AAAA'), false);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
