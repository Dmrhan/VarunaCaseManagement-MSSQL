/**
 * Manuel smoke — POST /api/analytics/cases/overview aggregator'i HTTP olmadan
 * canlandirir. SystemAdmin scope'unda son 7 gun + son 30 gun overview hesaplar
 * ve KPI degerlerini yazdirir. Phase 1 verification icin.
 *
 * Calistir: `node --env-file=.env scripts/smoke-analytics-overview.js`
 */

import { prisma } from '../server/db/client.js';
import { computeOperationsOverview } from '../server/analytics/operationsAggregator.js';
import { deriveAnalyticsScope, describeScope } from '../server/analytics/scopeDerivation.js';

async function main() {
  // SystemAdmin gibi davran — tum sirketleri gor
  const allCompanies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const fakeUser = {
    id: 'smoke-runner',
    role: 'SystemAdmin',
    allowedCompanyIds: allCompanies.map((c) => c.id),
    personId: null,
  };

  console.log(`Sirketler: ${allCompanies.map((c) => c.name).join(', ')}`);
  console.log(`Vaka sayisi (toplam DB): ${await prisma.case.count()}\n`);

  for (const days of [7, 30]) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const body = { from: from.toISOString(), to: to.toISOString() };

    const scope = deriveAnalyticsScope(fakeUser, body);
    console.log(`\n=== Son ${days} gun · ${describeScope(scope)} ===`);
    console.log(`  scopeKind=${scope.scopeKind}, companies=${scope.companyIds.length}`);

    const filters = {
      from: body.from,
      to: body.to,
      productGroups: null,
      caseTypes: null,
      statuses: null,
      granularity: 'day',
    };

    const t0 = Date.now();
    const payload = await computeOperationsOverview({ scope, filters });
    const ms = Date.now() - t0;

    console.log(`  durationMs=${ms} (target <600ms)`);
    console.log(`  formulaVersion=${payload.formulaVersion}`);
    console.log('  KPI:');
    for (const [key, m] of Object.entries(payload.kpis)) {
      const v = m.value == null ? '—' : m.value;
      const d = m.delta?.value == null ? '' : ` (Δ ${m.delta.value} ${m.delta.direction})`;
      console.log(`    ${key.padEnd(32)} ${String(v).padStart(8)}${d}`);
    }
    console.log(`  timeSeries.length=${payload.timeSeries.length}`);
    console.log(`  byStatus=${payload.byStatus.map((s) => s.key + ':' + s.count).join(', ')}`);
    console.log(`  byPriority=${payload.byPriority.map((s) => s.key + ':' + s.count).join(', ')}`);
    console.log(`  byCaseType=${payload.byCaseType.map((s) => s.key + ':' + s.count).join(', ')}`);
    console.log(`  byCompany=${(payload.byCompany ?? []).map((c) => c.name + ':' + c.count).join(', ')}`);
    console.log(`  byTeam (top): ${payload.byTeam.slice(0, 3).map((t) => t.name + ':' + t.count).join(', ')}`);
    console.log(`  topAtRiskAccounts: ${payload.topAtRiskAccounts.slice(0, 3).map((a) => a.accountName + ' (open=' + a.openCount + ', sla=' + a.slaBreachCount + ')').join('; ')}`);
    if (payload.minSampleViolations.length > 0) {
      console.log(`  minSampleViolations: ${payload.minSampleViolations.map((v) => v.metric + ' (n=' + v.sampleSize + ')').join(', ')}`);
    }
    if (payload.notAvailable.length > 0) {
      console.log(`  notAvailable: ${payload.notAvailable.join(', ')}`);
    }
  }

  console.log('\nSmoke complete.');
}

main()
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
