/**
 * smoke-pr2-default-tab-mail-origin.js — 2026-07-04
 *
 * PR-2 FAZ 4 — Mail-kaynaklı vakada default sekme = İletişim.
 * Kullanıcı direktifi: oturum içinde kullanıcı seçimi ezilmez.
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

const d = read('src/features/cases/CaseDetailPage.tsx');

console.log('── 1) Pattern — initialTabAppliedRef guard ────');
expectTrue('1.1 initialTabAppliedRef = useRef(false)',
  /const initialTabAppliedRef\s*=\s*useRef\(false\)/.test(d));
expectTrue('1.2 useEffect gate: initialTabAppliedRef.current true ise EARLY RETURN',
  /if \(!item \|\| initialTabAppliedRef\.current\) return/.test(d));
expectTrue('1.3 Ref işaretle (bir kez apply)',
  /initialTabAppliedRef\.current\s*=\s*true/.test(d));
expectTrue('1.4 origin==="E-posta" → setTab("communication")',
  /if \(item\.origin === 'E-posta'\)[\s\S]{0,100}setTab\('communication'\)/.test(d));
expectTrue('1.5 Manuel origin → default \'detail\' korunur',
  /useState<TabKey>\('detail'\)/.test(d));

console.log('\n── 2) Davranış — sekme selector sim ─────────');

// Sim: mount + item load lifecycle
function simulate(scenario) {
  let tab = 'detail';
  const refApplied = { current: false };
  const events = [];

  const applyInitial = (item) => {
    if (!item || refApplied.current) return;
    refApplied.current = true;
    if (item.origin === 'E-posta') {
      tab = 'communication';
      events.push('auto-set-communication');
    } else {
      events.push('no-change');
    }
  };

  const userSetTab = (newTab) => {
    tab = newTab;
    events.push(`user-set-${newTab}`);
  };

  for (const step of scenario) {
    if (step.type === 'load') applyInitial(step.item);
    else if (step.type === 'user') userSetTab(step.tab);
  }
  return { tab, events };
}

// Senaryo A: E-posta origin → mount'ta communication
const a = simulate([{ type: 'load', item: { origin: 'E-posta' } }]);
expect('2.1 E-posta origin mount → tab=communication',
  a.tab, 'communication');

// Senaryo B: Telefon origin → detail kalır
const b = simulate([{ type: 'load', item: { origin: 'Telefon' } }]);
expect('2.2 Telefon origin mount → tab=detail (default)',
  b.tab, 'detail');

// Senaryo C: E-posta → user detail → item re-load → detail KORUNUR
const c = simulate([
  { type: 'load', item: { origin: 'E-posta' } },   // → communication
  { type: 'user', tab: 'detail' },                 // kullanıcı manuel detail
  { type: 'load', item: { origin: 'E-posta' } },   // item güncelenir
]);
expect('2.3 Kullanıcı seçimi EZİLMEZ — user detail sonrası re-load → tab=detail',
  c.tab, 'detail');

// Senaryo D: Telefon → user communication → item re-load → communication KORUNUR
const d1 = simulate([
  { type: 'load', item: { origin: 'Telefon' } },
  { type: 'user', tab: 'communication' },
  { type: 'load', item: { origin: 'Telefon' } },
]);
expect('2.4 Telefon vakasında user communication seçmişse KORUNUR',
  d1.tab, 'communication');

// Senaryo E: Item null → nothing (guard)
const e = simulate([{ type: 'load', item: null }]);
expect('2.5 Item null → tab default kalır (guard)',
  e.tab, 'detail');

// Senaryo F: E-posta ilk load, sonra Telefon origin'e değişse bile guard: ref set
// (bir kez apply — yeni item origin değişse bile ezilmez)
const f = simulate([
  { type: 'load', item: { origin: 'E-posta' } },   // → communication (auto)
  { type: 'load', item: { origin: 'Telefon' } },   // ref already set → ignore
]);
expect('2.6 Ref bir kez apply — sonraki item değişimlerde ezilmez',
  f.tab, 'communication');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
