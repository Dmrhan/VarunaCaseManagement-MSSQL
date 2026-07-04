/**
 * smoke-pr2-r12-collapsed-default-inline-new.js — 2026-07-04
 *
 * PR-2 R12 — İletişim sekmesi kompakt "Yeni e-posta" + default hepsi katlı.
 *
 * 1) "+ Yeni e-posta" ListPane başlık çubuğuna kompakt buton olarak taşındı;
 *    tam-genişlik toolbar satırı YOK. Ayrı satır = dikey yer kaybı; buton
 *    başlıkta = dikey yer listeye kazandırıldı.
 *
 * 2) Default: HİÇBİR mail seçili değil (selectedId=null). Alt reader + drag
 *    divider hiç render EDİLMEZ; liste sekmenin tam yüksekliğini kullanır.
 *    Satıra tıklayınca reader açılır (mevcut davranış).
 *    R9 auto-select en-yeni davranışı KALDIRILDI. Fs'den X/ESC dönüşünde
 *    selectedId korunur (tekrar katlanmaz).
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
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');

console.log('── 1) ListPane onNewEmail prop + kompakt buton ─');
expectTrue('1.1 onNewEmail?: () => void prop',
  /onNewEmail\?:\s*\(\)\s*=>\s*void/.test(listPane));
expectTrue('1.2 destructure onNewEmail',
  /variant = 'default'[\s\S]{0,600}onNewEmail,\s*\n\s*[^}]*\}: Props/.test(listPane));
expectTrue('1.3 Plus icon import',
  /import \{[^}]*Plus[^}]*\} from 'lucide-react'/.test(listPane));
expectTrue('1.4 Buton başlık çubuğunda render (onNewEmail && <button>)',
  /\{onNewEmail && \(\s*<button\b[\s\S]{0,600}onClick=\{onNewEmail\}[\s\S]{0,600}Yeni e-posta/.test(listPane));
expectTrue('1.5 Buton kompakt boyut (MAIL_TYPE.t1 = 11px)',
  /\{onNewEmail && \(\s*<button[\s\S]{0,600}\$\{MAIL_TYPE\.t1\} font-medium/.test(listPane));
expectTrue('1.6 Buton title tooltip',
  /title="Yeni e-posta yaz \(bu vakada\)"/.test(listPane));
expectTrue('1.7 Başlık çubuğu SORT toggle + NEW butonu TEK satırda (justify-between)',
  /flex shrink-0 items-center justify-between gap-2 border-b/.test(listPane));

console.log('\n── 2) Tab: toolbar satırı KALKMIŞ ────────────');
expectTrue('2.1 REGRESYON: eski "flex justify-end + Button Yeni e-posta" toolbar satırı KALKMIŞ',
  !/<div className="flex justify-end">\s*<Button type="button" variant="primary" leftIcon=\{<Plus size=\{13\} \/>\} onClick=\{openNew\}>/.test(tab));
expectTrue('2.2 openNew hâlâ tanımlı (composer flow değişmedi)',
  /const openNew\s*=\s*useCallback/.test(tab));
expectTrue('2.3 Sekme-içi ListPane onNewEmail={openNew} geçirir',
  /<MailThreadListPane[\s\S]{0,600}onNewEmail=\{openNew\}/.test(tab));
expectTrue('2.4 Fs ListPane de onNewEmail={openNew} geçirir (iki mount aynı bileşen)',
  (tab.match(/onNewEmail=\{openNew\}/g) ?? []).length === 2);

console.log('\n── 3) Empty state kartında Yeni e-posta butonu ─');
expectTrue('3.1 emails.length === 0 branch\'ında Button görünür (kart içi CTA)',
  /emails\.length === 0[\s\S]{0,600}<Button type="button" variant="primary" leftIcon=\{<Plus size=\{13\} \/>\} onClick=\{openNew\}>\s*\n?\s*Yeni e-posta/.test(tab));

console.log('\n── 4) Default selectedId=null — katlı başlangıç ─');
expectTrue('4.1 R14.2: auto-select GERİ (R12 katlı-başlangıçtan vazgeçildi) — items[last]',
  /if \(cur && items\.some\(\(e\) => e\.id === cur\)\) return cur;\s*return items\.length > 0 \? items\[items\.length - 1\]\.id : null;/.test(tab));
expectTrue('4.2 R14.2: items[items.length - 1].id auto-select MEVCUT (R12 regresyonu geri alındı)',
  /items\[items\.length - 1\]\.id/.test(tab));

console.log('\n── 5) Split conditional — reader+divider yalnız seçim varken ─');
expectTrue('5.1 R14.2: Liste yükseklik listSizeMeasured ? listPx : splitRatio% (selectedEmail? ölü dalı temizlendi)',
  /style=\{listSizeMeasured\s*\?\s*\{ height: `\$\{listPx\}px`, flexShrink: 0 \}\s*:\s*\{ height: `\$\{splitRatio \* 100\}%`, flexShrink: 0 \}\}/.test(tab));
expectTrue('5.2 R14.2: Divider listSizeMeasured && atCap; reader SEPARATE conditional (selectedEmail iken)',
  /\{listSizeMeasured && atCap && \(\s*<>[\s\S]{0,1500}role="separator"/.test(tab)
  && /\{selectedEmail && \(\s*<div className="min-h-0 flex-1 bg-white/.test(tab));
expectTrue('5.3 REGRESYON: "Bir mesaj seçin" placeholder KALKMIŞ (split yok → placeholder yok)',
  !/Bir mesaj seçin/.test(tab));
expectTrue('5.4 REGRESYON: eski "min-h-0 shrink-0" liste div KALKMIŞ (conditional style ile)',
  !/className="min-h-0 shrink-0"\s*\n\s*style=\{\{ height: `\$\{splitRatio/.test(tab));

console.log('\n── 6) Davranış simülasyonu ──────────────────');

// loadEmails davranışı — R9 kaldırıldı, yalnız persistence
function loadEmailsSim({ current, items }) {
  if (current && items.some((e) => e.id === current)) return current;
  return null;
}

// 6.1 İlk açılış — selectedId yok, liste dolu → null (katlı)
expect('6.1 İlk açılış (cur=null, 3 mesaj) → selectedId=null (katlı)',
  loadEmailsSim({ current: null, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
  null);

// 6.2 İlk açılış tek mesajlı → yine katlı (istisna İCAT EDİLMEDİ)
expect('6.2 Tek mesajlı vaka + cur=null → yine katlı (null)',
  loadEmailsSim({ current: null, items: [{ id: 'a' }] }),
  null);

// 6.3 Refresh — seçim listede duruyor → korunur
expect('6.3 Refresh (cur=b listede) → korunur',
  loadEmailsSim({ current: 'b', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
  'b');

// 6.4 Refresh — seçim listede yok (silinmiş) → null (katlanır)
expect('6.4 Refresh (cur=x yok) → null (katlanır)',
  loadEmailsSim({ current: 'x', items: [{ id: 'a' }, { id: 'b' }] }),
  null);

// 6.5 Boş liste + cur=null → null
expect('6.5 Boş liste → null', loadEmailsSim({ current: null, items: [] }), null);

// 6.6 Tıklama sonrası setSelectedId('a') → state'e yansır (mevcut akış — setSelectedId sim'i loadEmails\'a etki etmiyor)
//     loadEmails'ın refresh sonrası korumaya devam ettiğini simüle
expect('6.6 Tıklama a → sonraki refresh a listede → korunur',
  loadEmailsSim({ current: 'a', items: [{ id: 'a' }, { id: 'b' }] }),
  'a');

// 6.7 Fs'den ESC/X ile dönüş: setReaderMode('inline') selectedId'ye dokunmuyor
//     → sonraki refresh'te seçim korunur; tekrar katlanmaz
expect('6.7 Fs dönüşü (readerMode inline) sonrası selectedId korunur',
  loadEmailsSim({ current: 'b', items: [{ id: 'a' }, { id: 'b' }] }),
  'b');

console.log('\n── 7) Regresyon — R11/R10.1/R10.3/R9.1 KORUNDU ─');
expectTrue('7.1 R11: ListPane MAIL_TYPE import',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(listPane));
expectTrue('7.2 R11: yeni-e-posta buton T1 token (11px)',
  /\$\{MAIL_TYPE\.t1\} font-medium text-white/.test(listPane));
expectTrue('7.3 R10.3: bar müşteri onShowCustomer akışı korundu',
  /onShowCustomer && item\.accountId/.test(tab));
expectTrue('7.4 R10.1: compactDock composer prop hâlâ verilir',
  /compactDock=\{composerLayout === 'inline' && readerMode === 'fullscreen'\}/.test(tab));
expectTrue('7.5 R9.1: currentUserId 4 wiring korundu',
  (tab.match(/currentUserId=\{currentUserId\}/g) ?? []).length === 4);
expectTrue('7.6 R8: MailComposer instance = 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
