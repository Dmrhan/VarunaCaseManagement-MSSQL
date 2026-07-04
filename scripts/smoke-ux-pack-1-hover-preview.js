/**
 * smoke-ux-pack-1-hover-preview.js — 2026-07-04
 *
 * UX FIX PAKETİ PR-1 / FAZ 3 — HoverPreview generic component.
 *
 * Kapsam (pattern + davranış):
 *  1. 400ms delay before open
 *  2. LAZY — hover trigger olmadan istek YOK
 *  3. Oturum cache (module-scope Map)
 *  4. Touch/klavye devre dışı (@media hover:hover)
 *  5. Non-image kart 5 satır (ad + tip + boyut + yükleyen + tarih)
 *  6. detectImageDefault helper (MIME + extension fallback)
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

const hp = read('src/components/attachments/HoverPreview.tsx');

console.log('── 1) Yapı + Generic API ─────────────────────────');
expectTrue('1.1 HoverPreviewItem interface — id+fileName+fileSize+mimeType?+uploadedBy?+uploadedAt?',
  /export interface HoverPreviewItem[\s\S]{0,400}uploadedBy\?:[\s\S]{0,100}uploadedAt\?/.test(hp));
expectTrue('1.2 Generic HoverPreview<T extends HoverPreviewItem>',
  /export function HoverPreview<T extends HoverPreviewItem>/.test(hp));
expectTrue('1.3 Props: item + getPreviewUrl + children + isImage?',
  /item:\s*T[\s\S]{0,200}getPreviewUrl:[\s\S]{0,200}children:\s*ReactNode[\s\S]{0,100}isImage\?/.test(hp));

console.log('\n── 2) Delay + lazy davranış ─────────────────────');
expectTrue('2.1 HOVER_DELAY_MS = 400',
  /HOVER_DELAY_MS\s*=\s*400/.test(hp));
expectTrue('2.2 CARD_MAX_WIDTH = 350',
  /CARD_MAX_WIDTH\s*=\s*350/.test(hp));
expectTrue('2.3 openTimer window.setTimeout ile 400ms sonra fetch',
  /openTimer\.current\s*=\s*window\.setTimeout\(async \(\)\s*=>/.test(hp));
expectTrue('2.4 LAZY — getPreviewUrl SADECE zamanlanmış handler içinde',
  /openTimer\.current\s*=\s*window\.setTimeout[\s\S]{0,1000}getPreviewUrl\(item\)/.test(hp));
expectTrue('2.5 mouseleave → scheduleClose → timer temizler',
  /scheduleClose[\s\S]{0,300}window\.clearTimeout\(openTimer\.current\)/.test(hp));

console.log('\n── 3) Oturum cache ─────────────────────────────');
expectTrue('3.1 Modül-scope urlCache Map (typed) tanımlı',
  /const urlCache\s*=\s*new Map(?:<[^>]+>)?\(\)/.test(hp));
expectTrue('3.2 Cache lookup: urlCache.get(item.id)',
  /const cached\s*=\s*urlCache\.get\(item\.id\)/.test(hp));
expectTrue('3.3 Cache hit → fetch atlanır (return early)',
  /if \(cached !== undefined\)[\s\S]{0,200}return/.test(hp));
expectTrue('3.4 Başarı → urlCache.set(item.id, r.url)',
  /urlCache\.set\(item\.id,\s*r\.url\)/.test(hp));
expectTrue('3.5 Hata → urlCache.set(item.id, null) (negative cache)',
  /urlCache\.set\(item\.id,\s*null\)/.test(hp));

console.log('\n── 4) Touch devre dışı — @media hover:hover ────');
expectTrue('4.1 Kart className: [@media(hover:hover)]:block + hidden default',
  /hidden[\s\S]{0,200}\[@media\(hover:hover\)\]:block/.test(hp));

console.log('\n── 4b) className prop — dış sarmalayıcı flex-item control (mini-fix) ─');
expectTrue('4b.1 Props tanımında className?: string',
  /className\?: string/.test(hp));
expectTrue('4b.2 Component signature className destructure eder',
  /export function HoverPreview<[\s\S]{0,300}className,\s*\}: Props/.test(hp));
expectTrue('4b.3 Dış span className\'e class merge — hover-preview-wrap${className}',
  /className=\{`hover-preview-wrap\$\{className \? ` \$\{className\}` : ''\}`\}/.test(hp));

console.log('\n── 5) Non-image kart 5 satır ───────────────────');
expectTrue('5.1 shouldFetch true (image) → thumbnail render alanı',
  /shouldFetch &&[\s\S]{0,600}<Loader2/.test(hp));
expectTrue('5.2 uploadedBy + uploadedAt render (5. satır)',
  /item\.uploadedBy \|\| item\.uploadedAt[\s\S]{0,600}\{item\.uploadedBy \?\? '—'\}/.test(hp));
expectTrue('5.3 formatShortDate helper (tr-TR)',
  /formatShortDate\(iso\?: string \| null\)[\s\S]{0,300}toLocaleDateString\('tr-TR'/.test(hp));

console.log('\n── 6) Silinen dosya guard — 404 sessiz ─────────');
expectTrue('6.1 img.onError → setErrored(true)',
  /onError=\{\(\)\s*=>\s*setErrored\(true\)\}/.test(hp));
expectTrue('6.2 Errored + görsel → "Önizleme yok" mini metin',
  /errored && !loading[\s\S]{0,200}Önizleme yok/.test(hp));

console.log('\n── 7) detectImageDefault helper ────────────────');
expectTrue('7.1 MIME startsWith image/',
  /m\.startsWith\('image\/'\)/.test(hp));
expectTrue('7.2 Extension fallback: png/jpe?g/gif/webp/bmp/svg',
  /\/\\\.\(png\|jpe\?g\|gif\|webp\|bmp\|svg\)\$\//.test(hp));

console.log('\n── 8) Davranış — detectImageDefault sim ────────');
function detectImg(item) {
  const m = (item.mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return true;
  const name = item.fileName.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
}
expect('8.1 image/png → true', detectImg({ mimeType: 'image/png', fileName: 'x' }), true);
expect('8.2 application/pdf + .pdf → false', detectImg({ mimeType: 'application/pdf', fileName: 'x.pdf' }), false);
expect('8.3 mime YOK + .jpg → true (extension fallback)', detectImg({ fileName: 'x.jpg' }), true);
expect('8.4 mime application/octet-stream + .webp → true (extension fallback)',
  detectImg({ mimeType: 'application/octet-stream', fileName: 'x.webp' }), true);
expect('8.5 mime YOK + .docx → false', detectImg({ fileName: 'x.docx' }), false);
expect('8.6 uppercase mime IMAGE/PNG → true (toLowerCase yakalar)',
  detectImg({ mimeType: 'IMAGE/PNG', fileName: 'x' }), true);

console.log('\n── 9) Davranış — cache semantiği sim ────────────');
const cache = new Map();
async function fetchWithCache(itemId, fetcher) {
  if (cache.has(itemId)) return cache.get(itemId);
  const r = await fetcher();
  cache.set(itemId, r);
  return r;
}
let fetchCount = 0;
const fetcher = async () => { fetchCount++; return 'https://example.com/x.png'; };

await fetchWithCache('a1', fetcher);
expect('9.1 İlk hover — fetch çağrıldı', fetchCount, 1);
await fetchWithCache('a1', fetcher);
expect('9.2 İkinci hover aynı id — fetch ATLANDI (cache hit)', fetchCount, 1);
await fetchWithCache('a2', fetcher);
expect('9.3 Farklı id — yeni fetch', fetchCount, 2);

// Negative cache
cache.set('bad', null);
await fetchWithCache('bad', fetcher);
expect('9.4 Negative cache (null) — fetch ATLANDI', fetchCount, 2);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
