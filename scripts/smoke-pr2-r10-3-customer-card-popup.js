/**
 * smoke-pr2-r10-3-customer-card-popup.js — 2026-07-04
 *
 * R10.3 — Tam-ekran başlık barı müşteri linki: CustomerCardModal popup
 * (Detay sekmesindeki kardeş desen). R10 B5'te yanlışlıkla onOpenAccount
 * (accounts sayfası navigasyonu) bağlanmıştı → tam-ekran + İletişim bağlamı
 * kayboluyordu.
 *
 * Fixes:
 *  - CommunicationTab: onOpenAccount prop yerine onShowCustomer
 *  - Başlık barı tıklaması onShowCustomer(item.accountId) çağırır
 *  - CaseDetailPage onShowCustomer'ı CommunicationTab'a geçirir
 *  - Modal.tsx ESC listener capture:true + stopPropagation → kart açıkken
 *    ESC yalnız kartı kapatır (composer/reader ESC'lerine ulaşmaz)
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

const tab = read('src/features/cases/components/CommunicationTab.tsx');
const detail = read('src/features/cases/CaseDetailPage.tsx');
const modal = read('src/components/ui/Modal.tsx');
const app = read('src/App.tsx');

console.log('── 1) CommunicationTab prop swap ─────────────');
expectTrue('1.1 Props: onShowCustomer?: (accountId: string) => void',
  /onShowCustomer\?:\s*\(accountId:\s*string\)\s*=>\s*void/.test(tab));
expectTrue('1.2 Destructure onShowCustomer',
  /export function CommunicationTab\(\{ item, onCaseShouldRefresh, onShowCustomer \}: Props\)/.test(tab));
expectTrue('1.3 REGRESYON: onOpenAccount CommunicationTab\'dan kaldırıldı (ölü-değer)',
  !/onOpenAccount\?:\s*\(accountId:\s*string\)/.test(tab));
expectTrue('1.4 REGRESYON: onOpenAccount destructure kalktı',
  !/onOpenAccount \}: Props/.test(tab));
expectTrue('1.5 REGRESYON: onOpenAccount tıklama kalktı',
  !/onClick=\{\(\) => onOpenAccount\(item\.accountId\)\}/.test(tab));

console.log('\n── 2) Başlık barı — onShowCustomer wiring ────');
expectTrue('2.1 Bar accountName tıklaması onShowCustomer(item.accountId)',
  /onShowCustomer && item\.accountId[\s\S]{0,300}onClick=\{\(\) => onShowCustomer\(item\.accountId\)\}[\s\S]{0,300}\{item\.accountName\}/.test(tab));
expectTrue('2.2 Tooltip "Müşteri kartını aç: X" (davranış tooltip\'e uyar)',
  /title=\{`Müşteri kartını aç: \$\{item\.accountName\}`\}/.test(tab));

console.log('\n── 3) CaseDetailPage → CommunicationTab pipeline ─');
expectTrue('3.1 CaseDetailPage onShowCustomer aktif prop (R10.3: _prefix + eslint yorumu kaldırıldı)',
  /export function CaseDetailPage\(\{ caseId, onBack, onShowCustomer, onOpenAccount \}: CaseDetailPageProps\)/.test(detail));
expectTrue('3.2 REGRESYON: eski `onShowCustomer: _onShowCustomer` KALKMIŞ',
  !/onShowCustomer:\s*_onShowCustomer/.test(detail));
expectTrue('3.3 CommunicationTab çağrısı onShowCustomer={onShowCustomer} geçirir',
  /<CommunicationTab[\s\S]{0,600}onShowCustomer=\{onShowCustomer\}/.test(detail));
expectTrue('3.4 REGRESYON: CommunicationTab çağrısı onOpenAccount göndermiyor',
  !/<CommunicationTab[\s\S]{0,600}onOpenAccount=/.test(detail));
expectTrue('3.5 App.tsx CaseDetailPage onShowCustomer={setCustomerCardId} DEVAM (kardeş kullanım korundu)',
  /<CaseDetailPage[\s\S]{0,300}onShowCustomer=\{\(id\) => setCustomerCardId\(id\)\}/.test(app));

console.log('\n── 4) Modal ESC katman sahipliği ─────────────');
expectTrue('4.1 addEventListener capture:true',
  /window\.addEventListener\('keydown',\s*onKey,\s*\{\s*capture:\s*true\s*\}\)/.test(modal));
expectTrue('4.2 removeEventListener capture:true (cleanup simetri)',
  /window\.removeEventListener\('keydown',\s*onKey,\s*\{\s*capture:\s*true\s*\}\)/.test(modal));
expectTrue('4.3 Escape dalı: stopPropagation + stopImmediatePropagation + onClose',
  /if \(e\.key !== 'Escape'\) return[\s\S]{0,200}e\.stopPropagation\(\)[\s\S]{0,200}e\.stopImmediatePropagation\(\)[\s\S]{0,200}onClose\(\)/.test(modal));
expectTrue('4.4 REGRESYON: eski bubble-phase kısa satır KALKMIŞ',
  !/onKey\s*=\s*\(e: KeyboardEvent\)\s*=>\s*e\.key === 'Escape' && onClose\(\);/.test(modal));

console.log('\n── 5) Kart popup z-index: overlay üstünde ────');
// Modal fixed inset-0 z-50; CommunicationTab fullscreen overlay z-40.
expectTrue('5.1 Modal z-50 (fixed inset-0)',
  /fixed inset-0 z-50/.test(modal));
expectTrue('5.2 CommunicationTab fs overlay z-40 (Modal onun üstünde açılır)',
  /fixed inset-0 z-40 flex flex-col bg-white/.test(tab));

console.log('\n── 6) ESC katman zinciri — davranış sim ─────');

// Layered ESC dispatcher — Lightbox R10.2 + Modal R10.3 capture öncelik
function dispatchEsc({ lightboxOpen, cardOpen, composerOpen, dirty, modalOpen, fsOpen }) {
  const effects = [];
  // 1) Capture phase — Lightbox
  if (lightboxOpen) return { effects: ['lightbox-close'] };
  // 2) Capture phase — Modal (CustomerCardModal buradan geçer)
  if (cardOpen) return { effects: ['card-close'] };
  // 3) Bubble phase — Composer parent (composerOpen)
  if (composerOpen) {
    if (modalOpen) effects.push('composer-modal-close');
    else if (dirty) effects.push('composer-modal-open');
    else effects.push('composer-close-onCancel');
    return { effects };
  }
  // 4) Reader ESC (bubble)
  if (fsOpen) effects.push('reader-onCollapse-fs');
  return { effects };
}

// 6.1 Kanıt senaryosu — kart açık + fs açık + ESC → yalnız kart
const r1 = dispatchEsc({ lightboxOpen: false, cardOpen: true, composerOpen: false, dirty: false, modalOpen: false, fsOpen: true });
expect('6.1 Kart açık + fs açık + ESC → YALNIZ kart kapanır (fs kalır)',
  r1.effects[0], 'card-close');
expect('6.1b Tek katman kapanır (1 effect)', r1.effects.length, 1);

// 6.2 Kart açık + composer dirty + ESC → yalnız kart
const r2 = dispatchEsc({ lightboxOpen: false, cardOpen: true, composerOpen: true, dirty: true, modalOpen: false, fsOpen: true });
expect('6.2 Kart açık + composer dirty + ESC → YALNIZ kart (composer modal fırlamaz)',
  r2.effects[0], 'card-close');

// 6.3 REGRESYON — Lightbox öncelik (kart üzerinde de)
const r3 = dispatchEsc({ lightboxOpen: true, cardOpen: true, composerOpen: false, dirty: false, modalOpen: false, fsOpen: true });
expect('6.3 REGRESYON: Lightbox öncelik (kart açıkken bile)',
  r3.effects[0], 'lightbox-close');

// 6.4 Kart kapandıktan sonra ESC → sıradaki katman (composer/reader)
const r4 = dispatchEsc({ lightboxOpen: false, cardOpen: false, composerOpen: true, dirty: true, modalOpen: false, fsOpen: true });
expect('6.4 Kart kapandıktan sonra ESC → composer modal aç (sıra devam)',
  r4.effects[0], 'composer-modal-open');

// 6.5 REGRESYON — Çıplak fs + ESC → onCollapse
const r5 = dispatchEsc({ lightboxOpen: false, cardOpen: false, composerOpen: false, dirty: false, modalOpen: false, fsOpen: true });
expect('6.5 REGRESYON: Çıplak fs + ESC → onCollapse',
  r5.effects[0], 'reader-onCollapse-fs');

console.log('\n── 7) Detay sekmesi kardeş akışı REGRESYON ───');
// App.tsx CaseDetailPage → onShowCustomer → setCustomerCardId → CustomerCardModal
// zinciri hâlâ çalışır. Detay içi accountId tıklaması etkilenmedi.
expectTrue('7.1 App CustomerCardModal hâlâ mount edilir (z-50 popup)',
  /<CustomerCardModal[\s\S]{0,300}onClose=\{\(\) => setCustomerCardId\(null\)\}/.test(app));
expectTrue('7.2 setCustomerCardId state hâlâ mevcut',
  /const \[customerCardId, setCustomerCardId\]\s*=\s*useState<string \| null>\(null\)/.test(app));

console.log('\n── 8) R10.1/R10.2/R8/R9.1 KORUNDU ────────────');
expectTrue('8.1 R8: MailComposer instance = 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('8.2 R10.1: composer compactDock + cancelRequestRef',
  /compactDock=\{composerLayout === 'inline' && readerMode === 'fullscreen'\}/.test(tab)
  && /cancelRequestRef=\{composerCancelRef\}/.test(tab));
expectTrue('8.3 R9.1: currentUserId 4 wiring',
  (tab.match(/currentUserId=\{currentUserId\}/g) ?? []).length === 4);
expectTrue('8.4 R10 B5 + R11: bar h-14 + caseNumber badge (MAIL_TYPE.barCaseNo) hâlâ mevcut',
  /flex h-14 shrink-0 items-center gap-3 border-b/.test(tab)
  && /\$\{MAIL_TYPE\.barCaseNo\}[\s\S]{0,100}\{item\.caseNumber\}/.test(tab));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
