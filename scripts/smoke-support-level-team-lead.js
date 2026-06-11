/**
 * smoke-support-level-team-lead.js — WR-A5 + WR-B1 / PM-03 (Phase 1 foundation).
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-support-level-team-lead.js
 *
 * Backend dev server (port 3101) ayakta olmalı. db:seed + db:seed:auth +
 * seed-full-demo-scenarios.js çalışmış olmalı.
 *
 * 10 senaryo:
 *  1. Schema: SupportLevel enum + Person/Team/Case columns present
 *  2. Seed: en az 1 team lead (Person.isTeamLead=true)
 *  3. Person.supportLevel distribution — L1 + L2 her ikisi mevcut
 *  4. Team.defaultSupportLevel non-null distribution
 *  5. Case create with assignedPersonId → Case.supportLevel = Person.supportLevel
 *  6. Case create with assignedTeamId only → Case.supportLevel = Team.defaultSupportLevel
 *  7. Case create with neither → Case.supportLevel = L1
 *  8. Supervisor PATCH Case.supportLevel → 200
 *  9. Agent PATCH Case.supportLevel → 403 support_level_forbidden
 * 10. Multi-tenant: foreign tenant Case patch attempt → 403/404
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

const STAMP = `smoke-a5-${Date.now()}`;
const createdCaseIds = [];

async function cleanup() {
  try {
    if (createdCaseIds.length) {
      await prisma.case.deleteMany({ where: { id: { in: createdCaseIds } } });
    }
  } catch (e) {
    console.warn('[cleanup]', e?.message);
  }
}

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
const supervisorToken = await getToken('supervisor@varuna.dev');
if (!adminToken) { console.log('SKIP — admin token yok'); await prisma.$disconnect(); process.exit(0); }

// Tenant: UNIVERA (admin has access)
const COMP = 'COMP-UNIVERA';

// ─────────────────────────────────────────────────────────────────
// 1) Schema check
// ─────────────────────────────────────────────────────────────────

console.log('\n── 1) Schema columns + enum ──');
{
  const cols = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE (table_name = 'Person' AND column_name IN ('isTeamLead', 'supportLevel'))
        OR (table_name = 'Team' AND column_name = 'defaultSupportLevel')
        OR (table_name = 'Case' AND column_name = 'supportLevel')
  `);
  const set = new Set((cols ?? []).map((c) => `${c.table_name}.${c.column_name}`));
  const required = ['Person.isTeamLead', 'Person.supportLevel', 'Team.defaultSupportLevel', 'Case.supportLevel'];
  const missing = required.filter((c) => !set.has(c));
  record('1. All four columns present', missing.length === 0, missing.length ? `missing=${missing.join(',')}` : '');
  const enumRows = await prisma.$queryRawUnsafe(`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SupportLevel') ORDER BY enumsortorder`);
  const labels = (enumRows ?? []).map((r) => r.enumlabel);
  record('1b. SupportLevel enum has L1/L2/L3/Expert', JSON.stringify(labels) === JSON.stringify(['L1','L2','L3','Expert']), `labels=${labels.join(',')}`);
}

// ─────────────────────────────────────────────────────────────────
// 2) Seed: team lead var mı
// ─────────────────────────────────────────────────────────────────

console.log('\n── 2) Seed team leads ──');
{
  const n = await prisma.person.count({ where: { isTeamLead: true } });
  record('2. At least 1 team lead', n >= 1, `count=${n}`);
}

// ─────────────────────────────────────────────────────────────────
// 3-4) Distribution
// ─────────────────────────────────────────────────────────────────

console.log('\n── 3-4) Distribution ──');
{
  const l1 = await prisma.person.count({ where: { supportLevel: 'L1' } });
  const l2 = await prisma.person.count({ where: { supportLevel: 'L2' } });
  record('3. Person.supportLevel has L1 + L2 both', l1 > 0 && l2 > 0, `L1=${l1} L2=${l2}`);

  const tL1 = await prisma.team.count({ where: { defaultSupportLevel: 'L1' } });
  record('4. Team.defaultSupportLevel non-null (L1 set)', tL1 > 0, `L1 teams=${tL1}`);
}

// ─────────────────────────────────────────────────────────────────
// 5) Case create with assignedPersonId → person.supportLevel
// ─────────────────────────────────────────────────────────────────

console.log('\n── 5) Case create cascade: person.supportLevel ──');
{
  // L2 person bul
  const l2Person = await prisma.person.findFirst({ where: { supportLevel: 'L2' }, include: { team: true } });
  if (!l2Person) {
    record('5. find L2 person', false, 'no L2 person in DB');
  } else {
    const r = await api(adminToken, '/api/cases', {
      method: 'POST',
      body: JSON.stringify({
        title: `${STAMP} 5-cascade-person`,
        description: 'cascade from person',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: COMP,
        companyName: 'UNIVERA',
        category: 'Yazılım',
        subCategory: 'Mobil App',
        requestType: 'Şikayet',
        assignedTeamId: l2Person.teamId ?? undefined,
        assignedTeamName: l2Person.team?.name,
        assignedPersonId: l2Person.id,
        assignedPersonName: l2Person.name,
      }),
    });
    const ok = r.status === 201 && r.data?.supportLevel === 'L2';
    record('5. Person.supportLevel=L2 → Case.supportLevel=L2', ok, `status=${r.status} supportLevel=${r.data?.supportLevel}`);
    if (r.data?.id) createdCaseIds.push(r.data.id);
  }
}

// ─────────────────────────────────────────────────────────────────
// 6) Case create with assignedTeamId only → team.defaultSupportLevel
// ─────────────────────────────────────────────────────────────────

console.log('\n── 6) Case create cascade: team.defaultSupportLevel ──');
{
  // Demo seed'de bazı şirketlerde takım olmayabilir; herhangi bir aktif takım
  // bulup defaultSupportLevel'i geçici olarak L3'e set ederiz (deterministic).
  const team = await prisma.team.findFirst({
    where: { isActive: true },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!team) {
    record('6. find any active team', false, 'no teams in DB');
  } else {
    const prevLevel = team.defaultSupportLevel;
    await prisma.team.update({ where: { id: team.id }, data: { defaultSupportLevel: 'L3' } });
    const r = await api(adminToken, '/api/cases', {
      method: 'POST',
      body: JSON.stringify({
        title: `${STAMP} 6-cascade-team`,
        description: 'cascade from team default',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: team.companyId,
        companyName: team.company?.name ?? team.companyId,
        category: 'Yazılım',
        subCategory: 'Mobil App',
        requestType: 'Şikayet',
        assignedTeamId: team.id,
        assignedTeamName: team.name,
        // NO assignedPersonId
      }),
    });
    const ok = r.status === 201 && r.data?.supportLevel === 'L3';
    record('6. Team default L3 → Case.supportLevel=L3', ok, `status=${r.status} supportLevel=${r.data?.supportLevel}`);
    if (r.data?.id) createdCaseIds.push(r.data.id);
    // Restore team defaultSupportLevel (whatever it was before; default L1).
    await prisma.team.update({ where: { id: team.id }, data: { defaultSupportLevel: prevLevel ?? 'L1' } });
  }
}

// ─────────────────────────────────────────────────────────────────
// 7) Case create with neither → L1
// ─────────────────────────────────────────────────────────────────

console.log('\n── 7) Case create cascade: default L1 ──');
{
  const r = await api(adminToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      title: `${STAMP} 7-default-l1`,
      description: 'no assignment',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: COMP,
      companyName: 'UNIVERA',
      category: 'Yazılım',
      subCategory: 'Mobil App',
      requestType: 'Şikayet',
      // NO assigned*Id
    }),
  });
  const ok = r.status === 201 && r.data?.supportLevel === 'L1';
  record('7. No assignment → Case.supportLevel=L1', ok, `status=${r.status} supportLevel=${r.data?.supportLevel}`);
  if (r.data?.id) createdCaseIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 8) Supervisor PATCH supportLevel → 200
// ─────────────────────────────────────────────────────────────────

console.log('\n── 8) Supervisor PATCH supportLevel ──');
{
  // Baseline case (L1) yarat + supervisor ile L2'ye patch et
  const c = await api(adminToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      title: `${STAMP} 8-patch-baseline`,
      description: 'patch baseline',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: COMP,
      companyName: 'UNIVERA',
      category: 'Yazılım',
      subCategory: 'Mobil App',
      requestType: 'Şikayet',
    }),
  });
  if (c.data?.id) createdCaseIds.push(c.data.id);
  if (supervisorToken && c.data?.id) {
    const r = await api(supervisorToken, `/api/cases/${c.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ supportLevel: 'L2' }),
    });
    const row = await prisma.case.findUnique({ where: { id: c.data.id }, select: { supportLevel: true } });
    record('8. Supervisor PATCH L2 → 200 + DB updated', r.status === 200 && row?.supportLevel === 'L2', `status=${r.status} supportLevel=${row?.supportLevel}`);
  } else {
    record('8. Supervisor PATCH supportLevel', false, 'no supervisor token or baseline case');
  }
}

// ─────────────────────────────────────────────────────────────────
// 9) Agent PATCH supportLevel → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 9) Agent PATCH supportLevel → 403 ──');
{
  // Use any existing UNIVERA case (we just created several above).
  const c = createdCaseIds[createdCaseIds.length - 1];
  if (agentToken && c) {
    const r = await api(agentToken, `/api/cases/${c}`, {
      method: 'PATCH',
      body: JSON.stringify({ supportLevel: 'L3' }),
    });
    const ok = r.status === 403 && r.data?.error === 'support_level_forbidden';
    record('9. Agent PATCH supportLevel → 403 support_level_forbidden', ok, `status=${r.status} error=${r.data?.error}`);
  } else {
    record('9. Agent PATCH supportLevel', false, 'no agent token or baseline case');
  }
}

// ─────────────────────────────────────────────────────────────────
// 10) Multi-tenant scope guard
// ─────────────────────────────────────────────────────────────────

console.log('\n── 10) Multi-tenant scope ──');
{
  // Agent (her şirkete üye demo) bir UNIVERA case'ini patch etmek isterse
  // role gate önce çalışır (403 support_level_forbidden). Bu test sadece
  // company-scope NOT IN allowedCompanyIds için anlamlı. CSM (PARAM-only)
  // ile UNIVERA case PATCH et — Beklenen: 403 forbidden (scope guard) veya
  // 403 support_level_forbidden (CSM yetkili ama scope dışı). caseRepository
  // assertCaseInScope null döner → route 404 verir.
  const csmToken = await getToken('csm@varuna.dev');
  const c = createdCaseIds[0];
  if (csmToken && c) {
    const r = await api(csmToken, `/api/cases/${c}`, {
      method: 'PATCH',
      body: JSON.stringify({ supportLevel: 'L2' }),
    });
    // CSM is PARAM-only per seed. UNIVERA case → assertCaseInScope returns null → 404.
    const ok = r.status === 404 || r.status === 403;
    record('10. CSM (PARAM-only) → UNIVERA case PATCH → 403/404', ok, `status=${r.status}`);
  } else {
    record('10. CSM scope guard', false, 'no csm token or baseline case');
  }
}

// ─────────────────────────────────────────────────────────────────
// 11-15) Codex review fix — team lead requires effective teamId
// ─────────────────────────────────────────────────────────────────

console.log('\n── 11-15) Team lead invariant: requires effective teamId ──');

const sysadminToken = await getToken('sysadmin@varuna.dev');
const createdPersonIds = [];
const teamForFix = await prisma.team.findFirst({ where: { isActive: true } });

if (!sysadminToken) {
  record('11-15. team lead invariant suite', false, 'sysadmin token unavailable');
} else if (!teamForFix) {
  record('11-15. team lead invariant suite', false, 'no active team in DB');
} else {
  // 11) POST /api/admin/persons with isTeamLead=true + no teamId → 400
  {
    const r = await api(sysadminToken, '/api/admin/persons', {
      method: 'POST',
      body: JSON.stringify({
        name: `${STAMP} 11 no-team-lead`,
        isActive: true,
        isTeamLead: true,
        // NO teamId
      }),
    });
    const ok = r.status === 400 && r.data?.error === 'team_lead_requires_team';
    record('11. Create isTeamLead=true + no teamId → 400 team_lead_requires_team', ok, `status=${r.status} error=${r.data?.error}`);
    if (r.data?.id) createdPersonIds.push(r.data.id);
  }

  // Baseline: create a person WITH team, no lead — anchor for tests 12-15.
  let baselinePerson = null;
  {
    const r = await api(sysadminToken, '/api/admin/persons', {
      method: 'POST',
      body: JSON.stringify({
        name: `${STAMP} 12-15 baseline`,
        isActive: true,
        teamId: teamForFix.id,
        isTeamLead: false,
        supportLevel: 'L1',
      }),
    });
    if (r.status === 201 && r.data?.id) {
      baselinePerson = r.data;
      createdPersonIds.push(r.data.id);
    } else {
      record('11-15. baseline create', false, `status=${r.status} error=${r.data?.error}`);
    }
  }

  // 12) PATCH teamId=null + isTeamLead=true → 400
  if (baselinePerson) {
    const r = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ teamId: null, isTeamLead: true }),
    });
    const ok = r.status === 400 && r.data?.error === 'team_lead_requires_team';
    record('12. PATCH teamId=null + isTeamLead=true → 400 team_lead_requires_team', ok, `status=${r.status} error=${r.data?.error}`);
  }

  // 13) Promote baseline to lead (valid), then PATCH only teamId=null → 400.
  let leadPerson = null;
  if (baselinePerson) {
    const promote = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isTeamLead: true }),
    });
    if (promote.status === 200) {
      leadPerson = promote.data;
      const r = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId: null }),
      });
      const ok = r.status === 400 && r.data?.error === 'team_lead_requires_team';
      record('13. Existing lead PATCH teamId=null only → 400 (effective lead remains true)', ok, `status=${r.status} error=${r.data?.error}`);
    } else {
      record('13. Promote to lead', false, `status=${promote.status} error=${promote.data?.error}`);
    }
  }

  // 14) PATCH valid teamId + isTeamLead=true → 200.
  if (baselinePerson) {
    const r = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ teamId: teamForFix.id, isTeamLead: true }),
    });
    const ok = r.status === 200 && r.data?.isTeamLead === true && r.data?.teamId === teamForFix.id;
    record('14. PATCH valid teamId + isTeamLead=true → 200', ok, `status=${r.status} teamId=${r.data?.teamId} isTeamLead=${r.data?.isTeamLead}`);
  }

  // 15) Demote then clear teamId → 200 (both ops valid in sequence).
  if (baselinePerson && leadPerson) {
    const demote = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isTeamLead: false }),
    });
    if (demote.status !== 200) {
      record('15. Demote step', false, `status=${demote.status} error=${demote.data?.error}`);
    } else {
      const r = await api(sysadminToken, `/api/admin/persons/${baselinePerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId: null }),
      });
      const ok = r.status === 200 && r.data?.teamId === null && r.data?.isTeamLead === false;
      record('15. After demote, PATCH teamId=null → 200 (no lead)', ok, `status=${r.status} teamId=${r.data?.teamId} isTeamLead=${r.data?.isTeamLead}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Summary + cleanup
// ─────────────────────────────────────────────────────────────────

// Cleanup any persons created by this run (cases not assigned to them since
// we never reference them; safe to hard delete).
async function cleanupPersons() {
  try {
    if (createdPersonIds.length) {
      await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
    }
  } catch (e) {
    console.warn('[cleanup persons]', e?.message);
  }
}
await cleanupPersons();

await cleanup();
await prisma.$disconnect();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Sonuç: ${passed} ✓ / ${failed} ✗`);
if (failed > 0) {
  console.log('Başarısız:');
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name} — ${r.detail}`));
  process.exit(1);
}
process.exit(0);
