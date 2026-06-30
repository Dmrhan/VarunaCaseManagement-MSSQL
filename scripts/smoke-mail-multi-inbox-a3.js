/**
 * smoke-mail-multi-inbox-a3.js — Multi-Inbox A3 (intake routing).
 *
 * KAPSAM (static / DB-bağımsız):
 *   - inboundMailIntake.js inboxId parametresi alıyor (signature)
 *   - externalMailInboxRepo + prisma import edildi (routing lookup için)
 *   - newCaseInput'a assignedTeamId + assignedTeamName eklenmiş
 *   - Defense-in-depth: Team.companyId === companyId + isActive kontrolü
 *   - Routing fail → vakayı engellemez (try/catch log)
 *
 * KAPSAM DIŞI (A4 sonrası integration smoke):
 *   - Gerçek inbox + Team seed → mail simülasyonu → vaka assignedTeamId
 *     doğru mu DB-level verify
 *   - Cross-tenant inbox routing (Team başka companyId → null'a düşer mi)
 *   - Inaktif team → null'a düşer mi
 *
 * Çalıştır:
 *   node scripts/smoke-mail-multi-inbox-a3.js
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

const src = read('server/lib/inboundMailIntake.js');
const code = strip(src);

console.log('── 1) Import + signature ──────────────────────');
expect('1.1 externalMailInboxRepo import',
  /import \{ externalMailInboxRepo \} from '\.\.\/db\/externalMailInboxRepository\.js'/.test(code), true);
expect('1.2 prisma import (Team lookup için)',
  /import \{ prisma \} from '\.\.\/db\/client\.js'/.test(code), true);
expect('1.3 intakeInboundEmail signature inboxId opsiyonel',
  /export async function intakeInboundEmail\(\{[\s\S]{0,500}inboxId\s*=\s*null/.test(code), true);

console.log('\n── 2) Inbox lookup + Team resolve ─────────────');
expect('2.1 inboxId truthy ise repo.findById çağrısı',
  /if \(inboxId\)[\s\S]{0,200}externalMailInboxRepo\.findById\(companyId, inboxId\)/.test(code), true);
expect('2.2 inbox.assignedTeamId varsa prisma.team.findUnique',
  /inbox\.assignedTeamId[\s\S]{0,200}prisma\.team\.findUnique/.test(code), true);

console.log('\n── 3) Defense-in-depth guard\'lar ─────────────');
expect('3.1 team.companyId === companyId (cross-tenant koruma)',
  /team\.companyId === companyId/.test(code), true);
expect('3.2 team.isActive kontrolü',
  /team\.isActive/.test(code), true);
expect('3.3 routing fail vakayı engellemez (try/catch + log)',
  /catch \(err\)[\s\S]{0,300}\[intake\] inbox routing lookup fail/.test(code), true);

console.log('\n── 4) caseRepository.create input shape ───────');
expect('4.1 assignedTeamId newCaseInput\'a eklendi',
  /newCaseInput[\s\S]{0,1500}assignedTeamId:\s*routedTeamId/.test(code), true);
expect('4.2 assignedTeamName newCaseInput\'a eklendi',
  /newCaseInput[\s\S]{0,1500}assignedTeamName:\s*routedTeamName/.test(code), true);
expect('4.3 Routing default null (havuz pattern; PersonId YOK)',
  /let routedTeamId = null/.test(code) && /let routedTeamName = null/.test(code), true);
expect('4.4 assignedPersonId YOK (havuz; A3 karar)',
  !/newCaseInput[\s\S]{0,1500}assignedPersonId:/.test(code), true);

console.log('\n── 5) Backward compat ─────────────────────────');
expect('5.1 inboxId default null (eski caller\'lar etkilenmez)',
  /inboxId\s*=\s*null/.test(code), true);
expect('5.2 inboxId null/undefined ise inbox lookup atlanır',
  /if \(inboxId\)/.test(code), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
