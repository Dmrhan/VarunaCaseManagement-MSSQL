/**
 * smoke-pr2-r14-1-lazytabboundary-chain.js — 2026-07-04
 *
 * R14.1 HOTFIX — LazyTabBoundary sınıfsız div flex zincirini kırıyordu.
 *
 * E2E kanıt (DOM zincir dökümü): CaseDetail İletişim wrapper'ı doğru
 * min-h-0/flex-1 taşıyor, AMA çocuğu LazyTabBoundary'nin render ettiği
 * <div key={resetKey}> min-h-0/flex-1 taşımadığından içerik boyutuna
 * büyüyor → gövde MAIN overflow-hidden'da kesiliyor, iç scroll yok,
 * hızlı-yanıt görünmüyor, containerH ölçümü şişkin.
 *
 * Fix (dikişli): LazyTabBoundary'ye opsiyonel className prop; İletişim
 * tüketicisinde zincir class'ı geçirilir; diğer tüketiciler prop'suz kalır
 * (mevcut davranış birebir).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }

const boundary = read('src/features/cases/components/LazyTabBoundary.tsx');
const detail = read('src/features/cases/CaseDetailPage.tsx');

console.log('── 1) LazyTabBoundary className prop + wrapper ─');
expectTrue('1.1 Props.className?: string (opsiyonel, geriye uyumlu)',
  /className\?:\s*string/.test(boundary));
expectTrue('1.2 R14.1 açıklaması Props yorumunda (kanıt + niyet)',
  /R14\.1 HOTFIX[\s\S]{0,600}flex zincir/.test(boundary));
expectTrue('1.3 Render <div key={resetKey} className={this.props.className}>',
  /<div key=\{this\.state\.resetKey\} className=\{this\.props\.className\}>\{this\.props\.children\}<\/div>/.test(boundary));
expectTrue('1.4 REGRESYON: eski sınıfsız <div key={resetKey}> KALKMIŞ',
  !/<div key=\{this\.state\.resetKey\}>\{this\.props\.children\}<\/div>/.test(boundary));

console.log('\n── 2) İletişim tüketicisi (CaseDetailPage) ────');
expectTrue('2.1 <LazyTabBoundary className="flex min-h-0 flex-1 flex-col" label="İletişim sekmesi yüklenemedi.">',
  /<LazyTabBoundary\s+label="İletişim sekmesi yüklenemedi\."\s+className="flex min-h-0 flex-1 flex-col"\s*>/.test(detail));
expectTrue('2.2 REGRESYON: eski className\'siz <LazyTabBoundary label="İletişim ..."> KALKMIŞ',
  !/<LazyTabBoundary label="İletişim sekmesi yüklenemedi\.">/.test(detail));

console.log('\n── 3) Envanter: diğer tüketiciler prop\'suz (birebir davranış) ─');

// Tüm src ağacını tara — LazyTabBoundary kullanımlarını listele
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(name)) yield p;
  }
}
const consumers = [];
for (const f of walk('src')) {
  const src = read(f);
  const matches = [...src.matchAll(/<LazyTabBoundary\b[^>]*>/g)];
  for (const m of matches) consumers.push({ file: f, tag: m[0] });
}
expect('3.1 Toplam <LazyTabBoundary> kullanım sayısı = 1 (yalnız İletişim; envanter net)',
  consumers.length, 1);
expectTrue('3.2 Tek tüketici CaseDetailPage.tsx',
  consumers[0]?.file.endsWith('CaseDetailPage.tsx'));
expectTrue('3.3 O tüketicide className="flex min-h-0 flex-1 flex-col" var',
  /className="flex min-h-0 flex-1 flex-col"/.test(consumers[0]?.tag ?? ''));

console.log('\n── 4) Zincir bütünlüğü — CaseDetailPage → LazyTabBoundary → CommunicationTab ─');
expectTrue('4.1 CaseDetailPage sekme wrapper flex-1 min-h-0 flex-col (İletişim durumunda)',
  /tab === 'communication'\s*\?\s*'flex min-h-0 flex-1 flex-col p-4'/.test(detail));
expectTrue('4.2 LazyTabBoundary zincir class\'ını geçirir (2.1 doğrulaması)',
  /<LazyTabBoundary[\s\S]{0,200}className="flex min-h-0 flex-1 flex-col"/.test(detail));
const tab = read('src/features/cases/components/CommunicationTab.tsx');
expectTrue('4.3 CommunicationTab root flex-1 min-h-0 flex-col',
  /<div className="flex min-h-0 flex-1 flex-col gap-3">/.test(tab));
expectTrue('4.4 Split kabı flex-1 min-h-0 (zincirin son halkası)',
  /ref=\{setContainerRef\}\s*\n\s*className="relative flex min-h-0 flex-1 flex-col overflow-hidden/.test(tab));

console.log('\n── 5) Regresyon — R14/R13/R11 KORUNDU ────────');
expectTrue('5.1 R14 M1: diğer sekmeler overflow-y-auto p-6',
  /flex-1 overflow-y-auto p-6/.test(detail));
expectTrue('5.2 R14 M2: Reader konu mode-aware',
  /truncate \$\{mode === 'fullscreen' \? MAIL_TYPE\.t4 : MAIL_TYPE\.t4Inline\}/.test(read('src/features/cases/components/MailThreadReader.tsx')));
expectTrue('5.3 R14 M3: divider selectedEmail && listSizeMeasured && atCap',
  /\{selectedEmail && listSizeMeasured && atCap && \(/.test(tab));
expectTrue('5.4 R13.1: setContainerRef callback ref hâlâ',
  /const setContainerRef = useCallback/.test(tab));
expectTrue('5.5 R11.1: text-[10px] literal yok',
  !/text-\[10px\]/.test(tab));
expectTrue('5.6 R8: MailComposer instance=1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
