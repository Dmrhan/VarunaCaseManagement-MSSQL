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
expect('1.2 onPasteImage prop (opsiyonel — regresyonsuz)',
  /onPasteImage\?:\s*\(file:\s*File\)\s*=>\s*Promise<PasteImageResult>/.test(editor), true);
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
expect('1.9 Başarı → src\'yi cid:{id} olarak swap',
  /tr\.setNodeMarkup\(pos,\s*undefined,\s*\{[\s\S]{0,200}src:\s*`cid:\$\{res\.cid\}`/.test(editorCode), true);
expect('1.10 revokeObjectURL — memory leak guard',
  /URL\.revokeObjectURL\(blobUrl\)/.test(editor), true);
expect('1.11 UI ipucu (HELP maddesi) — "görseli doğrudan yapıştırabilirsin"',
  /görseli doğrudan yapıştırabilirsin/.test(editor), true);
expect('1.12 İpucu sadece onPasteImage varsa (regresyonsuz UI)',
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
expect('2.5 UploadedFileRef inline?: boolean',
  /interface UploadedFileRef\s*\{[\s\S]{0,400}inline\?:\s*boolean/.test(composer), true);
expect('2.6 handlePasteImage — mime guard',
  /handlePasteImage[\s\S]{0,600}INLINE_PASTE_ALLOWED_MIME\.has\(file\.type\)/.test(composerCode), true);
expect('2.7 handlePasteImage — size guard',
  /handlePasteImage[\s\S]{0,900}file\.size\s*>\s*INLINE_PASTE_MAX_SIZE/.test(composerCode), true);
expect('2.8 handlePasteImage — caseService.addFile reuse',
  /handlePasteImage[\s\S]{0,1800}caseService\.addFile\(item\.id,\s*file\)/.test(composerCode), true);
expect('2.9 handlePasteImage — attachments state inline: true',
  /setAttachments[\s\S]{0,400}inline:\s*true/.test(composerCode), true);
expect('2.10 handlePasteImage — return cid: caseFile.id',
  /handlePasteImage[\s\S]{0,2000}ok:\s*true,\s*cid:\s*caseFile\.id/.test(composerCode), true);
expect('2.11 Send öncesi — safeBody\'den cid regex extract',
  /const\s+cidRefs\s*=\s*new\s+Set<string>\(\);[\s\S]{0,300}<img\[\^>\]\+src=\["'\]cid:/.test(composer), true);
expect('2.12 Send öncesi — inline attachment ise cidRefs.has(a.id) filter',
  /attachments[\s\S]{0,300}\.filter\(\(a\)\s*=>\s*\(a\.inline\s*\?\s*cidRefs\.has\(a\.id\)\s*:\s*true\)\)/.test(composer), true);
expect('2.13 RichTextEditor prop bağlantısı — onPasteImage=handlePasteImage',
  /<RichTextEditor[\s\S]{0,300}onPasteImage=\{handlePasteImage\}/.test(composer), true);
expect('2.14 Attachment pill — inline rozeti (gövde)',
  /a\.inline\s*&&[\s\S]{0,200}\(gövde\)/.test(composer), true);
expect('2.15 Attachment pill — inline title ipucu',
  /a\.inline\s*\?\s*'Gövde içinde görsel/.test(composer), true);

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

console.log('\n── 6) Davranış — send öncesi inline attachment filter ─');

function sendFilter(bodyHtml, attachments) {
  const cidRefs = new Set();
  const re = /<img[^>]+src=["']cid:([^"']+)["']/gi;
  for (let m; (m = re.exec(bodyHtml)); ) cidRefs.add(m[1]);
  return attachments.filter((a) => (a.inline ? cidRefs.has(a.id) : true)).map((a) => a.id);
}

// 3 attachment: normal doc + inline paste + inline paste (silinmiş)
const atts = [
  { id: 'doc1', fileName: 'rapor.pdf', inline: false },
  { id: 'img-a', fileName: 'ss1.png', inline: true },
  { id: 'img-b', fileName: 'ss2.png', inline: true },  // sonradan editörden silindi
];

expect('6.1 body: sadece img-a referansı → doc1 + img-a gönderilir, img-b DÜŞER',
  JSON.stringify(sendFilter('<p>bak: <img src="cid:img-a"/></p>', atts)),
  '["doc1","img-a"]');

expect('6.2 body: iki inline de referanslı → hepsi gönderilir',
  JSON.stringify(sendFilter('<img src="cid:img-a"/><img src="cid:img-b"/>', atts)),
  '["doc1","img-a","img-b"]');

expect('6.3 body: hiç cid referansı yok (görsel yok) → sadece normal doc',
  JSON.stringify(sendFilter('<p>Sadece metin</p>', atts)),
  '["doc1"]');

expect('6.4 Görsel-olmayan yapıştırma — attachments hiç değişmemiş → normal ekler regresyonsuz',
  JSON.stringify(sendFilter('<p>metin</p>', [{ id: 'doc1', inline: false }])),
  '["doc1"]');

expect('6.5 Boş bodyHtml + inline attachment → düşürülür',
  JSON.stringify(sendFilter('', [{ id: 'x', inline: true }])),
  '[]');

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

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
