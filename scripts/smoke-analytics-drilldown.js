/**
 * Manuel smoke — Drilldown bucket dispatch + scope binding.
 *
 * Calistir: `node --env-file=.env scripts/smoke-analytics-drilldown.js`
 *
 * HTTP'siz; route handler'i degil, drilldown SQL'in olusturdugu Prisma where
 * agacini calistirir. Audit yazimi UI/curl uzerinden HTTP testinde dogrulanir.
 */

import { prisma } from '../server/db/client.js';
import { deriveAnalyticsScope } from '../server/analytics/scopeDerivation.js';
import { OPEN_STATUSES } from '../server/analytics/metricFormulas.js';

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
      allowedCompanyIds: u.role === 'SystemAdmin' ? null : u.companies.map((c) => c.companyId),
    };
  }
  if (map.SystemAdmin) {
    const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
    map.SystemAdmin.allowedCompanyIds = all.map((c) => c.id);
  }
  return map;
}

function buildPeriod() {
  const to = new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

// Endpoint helper'larini yeniden kullanmak yerine semantik olarak ozdes
// where olusturup direkt Prisma'ya soruyoruz (route handler'la birebir uyum).
function buildWhere({ scope, from, to, bucket }) {
  const and = [{ companyId: { in: scope.companyIds } }];
  if (scope.teamIds?.length) and.push({ assignedTeamId: { in: scope.teamIds } });
  if (scope.personIds?.length) and.push({ assignedPersonId: { in: scope.personIds } });
  const periodCreated = { createdAt: { gte: from, lt: to } };
  const periodResolved = { resolvedAt: { gte: from, lt: to } };
  switch (bucket.kind) {
    case 'totalCases':
    case 'createdInPeriod':
      and.push(periodCreated); break;
    case 'resolvedInPeriod':
      and.push(periodResolved); break;
    case 'openCases':
      and.push({ status: { in: OPEN_STATUSES } }); break;
    case 'status':
      and.push(periodCreated, { status: bucket.key }); break;
    case 'priority':
      and.push(periodCreated, { priority: bucket.key }); break;
    case 'company':
      and.push(periodCreated, { companyId: bucket.key }); break;
    default:
      and.push(periodCreated);
  }
  return { AND: and };
}

async function count(role, user, bucket) {
  const { from, to } = buildPeriod();
  const scope = deriveAnalyticsScope(user, {});
  const where = buildWhere({ scope, from, to, bucket });
  const total = await prisma.case.count({ where });
  return { role, kind: bucket.kind, key: bucket.key ?? null, scopeKind: scope.scopeKind, total };
}

async function main() {
  const users = await loadDemoUsers();
  if (!users.Agent || !users.Supervisor || !users.Admin || !users.SystemAdmin) {
    console.error('Eksik demo persona. `npm run db:seed:auth` calistir.');
    process.exit(1);
  }

  console.log(`=== Drilldown bucket smoke (last ${PERIOD_DAYS} days) ===\n`);

  console.log('--- openCases ---');
  for (const role of ['Agent', 'Supervisor', 'Admin', 'SystemAdmin']) {
    const r = await count(role, users[role], { kind: 'openCases' });
    console.log(`${role.padEnd(13)} scope=${r.scopeKind.padEnd(14)} openCases=${r.total}`);
  }

  console.log('\n--- status=Acik ---');
  for (const role of ['Agent', 'SystemAdmin']) {
    const r = await count(role, users[role], { kind: 'status', key: 'Acik' });
    console.log(`${role.padEnd(13)} scope=${r.scopeKind.padEnd(14)} cases=${r.total}`);
  }

  console.log('\n--- priority=Critical ---');
  for (const role of ['Supervisor', 'SystemAdmin']) {
    const r = await count(role, users[role], { kind: 'priority', key: 'Critical' });
    console.log(`${role.padEnd(13)} scope=${r.scopeKind.padEnd(14)} cases=${r.total}`);
  }

  console.log('\n--- company=COMP-PARAM ---');
  for (const role of ['Admin', 'SystemAdmin']) {
    const r = await count(role, users[role], { kind: 'company', key: 'COMP-PARAM' });
    console.log(`${role.padEnd(13)} scope=${r.scopeKind.padEnd(14)} cases=${r.total}`);
  }

  console.log('\n=== Beklenen ===');
  console.log('  Agent openCases       sadece kendi atandigi (kucuk sayi)');
  console.log('  Supervisor/Admin      sirket icerigi (orta-buyuk sayi)');
  console.log('  SystemAdmin           tum sirketler (en buyuk sayi)');
  console.log('  Agent status=Acik     sadece kendi atandigi Acik');
  console.log('  Admin company=PARAM   PARAM-bazli rakam; SystemAdmin tum-erisim');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
