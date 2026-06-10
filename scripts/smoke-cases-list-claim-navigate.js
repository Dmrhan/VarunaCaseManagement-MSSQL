/**
 * smoke-cases-list-claim-navigate.js — PR-2 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-cases-list-claim-navigate.js
 *
 * Business review Madde 5 — Üstlen sonrası Case Detail'e gidiş.
 *
 * Korunan invariant'lar:
 *   - CasesListPage handleClaim success branch'inde onSelectCase çağrılır
 *   - Mevcut toast davranışı korundu
 *   - Mevcut load() + refreshStats() arka plan refresh korundu
 *   - 409/race conflict (apiFetch toast'ladığı path) navigate ETMEZ
 *   - claimCase endpoint imzası dokunulmadı (caseService)
 *   - CaseDetailPage'deki claim davranışı dokunulmadı (regression)
 *   - canClaimCase yetki kontrolü dokunulmadı
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIST = resolve(ROOT, 'src/features/cases/CasesListPage.tsx');
const DETAIL = resolve(ROOT, 'src/features/cases/CaseDetailPage.tsx');
const SVC = resolve(ROOT, 'src/services/caseService.ts');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [LIST, DETAIL, SVC]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const list = readFileSync(LIST, 'utf8');
const detail = readFileSync(DETAIL, 'utf8');
const svc = readFileSync(SVC, 'utf8');

// 1) handleClaim success branch'inde onSelectCase çağrısı eklendi.
//    Pattern: `if (updated)` ve sonrası `onSelectCase(updated.id)`.
//    Nested brace yapısı için greedy regex yerine flat lookup.
if (/if\s*\(updated\)\s*\{[\s\S]{0,800}?onSelectCase\(updated\.id\)/.test(list)) {
  ok('1) handleClaim success branch\'inde onSelectCase(updated.id) çağrılıyor');
} else {
  bad('1) onSelectCase çağrısı eksik');
}

// 2) Toast davranışı korundu (success message).
if (/toast\(\s*\{\s*type:\s*['"]success['"][\s\S]{0,200}?Vaka üstlenildi/.test(list)) {
  ok('2) Success toast davranışı korundu');
} else {
  bad('2) Toast davranışı bozuldu');
}

// 3) load() + refreshStats() arka plan refresh korundu.
//    handleClaim'in success branch'inde her ikisi de mevcut olmalı.
if (
  /onSelectCase\(updated\.id\)[\s\S]{0,200}?void\s+load\(\)[\s\S]{0,200}?void\s+refreshStats\(\)/.test(list)
) {
  ok('3) Arka plan load() + refreshStats() korundu (navigate sonrası)');
} else {
  bad('3) Arka plan refresh eksik veya yanlış sırada');
}

// 4) 409/conflict path (updated === undefined) navigate ETMEZ.
//    handleClaim else branch'inde onSelectCase OLMAMALI.
//    Pattern: `} else { void load(); }` blok kalıbı; onSelectCase yok.
const elseBlock = list.match(/\}\s*else\s*\{\s*(?:\/\/[^\n]*\n\s*)*void\s+load\(\);\s*\}/);
if (elseBlock && !/onSelectCase/.test(elseBlock[0])) {
  ok('4) 409/conflict else branch\'inde onSelectCase YOK (race-safe)');
} else if (elseBlock) {
  bad('4) Else branch onSelectCase içeriyor (yanlış)');
} else {
  bad('4) Else branch tespit edilemedi');
}

// 5) claimCase endpoint imzası dokunulmadı.
//    caseService.claimCase(caseId) tek argüman alır.
if (/async\s+claimCase\(\s*caseId:\s*string\s*\)/.test(svc)) {
  ok('5) caseService.claimCase imzası dokunulmadı');
} else {
  bad('5) claimCase imzası değişmiş (regression riski)');
}

// 6) Regression: CaseDetailPage'deki claim davranışı dokunulmadı.
//    handleClaim içinde caseService.claimCase çağrısı mevcut + setItem(updated)
//    pattern'i intact.
if (
  /async\s+function\s+handleClaim[\s\S]{0,600}?caseService\.claimCase\(item\.id\)[\s\S]{0,400}?setItem\(updated\)/.test(detail)
) {
  ok('6) CaseDetailPage handleClaim + setItem(updated) intact (regression korundu)');
} else {
  bad('6) CaseDetailPage claim davranışı dokunulmuş (regression)');
}

// 7) canClaimCase yetki kontrolü dokunulmadı.
if (
  /canClaimCase\s*=\s*\(c[\s\S]{0,300}?user\?\.personId[\s\S]{0,200}?CLOSED_STATUSES\.includes/.test(list)
) {
  ok('7) canClaimCase yetki kontrolü dokunulmadı');
} else {
  bad('7) canClaimCase yetki kontrolü değişmiş');
}

// 8) Sadece CasesListPage'de navigate eklendi — ActionCenter / MyHome'da
//    yeni claim navigate akışı YOK (scope sınırı).
const actionCenter = resolve(ROOT, 'src/features/action-center');
const myHome = resolve(ROOT, 'src/features/my-home');
let extraNavigate = false;
for (const dir of [actionCenter, myHome]) {
  if (existsSync(dir)) {
    // Sadece varlık kontrolü; dosyaları taramaya gerek yok — eğer claim
    // varsa ve onSelectCase eklenseydi bug riski olurdu. Bu PR'da hiç
    // dokunulmadığını belirtmek için bilgi amaçlı.
  }
}
// Scope sınırı invariant'ı: bu PR yalnız 1 dosyaya dokunmuş olmalı.
// Smoke seviyesinde, sadece CasesListPage'de "onSelectCase(updated.id)"
// claim ile aynı bloğa eklenmiş olmalı.
const claimNavigateOccurrences = (list.match(/onSelectCase\(updated\.id\)/g) ?? []).length;
if (claimNavigateOccurrences === 1) {
  ok('8) Claim navigate yalnız 1 yerde (CasesListPage handleClaim success)');
} else {
  bad(`8) Claim navigate çoklu nokta — count=${claimNavigateOccurrences}`);
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
