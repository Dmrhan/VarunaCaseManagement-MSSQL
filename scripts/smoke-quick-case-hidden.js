/**
 * smoke-quick-case-hidden.js — "Hızlı Vaka" buton'u feature flag ile gizli.
 *
 * Çalıştır:
 *   node scripts/smoke-quick-case-hidden.js
 *
 * Static grep — DB/HTTP gerektirmez. Quick Case gizleme PR'ının
 * invariant'ları:
 *
 *   - featureFlags.quickCaseEnabled tanımlı, default false
 *   - VITE_QUICK_CASE_ENABLED env override mevcut
 *   - CasesListPage "Hızlı Vaka" buton'u flag ile sarılmış
 *   - 'q' hotkey + pendingQuickPrefill effect flag ile gate'li
 *   - QuickCaseModal kodu SİLİNMEDİ (geri açılabilir)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FLAGS = resolve(ROOT, 'src/config/featureFlags.ts');
const CASES = resolve(ROOT, 'src/features/cases/CasesListPage.tsx');
const MODAL = resolve(ROOT, 'src/features/cases/QuickCaseModal.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [FLAGS, CASES, MODAL]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const flags = readFileSync(FLAGS, 'utf8');
const cases = readFileSync(CASES, 'utf8');

// 1) featureFlags.quickCaseEnabled tanımlı + default false.
if (
  /quickCaseEnabled:\s*readFlag\(\s*['"]VITE_QUICK_CASE_ENABLED['"]\s*,\s*false\s*\)/.test(flags)
) {
  ok('1) featureFlags.quickCaseEnabled default false (env override desteği)');
} else {
  bad('1) quickCaseEnabled flag tanımı eksik veya default false değil');
}

// 2) CasesListPage featureFlags import ediyor.
if (/import\s*\{\s*featureFlags\s*\}\s*from\s*['"]@\/config\/featureFlags['"]/.test(cases)) {
  ok('2) CasesListPage featureFlags import ediyor');
} else {
  bad('2) featureFlags import eksik');
}

// 3) "Hızlı Vaka" buton'u featureFlags.quickCaseEnabled koşulu ile sarılı.
//    Pattern: `{featureFlags.quickCaseEnabled && (` öncesi `Hızlı Vaka` sonrası gelmeli.
const buttonBlock = cases.match(/\{featureFlags\.quickCaseEnabled\s*&&\s*\([\s\S]{0,800}?Hızlı Vaka/);
if (buttonBlock) {
  ok('3) "Hızlı Vaka" buton featureFlags.quickCaseEnabled ile sarılı');
} else {
  bad('3) Hızlı Vaka buton flag-gated değil');
}

// 4) 'q' hotkey flag kontrolü içeriyor.
if (
  /useHotkey\(\s*['"]q['"][\s\S]{0,300}?featureFlags\.quickCaseEnabled/.test(cases)
) {
  ok('4) "q" hotkey flag kontrolü içeriyor');
} else {
  bad('4) q hotkey flag gate eksik');
}

// 5) pendingQuickPrefill effect flag kontrolü.
//    Codex P1 (#452) + Codex P2 (#459) review fix — flag false iken
//    silent ignore YOK, NewCaseForm'a TAM initialContext (accountId +
//    accountCompanyIds + accountName) ile yönlendirilir. State adı
//    `newPrefill` (önceki sade accountId state'inden geliştirildi).
if (
  /featureFlags\.quickCaseEnabled[\s\S]{0,300}?setQuickOpen\(true\)[\s\S]{0,800}?accountService\.get[\s\S]{0,400}?setNewPrefill[\s\S]{0,200}?setNewOpen\(true\)/.test(cases)
) {
  ok('5) pendingQuickPrefill effect — flag açık → Quick / kapalı → account fetch + NewCaseForm');
} else {
  bad('5) pendingQuickPrefill iki yol pattern eksik');
}

// 5b) Codex P2 (main #459) — NewCaseForm initialContext TAM shape
//     (accountCompanyIds + accountName) ile, account-only seed bug'ı
//     elimine. Eski sade `accountId` patch elimine.
if (
  /accountCompanyIds:\s*companyIds/.test(cases) &&
  /initialContext=\{newPrefill\s*\?\?\s*undefined\}/.test(cases)
) {
  ok('5b) Codex P1+P2 fix — NewCaseForm tam initialContext (accountCompanyIds + accountName)');
} else {
  bad('5b) Tam initialContext shape eksik');
}

// 6) QuickCaseModal dosyası SİLİNMEDİ (kod intact, geri açılabilir).
if (existsSync(MODAL)) {
  const modal = readFileSync(MODAL, 'utf8');
  if (modal.includes('export function QuickCaseModal') || modal.includes('export default QuickCaseModal')) {
    ok('6) QuickCaseModal kodu intact (silinmedi, geri açılabilir)');
  } else {
    bad('6) QuickCaseModal export eksik');
  }
} else {
  bad('6) QuickCaseModal dosyası YOK');
}

// 7) QuickCaseModal hala CasesListPage'de import ediliyor (render path
//    flag açıkken çalışsın diye).
if (/import\s*\{\s*QuickCaseModal\s*\}/.test(cases)) {
  ok('7) QuickCaseModal import korundu (flag açılırsa render eder)');
} else {
  bad('7) QuickCaseModal import kaldırılmış');
}

// 8) Akıllı Ticket buton RUNA AI brand gradient (violet → fuchsia).
if (
  /Akıllı Ticket akışıyla vaka aç \(RUNA AI\)/.test(cases) &&
  /from-violet-600\s+to-fuchsia-600/.test(cases)
) {
  ok('8) Akıllı Ticket buton RUNA AI violet→fuchsia gradient');
} else {
  bad('8) Akıllı Ticket buton renk override eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
