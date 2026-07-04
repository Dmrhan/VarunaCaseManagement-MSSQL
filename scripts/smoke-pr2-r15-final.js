/**
 * smoke-pr2-r15-final.js — 2026-07-04
 *
 * R15 KAPANIŞ PAKETİ (İletişim sekme-içi son hali).
 *
 * M1 — CaseDetailPage İletişim özel wrapper KALKTI; hepsi 'flex-1 overflow-y-auto p-6'.
 * M2 — Reader mode='inline' body doğal yükseklik (overflow-visible).
 * M3 — Sekme-içi drag/ölçüm makinesi TAMAMEN silindi:
 *      SPLIT_STORAGE_KEY, SPLIT_DEFAULT/MIN/MAX, containerH, listContentH,
 *      containerRef/containerObsRef/setContainerRef, draggingH, resetSplit,
 *      LIST_HEADER_H/LIST_ROW_H, rowsCapPx/ratioCapPx/capPx/atCap/listPx,
 *      isCustomRatio, listSizeMeasured, sekme-içi divider — HEPSİ silindi.
 * M4 — Reader kart ayrışması + yön ikonu inline'da gizli.
 * M5 — Tıklama hedefleri: aksiyon min-h-[36px], hızlı-yanıt min-h-[40px].
 *
 * KALDI: Fs (fullscreen Gmail) sol drag — FS_SPLIT_* + fsSplitRatio +
 * draggingV + fsContainerRef + resetFsSplit + handleHintSeen.
 *
 * Backend R13 M3 (buildReplyContext direction-aware) hâlâ yaşıyor — bu smoke
 * onu da doğrular.
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
const boundary = read('src/features/cases/components/LazyTabBoundary.tsx');
const backend = read('server/lib/caseEmailSender.js');

console.log('── 1) M1 — CaseDetailPage özel wrapper KALKTI ─');
expectTrue('1.1 Tüm sekmeler tek wrapper (İletişim conditional YOK)',
  /<div className="flex-1 overflow-y-auto p-6">/.test(detail));
expectTrue('1.2 REGRESYON: eski "tab === \'communication\' ?" ternary KALKMIŞ',
  !/tab === 'communication'\s*\?\s*'flex/.test(detail));
expectTrue('1.3 LazyTabBoundary className KALKMIŞ (İletişim tüketicisinde)',
  !/<LazyTabBoundary[\s\S]{0,200}className="flex min-h-0/.test(detail));

console.log('\n── 2) M3 — Sekme-içi drag/ölçüm makinesi silindi ─');
expectTrue('2.1 SPLIT_STORAGE_KEY (sekme-içi) SİLİNDİ',
  !/const SPLIT_STORAGE_KEY/.test(tab));
expectTrue('2.2 SPLIT_DEFAULT (sekme-içi) SİLİNDİ',
  !/const SPLIT_DEFAULT\s*=/.test(tab));
expectTrue('2.3 SPLIT_MIN / SPLIT_MAX (sekme-içi) SİLİNDİ',
  !/const SPLIT_MIN\s*=/.test(tab) && !/const SPLIT_MAX\s*=/.test(tab));
expectTrue('2.4 splitRatio state SİLİNDİ',
  !/\[splitRatio, setSplitRatio\]/.test(tab));
expectTrue('2.5 containerH / listContentH state SİLİNDİ',
  !/\[containerH, setContainerH\]/.test(tab)
  && !/\[listContentH, setListContentH\]/.test(tab));
expectTrue('2.6 containerRef / containerObsRef / setContainerRef SİLİNDİ',
  !/const containerRef = useRef/.test(tab)
  && !/containerObsRef/.test(tab)
  && !/setContainerRef/.test(tab));
expectTrue('2.7 draggingH state + horizontal drag effect SİLİNDİ',
  !/\[draggingH, setDraggingH\]/.test(tab)
  && !/Horizontal \(sekme içi\) drag effect/.test(tab));
expectTrue('2.8 resetSplit SİLİNDİ',
  !/const resetSplit = useCallback/.test(tab));
expectTrue('2.9 LIST_HEADER_H / LIST_ROW_H / rowsCapPx / ratioCapPx / capPx / atCap / listPx SİLİNDİ',
  !/LIST_HEADER_H/.test(tab)
  && !/LIST_ROW_H/.test(tab)
  && !/rowsCapPx/.test(tab)
  && !/ratioCapPx/.test(tab)
  && !/const capPx/.test(tab)
  && !/const atCap/.test(tab)
  && !/const listPx/.test(tab));
expectTrue('2.10 isCustomRatio / listSizeMeasured SİLİNDİ',
  !/isCustomRatio/.test(tab) && !/listSizeMeasured/.test(tab));
expectTrue('2.11 Sekme-içi role="separator" (drag handle) render KALKMIŞ',
  !/role="separator"[\s\S]{0,200}aria-orientation="horizontal"/.test(tab));

console.log('\n── 3) M3 KALDI — Fs (fullscreen) drag intact ─');
expectTrue('3.1 FS_SPLIT_STORAGE_KEY korunmuş',
  /const FS_SPLIT_STORAGE_KEY = 'pr2\.commTab\.fullscreenListRatio'/.test(tab));
expectTrue('3.2 fsSplitRatio state korunmuş',
  /\[fsSplitRatio, setFsSplitRatio\]/.test(tab));
expectTrue('3.3 draggingV state + Vertical drag effect korunmuş',
  /\[draggingV, setDraggingV\]/.test(tab)
  && /Vertical \(fullscreen Gmail düzeni\) drag effect/.test(tab));
expectTrue('3.4 fsContainerRef + resetFsSplit korunmuş',
  /const fsContainerRef = useRef/.test(tab)
  && /const resetFsSplit = useCallback/.test(tab));
expectTrue('3.5 handleHintSeen korunmuş (fs drag için)',
  /handleHintSeen/.test(tab));
expectTrue('3.6 Fs role="separator" aria-orientation="vertical" korunmuş',
  /role="separator"[\s\S]{0,200}aria-orientation="vertical"/.test(tab));

console.log('\n── 4) M4 — Sekme-içi düzen: liste+reader kartları ─');
expectTrue('4.1 Sekme-içi wrapper "flex flex-col gap-3" (doğal akış)',
  /<div className="flex flex-col gap-3">/.test(tab));
expectTrue('4.2 Liste kartı h-[174px] + rounded-lg + ring-1 (başlık + 3 tam satır)',
  /h-\[174px\] overflow-hidden rounded-lg ring-1 ring-slate-200/.test(tab));
expectTrue('4.3 Reader kartı ayrı yüzey: rounded-lg bg-white shadow-sm ring-1',
  /rounded-lg bg-white shadow-sm ring-1 ring-slate-200/.test(tab));
expectTrue('4.4 Reader mount reader wrapper içinde (mode="inline")',
  /rounded-lg bg-white shadow-sm ring-1[\s\S]{0,200}<MailThreadReader[\s\S]{0,300}mode="inline"/.test(tab));

console.log('\n── 5) M2 — Reader inline doğal yükseklik + M4 yön ikonu ─');
expectTrue('5.1 Reader root mode-conditional: fs "flex h-full flex-col overflow-hidden" / inline "flex flex-col"',
  /mode === 'fullscreen' \? 'flex h-full flex-col overflow-hidden' : 'flex flex-col'/.test(reader));
expectTrue('5.2 Reader body mode-conditional: fs "flex-1 overflow-auto p-6" / inline "p-4" (doğal)',
  /mode === 'fullscreen' \? 'flex-1 overflow-auto p-6' : 'p-4'/.test(reader));
expectTrue('5.3 M4: Yön ikonu (h-6 w-6 rounded emerald/blue) YALNIZ fs\'de render',
  /mode === 'fullscreen' && \(\s*<span[\s\S]{0,300}h-6 w-6 shrink-0 items-center justify-center rounded-full/.test(reader));

console.log('\n── 6) M5 — Tıklama hedefleri geri ─────────────');
expectTrue('6.1 Reader aksiyon butonları min-h-[36px]',
  (reader.match(/min-h-\[36px\]/g) ?? []).length >= 3);
expectTrue('6.2 Hızlı-yanıt bar min-h-[40px] py-2 (M5 tıklama hedefi geri)',
  /min-h-\[40px\][\s\S]{0,600}Hızlı yanıt yaz/.test(tab));

console.log('\n── 7) ListPane cleanup (R15 sonrası) ────────');
expectTrue('7.1 onContentHeightChange prop KALDIRILDI',
  !/onContentHeightChange/.test(listPane));
expectTrue('7.2 useLayoutEffect + ResizeObserver + rootRef KALDIRILDI',
  !/useLayoutEffect/.test(listPane)
  && !/new ResizeObserver/.test(listPane)
  && !/rootRef/.test(listPane));
expectTrue('7.3 ListPane root h-full sabit (parent yüksekliği alır)',
  /flex h-full flex-col overflow-hidden/.test(listPane));
expectTrue('7.4 data-mail-list-header + data-mail-list-body attribute korunmuş (kabul scripti için)',
  /data-mail-list-header/.test(listPane) && /data-mail-list-body/.test(listPane));

console.log('\n── 8) Backend R13 M3 buildReplyContext hâlâ yaşıyor ─');
expectTrue('8.1 REPLY_FIELDS "direction: true" içerir',
  /REPLY_FIELDS = \{[\s\S]{0,200}direction:\s*true/.test(backend));
expectTrue('8.2 emailId filtresiz ref al (outbound da geçerli)',
  /if \(emailId\) \{\s*refRow = await prisma\.caseEmail\.findFirst\(\{\s*where:\s*\{ id:\s*emailId,\s*caseId \}/.test(backend));
expectTrue('8.3 Fallback: son inbound → son outbound',
  /if \(!refRow\)[\s\S]{0,300}direction:\s*'inbound'[\s\S]{0,800}if \(!refRow\)[\s\S]{0,300}direction:\s*'outbound'/.test(backend));
expectTrue('8.4 refRow.direction === "inbound" → K6 reply-all',
  /if \(refRow\.direction === 'inbound'\) \{[\s\S]{0,400}uniq\(\[senderEntry, \.\.\.refTo\]\)/.test(backend));
expectTrue('8.5 Outbound ref: to = refTo (self yok)',
  /\} else \{[\s\S]{0,400}to = filterAlias\(uniq\(refTo\)\);\s*cc = filterAlias\(uniq\(refCc\)\)/.test(backend));

console.log('\n── 9) LazyTabBoundary — className opsiyonel korunmuş ─');
expectTrue('9.1 Props.className?: string opsiyonel (geriye uyum)',
  /className\?:\s*string/.test(boundary));
expectTrue('9.2 <div key={resetKey} className={this.props.className}>',
  /<div key=\{this\.state\.resetKey\} className=\{this\.props\.className\}>/.test(boundary));

console.log('\n── 10) auto-select davranış simülasyonu ─────');

function autoSelect({ cur, items }) {
  if (cur && items.some((e) => e.id === cur)) return cur;
  return items.length > 0 ? items[items.length - 1].id : null;
}
expect('10.1 İlk açılış (cur=null, 3 mesaj) → son mesaj',
  autoSelect({ cur: null, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), 'c');
expect('10.2 Refresh persistence (cur=b listede)',
  autoSelect({ cur: 'b', items: [{ id: 'a' }, { id: 'b' }] }), 'b');
expect('10.3 Silinen seçim → yeni son',
  autoSelect({ cur: 'x', items: [{ id: 'a' }, { id: 'b' }] }), 'b');
expect('10.4 Boş liste → null',
  autoSelect({ cur: null, items: [] }), null);

console.log('\n── 11) Regresyon — R11/R10.x/R9.1/R8 KORUNDU ─');
expectTrue('11.1 R11: MAIL_TYPE token import (reader + listPane + tab)',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(tab)
  && /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(reader)
  && /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(listPane));
expectTrue('11.2 R11.1: text-[10px] literal yok',
  !/text-\[10px\]/.test(tab) && !/text-\[10px\]/.test(reader));
expectTrue('11.3 R10.3: bar müşteri onShowCustomer',
  /onShowCustomer && item\.accountId/.test(tab));
expectTrue('11.4 R10.1: compactDock composer',
  /compactDock=\{composerLayout === 'inline' && readerMode === 'fullscreen'\}/.test(tab));
expectTrue('11.5 R9.1: currentUserId prop 4 wiring',
  (tab.match(/currentUserId=\{currentUserId\}/g) ?? []).length === 4);
expectTrue('11.6 R8: MailComposer instance = 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('11.7 R12: kompakt "+ Yeni e-posta" onNewEmail 2 mount',
  (tab.match(/onNewEmail=\{openNew\}/g) ?? []).length === 2);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
