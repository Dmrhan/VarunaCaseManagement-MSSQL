/**
 * smoke-pr2-r13-1-hotfix-list-collapse.js — 2026-07-04
 *
 * R13.1 HOTFIX — E2E kanıtlı repro: satır seç → liste 0px'e çöker (R13 M1
 * regresyonu).
 *
 * Kök: containerH ResizeObserver'ı useEffect([containerRef]) ile mount'ta
 * 1 kez tetikleniyor; split kapsayıcısı emails.length===0 → dolu geçişinde
 * sonradan mount olunca effect tekrar çalışmıyor → containerH=0 kalıcı →
 * listPx = 0*ratio = 0 → liste görünmez.
 *
 * Fix (2 katman):
 *   1) setContainerRef CALLBACK REF: element mount/unmount'ta otomatik.
 *   2) SAVUNMA GUARD: listSizeMeasured=false iken inline height uygulama,
 *      eski splitRatio*100% oran davranışına düş.
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

console.log('── 1) Katman 1 — setContainerRef callback ref ─');
expectTrue('1.1 containerObsRef (ResizeObserver instance ref)',
  /const containerObsRef = useRef<ResizeObserver \| null>\(null\)/.test(tab));
expectTrue('1.2 setContainerRef useCallback (element mount/unmount ile tetiklenir)',
  /const setContainerRef = useCallback\(\(el: HTMLDivElement \| null\) => \{/.test(tab));
expectTrue('1.3 setContainerRef: containerRef.current = el atama (drag için)',
  /setContainerRef = useCallback[\s\S]{0,200}containerRef\.current = el/.test(tab));
expectTrue('1.4 setContainerRef: eski observer disconnect + null (leak koruması)',
  /setContainerRef = useCallback[\s\S]{0,400}containerObsRef\.current\?\.disconnect\(\)[\s\S]{0,100}containerObsRef\.current = null/.test(tab));
expectTrue('1.5 setContainerRef: el=null → setContainerH(0) + erken dönüş',
  /setContainerRef = useCallback[\s\S]{0,600}if \(!el\) \{\s*setContainerH\(0\);\s*return;\s*\}/.test(tab));
expectTrue('1.6 setContainerRef: el varsa yeni ResizeObserver + observe',
  /setContainerRef = useCallback[\s\S]{0,900}new ResizeObserver[\s\S]{0,200}ro\.observe\(el\)[\s\S]{0,100}containerObsRef\.current = ro/.test(tab));
expectTrue('1.7 Split kapsayıcısında ref={setContainerRef} (R14 M1 sonrası flex-1 min-h-0 zinciri)',
  /ref=\{setContainerRef\}\s*\n\s*className="relative flex min-h-0 flex-1 flex-col/.test(tab));
expectTrue('1.8 REGRESYON: eski useEffect([containerRef]) KALKMIŞ',
  !/\}, \[containerRef\]\)/.test(tab));

console.log('\n── 2) Katman 2 — savunma guard (0px koruma) ──');
expectTrue('2.1 listSizeMeasured = containerH > 0 && listContentH > 0',
  /const listSizeMeasured = containerH > 0 && listContentH > 0/.test(tab));
expectTrue('2.2 R14.2: atCap = listSizeMeasured && content>=cap-1 (fallback dalında divider gizli)',
  /const atCap = listSizeMeasured && listContentH >= capPx - 1/.test(tab));
expectTrue('2.3 R14.2: Liste div style listSizeMeasured ? listPx : splitRatio% (selectedEmail? ölü dalı temizlendi)',
  /style=\{listSizeMeasured\s*\?\s*\{ height: `\$\{listPx\}px`, flexShrink: 0 \}\s*:\s*\{ height: `\$\{splitRatio \* 100\}%`, flexShrink: 0 \}\}/.test(tab));

console.log('\n── 3) Davranış simülasyonu — E2E senaryoları ─');

function computeStyle({ selectedEmail, containerH, listContentH, splitRatio }) {
  const listSizeMeasured = containerH > 0 && listContentH > 0;
  const capPx = containerH * splitRatio;
  const atCap = !listSizeMeasured || listContentH >= capPx - 1;
  const listPx = atCap ? capPx : listContentH;
  if (!selectedEmail) return { style: { flex: '1 1 0%' }, atCap: false };
  if (listSizeMeasured) return { style: { height: `${listPx}px`, flexShrink: 0 }, atCap };
  return { style: { height: `${splitRatio * 100}%`, flexShrink: 0 }, atCap };
}

// 3.1 KANITLANAN HATA: seçim sonrası ölçüm yok → önceden 0px, şimdi %35
const r1 = computeStyle({ selectedEmail: true, containerH: 0, listContentH: 0, splitRatio: 0.35 });
expect('3.1 Ölçüm yok + seçim + splitRatio 0.35 → height=%35 (0px DEĞİL)',
  r1.style.height, '35%');

// 3.2 Ölçüm geldi + 1 mesajlı (UNV-1000111 senaryosu)
const r2 = computeStyle({ selectedEmail: true, containerH: 700, listContentH: 80, splitRatio: 0.35 });
expect('3.2 1 mesaj (80px, container 700) → height=80px', r2.style.height, '80px');
expect('3.2b divider GİZLİ (atCap=false)', r2.atCap, false);

// 3.3 Ölçüm geldi + 7 mesajlı (UNV-1000058 senaryosu)
const r3 = computeStyle({ selectedEmail: true, containerH: 700, listContentH: 400, splitRatio: 0.35 });
expectTrue('3.3 7 mesaj (400px > cap 245) → height ≈ 245px (float toleransı ±0.01)',
  Math.abs(parseFloat(r3.style.height) - 245) < 0.01);
expect('3.3b divider görünür (atCap=true)', r3.atCap, true);

// 3.4 Katlı → seçim → katlı geçişi (observer disconnect testi)
const r4a = computeStyle({ selectedEmail: false, containerH: 700, listContentH: 400, splitRatio: 0.35 });
expect('3.4a Katlı: flex 1 1 0%', r4a.style.flex, '1 1 0%');
// Seçim yapıldı — observer bağlı, ölçüm var
const r4b = computeStyle({ selectedEmail: true, containerH: 700, listContentH: 400, splitRatio: 0.35 });
expectTrue('3.4b Seçim sonrası ölçüm var → ≈245px (leak yok)',
  Math.abs(parseFloat(r4b.style.height) - 245) < 0.01);
// Katlanır — style flex'e döner
const r4c = computeStyle({ selectedEmail: false, containerH: 700, listContentH: 400, splitRatio: 0.35 });
expect('3.4c Tekrar katlı → flex 1 1 0%', r4c.style.flex, '1 1 0%');

// 3.5 Pencere resize → containerH güncellenir → yeni cap
const r5 = computeStyle({ selectedEmail: true, containerH: 900, listContentH: 400, splitRatio: 0.35 });
expect('3.5 Container 700→900 resize → cap 245→315; 400>315 → height=315px', r5.style.height, '315px');

// 3.6 Sadece listContentH gecikmişse (containerH var, listContent henüz gelmedi)
const r6 = computeStyle({ selectedEmail: true, containerH: 700, listContentH: 0, splitRatio: 0.35 });
expect('3.6 Yalnız listContent gecikti → güvenli düşüş %35',
  r6.style.height, '35%');

// 3.7 Sadece containerH gecikmiş (listContent geldi, container henüz yok)
const r7 = computeStyle({ selectedEmail: true, containerH: 0, listContentH: 80, splitRatio: 0.35 });
expect('3.7 Yalnız container gecikti → güvenli düşüş %35',
  r7.style.height, '35%');

console.log('\n── 4) Regresyon — R13 diğer davranışı KORUNDU ─');
expectTrue('4.1 Reader SEPARATE conditional (selectedEmail iken her durumda)',
  /\{selectedEmail && \(\s*<div className="min-h-0 flex-1 bg-white/.test(tab));
expectTrue('4.2 R14.2: Divider yalnız listSizeMeasured && atCap (selectedEmail guard\'ı ölü dal kalktı)',
  /\{listSizeMeasured && atCap && \(/.test(tab));
expectTrue('4.3 R14.2: R12 katlı-başlangıç ölü dalı temizlendi (auto-select GERİ)',
  !/\{ flex: '1 1 0%' \}\}/.test(tab));
expectTrue('4.4 R11.1 kaçak yok (drag tooltip token\'da)',
  !/text-\[10px\]/.test(tab));
expectTrue('4.5 R8: MailComposer instance=1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('4.6 drag handler containerRef.current hâlâ çalışır (dolu kalır)',
  /const el = containerRef\.current[\s\S]{0,80}if \(!el\) return[\s\S]{0,80}getBoundingClientRect/.test(tab));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
