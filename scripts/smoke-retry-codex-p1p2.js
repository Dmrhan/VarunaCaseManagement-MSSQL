/**
 * smoke-retry-codex-p1p2.js — retry-pending-notifications Codex P1+P2.
 *
 * P1 (Restrict retries): emitEvent per-Pending çağrılırken sadece o
 *     ruleId hedeflensin. Aksi halde case+event'in başka rule'ları
 *     duplicate email atar (idempotency dolduysa).
 *
 * P2 (Keep pending until replacement): emit boş dönerse eski Pending'i
 *     Suppress ETME. Operatör kuyruğundan sinsi kayıp yasak.
 *
 * Test stratejisi: kaynak koddan pattern doğrulama + saf davranış
 * simülasyonu (Prisma/emitEvent mock).
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const repoSrc = read('server/db/notificationRepository.js');
const repoCode = strip(repoSrc);
const scriptSrc = read('scripts/retry-pending-notifications.js');
const scriptCode = strip(scriptSrc);

console.log('── 1) emitEvent — targetRuleId opsiyonu (P1) ──');
expect('1.1 signature targetRuleId parametresi',
  /export async function emitEvent\(\{ event, caseId, approvalContext = null, targetRuleId = null \}\)/.test(repoCode), true);
expect('1.2 findMany where.id = targetRuleId (varsa)',
  /prisma\.notificationRule\.findMany\(\{[\s\S]{0,300}where: \{[\s\S]{0,200}\.\.\.\(targetRuleId \? \{ id: targetRuleId \} : \{\}\)/.test(repoCode), true);

console.log('\n── 2) retry-script — per-dispatch (P1) ──');
expect('2.1 select ruleId snapshot dahil',
  /findMany\(\{[\s\S]{0,600}select: \{[\s\S]{0,400}ruleId: true/.test(scriptCode), true);
expect('2.2 (caseId,event) tekilleştirme YOK — per-dispatch loop',
  /for \(const disp of pendings\)/.test(scriptCode), true);
expect('2.3 emitEvent çağrısı targetRuleId geçirir',
  /emitEvent\(\{[\s\S]{0,200}targetRuleId: disp\.ruleId/.test(scriptCode), true);
expect('2.4 ruleId snapshot yoksa retry SKIP',
  /if \(!disp\.ruleId\)[\s\S]{0,400}kept_no_rule_snapshot/.test(scriptCode), true);

console.log('\n── 3) retry-script — replacement kontrolü (P2) ──');
expect('3.1 emitted.length === 0 → KORU',
  /emittedCount === 0[\s\S]{0,400}kept_no_replacement/.test(scriptCode), true);
expect('3.2 emitted.length === 0 → suppress YOK (continue)',
  /emittedCount === 0[\s\S]{0,400}continue/.test(scriptCode), true);
expect('3.3 emitted >= 1 → updateMany suppress (replacement var)',
  /emittedCount === 0[\s\S]{0,500}updateMany\(\{[\s\S]{0,300}Suppressed[\s\S]{0,200}superseded_by_retry/.test(scriptCode), true);
expect('3.4 suppress where: id + state=Pending (race guard)',
  /updateMany\(\{[\s\S]{0,300}where: \{ id: disp\.id, state: 'Pending' \}/.test(scriptCode), true);

console.log('\n── 4) Davranış simülasyonu (mock emitEvent) ────');

let capturedTargetRuleIds = [];
function fakeEmitEvent({ event, caseId, targetRuleId }) {
  capturedTargetRuleIds.push({ event, caseId, targetRuleId });
  // İki senaryo:
  //  A: ruleId='rule_A' → replacement var, 1 dispatch (Sent)
  //  B: ruleId='rule_gone' → rule kaldırılmış, []
  if (targetRuleId === 'rule_A') return Promise.resolve([{ id: 'new_disp_A', state: 'Sent' }]);
  if (targetRuleId === 'rule_gone') return Promise.resolve([]);
  return Promise.resolve([]);
}

let suppressCalls = [];
const fakePrisma = {
  notificationDispatch: {
    updateMany: ({ where, data }) => {
      suppressCalls.push({ where, data });
      return Promise.resolve({ count: 1 });
    },
  },
};

async function runOne(disp) {
  const emitted = await fakeEmitEvent({
    event: disp.event, caseId: disp.caseId, targetRuleId: disp.ruleId,
  });
  const emittedCount = Array.isArray(emitted) ? emitted.length : 0;
  if (emittedCount === 0) return 'kept_no_replacement';
  const upd = await fakePrisma.notificationDispatch.updateMany({
    where: { id: disp.id, state: 'Pending' },
    data: { state: 'Suppressed', suppressionReason: 'superseded_by_retry' },
  });
  return upd.count > 0 ? 'suppressed_replacement' : 'not_pending';
}

const pending1 = { id: 'disp1', caseId: 'case1', event: 'case_closed', ruleId: 'rule_A' };
const pending2 = { id: 'disp2', caseId: 'case2', event: 'case_closed', ruleId: 'rule_gone' };

const [r1, r2] = await Promise.all([runOne(pending1), runOne(pending2)]);

expect('4.1 rule_A (replacement var) → suppressed_replacement', r1, 'suppressed_replacement');
expect('4.2 rule_gone (replacement yok) → kept_no_replacement', r2, 'kept_no_replacement');
expect('4.3 emitEvent iki kez çağrıldı', capturedTargetRuleIds.length, 2);
expect('4.4 targetRuleId=rule_A', capturedTargetRuleIds[0].targetRuleId, 'rule_A');
expect('4.5 targetRuleId=rule_gone', capturedTargetRuleIds[1].targetRuleId, 'rule_gone');
expect('4.6 suppress sadece rule_A için çağrıldı (1 kez)', suppressCalls.length, 1);
expect('4.7 suppress where id=disp1', suppressCalls[0].where.id, 'disp1');
expect('4.8 suppress where state=Pending', suppressCalls[0].where.state, 'Pending');
expect('4.9 suppression reason superseded_by_retry',
  suppressCalls[0].data.suppressionReason, 'superseded_by_retry');

console.log('\n── 5) Regresyon — 8c38613 fix\'i korundu ────────');
expect('5.1 resolveCustomerCommunication preferChannel signature',
  /export async function resolveCustomerCommunication\(\{ caseRow, preferChannel = null \}\)/.test(repoCode), true);
expect('5.2 emitEvent audience loop\'ta ruleChannel: rule.channel geçiriliyor',
  /resolveAudienceRow\(\{[\s\S]{0,300}ruleChannel: rule\.channel/.test(repoCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
