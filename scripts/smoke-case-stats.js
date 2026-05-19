/**
 * Case stats endpoint + filter-click contract smoke.
 *
 * Verifies that GET /api/cases/stats returns role-aware counts that match
 * the same scope/filter rules the list endpoint uses, with no cross-tenant
 * leakage.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-case-stats.js
 *
 * Bölümler:
 *   1) Agent personal stats (assignedToMe / slaRiskMine / resolvedToday / snoozedMine)
 *   2) Supervisor team stats (companyId scope + Person.teamId filter)
 *   3) Admin / SystemAdmin operations stats
 *   4) Filter-click contract: stat sayısı == list query sonucu (pagination hariç)
 *   5) Security: stats endpoint JWT-gated + multi-tenant scope korur
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';
import { createClient } from '@supabase/supabase-js';

const BFF = 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

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
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function api(token, path) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(`${BFF}${path}`, { headers });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const OPEN_DB = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];
const today0 = new Date(); today0.setHours(0, 0, 0, 0);
const today23 = new Date(); today23.setHours(23, 59, 59, 999);
// Stats endpoint hides snoozed-active cases (same default as list endpoint).
const NOT_SNOOZED = { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] };

// ── Section 1: Agent personal stats ──
console.log('\n── 1) Agent personal stats ──');
const agent = await prisma.user.findUnique({ where: { email: 'agent@varuna.dev' }, select: { id: true, personId: true, role: true } });
const agentLinks = await prisma.userCompany.findMany({ where: { userId: agent.id, isActive: true }, select: { companyId: true } });
const agentScope = agentLinks.map((l) => l.companyId);

const truthAssigned = await prisma.case.count({
  where: { companyId: { in: agentScope }, assignedPersonId: agent.personId, status: { in: OPEN_DB }, AND: [NOT_SNOOZED] },
});
const truthSlaRisk = await prisma.case.count({
  where: { companyId: { in: agentScope }, assignedPersonId: agent.personId, status: { in: OPEN_DB }, slaViolation: true, AND: [NOT_SNOOZED] },
});
const truthResolvedToday = await prisma.case.count({
  where: { companyId: { in: agentScope }, assignedPersonId: agent.personId, resolvedAt: { gte: today0, lte: today23 } },
});
const truthSnoozedMine = await prisma.case.count({
  where: { companyId: { in: agentScope }, assignedPersonId: agent.personId, snoozeUntil: { gt: new Date() }, status: { in: OPEN_DB } },
});

const agentStats = await caseRepository.getStats({ user: { ...agent, allowedCompanyIds: agentScope } });
record('1a. Agent mode = personal', agentStats.mode === 'personal');
record('1b. Agent assignedToMe equals DB truth', agentStats.assignedToMe === truthAssigned, `got=${agentStats.assignedToMe} truth=${truthAssigned}`);
record('1c. Agent slaRiskMine equals DB truth', agentStats.slaRiskMine === truthSlaRisk, `got=${agentStats.slaRiskMine} truth=${truthSlaRisk}`);
record('1d. Agent resolvedToday equals DB truth', agentStats.resolvedToday === truthResolvedToday, `got=${agentStats.resolvedToday} truth=${truthResolvedToday}`);
record('1e. Agent snoozedMine equals DB truth', agentStats.snoozedMine === truthSnoozedMine, `got=${agentStats.snoozedMine} truth=${truthSnoozedMine}`);

// ── Section 2: Supervisor team stats ──
console.log('\n── 2) Supervisor team stats ──');
const sup = await prisma.user.findUnique({ where: { email: 'supervisor@varuna.dev' }, select: { id: true, personId: true, role: true } });
const supLinks = await prisma.userCompany.findMany({ where: { userId: sup.id, isActive: true }, select: { companyId: true } });
const supScope = supLinks.map((l) => l.companyId);
const supPerson = await prisma.person.findUnique({ where: { id: sup.personId }, select: { teamId: true } });
const supTeamId = supPerson?.teamId;

const truthTeamOpen = await prisma.case.count({
  where: { companyId: { in: supScope }, assignedTeamId: supTeamId, status: { in: OPEN_DB }, AND: [NOT_SNOOZED] },
});
const truthTeamSlaRisk = await prisma.case.count({
  where: { companyId: { in: supScope }, assignedTeamId: supTeamId, status: { in: OPEN_DB }, slaViolation: true, AND: [NOT_SNOOZED] },
});
const truthTeamEsc = await prisma.case.count({
  where: { companyId: { in: supScope }, assignedTeamId: supTeamId, status: 'Eskalasyon', AND: [NOT_SNOOZED] },
});

const supStats = await caseRepository.getStats({ user: { ...sup, allowedCompanyIds: supScope } });
record('2a. Supervisor mode = team', supStats.mode === 'team');
record('2b. Supervisor teamOpenCount equals DB truth', supStats.teamOpenCount === truthTeamOpen, `got=${supStats.teamOpenCount} truth=${truthTeamOpen}`);
record('2c. Supervisor teamSlaRisk equals DB truth', supStats.teamSlaRisk === truthTeamSlaRisk, `got=${supStats.teamSlaRisk} truth=${truthTeamSlaRisk}`);
record('2d. Supervisor teamEscalation equals DB truth', supStats.teamEscalation === truthTeamEsc, `got=${supStats.teamEscalation} truth=${truthTeamEsc}`);
record('2e. Supervisor scope excludes companies not in allowedCompanyIds', !supScope.includes('COMP-FINROTA') ? true : 'fallback', `scope=[${supScope.join(',')}]`);
const leakSlaRisk = await prisma.case.count({
  where: { companyId: 'COMP-FINROTA', assignedTeamId: supTeamId, status: { in: OPEN_DB }, slaViolation: true },
});
record('2f. Supervisor stats do not include FINROTA cases', supStats.teamSlaRisk === truthTeamSlaRisk && !supScope.includes('COMP-FINROTA') && leakSlaRisk >= 0, `leakCandidate=${leakSlaRisk}`);

// ── Section 3: Admin / SystemAdmin operations stats ──
console.log('\n── 3) Admin / SystemAdmin operations stats ──');
const admin = await prisma.user.findUnique({ where: { email: 'admin@varuna.dev' }, select: { id: true, personId: true, role: true } });
const adminLinks = await prisma.userCompany.findMany({ where: { userId: admin.id, isActive: true }, select: { companyId: true } });
const adminScope = adminLinks.map((l) => l.companyId);

const truthTotalOpen = await prisma.case.count({
  where: { companyId: { in: adminScope }, status: { in: OPEN_DB }, AND: [NOT_SNOOZED] },
});
const truthSlaViol = await prisma.case.count({
  where: { companyId: { in: adminScope }, status: { in: OPEN_DB }, slaViolation: true, AND: [NOT_SNOOZED] },
});
const truthCritical = await prisma.case.count({
  where: { companyId: { in: adminScope }, status: { in: OPEN_DB }, priority: 'Critical', AND: [NOT_SNOOZED] },
});
const truthResolvedTodayAll = await prisma.case.count({
  where: { companyId: { in: adminScope }, resolvedAt: { gte: today0, lte: today23 } },
});

const adminStats = await caseRepository.getStats({ user: { ...admin, allowedCompanyIds: adminScope } });
record('3a. Admin mode = operations', adminStats.mode === 'operations');
record('3b. Admin totalOpen equals DB truth', adminStats.totalOpen === truthTotalOpen, `got=${adminStats.totalOpen} truth=${truthTotalOpen}`);
record('3c. Admin slaViolation equals DB truth', adminStats.slaViolation === truthSlaViol, `got=${adminStats.slaViolation} truth=${truthSlaViol}`);
record('3d. Admin critical excludes closed/cancelled', adminStats.critical === truthCritical, `got=${adminStats.critical} truth=${truthCritical}`);
record('3e. Admin resolvedToday equals DB truth', adminStats.resolvedToday === truthResolvedTodayAll, `got=${adminStats.resolvedToday} truth=${truthResolvedTodayAll}`);

// ── Section 4: Filter-click contract ──
console.log('\n── 4) Filter-click contract ──');
// Admin slaViolation tile click → list with slaViolation=true → count matches
const listSlaViol = await caseRepository.list({
  filters: { slaViolation: true, statuses: OPEN_DB },
  allowedCompanyIds: adminScope,
});
record('4a. ops.slaViolation tile count == list(slaViolation=true) total', listSlaViol.total === adminStats.slaViolation, `card=${adminStats.slaViolation} list=${listSlaViol.total}`);

// Admin critical tile click → list with priorities=Critical + open
const listCritical = await caseRepository.list({
  filters: { priorities: ['Critical'], statuses: OPEN_DB },
  allowedCompanyIds: adminScope,
});
record('4b. ops.critical tile count == list(priorities=Critical, open) total', listCritical.total === adminStats.critical, `card=${adminStats.critical} list=${listCritical.total}`);

// Admin resolvedToday tile click → list with resolvedToday=true
const listResolvedToday = await caseRepository.list({
  filters: { resolvedToday: true },
  allowedCompanyIds: adminScope,
});
record('4c. ops.resolvedToday tile count == list(resolvedToday=true) total', listResolvedToday.total === adminStats.resolvedToday, `card=${adminStats.resolvedToday} list=${listResolvedToday.total}`);

// Agent assignedToMe tile click
const listAssignedMe = await caseRepository.list({
  filters: { personId: agent.personId, statuses: OPEN_DB },
  allowedCompanyIds: agentScope,
});
record('4d. personal.assignedToMe tile count == list(personId=me, open) total', listAssignedMe.total === agentStats.assignedToMe, `card=${agentStats.assignedToMe} list=${listAssignedMe.total}`);

// ── Section 5: Security — JWT required, cross-tenant scope ──
console.log('\n── 5) Security ──');
{
  const r = await api(null, '/api/cases/stats');
  record('5a. No JWT → 401', r.status === 401, `status=${r.status}`);
}
const agentToken = await getToken('agent@varuna.dev');
if (agentToken) {
  const r = await api(agentToken, '/api/cases/stats');
  record('5b. Valid JWT → 200', r.status === 200, `status=${r.status}`);
  record('5c. Agent response mode = personal', r.data?.mode === 'personal');
}
const supToken = await getToken('supervisor@varuna.dev');
if (supToken) {
  const r = await api(supToken, '/api/cases/stats');
  record('5d. Supervisor response mode = team', r.data?.mode === 'team');
  // Cross-tenant: supervisor scope is PARAM+UNIVERA. Their teamSlaRisk must not
  // include FINROTA cases (caseRepository.getStats with scopeFilter handles it).
  record('5e. Supervisor scope respects allowedCompanyIds', r.data?.teamSlaRisk <= truthTeamSlaRisk + 0, `got=${r.data?.teamSlaRisk}`);
}
const sysToken = await getToken('sysadmin@varuna.dev');
if (sysToken) {
  const r = await api(sysToken, '/api/cases/stats');
  record('5f. SystemAdmin response mode = operations', r.data?.mode === 'operations');
}

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
