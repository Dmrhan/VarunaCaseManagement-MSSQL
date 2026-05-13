/**
 * Manuel smoke — Phase 4a AI Analyst endpoint'lerinin OpenAI tarafindan
 * uretilen ham cikti + sanitize katmaninin shape'e uyumu.
 *
 * Calistir: `node --env-file=.env scripts/smoke-ai-operations.js`
 *
 * HTTP'siz: deriveAnalyticsScope -> computeOperationsOverview ->
 * buildOperationsSnapshot -> callOpenAI(prompt) -> sanitize* fonksiyonlari.
 *
 * Audit row yazimini ayrica dogrulamaz (HTTP smoke icin curl/UI gerek).
 */

import { prisma } from '../server/db/client.js';
import { computeOperationsOverview } from '../server/analytics/operationsAggregator.js';
import { deriveAnalyticsScope, describeScope } from '../server/analytics/scopeDerivation.js';
import { callOpenAI } from '../server/lib/aiClient.js';
import {
  buildOperationsSnapshot,
  buildBriefPrompt,
  buildInsightsPrompt,
  buildExplainPrompt,
  buildReportPrompt,
  sanitizeBrief,
  sanitizeInsights,
  sanitizeExplain,
  sanitizeReport,
} from '../server/ai/operationsAnalyst.js';

const PERIOD_DAYS = 30;

async function loadUser(role) {
  const u = await prisma.user.findFirst({
    where: { email: { endsWith: '@varuna.dev' }, role },
    select: { id: true, role: true, personId: true, companies: { select: { companyId: true } } },
  });
  if (!u) throw new Error(`Persona bulunamadi: ${role}`);
  let allowedCompanyIds = u.companies.map((c) => c.companyId);
  if (role === 'SystemAdmin') {
    const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
    allowedCompanyIds = all.map((c) => c.id);
  }
  return { id: u.id, role: u.role, personId: u.personId, allowedCompanyIds };
}

async function buildSnapshotFor(user) {
  const to = new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const filters = {
    from: from.toISOString(),
    to: to.toISOString(),
    productGroups: null,
    caseTypes: null,
    statuses: null,
    granularity: 'day',
  };
  const scope = deriveAnalyticsScope(user, {});
  const payload = await computeOperationsOverview({ scope, filters });
  const enriched = { ...payload, scope: { narrative: describeScope(scope) } };
  return { scope, snapshot: buildOperationsSnapshot(scope, enriched, filters) };
}

async function smokeOne(label, builder, sanitize) {
  console.log(`\n--- ${label} ---`);
  const t0 = Date.now();
  try {
    const { json, tokenCount } = await callOpenAI({ ...builder, expectJson: true });
    const safe = sanitize(json);
    console.log(`OK  tokens=${tokenCount ?? '-'}  durMs=${Date.now() - t0}`);
    console.log('Sanitized shape:', JSON.stringify(safe, null, 2).slice(0, 500), '...');
    return true;
  } catch (e) {
    console.error(`FAIL ${e?.message ?? e}`);
    return false;
  }
}

async function main() {
  console.log('=== Phase 4a AI Analyst smoke ===');
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY yok — smoke atlanir.');
    process.exit(0);
  }
  const sa = await loadUser('SystemAdmin');
  const { scope, snapshot } = await buildSnapshotFor(sa);
  console.log(`Scope: ${scope.scopeKind} · companies=${scope.companyIds.length}`);
  console.log(`Snapshot kpis: total=${snapshot.kpis.totalCases?.value} open=${snapshot.kpis.openCases?.value}`);

  let pass = 0;
  let total = 0;
  total++; if (await smokeOne('operations-brief', buildBriefPrompt(scope, snapshot), sanitizeBrief)) pass++;
  total++; if (await smokeOne('operations-insights', buildInsightsPrompt(scope, snapshot), (r) => ({ insights: sanitizeInsights(r) }))) pass++;
  total++; if (await smokeOne('operations-explain-metric (slaViolationRatePct)', buildExplainPrompt(scope, snapshot, 'slaViolationRatePct'), (r) => sanitizeExplain(r, 'slaViolationRatePct'))) pass++;
  total++; if (await smokeOne('operations-report-draft', buildReportPrompt(scope, snapshot), sanitizeReport)) pass++;

  // Agent persona — self scope brief
  const ag = await loadUser('Agent');
  const { scope: aScope, snapshot: aSnap } = await buildSnapshotFor(ag);
  console.log(`\nAgent scope: ${aScope.scopeKind} · personIds=${JSON.stringify(aScope.personIds)}`);
  total++; if (await smokeOne('operations-brief (Agent self)', buildBriefPrompt(aScope, aSnap), sanitizeBrief)) pass++;

  console.log(`\n=== ${pass}/${total} passed ===`);
  await prisma.$disconnect();
  process.exit(pass === total ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
