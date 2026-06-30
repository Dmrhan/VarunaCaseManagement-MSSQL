/**
 * smoke-release-codex-round2.js — Codex P2 round 2 rollback gap fix.
 *
 * Bulgu: writeAccount Central downgrade transaction'ı AccountProject.
 * anaFirmaAccountId NULL'lıyor ama job row sadece account before/after
 * tutuyor. rollbackCustomer360 accountProject rollback'inde
 * anaFirmaAccountId restore edilmiyor → bad role import sonrası rollback
 * UNRELATED projeleri sessizce null bırakır.
 *
 * Fix (3 katman):
 *   1. writeAccount: nullify edilen projeleri sideEffects'te döndür
 *      (id + previousAnaFirmaAccountId)
 *   2. Caller (main loop): synthetic importJobRow yarat — entityType
 *      'accountProject' + status 'updated' + beforeJson.anaFirmaAccountId
 *      + matchKey "sideEffect:centralDowngrade:..."
 *   3. rollbackCustomer360: accountProject Updated path'e
 *      anaFirmaAccountId restore satırı ekle
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const engine = read('server/lib/import/customer360CommitEngine.js');
const engineCode = strip(engine);

console.log('── 1) writeAccount sideEffects (nullified projects) ──');
expect('1.1 nullifiedAnaFirmaProjects array tanımlı',
  /let nullifiedAnaFirmaProjects = \[\]/.test(engineCode), true);
expect('1.2 Transaction öncesi findMany ile affected projects capture',
  /isCentralDowngradeImport\)[\s\S]{0,1000}prisma\.accountProject\.findMany\(\{[\s\S]{0,300}where: \{ anaFirmaAccountId: existing\.id \}[\s\S]{0,200}select: \{ id: true, anaFirmaAccountId: true \}/.test(engineCode), true);
expect('1.3 affected → {id, previousAnaFirmaAccountId} map',
  /affected\.map\(\(p\) => \(\{[\s\S]{0,200}id: p\.id,[\s\S]{0,200}previousAnaFirmaAccountId: p\.anaFirmaAccountId/.test(engineCode), true);
expect('1.4 Return shape\'inde sideEffects.nullifiedAnaFirmaProjects',
  /sideEffects: nullifiedAnaFirmaProjects\.length > 0[\s\S]{0,200}\{ nullifiedAnaFirmaProjects \}[\s\S]{0,100}: undefined/.test(engineCode), true);

console.log('\n── 2) Caller synthetic importJobRow ──────────────');
expect('2.1 r.sideEffects?.nullifiedAnaFirmaProjects check',
  /r\.sideEffects\?\.nullifiedAnaFirmaProjects\?\.length\)/.test(engineCode), true);
expect('2.2 prisma.importJobRow.create her etkilenen proje için',
  /for \(const p of r\.sideEffects\.nullifiedAnaFirmaProjects\)[\s\S]{0,300}prisma\.importJobRow\.create\(\{/.test(engineCode), true);
expect('2.3 importJobRow entityType=accountProject + parentRowNumber',
  /entityType: 'accountProject',[\s\S]{0,200}parentRowNumber: row\.rowNumber/.test(engineCode), true);
expect('2.4 beforeJson.anaFirmaAccountId previousValue',
  /beforeJson: \{ anaFirmaAccountId: p\.previousAnaFirmaAccountId \}/.test(engineCode), true);
expect('2.5 afterJson.anaFirmaAccountId = null',
  /afterJson: \{ anaFirmaAccountId: null \}/.test(engineCode), true);
expect('2.6 status=updated (rollback Updated path için)',
  /importJobRow\.create\([\s\S]{0,500}status: 'updated'/.test(engineCode), true);
expect('2.7 matchKey sideEffect:centralDowngrade prefix (audit)',
  /matchKey: `sideEffect:centralDowngrade:\$\{r\.recordId\}`/.test(engineCode), true);

console.log('\n── 3) rollbackCustomer360 accountProject restore ──');
expect('3.1 anaFirmaAccountId restore (Updated path)',
  /entity === 'accountProject'[\s\S]{0,1500}before\.anaFirmaAccountId !== undefined[\s\S]{0,200}restore\.anaFirmaAccountId = before\.anaFirmaAccountId/.test(engineCode), true);

console.log('\n── 4) Davranış simülasyonu — rollback uyumu ────');
// Pseudo: writeAccount Central downgrade üretirse:
//   - 2 proje varsa → 2 synthetic importJobRow
//   - rollbackCustomer360 her birini Updated path'ten restore eder
//   - beforeJson.anaFirmaAccountId artık restore edilir (line 3.1 ile teyit)
function shouldCreateSideEffectRow(sideEffects) {
  return !!sideEffects?.nullifiedAnaFirmaProjects?.length;
}
expect('4.1 Boş sideEffects → row create YAPILMAZ',
  shouldCreateSideEffectRow(undefined), false);
expect('4.2 Empty array → row create YAPILMAZ',
  shouldCreateSideEffectRow({ nullifiedAnaFirmaProjects: [] }), false);
expect('4.3 1+ proje → row create YAPILIR',
  shouldCreateSideEffectRow({ nullifiedAnaFirmaProjects: [{ id: 'p1', previousAnaFirmaAccountId: 'a1' }] }), true);
expect('4.4 sideEffects undefined yerine null check',
  shouldCreateSideEffectRow(null), false);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
