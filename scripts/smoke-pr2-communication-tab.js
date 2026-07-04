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
expectTrue('2.2 Default seçim: en son mesaj (array son elemanı)',
  /setSelectedId\(\(cur\)\s*=>[\s\S]{0,300}items\[items\.length - 1\]\.id/.test(t));

console.log('\n── 3) Split ratio — guard\'lar ────────────────');
expectTrue('3.1 SPLIT_STORAGE_KEY (localStorage kullanıcı bazlı)',
  /const SPLIT_STORAGE_KEY\s*=\s*'pr2\.commTab\.splitRatio'/.test(t));
expectTrue('3.2 SPLIT_DEFAULT=0.35',
  /const SPLIT_DEFAULT\s*=\s*0\.35/.test(t));
expectTrue('3.3 SPLIT_MIN=0.20 (liste min ~%20)',
  /const SPLIT_MIN\s*=\s*0\.20/.test(t));
expectTrue('3.4 SPLIT_MAX=0.60 (liste max ~%60)',
  /const SPLIT_MAX\s*=\s*0\.60/.test(t));
expectTrue('3.5 loadSplitRatio — bozuk/aralık-dışı → default',
  /!Number\.isFinite\(v\) \|\| v < SPLIT_MIN \|\| v > SPLIT_MAX/.test(t));
expectTrue('3.6 saveSplitRatio — try/catch (private mode guard)',
  /function saveSplitRatio[\s\S]{0,200}try\s*\{[\s\S]{0,200}catch/.test(t));

console.log('\n── 4) Drag mekanizması ──────────────────────');
expectTrue('4.1 dragging state',
  /const \[dragging, setDragging\]\s*=\s*useState\(false\)/.test(t));
expectTrue('4.2 mousemove listener — clamped ratio (SPLIT_MIN/MAX)',
  /Math\.max\(SPLIT_MIN,\s*Math\.min\(SPLIT_MAX,\s*ratio\)\)/.test(t));
expectTrue('4.3 mouseup → dragging=false + persist',
  /const onUp\s*=[\s\S]{0,300}setDragging\(false\)[\s\S]{0,300}saveSplitRatio\(v\)/.test(t));
expectTrue('4.4 Sürükleme sırasında user-select: none',
  /document\.body\.style\.userSelect\s*=\s*'none'/.test(t));
expectTrue('4.5 Cleanup: userSelect geri açılır',
  /document\.body\.style\.userSelect\s*=\s*''/.test(t));

console.log('\n── 5) Handle — görünür + çift-tık → default ──');
expectTrue('5.1 role="separator" + aria-orientation="horizontal"',
  /role="separator"[\s\S]{0,200}aria-orientation="horizontal"/.test(t));
expectTrue('5.2 aria-valuenow (accessibility)',
  /aria-valuenow=\{Math\.round\(splitRatio \* 100\)\}/.test(t));
expectTrue('5.3 onDoubleClick → resetSplit (default)',
  /onDoubleClick=\{resetSplit\}/.test(t));
expectTrue('5.4 cursor-row-resize',
  /cursor-row-resize/.test(t));
expectTrue('5.5 Handle görünür — h-2 (≥8px tutma alanı)',
  /className="[^"]*h-2[^"]*cursor-row-resize/.test(t));
expectTrue('5.6 Hover\'da belirginleşir — hover:bg + group-hover:w-12',
  /hover:bg-slate-200[\s\S]{0,300}group-hover:w-12/.test(t));

console.log('\n── 6) Reader entegrasyonu ────────────────────');
expectTrue('6.1 MailThreadReader mode={readerMode}',
  /mode=\{readerMode\}/.test(t));
expectTrue('6.2 onExpand → setReaderMode("fullscreen")',
  /onExpand=\{\(\)\s*=>\s*setReaderMode\('fullscreen'\)\}/.test(t));
expectTrue('6.3 onCollapse → setReaderMode("inline")',
  /onCollapse=\{\(\)\s*=>\s*setReaderMode\('inline'\)\}/.test(t));
expectTrue('6.4 onReply/onForward parent composer akışı',
  /onReply=\{\(e\)\s*=>\s*void openReply\(e\)\}[\s\S]{0,200}onForward=\{\(e\)\s*=>\s*void openForward\(e\)\}/.test(t));
expectTrue('6.5 onQuickReply → openReply (Yanıtla ile aynı)',
  /onQuickReply=\{\(e\)\s*=>\s*void openReply\(e\)\}/.test(t));

console.log('\n── 7) Composer flow — bulunduğu görünüme dön ─');
expectTrue('7.1 handleSent — readerMode DOKUNULMAZ (kullanıcı direktifi)',
  /const handleSent\s*=\s*useCallback[\s\S]{0,400}setComposerOpen\(false\)/.test(t)
    && !/handleSent[\s\S]{0,600}setReaderMode/.test(t));
expectTrue('7.2 loadEmails çağrılır (thread refresh)',
  /handleSent[\s\S]{0,500}void loadEmails\(\)/.test(t));

console.log('\n── 8) Boş-durum + tek mesaj + regresyonlar ───');
expectTrue('8.1 emails.length === 0 → boş-durum kartı',
  /emails\.length === 0[\s\S]{0,600}Henüz mesaj yok/.test(t));
expectTrue('8.2 Yeni e-posta butonu korundu',
  /Yeni e-posta/.test(t));
expectTrue('8.3 Config missing banner korundu',
  /mailConfigState === 'missing'/.test(t));
expectTrue('8.4 Signature bundle akışı korundu (getEmailSignatureBundle)',
  /getEmailSignatureBundle/.test(t));

console.log('\n── 9) Liste satırı ≥40px hit target + normalize ─');
expectTrue('9.1 Liste button min-h-[40px]',
  /min-h-\[40px\]/.test(t));
expectTrue('9.2 Liste subject normalize + ham tooltip (title=e.subject)',
  /title=\{e\.subject\}/.test(t) && /normalizeSubject\(e\.subject\)/.test(t));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
