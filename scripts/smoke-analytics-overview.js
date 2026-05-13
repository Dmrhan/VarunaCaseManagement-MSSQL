/**
 * Manuel smoke — POST /api/analytics/cases/overview aggregator'i HTTP olmadan
 * canlandirir. 4 demo persona (Agent/Supervisor/Admin/SystemAdmin) ile scope
 * dogru calisi mi diye karsilastirir.
 *
 * Calistir: `node --env-file=.env scripts/smoke-analytics-overview.js`
 *
 * HTTP smoke degildir — route handler'in yazdigi MetricQueryAudit row'larini
 * test etmez. Audit yazimi UI/curl HTTP testinde gozlemlenir.
 *
 * docs/OPERATIONS_DASHBOARD_DESIGN.md §2.2A scope kurallarini dogrular.
 */

import { prisma } from '../server/db/client.js';
import { computeOperationsOverview } from '../server/analytics/operationsAggregator.js';
import { deriveAnalyticsScope, describeScope } from '../server/analytics/scopeDerivation.js';

const PERIOD_DAYS = 30;

async function loadDemoUsers() {
  const rows = await prisma.user.findMany({
    where: { email: { endsWith: '@varuna.dev' } },
    select: { id: true, email: true, role: true, personId: true, companies: { select: { companyId: true } } },
  });
  const map = {};
  for (const u of rows) {
    map[u.role] = {
      id: u.id,
      email: u.email,
      role: u.role,
      personId: u.personId,
      allowedCompanyIds:
        u.role === 'SystemAdmin'
          ? null // verifyJwt buna ozel: tum aktif sirketler
          : u.companies.map((c) => c.companyId),
    };
  }
  // SystemAdmin icin tum aktif sirketleri doldur (verifyJwt davranisi)
  if (map.SystemAdmin) {
    const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
    map.SystemAdmin.allowedCompanyIds = all.map((c) => c.id);
  }
  return map;
}

function buildFilters() {
  const to = new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    productGroups: null,
    caseTypes: null,
    statuses: null,
    granularity: 'day',
  };
}

async function runForRole(user, body = {}) {
  const filters = { ...buildFilters(), ...body };
  const scope = deriveAnalyticsScope(user, body);
  const t0 = Date.now();
  const payload = await computeOperationsOverview({ scope, filters });
  return {
    role: user.role,
    scope,
    durationMs: Date.now() - t0,
    payload,
  };
}

function summarize(result) {
  const { role, scope, durationMs, payload } = result;
  const total = payload.kpis.totalCases.value;
  const open = payload.kpis.openCases.value;
  const byCompany = payload.byCompany;
  const byCompanyHidden = byCompany == null;
  return {
    role,
    scopeKind: scope.scopeKind,
    canCrossCompanyAgg: scope.canCrossCompanyAgg,
    companies: scope.companyIds,
    teamIds: scope.teamIds,
    personIds: scope.personIds,
    narrowedFromBody: scope.narrowedFromBody,
    totalCases: total,
    openCases: open,
    byCompanyHidden,
    byCompanyCount: byCompany ? byCompany.length : 0,
    durationMs,
  };
}

async function main() {
  const users = await loadDemoUsers();
  if (!users.Agent || !users.Supervisor || !users.Admin || !users.SystemAdmin) {
    console.error('Eksik demo persona. `npm run db:seed:auth` calistirildigindan emin ol.');
    process.exit(1);
  }

  console.log(`=== Multi-role HTTP-less smoke (last ${PERIOD_DAYS} days) ===\n`);

  // Test 1: Her rol, body filter yok
  console.log('--- Default scope (body filter yok) ---');
  for (const role of ['Agent', 'Supervisor', 'Admin', 'SystemAdmin']) {
    const result = await runForRole(users[role], {});
    const s = summarize(result);
    console.log(
      `${role.padEnd(13)} kind=${s.scopeKind.padEnd(14)} ` +
        `companies=${s.companies.length} ` +
        `total=${String(s.totalCases).padStart(4)} open=${String(s.openCases).padStart(3)} ` +
        `byCompany=${s.byCompanyHidden ? 'HIDDEN' : String(s.byCompanyCount)} ` +
        `(${s.durationMs}ms)`,
    );
  }

  // Test 2: Cross-tenant attack — Admin (PARAM+UNIVERA+FINROTA olmayan) bir sirket isteyince
  // FINROTA Admin'in elinde — burada Supervisor PARAM+UNIVERA. UNIVERA harici sirket istesin.
  console.log('\n--- Tenant isolation: Supervisor body.companies=[FINROTA] (yetkisiz) ---');
  const supRes = await runForRole(users.Supervisor, { companies: ['COMP-FINROTA'] });
  const supSum = summarize(supRes);
  console.log(
    `Supervisor body istek=[FINROTA] -> companies=${JSON.stringify(supSum.companies)} ` +
      `narrowedFromBody=${supSum.narrowedFromBody} (beklenen: bos liste + narrow=true)`,
  );

  // Test 3: Body filter ile dahili daraltma
  console.log('\n--- Body filter daraltma: Admin body.companies=[PARAM] ---');
  const adminRes = await runForRole(users.Admin, { companies: ['COMP-PARAM'] });
  const adminSum = summarize(adminRes);
  console.log(
    `Admin body istek=[PARAM] -> companies=${JSON.stringify(adminSum.companies)} ` +
      `narrowedFromBody=${adminSum.narrowedFromBody} ` +
      `(beklenen: [PARAM] + narrow=false; tum 3 sirkete sahip ama daraltti)`,
  );

  // Test 4: SystemAdmin cross-company default
  console.log('\n--- SystemAdmin cross-company breakdown ---');
  const saRes = await runForRole(users.SystemAdmin, {});
  const saSum = summarize(saRes);
  console.log(
    `SystemAdmin -> companies=${saSum.companies.length} byCompany=${saSum.byCompanyCount} (beklenen: dolu)`,
  );
  if (saRes.payload.byCompany) {
    console.log(`  Sirketler: ${saRes.payload.byCompany.map((c) => `${c.name}:${c.count}`).join(', ')}`);
  }

  // Test 5: Agent self scope — personIds dolu mu?
  console.log('\n--- Agent self scope dogrulamasi ---');
  const agentRes = await runForRole(users.Agent, {});
  const agentSum = summarize(agentRes);
  console.log(
    `Agent personIds=${JSON.stringify(agentSum.personIds)} kind=${agentSum.scopeKind} ` +
      `byCompany=${agentSum.byCompanyHidden ? 'HIDDEN' : 'visible'} (beklenen: kind=self + byCompany=HIDDEN)`,
  );

  // Beklenen davranis ozeti
  console.log('\n=== Beklenen ===');
  console.log('  Agent       kind=self           byCompany=HIDDEN  personIds=[USR-001]');
  console.log('  Supervisor  kind=team           byCompany=HIDDEN  teams=null (broad)');
  console.log('  Admin       kind=company        byCompany=HIDDEN');
  console.log('  SystemAdmin kind=cross-company  byCompany=visible');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
