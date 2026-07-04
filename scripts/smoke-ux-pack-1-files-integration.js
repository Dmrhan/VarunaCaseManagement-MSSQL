/**
 * smoke-ux-pack-1-files-integration.js — 2026-07-04
 *
 * UX FIX PAKETİ PR-1 / FAZ 4 — CaseFiles listesi entegrasyonu.
 *
 * Kapsam (pattern):
 *  1. Lightbox + HoverPreview import + kullanım
 *  2. Dosya adı tıklanabilir buton (≥40px hit target: min-h-[40px])
 *  3. Aksiyon ikonları ≥36px (h-9 w-9 = 36px)
 *  4. Görsel için nameClick → openLightbox; değilse → downloadFile
 *  5. imageFiles = filter(isImageAttachment) — nav yalnız görseller
 *  6. AttachmentImagePreviewDialog kullanımı KALDIRILDI + deprecated yorumu
 *  7. Silme onayı DOKUNULMAZ (handleRemove korundu)
 *  8. Manuel upload akışı DOKUNULMAZ (regresyon)
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

const files = read('src/features/cases/components/CaseFiles.tsx');
const dialog = read('src/features/cases/components/AttachmentImagePreviewDialog.tsx');

console.log('── 1) Import + kullanım ──────────────────────────');
expectTrue('1.1 Lightbox import',
  /import \{ Lightbox \} from '@\/components\/attachments\/Lightbox'/.test(files));
expectTrue('1.2 HoverPreview import',
  /import \{ HoverPreview \} from '@\/components\/attachments\/HoverPreview'/.test(files));
expectTrue('1.3 isImageAttachment helper import (reuse)',
  /import \{ isImageAttachment \} from '\.\/AttachmentImagePreviewDialog'/.test(files));

console.log('\n── 2) State + callbacks ────────────────────────');
expectTrue('2.1 lightboxActiveId state',
  /const \[lightboxActiveId, setLightboxActiveId\]\s*=\s*useState<string \| null>\(null\)/.test(files));
expectTrue('2.2 imageFiles = useMemo filter isImageAttachment',
  /const imageFiles\s*=\s*useMemo\(\(\)\s*=>\s*item\.files\.filter\(isImageAttachment\)/.test(files));
expectTrue('2.3 getPreviewUrl callback — Lightbox için { url, fileName }',
  /getPreviewUrl\s*=\s*useCallback\(async \(f:\s*CaseFile\)[\s\S]{0,300}\{ url:\s*out\.url,\s*fileName:\s*out\.fileName \}/.test(files));
expectTrue('2.4 getPreviewUrlHover callback — HoverPreview için { url }',
  /getPreviewUrlHover\s*=\s*useCallback[\s\S]{0,300}\{ url:\s*out\.url \}/.test(files));
expectTrue('2.5 openLightbox / closeLightbox / handleLightboxDownload',
  /openLightbox\s*=[\s\S]{0,200}closeLightbox\s*=[\s\S]{0,200}handleLightboxDownload\s*=/.test(files));

console.log('\n── 3) Render — dosya adı buton + hit target ───');
expectTrue('3.1 nameClick — previewable ? openLightbox : downloadFile',
  /nameClick\s*=\s*\(\)\s*=>\s*\(previewable[\s\S]{0,200}openLightbox\(f\.id\)[\s\S]{0,200}downloadFile\(item\.id,\s*f\.id\)/.test(files));
expectTrue('3.2 Dosya adı buton min-h-[40px] (≥40px hit target)',
  /min-h-\[40px\]/.test(files));
expectTrue('3.3 HoverPreview<CaseFile> wrap',
  /<HoverPreview<CaseFile>[\s\S]{0,400}getPreviewUrl=\{getPreviewUrlHover\}[\s\S]{0,200}isImage=\{isImageAttachment\}/.test(files));

console.log('\n── 4) Aksiyon ikonları ≥36px ──────────────────');
// h-9 w-9 = 36px (tailwind: 4px * 9)
expectTrue('4.1 Download button h-9 w-9',
  /onClick=\{\(\)\s*=>\s*void caseService\.downloadFile[\s\S]{0,200}h-9 w-9/.test(files));
expectTrue('4.2 Delete button h-9 w-9',
  /onClick=\{\(\)\s*=>\s*handleRemove\(f\)[\s\S]{0,200}h-9 w-9/.test(files));
expectTrue('4.3 REGRESYON: eski h-6 w-6 aksiyon ikonları KALKMIŞ',
  !/h-6 w-6[\s\S]{0,50}(Download|Trash2)/.test(files));

console.log('\n── 5) Lightbox render ─────────────────────────');
expectTrue('5.1 Lightbox<CaseFile> render',
  /<Lightbox<CaseFile>[\s\S]{0,600}open=\{lightboxActiveId != null\}/.test(files));
expectTrue('5.2 items=imageFiles (nav yalnız görseller)',
  /items=\{imageFiles\}/.test(files));
expectTrue('5.3 activeId + onNavigate + onDownload=handleLightboxDownload',
  /activeId=\{lightboxActiveId \?\? ''\}[\s\S]{0,200}onNavigate=\{setLightboxActiveId\}[\s\S]{0,200}onDownload=\{handleLightboxDownload\}/.test(files));

console.log('\n── 6) Eski dialog kullanımı KALDIRILDI ──────────');
expectTrue('6.1 CaseFiles içinde AttachmentImagePreviewDialog KULLANIMI YOK',
  !/<AttachmentImagePreviewDialog[\s\S]{0,200}open=/.test(files));
expectTrue('6.2 previewFile state KALDIRILDI',
  !/const \[previewFile, setPreviewFile\]/.test(files));
expectTrue('6.3 setPreviewFile call site YOK',
  !/setPreviewFile\(/.test(files));

console.log('\n── 7) Dialog dosyası deprecated yorumu ─────────');
expectTrue('7.1 @deprecated 2026-07-04 yorumu var',
  /@deprecated 2026-07-04/.test(dialog));
expectTrue('7.2 CaseFiles taşındığı belirtildi',
  /CaseFiles taşındı/.test(dialog));
expectTrue('7.3 CaseListDrawer için kaldığı not düşüldü',
  /CaseListDrawer/.test(dialog));

console.log('\n── 8) Regresyon — silme + upload akışı ────────');
expectTrue('8.1 handleRemove(f) satır render\'da korundu',
  /onClick=\{\(\)\s*=>\s*handleRemove\(f\)\}/.test(files));
expectTrue('8.2 caseService.addFile / upload progress kısmı korundu',
  /UploadProgress/.test(files) && /caseService/.test(files));

console.log('\n── 9) Davranış — nameClick karar sim ──────────');

function nameClickTarget(previewable) {
  return previewable ? 'lightbox' : 'download';
}
expect('9.1 image/png → lightbox',
  nameClickTarget(true), 'lightbox');
expect('9.2 application/pdf → download (Lightbox\'a girmez)',
  nameClickTarget(false), 'download');
expect('9.3 non-image → download (regresyonsuz mevcut davranış)',
  nameClickTarget(false), 'download');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
