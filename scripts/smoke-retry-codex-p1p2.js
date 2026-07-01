/**
 * smoke-retry-codex-p1p2.js — retry-pending-notifications Codex P1+P2.
 *
 * P1 round 1 (Restrict retries by rule): emitEvent per-Pending çağrılırken
 *     sadece o ruleId hedeflensin. Aksi halde case+event'in başka rule'ları
 *     duplicate email atar (idempotency dolduysa).
 *
 * P1 round 2 (Group retries per rule, target the original audience):
 *     targetRuleId sadece rule filtreler ama aynı rule'un başka audience
 *     row'ları (ZATEN Sent olmuş assignee/team_lead) yine tetiklenir →
 *     duplicate customer email. Fix: audienceOverride opsiyonu — retry
 *     script rule.audience'ı audienceType üzerinden filtreler ve daraltır.
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

console.log('── 1) emitEvent — targetRuleId + audienceOverride (P1) ──');
expect('1.1 signature targetRuleId + audienceOverride parametreleri',
  /export async function emitEvent\(\{[\s\S]{0,300}targetRuleId = null,[\s\S]{0,100}audienceOverride = null,?[\s\S]{0,50}\}\)/.test(repoCode), true);
expect('1.2 findMany where.id = targetRuleId (varsa)',
  /prisma\.notificationRule\.findMany\(\{[\s\S]{0,300}where: \{[\s\S]{0,200}\.\.\.\(targetRuleId \? \{ id: targetRuleId \} : \{\}\)/.test(repoCode), true);
expect('1.3 iç loop — audienceOverride varsa rule.audience yerine kullan',
  /const audienceRows = \(audienceOverride && rule\.id === targetRuleId\)[\s\S]{0,150}audienceOverride[\s\S]{0,100}rule\.audience/.test(repoCode), true);
expect('1.4 audienceOverride sadece targetRuleId ile eşleşen rule\'a uygulanır',
  /rule\.id === targetRuleId/.test(repoCode), true);

console.log('\n── 2) retry-script — per-dispatch + audience filter (P1) ──');
expect('2.1 select ruleId snapshot dahil',
  /findMany\(\{[\s\S]{0,600}select: \{[\s\S]{0,400}ruleId: true/.test(scriptCode), true);
expect('2.2 (caseId,event) tekilleştirme YOK — per-dispatch loop',
  /for \(const disp of pendings\)/.test(scriptCode), true);
expect('2.3 emitEvent çağrısı targetRuleId geçirir',
  /emitEvent\(\{[\s\S]{0,300}targetRuleId: disp\.ruleId/.test(scriptCode), true);
expect('2.4 ruleId snapshot yoksa retry SKIP',
  /if \(!disp\.ruleId\)[\s\S]{0,400}kept_no_rule_snapshot/.test(scriptCode), true);
expect('2.5 rule fetch — id + isActive + audience select',
  /prisma\.notificationRule\.findUnique\(\{[\s\S]{0,300}select: \{[\s\S]{0,200}audience: true/.test(scriptCode), true);
expect('2.6 rule silinmiş / inactive → KORU',
  /if \(!rule \|\| !rule\.isActive\)[\s\S]{0,400}kept_rule_gone/.test(scriptCode), true);
expect('2.7 audienceOverride — audienceType filter (Codex P1 round 2)',
  /audienceList\.filter\(\(a\) => a\?\.type === disp\.audienceType\)/.test(scriptCode), true);
expect('2.8 audienceOverride boş → audience type gone SKIP',
  /if \(audienceOverride\.length === 0\)[\s\S]{0,400}kept_audience_type_gone/.test(scriptCode), true);
expect('2.9 emitEvent çağrısı audienceOverride geçirir',
  /emitEvent\(\{[\s\S]{0,300}audienceOverride,/.test(scriptCode), true);

console.log('\n── 3) retry-script — replacement kontrolü (P2) ──');
expect('3.1 emitted.length === 0 → KORU',
  /emittedCount === 0[\s\S]{0,400}kept_no_replacement/.test(scriptCode), true);
expect('3.2 emitted.length === 0 → suppress YOK (continue)',
  /emittedCount === 0[\s\S]{0,400}continue/.test(scriptCode), true);
expect('3.3 emitted >= 1 → updateMany suppress (replacement var)',
  /emittedCount === 0[\s\S]{0,500}updateMany\(\{[\s\S]{0,300}Suppressed[\s\S]{0,200}superseded_by_retry/.test(scriptCode), true);
expect('3.4 suppress where: id + state=Pending (race guard)',
  /updateMany\(\{[\s\S]{0,300}where: \{ id: disp\.id, state: 'Pending' \}/.test(scriptCode), true);

console.log('\n── 4) Davranış simülasyonu (mock emitEvent + audienceOverride) ────');

let capturedCalls = [];
function fakeEmitEvent({ event, caseId, targetRuleId, audienceOverride }) {
  capturedCalls.push({ event, caseId, targetRuleId, audienceOverride });
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

// Simüle edilen rule.audience — assignee (Sent olmuş) + customer_primary_contact (Pending)
const fakeRules = {
  rule_A: {
    id: 'rule_A', isActive: true,
    audience: [
      { type: 'assignee' },                    // ← ZATEN Sent, tekrar tetiklenmemeli
      { type: 'customer_primary_contact' },    // ← Pending, retry hedefi
    ],
  },
  rule_gone: {
    id: 'rule_gone', isActive: true,
    audience: [{ type: 'customer_primary_contact' }],
  },
};

async function runOne(disp) {
  const rule = fakeRules[disp.ruleId];
  if (!rule || !rule.isActive) return 'kept_rule_gone';
  const audienceOverride = rule.audience.filter((a) => a?.type === disp.audienceType);
  if (audienceOverride.length === 0) return 'kept_audience_type_gone';

  const emitted = await fakeEmitEvent({
    event: disp.event, caseId: disp.caseId, targetRuleId: disp.ruleId, audienceOverride,
  });
  const emittedCount = Array.isArray(emitted) ? emitted.length : 0;
  if (emittedCount === 0) return 'kept_no_replacement';
  const upd = await fakePrisma.notificationDispatch.updateMany({
    where: { id: disp.id, state: 'Pending' },
    data: { state: 'Suppressed', suppressionReason: 'superseded_by_retry' },
  });
  return upd.count > 0 ? 'suppressed_replacement' : 'not_pending';
}

const pending1 = { id: 'disp1', caseId: 'case1', event: 'case_closed', ruleId: 'rule_A',
  audienceType: 'customer_primary_contact' };
const pending2 = { id: 'disp2', caseId: 'case2', event: 'case_closed', ruleId: 'rule_gone',
  audienceType: 'customer_primary_contact' };
// Ekstra: audienceType artık rule.audience'da yok — kept_audience_type_gone
const pending3 = { id: 'disp3', caseId: 'case3', event: 'case_closed', ruleId: 'rule_A',
  audienceType: 'requester' };

const [r1, r2, r3] = await Promise.all([runOne(pending1), runOne(pending2), runOne(pending3)]);

expect('4.1 rule_A + customer_primary_contact → suppressed_replacement', r1, 'suppressed_replacement');
expect('4.2 rule_gone (emit boş) → kept_no_replacement', r2, 'kept_no_replacement');
expect('4.3 rule_A + audienceType=requester (rule.audience\'da yok) → kept_audience_type_gone',
  r3, 'kept_audience_type_gone');
expect('4.4 emitEvent 2 kez çağrıldı (pending3 audience filter\'da elendi)', capturedCalls.length, 2);
expect('4.5 targetRuleId=rule_A', capturedCalls[0].targetRuleId, 'rule_A');
expect('4.6 audienceOverride SADECE customer_primary_contact (assignee elendi)',
  capturedCalls[0].audienceOverride.length, 1);
expect('4.7 audienceOverride[0].type=customer_primary_contact',
  capturedCalls[0].audienceOverride[0].type, 'customer_primary_contact');
expect('4.8 suppress sadece rule_A için çağrıldı (1 kez)', suppressCalls.length, 1);
expect('4.9 suppress where id=disp1', suppressCalls[0].where.id, 'disp1');
expect('4.10 suppress where state=Pending', suppressCalls[0].where.state, 'Pending');
expect('4.11 suppression reason superseded_by_retry',
  suppressCalls[0].data.suppressionReason, 'superseded_by_retry');

console.log('\n── 5) Regresyon — 8c38613 fix\'i korundu ────────');
expect('5.1 resolveCustomerCommunication preferChannel signature',
  /export async function resolveCustomerCommunication\(\{ caseRow, preferChannel = null \}\)/.test(repoCode), true);
expect('5.2 emitEvent audience loop\'ta ruleChannel: rule.channel geçiriliyor',
  /resolveAudienceRow\(\{[\s\S]{0,300}ruleChannel: rule\.channel/.test(repoCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
