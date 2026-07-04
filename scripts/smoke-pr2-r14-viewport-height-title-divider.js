/**
 * smoke-pr2-r14-viewport-height-title-divider.js — 2026-07-04
 *
 * R14 3 madde:
 *  M1 — İletişim sekmesi viewport-sabit (flex-1 min-h-0 zinciri; magic
 *       calc(100vh-320px) kaldırıldı). Diğer sekmelerin scroll'una dokunulmadı.
 *  M2 — Reader konu mode-aware: inline (T4Inline 15px) / fullscreen (T4 17px).
 *       Header padding inline py-2 / fs py-3 (dikey yer kazanımı).
 *  M3 — Divider yalnız listSizeMeasured && atCap (R13.2 mikro-fix): tek
 *       mesajlı vakada gizli; ölçüm-yok fallback'te de gizli.
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

const detail = read('src/features/cases/CaseDetailPage.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const token = read('src/features/cases/lib/mailTypography.ts');

console.log('── 1) M1 — Viewport-sabit yükseklik zinciri ─');
expectTrue('1.1 CaseDetailPage sekme wrapper conditional: İletişim flex-1 min-h-0 flex-col p-4; diğer sekmeler flex-1 overflow-y-auto p-6',
  /tab === 'communication'\s*\?\s*'flex min-h-0 flex-1 flex-col p-4'\s*:\s*'flex-1 overflow-y-auto p-6'/.test(detail));
expectTrue('1.2 CommunicationTab root flex-col min-h-0 flex-1 (parent zincirini alır)',
  /<div className="flex min-h-0 flex-1 flex-col gap-3">/.test(tab));
expectTrue('1.3 Kanal chips shrink-0 (viewport disiplini)',
  /flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 pb-2/.test(tab));
expectTrue('1.4 Split kabı flex-1 min-h-0 (dolgu → containerH doğal ölçüm)',
  /ref=\{setContainerRef\}\s*\n\s*className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-ndark-border"/.test(tab));
expectTrue('1.5 REGRESYON: eski calc(100vh-320px) magic KALKMIŞ',
  !/calc\(100vh - 320px\)/.test(tab));
expectTrue('1.6 REGRESYON: eski min-h-[560px] + inline height KALKMIŞ',
  !/min-h-\[560px\]/.test(tab));
expectTrue('1.7 Diğer sekmeler (Detay/Aktivite/Notlar) davranışı korundu (overflow-y-auto p-6)',
  /flex-1 overflow-y-auto p-6/.test(detail));

console.log('\n── 2) M2 — Reader konu mode-aware + kompakt header ─');
expectTrue('2.1 Token: MAIL_TYPE.t4Inline = "text-[15px]" (bilinçli istisna + açık yorum)',
  /t4Inline:\s*'text-\[15px\]'/.test(token));
expectTrue('2.2 Token yorumu R14 M2 direktifi açıklıyor (gizli sabit olmasın)',
  /R14 M2[\s\S]{0,300}Merdiven ara kademesi/.test(token));
expectTrue('2.3 Reader konu mode ternary: fs → t4, inline → t4Inline',
  /\$\{mode === 'fullscreen' \? MAIL_TYPE\.t4 : MAIL_TYPE\.t4Inline\}/.test(reader));
expectTrue('2.4 REGRESYON: eski sabit MAIL_TYPE.t4 KALKMIŞ (mode fark etmeden)',
  !/truncate \$\{MAIL_TYPE\.t4\} font-medium text-slate-900/.test(reader));
expectTrue('2.5 Reader header padding mode-aware: fs py-3 / inline py-2',
  /shrink-0 border-b border-slate-200 px-4 \$\{mode === 'fullscreen' \? 'py-3' : 'py-2'\}/.test(reader));

console.log('\n── 3) M3 — Divider mikro-fix (R13.2) ────────');
expectTrue('3.1 Divider koşulu: selectedEmail && listSizeMeasured && atCap',
  /\{selectedEmail && listSizeMeasured && atCap && \(/.test(tab));
expectTrue('3.2 REGRESYON: eski "selectedEmail && atCap" KALKMIŞ (ölçüm-yok fallback\'te de göstermiyordu)',
  !/\{selectedEmail && atCap && \(\s*<>[\s\S]{0,200}role="separator"/.test(tab));

console.log('\n── 4) Davranış simülasyonu ──────────────────');

function dividerVisible({ selectedEmail, containerH, listContentH, splitRatio }) {
  const listSizeMeasured = containerH > 0 && listContentH > 0;
  const capPx = containerH * splitRatio;
  const atCap = !listSizeMeasured || listContentH >= capPx - 1;
  return !!(selectedEmail && listSizeMeasured && atCap);
}

// 4.1 Tek mesajlı vaka (UNV-1000111 senaryosu)
expect('4.1 1 mesaj (80px < cap 245) → divider GİZLİ',
  dividerVisible({ selectedEmail: true, containerH: 700, listContentH: 80, splitRatio: 0.35 }),
  false);

// 4.2 8 mesajlı vaka (UNV-1000058) — cap
expect('4.2 8 mesaj (450px > cap 245) → divider görünür',
  dividerVisible({ selectedEmail: true, containerH: 700, listContentH: 450, splitRatio: 0.35 }),
  true);

// 4.3 Ölçüm henüz gelmedi → GİZLİ (fallback %35 dalı)
expect('4.3 Ölçüm yok → divider GİZLİ (fallback %35 dalında)',
  dividerVisible({ selectedEmail: true, containerH: 0, listContentH: 0, splitRatio: 0.35 }),
  false);

// 4.4 selectedEmail=null → divider GİZLİ (katlı mod)
expect('4.4 Seçim yok → divider GİZLİ',
  dividerVisible({ selectedEmail: false, containerH: 700, listContentH: 450, splitRatio: 0.35 }),
  false);

// 4.5 Sınır: cap±1 → görünür
expect('4.5 Tam sınır (245 vs cap 245) → görünür',
  dividerVisible({ selectedEmail: true, containerH: 700, listContentH: 244.5, splitRatio: 0.35 }),
  true);

// 4.6 Yalnız container ölçüldü, listContent değil → fallback → GİZLİ
expect('4.6 Yalnız containerH → listSizeMeasured false → GİZLİ',
  dividerVisible({ selectedEmail: true, containerH: 700, listContentH: 0, splitRatio: 0.35 }),
  false);

// 4.7 Yalnız listContent ölçüldü, container değil → fallback → GİZLİ
expect('4.7 Yalnız listContentH → listSizeMeasured false → GİZLİ',
  dividerVisible({ selectedEmail: true, containerH: 0, listContentH: 400, splitRatio: 0.35 }),
  false);

console.log('\n── 5) Regresyon — R13/R13.1/R12/R11/R10.x KORUNDU ─');
expectTrue('5.1 R13.1: setContainerRef callback ref hâlâ',
  /const setContainerRef = useCallback/.test(tab));
expectTrue('5.2 R13.1: guard listSizeMeasured hâlâ',
  /const listSizeMeasured = containerH > 0 && listContentH > 0/.test(tab));
expectTrue('5.3 R13 M1: liste style listSizeMeasured ? listPx : splitRatio%',
  /listSizeMeasured\s*\?\s*\{ height: `\$\{listPx\}px`, flexShrink: 0 \}\s*:\s*\{ height: `\$\{splitRatio \* 100\}%`, flexShrink: 0 \}/.test(tab));
expectTrue('5.4 R12: katlı başlangıç selectedId=null',
  /setSelectedId\(\(cur\) => \(cur && items\.some\(\(e\) => e\.id === cur\)\) \? cur : null\)/.test(tab));
expectTrue('5.5 R11: MAIL_TYPE tokenlarla çalışır (reader)',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(reader));
expectTrue('5.6 R11.1: text-[10px] kaçak yok',
  !/text-\[10px\]/.test(tab) && !/text-\[10px\]/.test(reader));
expectTrue('5.7 R8: MailComposer instance=1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('5.8 R10.3: bar müşteri onShowCustomer',
  /onShowCustomer && item\.accountId/.test(tab));
expectTrue('5.9 R13 M3: buildReplyContext direction-aware korundu (backend değişmedi — kontrol)',
  /if \(!refRow\)[\s\S]{0,600}direction:\s*'outbound'[\s\S]{0,300}orderBy:\s*\[\{ sentAt:\s*'desc'/.test(read('server/lib/caseEmailSender.js')));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
