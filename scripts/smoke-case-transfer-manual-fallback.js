/**
 * smoke-case-transfer-manual-fallback.js — Transfer manuel fallback regression.
 *
 * Bağlam: TransferModal AI suggestion fail olduğunda manuel takım/kişi seçimi
 * çalışmalı. Backend ve seed bu akışı destekliyor mu doğrula.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-case-transfer-manual-fallback.js
 *
 * Senaryolar (HTTP endpoint hits — UI/AI service'ten bağımsız):
 *  0. Seed kontrolü — UNIVERA & FINROTA en az 2 aktif takım sahibi.
 *  1. Team-only transfer (toPersonId boş) → 200 + assignedTeam değişti, person null.
 *  2. Team + person transfer (kişi takıma ait) → 200 + assignedTeam ve person değişti.
 *  3. Cross-tenant target team → 400 invalid_team (case UNIVERA, hedef PARAM team).
 *  4. Person başka takımdan → 400 invalid_person.
 *  5. Same team (no-op) → 400 same_team.
 *  6. Reason eksik → 400 invalid_input.
 *  7. CaseTransfer + CaseActivity kayıt oluştu mu (audit trail).
 *
 * AI suggestion bu smoke'da DEVRE DIŞI — manuel akışın AI'dan bağımsız
 * çalıştığını gösterir.
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getToken(email) {
  // Faz 5 — local auth: BFF /api/auth/login (Supabase token akışı kaldırıldı)
  const authBase = process.env.BFF_URL || process.env.BASE_URL || 'http://localhost:3101';
  const r = await fetch(`${authBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: TEST_PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  return j.accessToken || null;
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

const adminToken = await getToken('admin@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_UNI = 'COMP-UNIVERA';
const COMP_PAR = 'COMP-PARAM';

// ─────────────────────────────────────────────────────────────────
// 0) Seed kontrolü — UNIVERA & FINROTA en az 2 aktif takım sahibi.
// (Bu fix öncesi 0 idi → TransferModal "Aktarılacak Takım" boş kalıyordu.)
// ─────────────────────────────────────────────────────────────────
console.log('\n── 0) Seed coverage — UNIVERA & FINROTA teams ──');
{
  const uniCount = await prisma.team.count({ where: { companyId: COMP_UNI, isActive: true } });
  const finCount = await prisma.team.count({ where: { companyId: 'COMP-FINROTA', isActive: true } });
  record(
    '0a. UNIVERA aktif takım ≥ 2',
    uniCount >= 2,
    `count=${uniCount}`,
  );
  record(
    '0b. FINROTA aktif takım ≥ 2',
    finCount >= 2,
    `count=${finCount}`,
  );
}

// Test verisi hazırla — UNIVERA case + 2 UNIVERA team (kaynak + hedef) + bir UNIVERA person hedef takımda.
async function pickEntities() {
  const uniTeams = await prisma.team.findMany({
    where: { companyId: COMP_UNI, isActive: true },
    orderBy: { name: 'asc' },
    take: 4,
  });
  if (uniTeams.length < 2) return null;
  const sourceTeam = uniTeams[0];
  const targetTeam = uniTeams[1];

  // hedef takımda aktif person
  const targetPerson = await prisma.person.findFirst({
    where: { teamId: targetTeam.id, isActive: true },
  });

  // başka tenantta person (cross-tenant person reject testi için)
  const farPerson = await prisma.person.findFirst({
    where: { team: { companyId: COMP_PAR }, isActive: true },
  });

  // PARAM team (cross-tenant team reject testi)
  const parTeam = await prisma.team.findFirst({
    where: { companyId: COMP_PAR, isActive: true },
  });

  return { sourceTeam, targetTeam, targetPerson, parTeam, farPerson };
}

const ents = await pickEntities();
if (!ents) {
  console.log('SKIP — UNIVERA seed teams missing; reseed required.');
  await prisma.$disconnect();
  process.exit(0);
}

// Her test için yeni vaka oluştur (transferCount, audit kayıtları temiz).
async function createUniCase(token, suffix) {
  const r = await api(token, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      title: `SMOKE-XFER-${suffix}`,
      description: 'Transfer smoke vakası',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: COMP_UNI,
      companyName: 'UNIVERA',
      category: 'Genel',
      subCategory: 'Diğer',
      requestType: 'Talep',
      assignedTeamId: ents.sourceTeam.id,
      assignedTeamName: ents.sourceTeam.name,
    }),
  });
  if (r.status !== 201) {
    console.log('   case create failed', r.status, r.data);
    return null;
  }
  return r.data;
}

const createdCaseIds = [];

// ─────────────────────────────────────────────────────────────────
// 1) Team-only transfer (toPersonId boş) → 200, assignedPersonId null
// ─────────────────────────────────────────────────────────────────
console.log('\n── 1) Team-only transfer (no person) ──');
{
  const c = await createUniCase(adminToken, 'T1');
  if (c) {
    createdCaseIds.push(c.id);
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.targetTeam.id,
        // toPersonId yok → team-only
        reason: 'Manuel takım ataması — uzmanlık',
        reasonCode: 'expertise',
      }),
    });
    const after = await prisma.case.findUnique({
      where: { id: c.id },
      select: { assignedTeamId: true, assignedPersonId: true, transferCount: true },
    });
    const ok =
      r.status === 200 &&
      after?.assignedTeamId === ents.targetTeam.id &&
      after?.assignedPersonId === null &&
      after?.transferCount === 1;
    record(
      '1. team-only transfer → 200 + assignedPersonId null',
      ok,
      `status=${r.status} team=${after?.assignedTeamId === ents.targetTeam.id} person=${after?.assignedPersonId} count=${after?.transferCount}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 2) Team + person transfer (kişi takıma ait) → 200
// ─────────────────────────────────────────────────────────────────
console.log('\n── 2) Team + person transfer ──');
if (ents.targetPerson) {
  const c = await createUniCase(adminToken, 'T2');
  if (c) {
    createdCaseIds.push(c.id);
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.targetTeam.id,
        toPersonId: ents.targetPerson.id,
        reason: 'Manuel takım + kişi ataması',
        reasonCode: 'expertise',
      }),
    });
    const after = await prisma.case.findUnique({
      where: { id: c.id },
      select: { assignedTeamId: true, assignedPersonId: true },
    });
    const ok =
      r.status === 200 &&
      after?.assignedTeamId === ents.targetTeam.id &&
      after?.assignedPersonId === ents.targetPerson.id;
    record(
      '2. team+person transfer → 200',
      ok,
      `status=${r.status} team=${after?.assignedTeamId} person=${after?.assignedPersonId}`,
    );
  }
} else {
  record('2. team+person transfer', false, 'no target person available');
}

// ─────────────────────────────────────────────────────────────────
// 3) Cross-tenant target team → 400 invalid_team
// ─────────────────────────────────────────────────────────────────
console.log('\n── 3) Cross-tenant team → 400 ──');
if (ents.parTeam) {
  const c = await createUniCase(adminToken, 'T3');
  if (c) {
    createdCaseIds.push(c.id);
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.parTeam.id, // PARAM team, case UNIVERA
        reason: 'Cross-tenant deneme',
        reasonCode: 'other',
      }),
    });
    record(
      '3. cross-tenant team → 400 invalid_team',
      r.status === 400 && r.data?.error === 'invalid_team',
      `status=${r.status} code=${r.data?.error}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 4) Person başka takımdan → 400 invalid_person
// ─────────────────────────────────────────────────────────────────
console.log('\n── 4) Person not in target team → 400 ──');
if (ents.farPerson) {
  const c = await createUniCase(adminToken, 'T4');
  if (c) {
    createdCaseIds.push(c.id);
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.targetTeam.id,
        toPersonId: ents.farPerson.id, // PARAM person
        reason: 'Yanlış kişi',
        reasonCode: 'other',
      }),
    });
    record(
      '4. person not in team → 400 invalid_person',
      r.status === 400 && r.data?.error === 'invalid_person',
      `status=${r.status} code=${r.data?.error}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 5) Same team (no-op) → 400 same_team
// ─────────────────────────────────────────────────────────────────
console.log('\n── 5) Same team → 400 same_team ──');
{
  const c = await createUniCase(adminToken, 'T5');
  if (c) {
    createdCaseIds.push(c.id);
    // case sourceTeam'e atanmış zaten; aynı takıma transfer denemesi
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.sourceTeam.id,
        reason: 'Aynı takım denemesi',
        reasonCode: 'other',
      }),
    });
    record(
      '5. same team → 400 same_team',
      r.status === 400 && r.data?.error === 'same_team',
      `status=${r.status} code=${r.data?.error}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 6) Reason eksik → 400 invalid_input
// ─────────────────────────────────────────────────────────────────
console.log('\n── 6) Missing reason → 400 invalid_input ──');
{
  const c = await createUniCase(adminToken, 'T6');
  if (c) {
    createdCaseIds.push(c.id);
    const r = await api(adminToken, `/api/cases/${c.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        toTeamId: ents.targetTeam.id,
        // reason yok
      }),
    });
    record(
      '6. missing reason → 400 invalid_input',
      r.status === 400 && r.data?.error === 'invalid_input',
      `status=${r.status} code=${r.data?.error}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 7) Audit trail — CaseTransfer + CaseActivity oluştu mu (test 1 case'i)
// ─────────────────────────────────────────────────────────────────
console.log('\n── 7) Audit trail ──');
if (createdCaseIds.length > 0) {
  const caseId = createdCaseIds[0];
  const transferCount = await prisma.caseTransfer.count({ where: { caseId } });
  const activityCount = await prisma.caseActivity.count({
    where: { caseId, actionType: 'Transfer' },
  });
  record(
    '7. CaseTransfer + CaseActivity created',
    transferCount === 1 && activityCount === 1,
    `transfer=${transferCount} activity=${activityCount}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────
try {
  if (createdCaseIds.length) {
    await prisma.case.deleteMany({ where: { id: { in: createdCaseIds } } });
  }
} catch (e) {
  console.warn('[cleanup]', e?.message);
}

await prisma.$disconnect();

const failures = results.filter((r) => !r.ok);
console.log(`\nResults: ${results.length - failures.length}/${results.length} ok`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
