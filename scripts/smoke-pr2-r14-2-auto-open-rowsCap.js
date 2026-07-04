/**
 * smoke-pr2-r14-2-auto-open-rowsCap.js — 2026-07-04
 *
 * R14.2 bitirme paketi:
 *   M1 — Otomatik açılış GERİ (R9 davranışı geri; R12 katlı-başlangıçtan
 *        vazgeçildi). Refresh persistence + empty CTA + kompakt buton kalır.
 *   M2 — Liste cap = başlık + 3 tam satır (satırdan türet); Math.max(rowsCap,
 *        ratioCap) — localStorage tercihi cap üstündeyse tercihe saygı.
 *   M3 — atCap = listSizeMeasured && content ≥ cap-1; ölçüm-yok fallback'te
 *        divider gizli (koşullu render savunma).
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

console.log('── 1) M1 — Otomatik açılış geri (R9) ─────────');
expectTrue('1.1 loadEmails: mevcut seçim listede kaldıysa koru, aksi son mesaj',
  /setSelectedId\(\(cur\) => \{\s*if \(cur && items\.some\(\(e\) => e\.id === cur\)\) return cur;\s*return items\.length > 0 \? items\[items\.length - 1\]\.id : null;\s*\}\)/.test(tab));
expectTrue('1.2 REGRESYON: R12 katlı-başlangıç (":\\s*null") tek-satır KALKMIŞ',
  !/\? cur : null\);\s*\n\s*\}, \[item\.id\]\)/.test(tab));

console.log('\n── 2) M2 — Liste cap: başlık + 3 satır (satırdan türet) ─');
expectTrue('2.1 LIST_HEADER_H sabit (30px)',
  /const LIST_HEADER_H = 30/.test(tab));
expectTrue('2.2 LIST_ROW_H sabit (48px default satır)',
  /const LIST_ROW_H = 48/.test(tab));
expectTrue('2.3 rowsCapPx = HEADER + 3 * ROW (satırdan türetim)',
  /const rowsCapPx = LIST_HEADER_H \+ LIST_ROW_H \* 3/.test(tab));
expectTrue('2.4 ratioCapPx = containerH * splitRatio (drag tercihi)',
  /const ratioCapPx = containerH \* splitRatio/.test(tab));
expectTrue('2.5 capPx = isCustomRatio ? Math.max(rowsCapPx, ratioCapPx) : rowsCapPx — default rowsCap; user drag → tercihe saygı',
  /const isCustomRatio = Math\.abs\(splitRatio - SPLIT_DEFAULT\) > 1e-6[\s\S]{0,200}const capPx = isCustomRatio \? Math\.max\(rowsCapPx, ratioCapPx\) : rowsCapPx/.test(tab));
expectTrue('2.6 REGRESYON: eski "capPx = containerH * splitRatio" tek satır KALKMIŞ',
  !/const capPx = containerH \* splitRatio;/.test(tab));

console.log('\n── 3) M3 — atCap eşiği + divider koşulu ──────');
expectTrue('3.1 atCap = listSizeMeasured && listContentH >= capPx - 1 (fallback dalı false)',
  /const atCap = listSizeMeasured && listContentH >= capPx - 1/.test(tab));
expectTrue('3.2 REGRESYON: eski "!listSizeMeasured || ..." (fallback\'te true) KALKMIŞ',
  !/const atCap = !listSizeMeasured \|\| listContentH >= capPx - 1/.test(tab));
expectTrue('3.3 Divider koşulu listSizeMeasured && atCap (selectedEmail guard\'ı kalktı)',
  /\{listSizeMeasured && atCap && \(\s*<>/.test(tab));

console.log('\n── 4) Ölü dal temizliği (R12 katlı modu kalktı) ─');
expectTrue('4.1 Liste div style: listSizeMeasured ? listPx : splitRatio% (selectedEmail? kalktı)',
  /style=\{listSizeMeasured\s*\?\s*\{ height: `\$\{listPx\}px`, flexShrink: 0 \}\s*:\s*\{ height: `\$\{splitRatio \* 100\}%`, flexShrink: 0 \}\}/.test(tab));
expectTrue('4.2 REGRESYON: eski "selectedEmail ? (...) : {flex 1 1 0%}" ternary KALKMIŞ (liste style)',
  !/\{ flex: '1 1 0%' \}\}/.test(tab));

console.log('\n── 5) Davranış simülasyonu ──────────────────');

const SPLIT_DEFAULT_SIM = 0.35;
function computeLayout({ containerH, listContentH, splitRatio }) {
  const listSizeMeasured = containerH > 0 && listContentH > 0;
  const LIST_HEADER_H = 30;
  const LIST_ROW_H = 48;
  const rowsCapPx = LIST_HEADER_H + LIST_ROW_H * 3;
  const ratioCapPx = containerH * splitRatio;
  const isCustomRatio = Math.abs(splitRatio - SPLIT_DEFAULT_SIM) > 1e-6;
  const capPx = isCustomRatio ? Math.max(rowsCapPx, ratioCapPx) : rowsCapPx;
  const atCap = listSizeMeasured && listContentH >= capPx - 1;
  const listPx = atCap ? capPx : listContentH;
  return { rowsCapPx, ratioCapPx, capPx, atCap, listPx, listSizeMeasured, isCustomRatio };
}

// 5.1 R14.2: DEFAULT ratio (0.35 = SPLIT_DEFAULT) → isCustomRatio=false → rowsCap 174
const r1 = computeLayout({ containerH: 700, listContentH: 400, splitRatio: 0.35 });
expect('5.1 Default ratio (0.35) → cap = rowsCap 174 (drag olmadıkça satır cap egemen)',
  r1.capPx, 174);
expect('5.1b atCap true (400 > 173)', r1.atCap, true);

// 5.2 KÜÇÜK container + default ratio → rowsCap 174 (ratio görmezden)
const r2 = computeLayout({ containerH: 400, listContentH: 500, splitRatio: 0.35 });
expect('5.2 400px + 0.35 default → rowsCap 174', r2.capPx, 174);

// 5.3 Kullanıcı drag %60'a çıkardı → ratio cap kazanır
const r3 = computeLayout({ containerH: 700, listContentH: 800, splitRatio: 0.6 });
expect('5.3 700px + 0.6 → ratio 420 > rowsCap 174 → tercihe saygı 420',
  r3.capPx, 420);

// 5.4 Tek mesajlı (UNV-1000111): content ~80 << rowsCap 174 → atCap false → divider gizli
const r4 = computeLayout({ containerH: 700, listContentH: 80, splitRatio: 0.35 });
expect('5.4 Tek mesaj (80px) → listPx=80 (içerik)', r4.listPx, 80);
expect('5.4b atCap false → divider GİZLİ', r4.atCap, false);

// 5.5 Ölçüm yok → atCap false → divider gizli (fallback dalı, style %35)
const r5 = computeLayout({ containerH: 0, listContentH: 0, splitRatio: 0.35 });
expect('5.5 Ölçüm yok → atCap false (fallback dalı)', r5.atCap, false);
expect('5.5b listSizeMeasured false → style fallback %35', r5.listSizeMeasured, false);

// 5.6 8 mesajlı (UNV-1000058): default ratio → cap = rowsCap 174; 414 > 174 → cap
const r6 = computeLayout({ containerH: 700, listContentH: 414, splitRatio: 0.35 });
expect('5.6 8 mesaj (414px) + default ratio → listPx = rowsCap 174', r6.listPx, 174);
expect('5.6b atCap true → divider görünür', r6.atCap, true);

// 5.7 Sınır: rowsCap 174 kazandığı senaryoda atCap eşiği cap-1 = 173
// content=173 → 173 >= 173 → atCap TRUE (eşik dahil, drag akışı hazır).
const r7 = computeLayout({ containerH: 300, listContentH: 173, splitRatio: 0.35 });
expect('5.7 rowsCap 174 sınır (173 içerik) → atCap true (173 >= 173)',
  r7.atCap, true);
const r7b = computeLayout({ containerH: 300, listContentH: 170, splitRatio: 0.35 });
expect('5.7b Cap-1 altı (170 < 173) → atCap false → divider gizli',
  r7b.atCap, false);

console.log('\n── 6) auto-select davranış simülasyonu ──────');

function autoSelect({ cur, items }) {
  if (cur && items.some((e) => e.id === cur)) return cur;
  return items.length > 0 ? items[items.length - 1].id : null;
}

expect('6.1 İlk açılış (cur=null, 3 mesaj) → son mesaj auto-select',
  autoSelect({ cur: null, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
  'c');
expect('6.2 Tek mesaj + cur=null → o mesaj seçili (istisna yok)',
  autoSelect({ cur: null, items: [{ id: 'only' }] }),
  'only');
expect('6.3 Refresh persistence: cur=b listede → b',
  autoSelect({ cur: 'b', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
  'b');
expect('6.4 Silinen seçim → yeni son',
  autoSelect({ cur: 'x', items: [{ id: 'a' }, { id: 'b' }] }),
  'b');
expect('6.5 Boş liste → null (empty state)',
  autoSelect({ cur: null, items: [] }),
  null);

console.log('\n── 7) Regresyon — R14/R13/R12/R11 KORUNDU ───');
expectTrue('7.1 R14.2: sekme yükseklik zinciri (İletişim wrapper flex-1 min-h-0 flex-col p-2)',
  /tab === 'communication'\s*\?\s*'flex min-h-0 flex-1 flex-col p-2'/.test(read('src/features/cases/CaseDetailPage.tsx')));
expectTrue('7.2 R14 M2: Reader konu mode-aware',
  /truncate \$\{mode === 'fullscreen' \? MAIL_TYPE\.t4 : MAIL_TYPE\.t4Inline\}/.test(read('src/features/cases/components/MailThreadReader.tsx')));
expectTrue('7.3 R14.1: LazyTabBoundary className zincir class\'ı',
  /<LazyTabBoundary[\s\S]{0,200}className="flex min-h-0 flex-1 flex-col"/.test(read('src/features/cases/CaseDetailPage.tsx')));
expectTrue('7.4 R13.1: setContainerRef callback ref',
  /const setContainerRef = useCallback/.test(tab));
expectTrue('7.5 R12: kompakt "+ Yeni e-posta" başlıkta (kalıcı iyileştirme)',
  (tab.match(/onNewEmail=\{openNew\}/g) ?? []).length === 2);
expectTrue('7.6 R11.1: text-[10px] literal kaçak yok',
  !/text-\[10px\]/.test(tab));
expectTrue('7.7 R8: MailComposer instance=1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
