/**
 * smoke-ux-pack-1-lightbox.js — 2026-07-04
 *
 * UX FIX PAKETİ PR-1 / FAZ 2 — Lightbox generic component.
 *
 * Kapsam (pattern + davranış):
 *  1. Bağımsız bileşen (src/components/attachments/Lightbox.tsx)
 *  2. Generic <T extends LightboxItem> — PR-2 tarafından tüketilecek
 *  3. ESC/backdrop kapatır + focus close butonu + ← → gezinme
 *  4. Zoom in/out toggle
 *  5. İndir + Yeni sekmede aç
 *  6. Başlık: ad + boyut + N/M nav counter
 *  7. Loading + error placeholder
 *  8. Davranış sim: nav bound clamp, activeIdx resolution
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

const lb = read('src/components/attachments/Lightbox.tsx');

console.log('── 1) Yapı + Generic API ─────────────────────────');
expectTrue('1.1 LightboxItem interface export',
  /export interface LightboxItem[\s\S]{0,200}id:\s*string[\s\S]{0,200}fileName:\s*string[\s\S]{0,100}fileSize:\s*number[\s\S]{0,100}mimeType\?/.test(lb));
expectTrue('1.2 Generic Lightbox<T extends LightboxItem>',
  /export function Lightbox<T extends LightboxItem>/.test(lb));
expectTrue('1.3 Props: open + onClose + items + activeId + onNavigate + getPreviewUrl + onDownload?',
  /open:\s*boolean[\s\S]{0,200}onClose:[\s\S]{0,200}items:\s*T\[\][\s\S]{0,200}activeId:\s*string[\s\S]{0,200}onNavigate:[\s\S]{0,200}getPreviewUrl:[\s\S]{0,200}onDownload\?/.test(lb));

console.log('\n── 2) Klavye + navigasyon ──────────────────────');
expectTrue('2.1 Escape → onClose',
  /if \(e\.key === 'Escape'\) \{ onClose\(\)/.test(lb));
expectTrue('2.2 ArrowLeft → goPrev',
  /if \(e\.key === 'ArrowLeft'\) \{ goPrev\(\)/.test(lb));
expectTrue('2.3 ArrowRight → goNext',
  /if \(e\.key === 'ArrowRight'\) \{ goNext\(\)/.test(lb));
expectTrue('2.4 canPrev = activeIdx > 0',
  /const canPrev\s*=\s*activeIdx > 0/.test(lb));
expectTrue('2.5 canNext = activeIdx < items.length - 1',
  /const canNext\s*=\s*activeIdx >= 0 && activeIdx < items\.length - 1/.test(lb));

console.log('\n── 3) Backdrop + focus trap ────────────────────');
expectTrue('3.1 Backdrop tıklaması kapatır (target === currentTarget)',
  /const backdropClick\s*=[\s\S]{0,300}if \(e\.target === e\.currentTarget\) onClose\(\)/.test(lb));
expectTrue('3.2 Kapat butonuna focus (açılışta)',
  /closeBtnRef\.current\?\.focus\(\)/.test(lb));

console.log('\n── 4) Header — ad + boyut + N/M ─────────────────');
expectTrue('4.1 Header ad: {active.fileName}',
  /\{active\.fileName\}/.test(lb));
expectTrue('4.2 Boyut: formatBytes(fileSize)',
  /formatBytes\(active\.fileSize\)/.test(lb));
expectTrue('4.3 N/M counter (items.length > 1)',
  /items\.length > 1[\s\S]{0,200}\$\{activeIdx \+ 1\} \/ \$\{items\.length\}/.test(lb));

console.log('\n── 5) Aksiyonlar ───────────────────────────────');
expectTrue('5.1 Zoom in/out toggle (setZoom100 !v)',
  /setZoom100\(\(v\) => !v\)/.test(lb));
expectTrue('5.2 Yeni sekmede aç: target=_blank + noopener',
  /target="_blank"[\s\S]{0,100}rel="noopener noreferrer"/.test(lb));
expectTrue('5.3 İndir button — onDownload callback',
  /onClick=\{\(\)\s*=>\s*onDownload\?\.\(active\)\}/.test(lb));

console.log('\n── 6) Görsel render + zoom ─────────────────────');
expectTrue('6.1 Loading spinner (loading true)',
  /loading &&\s*<Loader2/.test(lb));
expectTrue('6.2 Errored placeholder',
  /errored && !loading[\s\S]{0,200}Önizleme yüklenemedi/.test(lb));
expectTrue('6.3 img zoom100 → max-w-none cursor-zoom-out',
  /zoom100[\s\S]{0,100}max-w-none[\s\S]{0,100}cursor-zoom-out/.test(lb));
expectTrue('6.4 img default → fit (max-h-[85vh] max-w-[90vw] object-contain)',
  /max-h-\[85vh\][\s\S]{0,100}max-w-\[90vw\][\s\S]{0,100}object-contain/.test(lb));
expectTrue('6.5 img tık → zoom toggle',
  /onClick=\{\(e\)\s*=>\s*\{ e\.stopPropagation\(\); setZoom100/.test(lb));

console.log('\n── 7) Nav arrows (items.length > 1) ───────────');
expectTrue('7.1 Prev arrow render (canPrev disabled)',
  /disabled=\{!canPrev\}/.test(lb));
expectTrue('7.2 Next arrow render (canNext disabled)',
  /disabled=\{!canNext\}/.test(lb));
expectTrue('7.3 aria-label Önceki + Sonraki',
  /aria-label="Önceki görsel"/.test(lb) && /aria-label="Sonraki görsel"/.test(lb));

console.log('\n── 8) Davranış — nav bound clamp sim ──────────');

function pickCanNav(items, activeId) {
  const idx = items.findIndex((i) => i.id === activeId);
  return {
    canPrev: idx > 0,
    canNext: idx >= 0 && idx < items.length - 1,
    idx,
  };
}

const items3 = [
  { id: 'a', fileName: 'a.png', fileSize: 100 },
  { id: 'b', fileName: 'b.png', fileSize: 200 },
  { id: 'c', fileName: 'c.png', fileSize: 300 },
];
expect('8.1 activeId=b → canPrev + canNext',
  JSON.stringify(pickCanNav(items3, 'b')),
  '{"canPrev":true,"canNext":true,"idx":1}');
expect('8.2 activeId=a (baş) → canPrev false',
  pickCanNav(items3, 'a').canPrev, false);
expect('8.3 activeId=c (son) → canNext false',
  pickCanNav(items3, 'c').canNext, false);
expect('8.4 activeId=unknown → idx=-1, canPrev+canNext false',
  JSON.stringify(pickCanNav(items3, 'z')),
  '{"canPrev":false,"canNext":false,"idx":-1}');

// Tek item — nav yok
const items1 = [{ id: 'x', fileName: 'x.png', fileSize: 100 }];
expect('8.5 Tek item → canPrev + canNext false',
  JSON.stringify(pickCanNav(items1, 'x')),
  '{"canPrev":false,"canNext":false,"idx":0}');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
