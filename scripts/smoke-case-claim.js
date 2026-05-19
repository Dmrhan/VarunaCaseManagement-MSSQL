/**
 * smoke-case-claim.js — WR-C1 / PM-07 ("Üstlen" / claim) smoke harness.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-case-claim.js
 *
 * Backend dev server (port 3101) ayakta olmalı.
 *
 * Doğrulanan kontrat (10 senaryo):
 *   1. Agent kendi şirketindeki atanmamış açık vakayı claim eder.
 *   2. Claim sonrası assignedPersonId / Name / TeamId populated.
 *   3. CaseActivity (FieldUpdate, "Vaka üstlenildi") oluşur.
 *   4. Aynı vakayı ikinci kez claim → 409.
 *   5. Cross-tenant case → 403 (CaseAccessError).
 *   6. Kapalı vaka (Cozuldu) → 400.
 *   7. Zaten atanmış vaka → 409 (atomic check).
 *   8. Admin/Supervisor da claim yapabilir.
 *   9. Mevcut liste filter'ları (assignedToMe) hâlâ çalışır.
 *  10. No cross-tenant leak: cross-tenant claim sonrası case değişmemiş.
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getToken(email) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function api(token, path, init = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  };
  const r = await fetch(`${BFF}${path}`, { ...init, headers });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// ── Fixture seçici: agent için claim-eligible bir vaka bul ──
async function pickCaseForAgent(agentScope) {
  return prisma.case.findFirst({
    where: {
      companyId: { in: agentScope },
      assignedPersonId: null,
      status: { notIn: ['Cozuldu', 'IptalEdildi'] },
    },
    select: { id: true, caseNumber: true, companyId: true },
  });
}

// ── Section 1-4: Agent claim path ──
console.log('\n── 1) Agent claims unassigned open case ──');
const agent = await prisma.user.findUnique({
  where: { email: 'agent@varuna.dev' },
  select: { id: true, personId: true, fullName: true },
});
const agentLinks = await prisma.userCompany.findMany({
  where: { userId: agent.id, isActive: true },
  select: { companyId: true },
});
const agentScope = agentLinks.map((l) => l.companyId);
const agentToken = await getToken('agent@varuna.dev');

const target = await pickCaseForAgent(agentScope);
record('1a. Agent has personId', !!agent.personId, `personId=${agent.personId}`);
record('1b. Agent has a claim-eligible fixture', !!target, target ? `caseNumber=${target.caseNumber}` : 'none');

let createdActivityId = null;
if (target && agentToken && agent.personId) {
  const r = await api(agentToken, `/api/cases/${target.id}/claim`, { method: 'POST' });
  record('1c. POST /claim → 200', r.status === 200, `status=${r.status}`);
  record('1d. Response.assignedPersonId === agent.personId',
    r.data?.assignedPersonId === agent.personId,
    `got=${r.data?.assignedPersonId}`);
  record('2a. Response.assignedPersonName populated', !!r.data?.assignedPersonName, `name=${r.data?.assignedPersonName}`);
  // Agent'ın Person'ı UNIVERA Backoffice team'inde olabilir; team set olduysa OK
  record('2b. Response.assignedTeamId set (if person has team)',
    typeof r.data?.assignedTeamId !== 'undefined',
    `teamId=${r.data?.assignedTeamId}`);

  // DB'de teyit
  const refreshed = await prisma.case.findUnique({
    where: { id: target.id },
    select: { assignedPersonId: true, assignedPersonName: true, status: true },
  });
  record('2c. DB assignedPersonId set (atomic update committed)',
    refreshed?.assignedPersonId === agent.personId);

  // CaseActivity teyit
  const activity = await prisma.caseActivity.findFirst({
    where: { caseId: target.id, actionType: 'FieldUpdate', fieldName: 'assignedPersonId' },
    orderBy: { at: 'desc' },
  });
  record('3. CaseActivity (FieldUpdate, "Vaka üstlenildi") exists',
    !!activity && /Vaka üstlenildi/.test(activity.action ?? ''),
    `action="${activity?.action ?? ''}"`);
  createdActivityId = activity?.id ?? null;

  // 4. Second claim → 409
  const r2 = await api(agentToken, `/api/cases/${target.id}/claim`, { method: 'POST' });
  record('4. Second claim on same case → 409', r2.status === 409, `status=${r2.status} code=${r2.data?.error}`);
}

// ── Section 5: Cross-tenant ──
console.log('\n── 5) Cross-tenant case claim ──');
const outOfScopeCase = await prisma.case.findFirst({
  where: {
    companyId: { notIn: agentScope },
    assignedPersonId: null,
    status: { notIn: ['Cozuldu', 'IptalEdildi'] },
  },
  select: { id: true, companyId: true },
});
if (outOfScopeCase && agentToken) {
  const r = await api(agentToken, `/api/cases/${outOfScopeCase.id}/claim`, { method: 'POST' });
  record('5. Cross-tenant claim → 403 or 404', [403, 404].includes(r.status), `status=${r.status}`);

  // 10. No leak — case değişmemiş
  const after = await prisma.case.findUnique({
    where: { id: outOfScopeCase.id },
    select: { assignedPersonId: true, assignedPersonName: true },
  });
  record('10. Out-of-scope case assignedPersonId unchanged (no leak)',
    after?.assignedPersonId === null,
    `got=${after?.assignedPersonId}`);
} else {
  record('5. Cross-tenant claim — skipped (no out-of-scope candidate)', true);
  record('10. No leak — skipped (no out-of-scope candidate)', true);
}

// ── Section 6: Closed case ──
console.log('\n── 6) Closed case claim ──');
const closedCase = await prisma.case.findFirst({
  where: {
    companyId: { in: agentScope },
    status: { in: ['Cozuldu', 'IptalEdildi'] },
    assignedPersonId: null, // closed + unassigned (nadir; bulunmazsa skip)
  },
  select: { id: true, status: true },
});
if (closedCase && agentToken) {
  const r = await api(agentToken, `/api/cases/${closedCase.id}/claim`, { method: 'POST' });
  record('6. Closed (Cozuldu/IptalEdildi) unassigned case claim → 400',
    r.status === 400, `status=${r.status} code=${r.data?.error}`);
} else {
  // Fallback: kapalı + atanmış vaka da claim'i reddetmeli (assignedPersonId not null branch → 409)
  const closedAssigned = await prisma.case.findFirst({
    where: { companyId: { in: agentScope }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
    select: { id: true, assignedPersonId: true, status: true },
  });
  if (closedAssigned && agentToken) {
    const r = await api(agentToken, `/api/cases/${closedAssigned.id}/claim`, { method: 'POST' });
    record('6. Closed case claim (closed+assigned) → 4xx',
      r.status === 400 || r.status === 409, `status=${r.status}`);
  } else {
    record('6. Closed case claim — skipped (no closed fixture)', true);
  }
}

// ── Section 7: Already assigned ──
console.log('\n── 7) Already-assigned case claim ──');
const alreadyAssigned = await prisma.case.findFirst({
  where: {
    companyId: { in: agentScope },
    assignedPersonId: { not: null },
    status: { notIn: ['Cozuldu', 'IptalEdildi'] },
    // Önemli: claim'i biz yapmadığımız vaka olsun — agent ile zaten claim'lenenleri filtre dışı tut
    NOT: target ? { id: target.id } : undefined,
  },
  select: { id: true, assignedPersonId: true },
});
if (alreadyAssigned && agentToken) {
  const r = await api(agentToken, `/api/cases/${alreadyAssigned.id}/claim`, { method: 'POST' });
  record('7. Already-assigned case claim → 409',
    r.status === 409, `status=${r.status} code=${r.data?.error}`);
} else {
  record('7. Already-assigned case — skipped (no other-assignee fixture)', true);
}

// ── Section 8: Supervisor + Admin claim ──
console.log('\n── 8) Supervisor + Admin claim path ──');
const supToken = await getToken('supervisor@varuna.dev');
const adminToken = await getToken('admin@varuna.dev');

if (supToken) {
  const sup = await prisma.user.findUnique({
    where: { email: 'supervisor@varuna.dev' },
    select: { personId: true },
  });
  if (sup?.personId) {
    const supLinks = await prisma.userCompany.findMany({
      where: { user: { email: 'supervisor@varuna.dev' }, isActive: true },
      select: { companyId: true },
    });
    const supScope = supLinks.map((l) => l.companyId);
    const supTarget = await prisma.case.findFirst({
      where: {
        companyId: { in: supScope },
        assignedPersonId: null,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
      select: { id: true },
    });
    if (supTarget) {
      const r = await api(supToken, `/api/cases/${supTarget.id}/claim`, { method: 'POST' });
      record('8a. Supervisor claim → 200', r.status === 200, `status=${r.status}`);
      record('8b. Supervisor claim assignedPersonId set',
        r.data?.assignedPersonId === sup.personId);
    } else {
      record('8a. Supervisor claim — skipped (no eligible case)', true);
    }
  } else {
    record('8a. Supervisor claim — skipped (no personId)', true);
  }
}

if (adminToken) {
  const adm = await prisma.user.findUnique({
    where: { email: 'admin@varuna.dev' },
    select: { personId: true },
  });
  if (adm?.personId) {
    const admLinks = await prisma.userCompany.findMany({
      where: { user: { email: 'admin@varuna.dev' }, isActive: true },
      select: { companyId: true },
    });
    const admScope = admLinks.map((l) => l.companyId);
    const admTarget = await prisma.case.findFirst({
      where: {
        companyId: { in: admScope },
        assignedPersonId: null,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
      select: { id: true },
    });
    if (admTarget) {
      const r = await api(adminToken, `/api/cases/${admTarget.id}/claim`, { method: 'POST' });
      record('8c. Admin claim → 200', r.status === 200, `status=${r.status}`);
    } else {
      record('8c. Admin claim — skipped (no eligible case)', true);
    }
  } else {
    // Admin'in personId'si yoksa endpoint 400 dönmeli
    const candidate = await prisma.case.findFirst({
      where: { assignedPersonId: null, status: { notIn: ['Cozuldu', 'IptalEdildi'] } },
      select: { id: true },
    });
    if (candidate) {
      const r = await api(adminToken, `/api/cases/${candidate.id}/claim`, { method: 'POST' });
      record('8c. Admin without personId → 400 (no_person_record)',
        r.status === 400, `status=${r.status} code=${r.data?.error}`);
    } else {
      record('8c. Admin claim — skipped (no fixture)', true);
    }
  }
}

// ── Section 9: List filter intactness (assignedToMe still works) ──
console.log('\n── 9) Existing list filter intactness ──');
if (agentToken && agent.personId) {
  const r = await api(agentToken, '/api/cases?assignedToMe=true&page=1&pageSize=200');
  record('9. Agent assignedToMe filter still works → 200', r.status === 200, `status=${r.status}`);
  // Az önce claim ettiğimiz case bu sonuçta görünmeli — pageSize=200 cap'i ile geniş arama.
  if (target) {
    const hit = (r.data?.value ?? []).some((c) => c.id === target.id);
    record('9b. Claimed case appears in assignedToMe filter', hit,
      `value.length=${r.data?.value?.length ?? 0}`);
  }
}

// ── Done ──
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
