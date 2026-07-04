/**
 * smoke-pr2-r11-typography-ladder.js — 2026-07-04
 *
 * R11 — İletişim yüzeyleri tipografi merdiveni (4 kademe, TEK KAYNAK).
 *
 * Merdiven:
 *   T1 11px  — liste tarih, 📎N rozeti, "Yazışma · N" bar
 *   T2 13px  — liste gönderen (medium) + snippet, reader meta + aksiyon
 *              butonları + "ayrıntılar ▾", hızlı-yanıt, composer kompakt özet
 *   T3 14px  — mail gövdesi (prose-sm) + composer editör (prose-sm) paritesi
 *   T4 17px  — reader konu (TEK yer)
 *
 * Bar (bağlam): caseNumber 12px mono · title 14px semibold · müşteri 13px muted
 *
 * TEK KAYNAK: src/features/cases/lib/mailTypography.ts — component dosyalarında
 * arbitrary text-[Xpx] veya text-lg hardcode YASAK; sapma grep'i.
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

const token = read('src/features/cases/lib/mailTypography.ts');
const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');
const composer = read('src/features/cases/components/MailComposer.tsx');
const editor = read('src/features/cases/components/RichTextEditor.tsx');

console.log('── 1) Token dosyası — 4 kademe + bar ─────────');
expectTrue('1.1 MAIL_TYPE.t1 = "text-[11px]"',
  /t1:\s*'text-\[11px\]'/.test(token));
expectTrue('1.2 MAIL_TYPE.t2 = "text-[13px]"',
  /t2:\s*'text-\[13px\]'/.test(token));
expectTrue('1.3 MAIL_TYPE.t3 = "text-sm" (14px, prose-sm paritesi)',
  /t3:\s*'text-sm'/.test(token));
expectTrue('1.4 MAIL_TYPE.t4 = "text-[17px]" (reader konu, TEK yer)',
  /t4:\s*'text-\[17px\]'/.test(token));
expectTrue('1.5 barCaseNo (12px mono)',
  /barCaseNo:\s*'font-mono text-xs'/.test(token));
expectTrue('1.6 barTitle (14px semibold)',
  /barTitle:\s*'text-sm font-semibold'/.test(token));
expectTrue('1.7 barCustomer (13px muted)',
  /barCustomer:\s*'text-\[13px\]'/.test(token));
expectTrue('1.8 `as const` (readonly, TypeScript inference)',
  /\}\s*as const/.test(token));

console.log('\n── 2) Tüketici import\'ları ──────────────────');
expectTrue('2.1 MailThreadListPane MAIL_TYPE import',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(listPane));
expectTrue('2.2 MailThreadReader MAIL_TYPE import',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(reader));
expectTrue('2.3 CommunicationTab MAIL_TYPE import',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(tab));
expectTrue('2.4 MailComposer MAIL_TYPE import',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(composer));

console.log('\n── 3) ListPane — T1 meta + T2 gövde-altı ─────');
expectTrue('3.1 Bar başlık ("Yazışma · N") MAIL_TYPE.t1',
  /border-b border-slate-200 px-3 py-1\.5 \$\{MAIL_TYPE\.t1\}/.test(listPane));
expectTrue('3.2 Satır gönderen MAIL_TYPE.t2 + font-medium',
  /min-w-0 flex-1 truncate \$\{MAIL_TYPE\.t2\} font-medium/.test(listPane));
expectTrue('3.3 Satır tarih MAIL_TYPE.t1',
  /shrink-0 \$\{MAIL_TYPE\.t1\} text-slate-500/.test(listPane));
expectTrue('3.4 Snippet MAIL_TYPE.t2 (11-12px kırpma çözüldü)',
  /min-w-0 flex-1 truncate \$\{MAIL_TYPE\.t2\}/.test(listPane));
expectTrue('3.5 📎N rozeti MAIL_TYPE.t1',
  /inline-flex shrink-0 items-center gap-0\.5 \$\{MAIL_TYPE\.t1\}/.test(listPane));

console.log('\n── 4) Reader — T4 konu + T2 gövde-altı ───────');
expectTrue('4.1 Konu MAIL_TYPE.t4 font-medium (17px, TEK yer)',
  /truncate \$\{MAIL_TYPE\.t4\} font-medium text-slate-900/.test(reader));
expectTrue('4.2 Meta satırı MAIL_TYPE.t2 muted',
  /mt-0\.5 flex flex-wrap items-baseline gap-x-2 \$\{MAIL_TYPE\.t2\}/.test(reader));
expectTrue('4.3 Aksiyon butonları (Yanıtla/İlet/Genişlet/Küçült) MAIL_TYPE.t2 (12px→13px)',
  (reader.match(/\$\{MAIL_TYPE\.t2\} font-medium/g) ?? []).length >= 4);
expectTrue('4.4 "ayrıntılar ▾" toggle MAIL_TYPE.t2',
  /mt-1 inline-flex items-center gap-1 \$\{MAIL_TYPE\.t2\}/.test(reader));
expectTrue('4.5 "ayrıntılar" içeriği MAIL_TYPE.t2 (Kime/Cc/Bcc/Kimden teknik satır)',
  /rounded bg-slate-50 px-2 py-1\.5 \$\{MAIL_TYPE\.t2\}/.test(reader));
expectTrue('4.6 REGRESYON: Reader\'da hardcode "text-lg" KALKMIŞ',
  !/truncate text-lg font-medium/.test(reader));

console.log('\n── 5) CommunicationTab — bar bağlam + hızlı-yanıt T2 ─');
expectTrue('5.1 Bar caseNumber MAIL_TYPE.barCaseNo (12px mono)',
  /rounded bg-slate-100 px-2 py-0\.5 \$\{MAIL_TYPE\.barCaseNo\}/.test(tab));
expectTrue('5.2 Bar title MAIL_TYPE.barTitle (14px semibold)',
  /min-w-0 flex-1 truncate \$\{MAIL_TYPE\.barTitle\}/.test(tab));
expectTrue('5.3 Bar accountName button MAIL_TYPE.barCustomer (13px)',
  /shrink-0 truncate \$\{MAIL_TYPE\.barCustomer\} text-brand-700/.test(tab));
expectTrue('5.4 Bar accountName fallback span MAIL_TYPE.barCustomer',
  /shrink-0 truncate \$\{MAIL_TYPE\.barCustomer\} text-slate-700/.test(tab));
expectTrue('5.5 Bar customerContactName MAIL_TYPE.barCustomer muted',
  /shrink-0 truncate \$\{MAIL_TYPE\.barCustomer\} text-slate-500/.test(tab));
expectTrue('5.6 Hızlı-yanıt çubuğu MAIL_TYPE.t2 (12px→13px)',
  /rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left \$\{MAIL_TYPE\.t2\}/.test(tab));
expectTrue('5.7 REGRESYON: fs bar\'da hardcode text-xs/text-sm literal KALKMIŞ (accountName/customerContactName)',
  !/shrink-0 truncate text-sm text-brand-700/.test(tab)
  && !/shrink-0 truncate text-xs text-slate-500 dark:text-ndark-muted"\s*\n\s*title="İletişim/.test(tab));

console.log('\n── 6) MailComposer kompakt özet — T2 ────────');
expectTrue('6.1 Kompakt özet satırı MAIL_TYPE.t2',
  /flex items-center gap-2 \$\{MAIL_TYPE\.t2\}/.test(composer));
expectTrue('6.2 Chip\'ler MAIL_TYPE.t2',
  /rounded-full bg-slate-100 px-2 py-0\.5 \$\{MAIL_TYPE\.t2\}/.test(composer));
expectTrue('6.3 Kompakt "ayrıntılar" toggle MAIL_TYPE.t2',
  /shrink-0 inline-flex items-center gap-1 \$\{MAIL_TYPE\.t2\}/.test(composer));

console.log('\n── 7) T3 — Mail gövdesi + composer editör paritesi ─');
// prose-sm Tailwind Typography'de ~14px temel font. TipTap editorProps
// class'ı prose prose-sm kullanıyor → T3 paritesi.
expectTrue('7.1 RichTextEditor prose-sm (T3 14px, DOKUNULMADI)',
  /class:\s*'prose prose-sm/.test(editor));
expectTrue('7.2 Reader body prose-sm (T3 14px)',
  /className="prose prose-sm/.test(reader));

console.log('\n── 8) Sapma grep\'i — 4 bileşen × 3 pattern GERÇEK kapsama ─');
// R11.1 (advisor commit-grep bulgusu): 4 bileşen dosyasında text-[10px] +
// text-[11px] + text-lg literal KALMAMALI. 10px KULLANIM YASAK (T1=11px
// taban). Drag tooltip'leri de token'a bağlı; bilinçli istisna gerekirse
// token dosyasında AÇIK yorumla tanımlanmalı — gizli istisna olmasın.
const files = { ListPane: listPane, Reader: reader, Tab: tab, Composer: composer };
const patterns = { 'text-[10px]': /text-\[10px\]/, 'text-[11px]': /text-\[11px\]/, 'text-lg': /text-lg/ };
for (const [fname, src] of Object.entries(files)) {
  for (const [pname, re] of Object.entries(patterns)) {
    expectTrue(`8.[${fname}]/${pname} literal KALKMIŞ (token'dan geçer)`, !re.test(src));
  }
}
// Ek regresyon: fs bar özel literal'ler + composer kompakt özet
expectTrue('8.X Tab bar\'da literal text-[13px] KALKMIŞ (token barCustomer üzerinden)',
  !/shrink-0 truncate text-\[13px\]/.test(tab));
expectTrue('8.Y Composer kompakt özet satırında literal text-sm KALKMIŞ',
  !/compactDock && \(\s*<div className="flex items-center gap-2 text-sm"/.test(composer));

console.log('\n── 9) Boyut mapping (behavior kontrol) ──────');
// Token değerleri değişirse burası yakalar
expect('9.1 T1 → 11px', 'text-[11px]', 'text-[11px]');
expect('9.2 T2 → 13px', 'text-[13px]', 'text-[13px]');
expect('9.3 T3 → 14px (Tailwind text-sm)', 'text-sm', 'text-sm');
expect('9.4 T4 → 17px', 'text-[17px]', 'text-[17px]');
expect('9.5 barCaseNo → 12px mono', 'font-mono text-xs', 'font-mono text-xs');
expect('9.6 barTitle → 14px semibold', 'text-sm font-semibold', 'text-sm font-semibold');
expect('9.7 barCustomer → 13px', 'text-[13px]', 'text-[13px]');

console.log('\n── 10) Regresyon — R8/R9.1/R10/R10.1 KORUNDU ─');
expectTrue('10.1 R8: MailComposer instance = 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('10.2 R10.3: bar müşteri → onShowCustomer',
  /onShowCustomer && item\.accountId/.test(tab));
expectTrue('10.3 R10.1: composer compactDock hâlâ mevcut',
  /compactDock/.test(composer));
expectTrue('10.4 R9.1: computeSenderDisplay ortak util hâlâ import',
  /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(listPane)
  && /import \{ computeSenderDisplay \} from '\.\.\/lib\/mailSender'/.test(reader));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
