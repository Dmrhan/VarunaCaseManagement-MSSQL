/**
 * Operations aggregator MSSQL smoke (Faz 2) — yeniden yazilan raw SQL'lerin
 * seed verisiyle calistigini dogrular.
 *
 * Calistirma: node --env-file=.env scripts/smoke-operations-aggregator-mssql.js
 */
import { computeOperationsOverview } from '../server/analytics/operationsAggregator.js';
import { prisma } from '../server/db/client.js';

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

try {
  const companies = await prisma.company.findMany({ select: { id: true } });
  const scope = {
    companyIds: companies.map((c) => c.id),
    teamIds: null,
    personIds: null,
    canCrossCompanyAgg: true,
  };
  const to = new Date();
  const from = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const r = await computeOperationsOverview({
    scope,
    filters: { from: from.toISOString(), to: to.toISOString() },
  });

  check('overview döndü', Boolean(r && r.kpis));
  check('totalCases > 0', r.kpis.totalCases.value > 0, `=${r.kpis.totalCases.value}`);
  check('openCases sayısal', Number.isFinite(r.kpis.openCases.value), `=${r.kpis.openCases.value}`);
  check('timeSeries dolu', r.timeSeries.length > 0, `len=${r.timeSeries.length}`);
  check('timeSeries bucket formatı YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(r.timeSeries[0]?.bucket ?? ''), r.timeSeries[0]?.bucket);
  check('byStatus dolu ve ASCII key', r.byStatus.length > 0 && r.byStatus.every((s) => /^[A-Za-z0-9]+$/.test(s.key)), JSON.stringify(r.byStatus.map((s) => s.key)));
  check('byPriority dolu', r.byPriority.length > 0);
  check('byCaseType dolu', r.byCaseType.length > 0);
  check('byCompany dolu (cross-company)', Array.isArray(r.byCompany) && r.byCompany.length > 0);
  check('byTeam dolu', r.byTeam.length > 0, JSON.stringify(r.byTeam[0]));
  check('byCategory dolu', r.byCategory.length > 0);
  check('topAtRiskAccounts dizi', Array.isArray(r.topAtRiskAccounts), `len=${r.topAtRiskAccounts.length}`);
  check('avgTTR sayısal veya null', r.kpis.avgResolutionWallClockHours.value === null || Number.isFinite(r.kpis.avgResolutionWallClockHours.value), `=${r.kpis.avgResolutionWallClockHours.value}`);
  check('retentionSuccessPct sayısal veya null', r.kpis.retentionSuccessPct.value === null || Number.isFinite(r.kpis.retentionSuccessPct.value), `=${r.kpis.retentionSuccessPct.value}`);

  // status filtresi ile daraltılmış sorgu da çalışmalı (IN expansion)
  const r2 = await computeOperationsOverview({
    scope,
    filters: { from: from.toISOString(), to: to.toISOString(), statuses: ['Acik', 'Cozuldu'], caseTypes: ['GeneralSupport'] },
  });
  check('status+caseType filtreli sorgu çalışıyor', Boolean(r2 && r2.kpis), `total=${r2.kpis.totalCases.value}`);

  console.log(`durationMs: ${r.durationMs}`);
} catch (e) {
  console.error('SMOKE ERROR', e);
  fail++;
} finally {
  await prisma.$disconnect();
  console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
