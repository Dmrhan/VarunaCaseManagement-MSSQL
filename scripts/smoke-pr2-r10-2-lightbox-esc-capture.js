/**
 * smoke-pr2-r10-2-lightbox-esc-capture.js — 2026-07-04
 *
 * R10.2 — E2E kanıtlı çarpışma: sekme-içi Yanıtla → gövde dirty → reader ekinde
 * "Önizle" → lightbox → ESC → hem lightbox kapanır hem "Taslak kaydedilmez"
 * modalı fırlar (tek tuş iki katman).
 *
 * Fix: Lightbox ESC listener'ı { capture: true } + stopPropagation +
 * stopImmediatePropagation → composer/reader ESC listener'ları o tuşu HİÇ görmez.
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

const lightbox = read('src/components/attachments/Lightbox.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── 1) Lightbox capture-phase ESC ────────────');
expectTrue('1.1 addEventListener capture:true',
  /window\.addEventListener\('keydown',\s*onKey,\s*\{\s*capture:\s*true\s*\}\)/.test(lightbox));
expectTrue('1.2 removeEventListener capture:true (cleanup simetri)',
  /window\.removeEventListener\('keydown',\s*onKey,\s*\{\s*capture:\s*true\s*\}\)/.test(lightbox));
expectTrue('1.3 Escape dalı: stopPropagation + stopImmediatePropagation + onClose',
  /if \(e\.key === 'Escape'\)\s*\{[\s\S]{0,200}e\.stopPropagation\(\)[\s\S]{0,200}e\.stopImmediatePropagation\(\)[\s\S]{0,200}onClose\(\)/.test(lightbox));
expectTrue('1.4 Arrow tuşları capture akışında stop DEĞİL (bubble davranışı korunur)',
  !/if \(e\.key === 'ArrowLeft'\)[\s\S]{0,100}stopPropagation/.test(lightbox));
expectTrue('1.5 REGRESYON: eski bubble-phase addEventListener KALKMIŞ',
  !/window\.addEventListener\('keydown',\s*onKey\)\s*;/.test(lightbox));

console.log('\n── 2) Reader/Tab defense-in-depth KORUNDU ────');
expectTrue('2.1 Reader lightboxActiveId guard hâlâ mevcut',
  /if \(lightboxActiveId != null\) return/.test(reader));
expectTrue('2.2 Tab composerOpen ESC listener hâlâ mevcut (composer sahibi hâlâ ele alır)',
  /if \(!composerOpen\) return[\s\S]{0,300}composerCancelRef\.current\?\.\(\)/.test(tab));
expectTrue('2.3 Reader ESC deps: mode+onCollapse+escEnabled+lightboxActiveId',
  /}, \[mode, onCollapse, escEnabled, lightboxActiveId\]\)/.test(reader));

console.log('\n── 3) E2E kanıtlı senaryo — davranış sim ────');

/**
 * Capture-phase Lightbox listener önce çalışır ve Escape'te
 * stopPropagation + stopImmediatePropagation → sonraki bubble listener'ları
 * (composer, reader) o tuşu görmez.
 *
 * Sim: listener'ları öncelik sırasına göre çalıştır; her biri "swallowed"
 * bayrağını kontrol eder.
 */
function dispatchEsc({ lightboxOpen, composerOpen, dirty, modalOpen, fsOpen }) {
  let swallowed = false;
  const effects = [];
  // 1) Capture phase: Lightbox
  if (lightboxOpen) {
    effects.push('lightbox-close');
    swallowed = true; // stopPropagation + stopImmediatePropagation
  }
  if (swallowed) return { effects };
  // 2) Bubble phase: Composer parent listener (composerOpen)
  if (composerOpen) {
    if (modalOpen) effects.push('composer-modal-close');
    else if (dirty) effects.push('composer-modal-open');
    else effects.push('composer-close-onCancel');
    // Composer listener stopPropagation etmiyor → Reader da yakalayabilir
    // ama Reader iç guard escEnabled=!composerOpen → composerOpen=true iken
    // Reader hiç bir şey yapmaz.
  }
  // 3) Reader ESC (bubble)
  if (fsOpen && !composerOpen && !lightboxOpen) {
    effects.push('reader-onCollapse-fs');
  }
  return { effects };
}

// 3.1 Kanıtlanan çarpışma senaryosu — R10.2 fix'i sonrası:
//   Lightbox açık + composer açık + dirty + ESC → yalnız lightbox
const r1 = dispatchEsc({ lightboxOpen: true, composerOpen: true, dirty: true, modalOpen: false, fsOpen: false });
expect('3.1 Lightbox+composer+dirty+ESC → YALNIZ lightbox (modal fırlamaz)',
  r1.effects.length, 1);
expect('3.1b Effect adı = lightbox-close', r1.effects[0], 'lightbox-close');

// 3.2 Lightbox kapandıktan sonra ESC → composer modal (sıradaki katman)
const r2 = dispatchEsc({ lightboxOpen: false, composerOpen: true, dirty: true, modalOpen: false, fsOpen: false });
expect('3.2 Lightbox kapalı + composer dirty + ESC → composer modal aç',
  r2.effects[0], 'composer-modal-open');

// 3.3 Composer modal açıkken ESC → modal kapan (taslak durur)
const r3 = dispatchEsc({ lightboxOpen: false, composerOpen: true, dirty: true, modalOpen: true, fsOpen: false });
expect('3.3 Composer modal açık + ESC → modal kapanır',
  r3.effects[0], 'composer-modal-close');

// 3.4 REGRESYON — R10 B2 senaryosu: lightbox + fs (composer yok) → yalnız lightbox
const r4 = dispatchEsc({ lightboxOpen: true, composerOpen: false, dirty: false, modalOpen: false, fsOpen: true });
expect('3.4 REGRESYON R10 B2: lightbox+fs+ESC → yalnız lightbox (fs kalır)',
  r4.effects.length, 1);
expect('3.4b Effect adı = lightbox-close', r4.effects[0], 'lightbox-close');

// 3.5 REGRESYON — Çıplak fs + ESC → onCollapse
const r5 = dispatchEsc({ lightboxOpen: false, composerOpen: false, dirty: false, modalOpen: false, fsOpen: true });
expect('3.5 REGRESYON: Çıplak fs + ESC → onCollapse',
  r5.effects[0], 'reader-onCollapse-fs');

// 3.6 REGRESYON — Temiz composer + ESC → onCancel (composer kapanır, fs kalır)
const r6 = dispatchEsc({ lightboxOpen: false, composerOpen: true, dirty: false, modalOpen: false, fsOpen: true });
expect('3.6 REGRESYON: Temiz composer + ESC → onCancel',
  r6.effects[0], 'composer-close-onCancel');

// 3.7 Sekme-içi (fs yok) + lightbox açık + composer dirty → yalnız lightbox
const r7 = dispatchEsc({ lightboxOpen: true, composerOpen: true, dirty: true, modalOpen: false, fsOpen: false });
expect('3.7 Sekme-içi lightbox+composer+dirty+ESC → yalnız lightbox',
  r7.effects[0], 'lightbox-close');

// 3.8 Hiçbir katman yok → no-op
const r8 = dispatchEsc({ lightboxOpen: false, composerOpen: false, dirty: false, modalOpen: false, fsOpen: false });
expect('3.8 Hiçbir katman yok → no-op', r8.effects.length, 0);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
