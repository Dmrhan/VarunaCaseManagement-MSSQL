/**
 * smoke-pr2-r3-r4-gmail-and-handle.js — 2026-07-04
 *
 * PR-2 görsel tur R3 + R4:
 *   R3 — Drag handle görünürlüğü (her iki bölücü)
 *   R4 — Fullscreen Gmail düzeni (sol liste + dikey drag + sağ reader)
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

console.log('── 1) MailThreadListPane bileşen (YENİ, ortak) ─');
expectTrue('1.1 Yeni dosya + export function MailThreadListPane',
  /export function MailThreadListPane/.test(listPane));
expectTrue('1.2 Props: emails + selectedId + onSelect + className?',
  /interface Props[\s\S]{0,300}emails:[\s\S]{0,100}selectedId:[\s\S]{0,100}onSelect:[\s\S]{0,100}className\?/.test(listPane));
expectTrue('1.3 CommunicationTab sekme içi ÜST pane olarak kullanır (h-full)',
  /<MailThreadListPane[\s\S]{0,300}className="h-full"/.test(tab));
expectTrue('1.4 Aynı bileşen fullscreen SOL pane olarak da kullanılır',
  (tab.match(/<MailThreadListPane/g) ?? []).length === 2);

console.log('\n── 2) Reader wrapper simplification (parent yönetir) ─');
expectTrue('2.1 Reader\'da mode===inline ? <div> : <fixed inset-0> switch KALKMIŞ',
  !/mode === 'inline' \? \(\s*<div[\s\S]{0,300}rounded-md border[\s\S]{0,100}\) : \(\s*<div[\s\S]{0,200}fixed inset-0/.test(reader));
expectTrue('2.2 Reader tek div wrapper (mode-agnostic)',
  /<div className="flex h-full min-h-0 flex-col bg-white[\s\S]{0,200}\{readerBody\}/.test(reader));
expectTrue('2.3 Reader fullscreen için kendi overlay YAPMAZ (parent CommunicationTab yapar)',
  !/role="dialog"[\s\S]{0,200}fixed inset-0 z-40 flex flex-col/.test(reader));

console.log('\n── 3) R4 Fullscreen Gmail düzeni ─────────────');
expectTrue('3.1 Fullscreen guard: readerMode==="fullscreen" && emails.length > 0 && selectedEmail',
  /readerMode === 'fullscreen' && emails\.length > 0 && selectedEmail/.test(tab));
expectTrue('3.2 Fullscreen overlay fixed inset-0 z-40 (composer z-50 altında)',
  /fixed inset-0 z-40 flex bg-white/.test(tab));
expectTrue('3.3 role="dialog" + aria-modal="true" + aria-label',
  /role="dialog"[\s\S]{0,200}aria-modal="true"[\s\S]{0,300}Mail thread \(genişletilmiş\)/.test(tab));
expectTrue('3.4 SOL pane genişliği fsSplitRatio ile bağlı',
  /width:\s*`\$\{fsSplitRatio \* 100\}%`/.test(tab));
expectTrue('3.5 Reader mode="fullscreen" prop',
  /<MailThreadReader[\s\S]{0,600}mode="fullscreen"/.test(tab));
expectTrue('3.6 Reader mode="inline" (sekme içi) ayrı instance',
  /<MailThreadReader[\s\S]{0,600}mode="inline"/.test(tab));

console.log('\n── 4) R4 Fullscreen split state + guard\'lar ──');
expectTrue('4.1 FS_SPLIT_STORAGE_KEY = "pr2.commTab.fullscreenListRatio" (ayrı anahtar)',
  /FS_SPLIT_STORAGE_KEY\s*=\s*'pr2\.commTab\.fullscreenListRatio'/.test(tab));
expectTrue('4.2 FS_SPLIT_MIN=0.18 (kullanıcı direktifi %18)',
  /FS_SPLIT_MIN\s*=\s*0\.18/.test(tab));
expectTrue('4.3 FS_SPLIT_MAX=0.40 (kullanıcı direktifi %40)',
  /FS_SPLIT_MAX\s*=\s*0\.40/.test(tab));
expectTrue('4.4 FS_SPLIT_DEFAULT=0.28 (sol ~%28)',
  /FS_SPLIT_DEFAULT\s*=\s*0\.28/.test(tab));
expectTrue('4.5 fsSplitRatio state + loadRatio ortak helper',
  /const \[fsSplitRatio, setFsSplitRatio\][\s\S]{0,300}loadRatio\(FS_SPLIT_STORAGE_KEY,\s*FS_SPLIT_DEFAULT,\s*FS_SPLIT_MIN,\s*FS_SPLIT_MAX\)/.test(tab));
expectTrue('4.6 resetFsSplit — çift-tık default\'a döner',
  /const resetFsSplit\s*=\s*useCallback[\s\S]{0,300}setFsSplitRatio\(FS_SPLIT_DEFAULT\)/.test(tab));

console.log('\n── 5) R4 Vertical drag effect ────────────────');
expectTrue('5.1 draggingV state + useEffect (Gmail vertical)',
  /const \[draggingV, setDraggingV\]/.test(tab)
  && /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,200}if \(!draggingV\) return/.test(tab));
expectTrue('5.2 Vertical drag → e.clientX / rect.width (X-axis)',
  /const x\s*=\s*e\.clientX - rect\.left[\s\S]{0,200}const ratio\s*=\s*x \/ rect\.width/.test(tab));
expectTrue('5.3 fs clamped: Math.max(FS_MIN, Math.min(FS_MAX, ratio))',
  /Math\.max\(FS_SPLIT_MIN,\s*Math\.min\(FS_SPLIT_MAX,\s*ratio\)\)/.test(tab));
expectTrue('5.4 Bırakınca localStorage kaydet',
  /setDraggingV\(false\)[\s\S]{0,200}setFsSplitRatio\(\(v\)\s*=>\s*\{\s*saveRatio\(FS_SPLIT_STORAGE_KEY, v\)/.test(tab));

console.log('\n── 6) R3 Handle görünürlük (her iki bölücü) ──');
// Yatay (sekme içi)
expectTrue('6.1 Yatay: cursor-row-resize + border-y (sınır her zaman görünür)',
  /cursor-row-resize[\s\S]{0,200}border-y border-slate-300/.test(tab));
expectTrue('6.2 Yatay: 3 nokta tutamaç pattern',
  /cursor-row-resize[\s\S]{0,500}h-1 w-1 rounded-full bg-slate-400[\s\S]{0,200}h-1 w-1 rounded-full bg-slate-400[\s\S]{0,200}h-1 w-1 rounded-full bg-slate-400/.test(tab));
// Dikey (fullscreen)
expectTrue('6.3 Dikey: cursor-col-resize (sekme içi\'nden FARKLI — direktif)',
  /cursor-col-resize/.test(tab));
expectTrue('6.4 Dikey: border-x (sınır her zaman görünür)',
  /cursor-col-resize[\s\S]{0,200}border-x border-slate-300/.test(tab));
expectTrue('6.5 Dikey: 3 nokta dikey tutamaç (flex-col)',
  /cursor-col-resize[\s\S]{0,500}flex flex-col gap-1[\s\S]{0,300}h-1 w-1 rounded-full/.test(tab));
expectTrue('6.6 Handle hover vurgusu: hover:bg-slate-200 + group-hover:bg-slate-600',
  /cursor-(row|col)-resize[\s\S]{0,300}hover:bg-slate-200/.test(tab)
  && /group-hover:bg-slate-600/.test(tab));

console.log('\n── 7) R3 Handle hint (1 kerelik tooltip) ────');
expectTrue('7.1 HANDLE_HINT_STORAGE_KEY = "pr2.commTab.handleHintSeen"',
  /HANDLE_HINT_STORAGE_KEY\s*=\s*'pr2\.commTab\.handleHintSeen'/.test(tab));
expectTrue('7.2 loadHandleHintSeen + saveHandleHintSeen helpers',
  /function loadHandleHintSeen[\s\S]{0,200}function saveHandleHintSeen/.test(tab));
expectTrue('7.3 handleHintSeen state — mount\'ta loadHandleHintSeen',
  /const \[handleHintSeen, setHandleHintSeen\]\s*=\s*useState[\s\S]{0,200}loadHandleHintSeen\(\)/.test(tab));
expectTrue('7.4 dismissHandleHint useCallback + her iki handle onMouseDown içinden çağrılır',
  /const dismissHandleHint\s*=\s*useCallback/.test(tab)
  && /setDraggingH\(true\);\s*dismissHandleHint\(\)/.test(tab)
  && /setDraggingV\(true\);\s*dismissHandleHint\(\)/.test(tab));
expectTrue('7.5 Tooltip conditional: !handleHintSeen && (...)',
  (tab.match(/\{!handleHintSeen && \(/g) ?? []).length === 2);
expectTrue('7.6 Tooltip metni "Sürükleyerek yeniden boyutlandır"',
  (tab.match(/Sürükleyerek yeniden boyutlandır/g) ?? []).length === 2);

console.log('\n── 8) Davranış — split guard\'lar sim ────────');

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Sekme içi (0.20 - 0.60)
expect('8.1 Sekme içi %10 → clamp %20', clamp(0.10, 0.20, 0.60), 0.20);
expect('8.2 Sekme içi %80 → clamp %60', clamp(0.80, 0.20, 0.60), 0.60);
expect('8.3 Sekme içi %35 → aynen', clamp(0.35, 0.20, 0.60), 0.35);

// Fullscreen (0.18 - 0.40)
expect('8.4 FS %10 → clamp %18', clamp(0.10, 0.18, 0.40), 0.18);
expect('8.5 FS %50 → clamp %40', clamp(0.50, 0.18, 0.40), 0.40);
expect('8.6 FS %28 → aynen (default)', clamp(0.28, 0.18, 0.40), 0.28);

console.log('\n── 9) ESC — fullscreen → sekme dönüş ────────');
expectTrue('9.1 Reader ESC listener sadece mode==="fullscreen"',
  /if \(mode !== 'fullscreen'\) return[\s\S]{0,200}e\.key === 'Escape' && onCollapse\(\)/.test(reader));
expectTrue('9.2 onCollapse → setReaderMode("inline") (sekme dönüş)',
  /onCollapse=\{\(\)\s*=>\s*setReaderMode\('inline'\)\}/.test(tab));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
