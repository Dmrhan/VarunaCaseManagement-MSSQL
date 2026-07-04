/**
 * smoke-pr2-r10-fs-fixes.js — 2026-07-04
 *
 * PR-2 görsel tur R10 — Tam-ekran İletişim fonksiyonel fix paketi:
 *   B1 — Composer tam-ekranda overlay arkasında kalıyordu (P1)
 *   B2 — ESC lightbox yerine tam-ekranı kapatıyordu (P1)
 *   B3 — ESC composer taslağını yiyip tam-ekranı kapatıyordu (P1)
 *   B4 — normalizeSubject token konum-bağımsız + Konu değişti inbound-only
 *   B5 — Tam-ekran üst başlık barı (caseNumber + title + · Müşteri + · İletişim)
 *
 * KURAL: R8 tek-composer-instance BOZULMADI (fiber tree'de aynı konum,
 * state korunur — Büyüt sırasında taslak kaybı yok).
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
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const detail = read('src/features/cases/CaseDetailPage.tsx');
const normalizer = read('src/lib/subjectNormalizer.ts');

console.log('── B1) Composer 3. wrapper durumu (fs+inline dock) ──');
expectTrue('B1.1 R8 KORUNDU: MailComposer instance TEK (fiber sabit)',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('B1.2 overlay durumu: fixed inset-0 z-50',
  /composerLayout === 'overlay'\s*\?\s*'fixed inset-0 z-50/.test(tab));
expectTrue('B1.3 fs+inline dock: fixed bottom-0 right-0 z-50 + max-h-[55%] + overflow-auto',
  /readerMode === 'fullscreen'\s*\?\s*'fixed bottom-0 right-0 z-50 max-h-\[55%\] overflow-auto/.test(tab));
expectTrue('B1.4 dock kenar/gölge: border-t border-l + shadow-2xl',
  /fixed bottom-0 right-0 z-50 max-h-\[55%\] overflow-auto border-t border-l[\s\S]{0,200}shadow-2xl/.test(tab));
expectTrue('B1.5 tab-içi inline: mt-3 rounded-lg ring-1 (regresyonsuz)',
  /:\s*'mt-3 rounded-lg ring-1 ring-slate-200/.test(tab));
expectTrue('B1.6 dock style — left: `${fsSplitRatio * 100}%` (drag ratio ile canlı)',
  /composerLayout === 'inline' && readerMode === 'fullscreen'\s*\?\s*\{\s*left:\s*`\$\{fsSplitRatio \* 100\}%`\s*\}/.test(tab));
expectTrue('B1.7 REGRESYON: overlay class dizini eski iki-yol (overlay|inline) tek satır DEĞİL — üçlü ternary',
  /composerLayout === 'overlay'[\s\S]{0,60}\?[\s\S]{0,300}readerMode === 'fullscreen'[\s\S]{0,60}\?/.test(tab));

console.log('\n── B2+B3) ESC katman sahipliği ──────────────');
expectTrue('B2.1 MailThreadReader escEnabled?: boolean prop',
  /escEnabled\?:\s*boolean/.test(reader));
expectTrue('B2.2 escEnabled default true (geriye uyum)',
  /escEnabled\s*=\s*true/.test(reader));
expectTrue('B2.3 ESC effect: lightboxActiveId != null → return (Lightbox sahip)',
  /if \(e\.key !== 'Escape'\) return;[\s\S]{0,200}if \(lightboxActiveId != null\) return/.test(reader));
expectTrue('B2.4 ESC effect: !escEnabled → return (composer sahip)',
  /if \(lightboxActiveId != null\) return;[\s\S]{0,200}if \(!escEnabled\) return/.test(reader));
expectTrue('B2.5 ESC effect deps — mode + onCollapse + escEnabled + lightboxActiveId',
  /}, \[mode, onCollapse, escEnabled, lightboxActiveId\]\)/.test(reader));
expectTrue('B2.6 CommunicationTab iki Reader escEnabled={!composerOpen}',
  (tab.match(/escEnabled=\{!composerOpen\}/g) ?? []).length === 2);

console.log('\n── B2+B3 davranış simülasyonu ───────────────');

// Reader ESC handler davranışı — util-eş
function readerEscHandler({ mode, lightboxActiveId, escEnabled }) {
  if (mode !== 'fullscreen') return 'no-op';
  if (lightboxActiveId != null) return 'no-op-lightbox';
  if (!escEnabled) return 'no-op-composer';
  return 'onCollapse';
}

// Lightbox açık, fs açık, composer kapalı → sadece lightbox kapanır
expect('B2.7 Lightbox açık: fs kapanmaz',
  readerEscHandler({ mode: 'fullscreen', lightboxActiveId: 'att-1', escEnabled: true }),
  'no-op-lightbox');

// Composer açık, fs açık, lightbox yok → fs kapanmaz (taslak korunur)
expect('B3.1 Composer açık: fs kapanmaz (taslak korunur)',
  readerEscHandler({ mode: 'fullscreen', lightboxActiveId: null, escEnabled: false }),
  'no-op-composer');

// Hiçbiri yok, fs açık → onCollapse
expect('B2.8 Çıplak fs + ESC → onCollapse',
  readerEscHandler({ mode: 'fullscreen', lightboxActiveId: null, escEnabled: true }),
  'onCollapse');

// inline mode → hiç
expect('B2.9 inline mode → ESC no-op',
  readerEscHandler({ mode: 'inline', lightboxActiveId: null, escEnabled: true }),
  'no-op');

// Lightbox + composer eş zamanlı → lightbox önce (öncelik en üstteki katman)
expect('B2.10 Lightbox + composer eş zamanlı: lightbox öncelik',
  readerEscHandler({ mode: 'fullscreen', lightboxActiveId: 'x', escEnabled: false }),
  'no-op-lightbox');

console.log('\n── B4) normalizeSubject token konum-bağımsız ─');
expectTrue('B4.1 CASE_TOKEN_GLOBAL_RE (/g flag)',
  /CASE_TOKEN_GLOBAL_RE\s*=\s*\/[^/]+\/g/.test(normalizer));
expectTrue('B4.2 CASE_TOKEN_FIRST_RE (ilk occurrence sakla)',
  /CASE_TOKEN_FIRST_RE\s*=\s*\/[^/]+\//.test(normalizer));
expectTrue('B4.3 REGRESYON: eski ^-anchored CASE_TOKEN_RE KALKMIŞ',
  !/CASE_TOKEN_RE\s*=\s*\/\^/.test(normalizer));
expectTrue('B4.4 replace(CASE_TOKEN_GLOBAL_RE, " ")',
  /input\.replace\(CASE_TOKEN_GLOBAL_RE,\s*' '\)/.test(normalizer));

console.log('\n── B4 ListPane — konu-değişti inbound-only ──');
expectTrue('B4.5 subjectChanged = inbound && subjectClean.length && caseTitle...',
  /subjectChanged\s*=\s*\n?\s*inbound\s*&&\s*\n?\s*subjectClean\.length > 0/.test(listPane));
expectTrue('B4.6 R10 açıklama: notification_dispatch + agent yanıtı doğal farklı',
  /notification_dispatch[\s\S]{0,200}g[üu]r[üu]lt[üu]/.test(listPane));

console.log('\n── B5) Tam-ekran üst başlık barı ────────────');
expectTrue('B5.1 CommunicationTab Props onOpenAccount?: (accountId: string) => void',
  /onOpenAccount\?:\s*\(accountId:\s*string\)\s*=>\s*void/.test(tab));
expectTrue('B5.2 CommunicationTab destructure onOpenAccount',
  /export function CommunicationTab\(\{ item, onCaseShouldRefresh, onOpenAccount \}: Props\)/.test(tab));
expectTrue('B5.3 fs overlay flex flex-col (bar üstte)',
  /className="fixed inset-0 z-40 flex flex-col bg-white/.test(tab));
expectTrue('B5.4 Bar h-14 + border-b',
  /className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/.test(tab));
expectTrue('B5.5 Bar caseNumber badge (font-mono)',
  /rounded bg-slate-100 px-2 py-0\.5 font-mono text-xs[\s\S]{0,100}\{item\.caseNumber\}/.test(tab));
expectTrue('B5.6 Bar title (font-semibold + truncate)',
  /min-w-0 flex-1 truncate text-sm font-semibold[\s\S]{0,150}\{item\.title\}/.test(tab));
expectTrue('B5.7 Bar accountName tıklanabilir → onOpenAccount(item.accountId)',
  /onOpenAccount && item\.accountId[\s\S]{0,200}onClick=\{\(\) => onOpenAccount\(item\.accountId\)\}[\s\S]{0,200}\{item\.accountName\}/.test(tab));
expectTrue('B5.8 Bar customerContactName muted',
  /truncate text-xs text-slate-500[\s\S]{0,200}\{item\.customerContactName\}/.test(tab));
expectTrue('B5.9 Bar X kapat — setReaderMode(\'inline\') → aria-label="Kapat" → <X size={18}/>',
  /aria-label="Kapat"[\s\S]{0,200}<X size=\{18\}/.test(tab)
  && /onClick=\{\(\) => setReaderMode\('inline'\)\}[\s\S]{0,400}aria-label="Kapat"/.test(tab));
expectTrue('B5.10 Body flex-1 min-h-0 (bar altında liste+reader row)',
  /<div ref=\{fsContainerRef\} className="flex min-h-0 w-full flex-1">/.test(tab));
expectTrue('B5.11 CaseDetailPage → CommunicationTab onOpenAccount geçilir',
  /<CommunicationTab[\s\S]{0,500}onOpenAccount=\{onOpenAccount\}/.test(detail));

console.log('\n── Regresyon — R9 + R9.1 + R8 ───────────────');
expectTrue('R.1 R8 KORUNDU: composer instance sayısı === 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('R.2 R9.1 currentUserId 4 wiring (2 ListPane + 2 Reader)',
  (tab.match(/currentUserId=\{currentUserId\}/g) ?? []).length === 4);
expectTrue('R.3 R9 ListPane konu-değişti mantığı hâlâ mevcut (koşul + amber renk)',
  /subjectChanged\s*=/.test(listPane) && /text-amber-700/.test(listPane));
expectTrue('R.4 R9.1 computeSenderDisplay ortak util import — hâlâ mevcut',
  /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(listPane)
  && /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(reader));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
