/**
 * smoke-pr2-communication-tab.js — 2026-07-04
 *
 * PR-2 FAZ 3 — CommunicationTab dikey usta-detay + drag-to-resize.
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

const t = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── 1) Yeni yerleşim — dikey usta-detay ────────');
expectTrue('1.1 MailThreadReader import',
  /import \{ MailThreadReader[\s\S]{0,200}MailThreadReaderMode/.test(t));
expectTrue('1.2 ESKİ MailThread import KALDIRILDI',
  !/import \{ MailThread[\s\S]{0,100}from '\.\/MailThread'/.test(t));
expectTrue('1.3 emails state (list) + selectedId + readerMode',
  /const \[emails, setEmails\][\s\S]{0,300}const \[selectedId, setSelectedId\][\s\S]{0,300}const \[readerMode, setReaderMode\]/.test(t));

console.log('\n── 2) loadEmails + default selection ─────────');
expectTrue('2.1 loadEmails callback — caseEmailService.listEmails',
  /const loadEmails\s*=\s*useCallback[\s\S]{0,300}caseEmailService\.listEmails\(item\.id\)/.test(t));
expectTrue('2.2 R14.2: Auto-select geri — mevcut seçim listede varsa koru, aksi son mesaj (R12 katlı-başlangıçtan vazgeçildi)',
  /setSelectedId\(\(cur\) => \{\s*if \(cur && items\.some[\s\S]{0,150}return items\.length > 0 \? items\[items\.length - 1\]\.id : null;\s*\}\)/.test(t));

console.log('\n── 3) R15: Sekme-içi split makinesi silindi ─');
expectTrue('3.1 R15: SPLIT_STORAGE_KEY (sekme-içi) SİLİNDİ',
  !/const SPLIT_STORAGE_KEY/.test(t));
expectTrue('3.2 R15: SPLIT_DEFAULT SİLİNDİ',
  !/const SPLIT_DEFAULT\s*=/.test(t));
expectTrue('3.3 R15: SPLIT_MIN / SPLIT_MAX SİLİNDİ',
  !/const SPLIT_MIN\s*=/.test(t) && !/const SPLIT_MAX\s*=/.test(t));
expectTrue('3.4 R15: Fs yönü hâlâ FS_SPLIT_STORAGE_KEY korunmuş',
  /const FS_SPLIT_STORAGE_KEY = 'pr2\.commTab\.fullscreenListRatio'/.test(t));
expectTrue('3.5 loadRatio ortak helper (fs için) korunmuş',
  /function loadRatio[\s\S]{0,400}!Number\.isFinite\(v\) \|\| v < min \|\| v > max/.test(t));
expectTrue('3.6 saveRatio ortak helper (fs için) korunmuş',
  /function saveRatio[\s\S]{0,200}try\s*\{[\s\S]{0,200}catch/.test(t));

console.log('\n── 4) R15: Sekme-içi drag SİLİNDİ, fs drag korunmuş ─');
expectTrue('4.1 R15: draggingH state SİLİNDİ',
  !/\[draggingH, setDraggingH\]/.test(t));
expectTrue('4.2 R15: Fs draggingV state korunmuş',
  /\[draggingV, setDraggingV\]\s*=\s*useState\(false\)/.test(t));
expectTrue('4.3 Fs mousemove: fsSplitRatio clamped FS_SPLIT_MIN/MAX',
  /Math\.max\(FS_SPLIT_MIN,\s*Math\.min\(FS_SPLIT_MAX,\s*ratio\)\)/.test(t));
expectTrue('4.4 Sürükleme sırasında user-select: none (fs)',
  /document\.body\.style\.userSelect\s*=\s*'none'/.test(t));
expectTrue('4.5 Cleanup: userSelect geri açılır',
  /document\.body\.style\.userSelect\s*=\s*''/.test(t));

console.log('\n── 5) R15: Sekme-içi handle SİLİNDİ; fs vertical handle korunmuş ─');
expectTrue('5.1 R15: aria-orientation="vertical" (fs) mevcut; horizontal (sekme-içi) YOK',
  /aria-orientation="vertical"/.test(t)
  && !/aria-orientation="horizontal"/.test(t));
expectTrue('5.2 Fs handle aria-valuenow (fsSplitRatio)',
  /aria-valuenow=\{Math\.round\(fsSplitRatio \* 100\)\}/.test(t));
expectTrue('5.3 onDoubleClick → resetFsSplit (fs default)',
  /onDoubleClick=\{resetFsSplit\}/.test(t));
expectTrue('5.4 Fs handle cursor-col-resize (dikey ayırıcı)',
  /cursor-col-resize/.test(t));
expectTrue('5.5 Fs handle w-3 (dikey handle, R3 iyileştirmesi)',
  /className="[^"]*w-3[^"]*cursor-col-resize/.test(t));
expectTrue('5.6 Hover\'da belirginleşir — hover:bg-slate-200 + tutamaç renk değişimi',
  /hover:bg-slate-200[\s\S]{0,600}group-hover:bg-slate-600/.test(t));

console.log('\n── 6) Reader entegrasyonu ────────────────────');
expectTrue('6.1 MailThreadReader mode="inline" (sekme içi) + mode="fullscreen" (Gmail) — iki instance',
  /<MailThreadReader\b/.test(t)
  && /mode="inline"/.test(t) && /mode="fullscreen"/.test(t));
expectTrue('6.2 onExpand → setReaderMode("fullscreen")',
  /onExpand=\{\(\)\s*=>\s*setReaderMode\('fullscreen'\)\}/.test(t));
expectTrue('6.3 onCollapse → setReaderMode("inline")',
  /onCollapse=\{\(\)\s*=>\s*setReaderMode\('inline'\)\}/.test(t));
expectTrue('6.4 onReply/onForward parent composer akışı',
  /onReply=\{\(e\)\s*=>\s*void openReply\(e\)\}[\s\S]{0,200}onForward=\{\(e\)\s*=>\s*void openForward\(e\)\}/.test(t));
expectTrue('6.5 R5: Reader bottomSlot={renderReaderBottom(selectedEmail)} — quickReply prop yerine',
  /bottomSlot=\{renderReaderBottom\(selectedEmail\)\}/.test(t));

console.log('\n── 7) Composer flow — R1: overlay + bulunduğu görünüme dön ─');
expectTrue('7.1 handleSent — readerMode DOKUNULMAZ (kullanıcı direktifi)',
  /const handleSent\s*=\s*useCallback[\s\S]{0,400}setComposerOpen\(false\)/.test(t)
    && !/handleSent[\s\S]{0,600}setReaderMode/.test(t));
expectTrue('7.2 loadEmails çağrılır (thread refresh)',
  /handleSent[\s\S]{0,500}void loadEmails\(\)/.test(t));

// R1+R5+R8: Composer TEK JSX site (composerOpen && wrapper class conditional)
expectTrue('7.3 R8: Composer TEK site — composerOpen && wrapper class (overlay: fixed inset-0)',
  /composerOpen && \(\s*<div\s+className=\{\s*composerLayout === 'overlay'\s*\?\s*'fixed inset-0 z-50/.test(t));
expectTrue('7.4 R1 REGRESYON: eski `composerOpen ? MailComposer : liste` swap KALKMIŞ',
  !/composerOpen \? \(\s*<MailComposer/.test(t));
expectTrue('7.5 R8: MailComposer instance TEK + layoutMode dinamik',
  (t.match(/<MailComposer\b/g) ?? []).length === 1
  && /layoutMode=\{composerLayout\}/.test(t));
expectTrue('7.6 R1: overlay z-50 > fullscreen Gmail z-40 (composer üstte)',
  /z-50/.test(t) && /z-40/.test(t));

console.log('\n── 8) Boş-durum + tek mesaj + regresyonlar ───');
expectTrue('8.1 emails.length === 0 → boş-durum kartı',
  /emails\.length === 0[\s\S]{0,600}Henüz mesaj yok/.test(t));
expectTrue('8.2 Yeni e-posta butonu korundu',
  /Yeni e-posta/.test(t));
expectTrue('8.3 Config missing banner korundu',
  /mailConfigState === 'missing'/.test(t));
expectTrue('8.4 Signature bundle akışı korundu (getEmailSignatureBundle)',
  /getEmailSignatureBundle/.test(t));

console.log('\n── 9) Liste — MailThreadListPane\'a çıkarıldı (R4) ─');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
expectTrue('9.1 MailThreadListPane satır button min-h-[48px]/[52px] (R9 2-satır)',
  /min-h-\[48px\]/.test(listPane) || /min-h-\[52px\]/.test(listPane));
expectTrue('9.2 MailThreadListPane subject normalize + ham tooltip (stripCaseToken=true)',
  /title=\{e\.subject[\s\S]{0,80}\}/.test(listPane) && /normalizeSubject\(e\.subject,\s*\{\s*stripCaseToken:\s*true\s*\}\)/.test(listPane));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
