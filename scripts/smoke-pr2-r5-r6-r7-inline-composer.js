/**
 * smoke-pr2-r5-r6-r7-inline-composer.js — 2026-07-04
 *
 * PR-2 görsel tur R5+R6+R7:
 *   R5 — Satır-içi yanıt (Gmail paritesi): inline composer reader body altında;
 *        hızlı-yanıt = kapalı hali; overlay yalnız Yeni/İlet/Büyüt; TEK bileşen.
 *   R6 — Genişletilmiş görünüm cilası: body max-w-760 mx-auto p-6; sol liste
 *        variant='fullscreen' bg-slate-50 + seçili sol vurgu.
 *   R7 — Composer form düzeni: "Ayrıntılar ▾" toggle (Cc/Bcc/İmza/Şablon).
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

const composer = read('src/features/cases/components/MailComposer.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── 1) R5 MailComposer — layoutMode prop + Büyüt ─');
expectTrue('1.1 MailComposerProps.layoutMode?: "overlay" | "inline"',
  /layoutMode\?:\s*'overlay'\s*\|\s*'inline'/.test(composer));
expectTrue('1.2 MailComposerProps.onGrow?: () => void (inline → overlay)',
  /onGrow\?:\s*\(\)\s*=>\s*void/.test(composer));
expectTrue('1.3 layoutMode default = "overlay" (regresyonsuz)',
  /layoutMode\s*=\s*'overlay'/.test(composer));
expectTrue('1.4 Büyüt butonu — inline mode + onGrow',
  /layoutMode === 'inline' && onGrow[\s\S]{0,400}Büyüt/.test(composer));

console.log('\n── 2) R7 Advanced toggle (Ayrıntılar ▾) ─────');
expectTrue('2.1 showAdvanced state',
  /const \[showAdvanced, setShowAdvanced\]\s*=\s*useState\(false\)/.test(composer));
expectTrue('2.2 Toggle button — aria-expanded + "ayrıntılar (Cc / Bcc / İmza / Şablon)"',
  /aria-expanded=\{showAdvanced\}[\s\S]{0,300}ayrıntılar \(Cc \/ Bcc \/ İmza \/ Şablon\)/.test(composer));
expectTrue('2.3 Cc + Bcc ContactPicker → showAdvanced altında',
  /showAdvanced && \([\s\S]{0,300}Kopya \(Cc\)[\s\S]{0,300}Gizli Kopya \(Bcc\)/.test(composer));
expectTrue('2.4 İmza + Mail Şablonu grid → showAdvanced altında',
  /showAdvanced && \(\s*<div className="grid[\s\S]{0,600}İmza/.test(composer));
expectTrue('2.5 REGRESYON: eski her zaman görünür Cc/Bcc bloğu KALKMIŞ (bare)',
  !/\}\s*<ContactPicker\s+label="Kopya \(Cc\)"/.test(composer));

console.log('\n── 3) R5 MailThreadReader — bottomSlot + onQuickReply kalktı ─');
expectTrue('3.1 Props: bottomSlot?: React.ReactNode',
  /bottomSlot\?:\s*React\.ReactNode/.test(reader));
expectTrue('3.2 REGRESYON: onQuickReply prop KALKMIŞ (parent bottomSlot ile karar)',
  !/onQuickReply:\s*\(email:/.test(reader));
expectTrue('3.3 bottomSlot conditional render (bottomSlot && <div>)',
  /\{bottomSlot && \(\s*<div className="shrink-0 border-t/.test(reader));
expectTrue('3.4 REGRESYON: eski sabit hızlı-yanıt button (Hızlı yanıt yaz…) KALKMIŞ (reader\'da)',
  !/onClick=\{\(\) => onQuickReply\(email\)\}/.test(reader));

console.log('\n── 4) R6 Reader body cilası ─────────────────');
expectTrue('4.1 Body max-w-[760px] mx-auto p-6',
  /flex-1 overflow-auto p-6[\s\S]{0,200}mx-auto max-w-\[760px\]/.test(reader));
expectTrue('4.2 REGRESYON: max-w-[680px] KALKMIŞ (R6 yeni değer 760)',
  !/max-w-\[680px\]/.test(reader));
expectTrue('4.3 Header konu tipografi text-lg font-medium (R6)',
  /truncate text-lg font-medium/.test(reader));
expectTrue('4.4 Meta text-[13px] muted',
  /text-\[13px\] text-slate-500/.test(reader));

console.log('\n── 5) R6 MailThreadListPane variant="fullscreen" ─');
expectTrue('5.1 Props: variant?: "default" | "fullscreen"',
  /variant\?:\s*'default'\s*\|\s*'fullscreen'/.test(listPane));
expectTrue('5.2 Fullscreen: bg-slate-50 zemin',
  /fs \? 'bg-slate-50/.test(listPane));
expectTrue('5.3 Fullscreen seçili: border-l-4 border-brand-600 + bg-white (sol iç vurgu)',
  /border-l-4 border-brand-600 bg-white/.test(listPane));
expectTrue('5.4 Fullscreen satır aralığı ferah — min-h-[44px] px-3 py-2.5',
  /min-h-\[44px\] px-3 py-2\.5/.test(listPane));
expectTrue('5.5 CommunicationTab fullscreen için variant="fullscreen" verir',
  /<MailThreadListPane[\s\S]{0,600}variant="fullscreen"/.test(tab));

console.log('\n── 6) R5 CommunicationTab — composerLayout state + akış ─');
expectTrue('6.1 composerLayout state ("inline" | "overlay")',
  /const \[composerLayout, setComposerLayout\]\s*=\s*useState<'inline'\s*\|\s*'overlay'>/.test(tab));
expectTrue('6.2 openReply → setComposerLayout("inline") (Gmail paritesi)',
  /const openReply\s*=\s*useCallback[\s\S]{0,500}setComposerLayout\('inline'\)/.test(tab));
expectTrue('6.3 openForward → setComposerLayout("overlay")',
  /const openForward\s*=\s*useCallback[\s\S]{0,500}setComposerLayout\('overlay'\)/.test(tab));
expectTrue('6.4 openNew → setComposerLayout("overlay")',
  /const openNew\s*=\s*useCallback[\s\S]{0,400}setComposerLayout\('overlay'\)/.test(tab));
expectTrue('6.5 growComposer → setComposerLayout("overlay") (Büyüt)',
  /const growComposer\s*=\s*useCallback[\s\S]{0,300}setComposerLayout\('overlay'\)/.test(tab));

console.log('\n── 7) R5 renderReaderBottom — inline composer VE hızlı-yanıt ─');
expectTrue('7.1 renderReaderBottom callback',
  /const renderReaderBottom\s*=\s*useCallback/.test(tab));
expectTrue('7.2 composerOpen && layout==="inline" → MailComposer inline',
  /composerOpen && composerLayout === 'inline'[\s\S]{0,600}<MailComposer[\s\S]{0,600}layoutMode="inline"/.test(tab));
expectTrue('7.3 onGrow={growComposer} (Büyüt tıklama parent\'a bildirir)',
  /onGrow=\{growComposer\}/.test(tab));
expectTrue('7.4 Kapalı hal (else) → hızlı-yanıt button → openReply',
  /return \(\s*<button[\s\S]{0,400}Hızlı yanıt yaz[\s\S]{0,100}Yanıtla ile aynı bileşen/.test(tab));
expectTrue('7.5 Her iki reader (inline + fullscreen) bottomSlot alır',
  (tab.match(/bottomSlot=\{renderReaderBottom\(selectedEmail\)\}/g) ?? []).length === 2);

console.log('\n── 8) R5 Overlay composer — YALNIZ layout="overlay" ─');
expectTrue('8.1 Overlay conditional: composerOpen && composerLayout === "overlay"',
  /composerOpen && composerLayout === 'overlay' && \(/.test(tab));
expectTrue('8.2 Overlay MailComposer layoutMode="overlay"',
  /composerOpen && composerLayout === 'overlay'[\s\S]{0,800}<MailComposer[\s\S]{0,600}layoutMode="overlay"/.test(tab));
expectTrue('8.3 REGRESYON: eski `composerOpen && (` (layout-check\'siz) KALKMIŞ',
  !/composerOpen && \(\s*<div className="fixed inset-0 z-50/.test(tab));

console.log('\n── 9) Davranış — composer akış sim ────────────');

function composerFlow(action) {
  const state = { open: false, layout: 'overlay', ctx: null };
  const openReply = () => { state.ctx = 'reply'; state.layout = 'inline'; state.open = true; };
  const openForward = () => { state.ctx = 'forward'; state.layout = 'overlay'; state.open = true; };
  const openNew = () => { state.ctx = null; state.layout = 'overlay'; state.open = true; };
  const growComposer = () => { state.layout = 'overlay'; };
  const handleSent = () => { state.open = false; state.ctx = null; };
  const handleCancel = () => { state.open = false; state.ctx = null; };
  const actions = { openReply, openForward, openNew, growComposer, handleSent, handleCancel };
  for (const a of action) actions[a]();
  return state;
}

// R5: Yanıtla → inline
const r1 = composerFlow(['openReply']);
expect('9.1 openReply → inline composer', r1.layout, 'inline');
expect('9.1b composerOpen=true', r1.open, true);

// R5: hızlı-yanıt = openReply (aynı bileşen)
const r2 = composerFlow(['openReply']);
expect('9.2 hızlı-yanıt → openReply → aynı inline layout', r2.layout, 'inline');

// R5: İlet → overlay
const r3 = composerFlow(['openForward']);
expect('9.3 openForward → overlay composer', r3.layout, 'overlay');

// R5: Yeni e-posta → overlay
const r4 = composerFlow(['openNew']);
expect('9.4 openNew → overlay composer', r4.layout, 'overlay');

// R5: Büyüt: inline → overlay
const r5 = composerFlow(['openReply', 'growComposer']);
expect('9.5 Büyüt: inline → overlay (taslak korunur, state aynı)',
  r5.layout, 'overlay');
expect('9.5b Composer HÂLÂ açık (state korunur)', r5.open, true);

// Gönderim sonrası kapanır
const r6 = composerFlow(['openReply', 'handleSent']);
expect('9.6 Gönder sonrası kapanır', r6.open, false);
expect('9.6b Bulunulan görünüme dön (layout dokunulmaz? handleSent temizler)',
  r6.layout, 'inline'); // state layout hâlâ inline; composerOpen false

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
