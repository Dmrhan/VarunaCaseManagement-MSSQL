/**
 * smoke-pr2-default-tab-mail-origin.js — 2026-07-04
 *
 * PR-2 FAZ 4 — Mail-kaynaklı vakada default sekme = İletişim.
 * Codex R1 P2 fix (2026-07-04): guard koşulsuz bool → VAKA-BAŞINA ref
 * (appliedForCaseIdRef). Aynı mount'ta ikinci mail vakasında da İletişim
 * default seçilir; aynı vakada refresh'te kullanıcı seçimi ezilmez.
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

console.log('── 1) Pattern — appliedForCaseIdRef (vaka-başına) ─');
expectTrue('1.1 Codex R1: appliedForCaseIdRef = useRef<string | null>(null)',
  /const appliedForCaseIdRef\s*=\s*useRef<string \| null>\(null\)/.test(d));
expectTrue('1.2 Guard: !item → early return',
  /if \(!item\) return/.test(d));
expectTrue('1.3 Guard: appliedForCaseIdRef.current === item.id → early return (aynı vakada re-apply YOK)',
  /if \(appliedForCaseIdRef\.current === item\.id\) return/.test(d));
expectTrue('1.4 Yeni vaka: appliedForCaseIdRef.current = item.id (baseline yeniden kurulur)',
  /appliedForCaseIdRef\.current\s*=\s*item\.id/.test(d));
expectTrue('1.5 setTab ternary: origin==="E-posta" ? "communication" : "detail"',
  /setTab\(item\.origin === 'E-posta' \? 'communication' : 'detail'\)/.test(d));
expectTrue('1.6 REGRESYON: eski koşulsuz initialTabAppliedRef bool KALKMIŞ',
  !/const initialTabAppliedRef\s*=\s*useRef\(false\)/.test(d));
expectTrue('1.7 REGRESYON: eski early return "initialTabAppliedRef.current" KALKMIŞ',
  !/initialTabAppliedRef\.current/.test(d));
expectTrue('1.8 useState initial default \'detail\' korunur',
  /useState<TabKey>\('detail'\)/.test(d));

console.log('\n── 2) Davranış — vaka-başına guard sim ──────');

// Sim: mount + item load lifecycle (vaka-başına ref)
function simulate(scenario) {
  let tab = 'detail';
  const appliedForCaseIdRef = { current: null };
  const events = [];

  const applyInitial = (item) => {
    if (!item) return;
    if (appliedForCaseIdRef.current === item.id) return;
    appliedForCaseIdRef.current = item.id;
    tab = item.origin === 'E-posta' ? 'communication' : 'detail';
    events.push(`apply-${tab}-${item.id}`);
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

// 2.1 — E-posta vaka → İletişim (default)
const a = simulate([{ type: 'load', item: { id: 'c1', origin: 'E-posta' } }]);
expect('2.1 Mail vaka 1 → İletişim', a.tab, 'communication');

// 2.2 — Normal vaka → Detay
const b = simulate([{ type: 'load', item: { id: 'c1', origin: 'Telefon' } }]);
expect('2.2 Normal vaka (Telefon) → Detay', b.tab, 'detail');

// 2.3 — CODEX R1 FIX: mail vaka 1 → mail vaka 2 → İletişim (eskiden ref ezildiği için detail\'de kalıyordu)
const c = simulate([
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },
  { type: 'load', item: { id: 'c2', origin: 'E-posta' } },
]);
expect('2.3 CODEX FIX: Aynı mount\'ta mail vaka 1 → mail vaka 2 → İletişim',
  c.tab, 'communication');
expect('2.3b Her iki vakaya apply olayı kaydedildi',
  c.events.length, 2);

// 2.4 — CODEX R1 FIX: mail vaka → normal vaka → Detay (baseline yeniden kurulur)
const d1 = simulate([
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },
  { type: 'load', item: { id: 'c2', origin: 'Telefon' } },
]);
expect('2.4 CODEX FIX: Mail vaka → normal vaka → Detay (yeni vakada baseline yeniden)',
  d1.tab, 'detail');

// 2.5 — Aynı vakada refresh → kullanıcı seçimi KORUNUR (item.id aynı → early return)
const e = simulate([
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },   // → İletişim
  { type: 'user', tab: 'detail' },                            // kullanıcı Detay'a
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },   // refresh — item.id AYNI
]);
expect('2.5 Aynı vakada kullanıcı seçimi refresh\'te KORUNUR (item.id === current)',
  e.tab, 'detail');

// 2.6 — Normal vakada kullanıcı İletişim seçtiyse refresh'te korunur
const f = simulate([
  { type: 'load', item: { id: 'c1', origin: 'Telefon' } },
  { type: 'user', tab: 'communication' },
  { type: 'load', item: { id: 'c1', origin: 'Telefon' } },
]);
expect('2.6 Normal vakada user İletişim → refresh → İletişim korunur',
  f.tab, 'communication');

// 2.7 — Item null → tab dokunulmaz
const g = simulate([{ type: 'load', item: null }]);
expect('2.7 Item null → default \'detail\'', g.tab, 'detail');

// 2.8 — Normal vaka 1 → Mail vaka 2 → İletişim
const h = simulate([
  { type: 'load', item: { id: 'c1', origin: 'Telefon' } },
  { type: 'load', item: { id: 'c2', origin: 'E-posta' } },
]);
expect('2.8 Normal vaka → mail vaka → İletişim (yeni vaka baseline)',
  h.tab, 'communication');

// 2.9 — CODEX FIX: mail vaka 1 → mail vaka 2 → aynı vaka 2 refresh → tab korunur
const i = simulate([
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },
  { type: 'load', item: { id: 'c2', origin: 'E-posta' } },
  { type: 'user', tab: 'detail' },
  { type: 'load', item: { id: 'c2', origin: 'E-posta' } },
]);
expect('2.9 Mail c1 → mail c2 (İletişim) → user Detay → c2 refresh → Detay korunur',
  i.tab, 'detail');

// 2.10 — Mail c1 → user Detay → mail c2 → İletişim (yeni vakada default reset)
const j = simulate([
  { type: 'load', item: { id: 'c1', origin: 'E-posta' } },
  { type: 'user', tab: 'detail' },
  { type: 'load', item: { id: 'c2', origin: 'E-posta' } },
]);
expect('2.10 Mail c1 → user Detay → mail c2 → İletişim (önceki vakadaki seçim yansımaz)',
  j.tab, 'communication');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
