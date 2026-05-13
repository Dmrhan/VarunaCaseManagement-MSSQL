/**
 * Phase 6a — Lens tone smoke. Ayni snapshot + scope ile farkli lens'lerin
 * AI brief tonunun gercekten degistigini gozler.
 */
import { prisma } from '../server/db/client.js';
import { computeOperationsOverview } from '../server/analytics/operationsAggregator.js';
import { deriveAnalyticsScope, describeScope } from '../server/analytics/scopeDerivation.js';
import { callOpenAI } from '../server/lib/aiClient.js';
import {
  buildOperationsSnapshot,
  buildBriefPrompt,
  sanitizeBrief,
} from '../server/ai/operationsAnalyst.js';

async function loadUser(role) {
  const u = await prisma.user.findFirst({
    where: { email: { endsWith: '@varuna.dev' }, role },
    select: { id: true, role: true, personId: true, companies: { select: { companyId: true } } },
  });
  if (!u) throw new Error(`persona yok: ${role}`);
  let allowedCompanyIds = u.companies.map((c) => c.companyId);
  if (role === 'SystemAdmin') {
    const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
    allowedCompanyIds = all.map((c) => c.id);
  }
  return { id: u.id, role: u.role, personId: u.personId, allowedCompanyIds };
}

async function snapshot(user) {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  const filters = { from: from.toISOString(), to: to.toISOString(), productGroups: null, caseTypes: null, statuses: null, granularity: 'day' };
  const scope = deriveAnalyticsScope(user, {});
  const payload = await computeOperationsOverview({ scope, filters });
  const snap = buildOperationsSnapshot(scope, { ...payload, scope: { narrative: describeScope(scope) } }, filters);
  return { scope, snap };
}

async function brief(scope, snap, lens) {
  const t0 = Date.now();
  const { json, tokenCount } = await callOpenAI({ ...buildBriefPrompt(scope, snap, lens), expectJson: true });
  const safe = sanitizeBrief(json);
  return { safe, tokenCount, durMs: Date.now() - t0 };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY yok — smoke atlanir.');
    process.exit(0);
  }
  console.log('=== Lens tone smoke ===');
  const sa = await loadUser('SystemAdmin');
  const { scope, snap } = await snapshot(sa);

  // Executive — kisa, karar destekli, gunluk operasyonel ayrinti yok
  console.log('\n--- SystemAdmin · executive ---');
  const ex = await brief(scope, snap, 'executive');
  console.log('Title:', ex.safe.title);
  console.log('Summary:', ex.safe.summary.slice(0, 240));
  console.log(`Bullets ${ex.safe.bullets.length}  Risks ${ex.safe.risks.length}  Actions ${ex.safe.recommendedActions.length}`);

  // Operations — taktik, SLA odakli
  console.log('\n--- SystemAdmin · operations ---');
  const op = await brief(scope, snap, 'operations');
  console.log('Title:', op.safe.title);
  console.log('Summary:', op.safe.summary.slice(0, 240));
  console.log(`Bullets ${op.safe.bullets.length}  Risks ${op.safe.risks.length}  Actions ${op.safe.recommendedActions.length}`);

  // Customer — musteri risk kumelerine odak; agent yargilama yok
  console.log('\n--- SystemAdmin · customer ---');
  const cu = await brief(scope, snap, 'customer');
  console.log('Title:', cu.safe.title);
  console.log('Summary:', cu.safe.summary.slice(0, 240));
  console.log(`Bullets ${cu.safe.bullets.length}  Risks ${cu.safe.risks.length}  Actions ${cu.safe.recommendedActions.length}`);

  // Agent · personal — sadece kisisel aksiyonlar; takim onerisi YOK
  console.log('\n--- Agent · personal ---');
  const ag = await loadUser('Agent');
  const { scope: aScope, snap: aSnap } = await snapshot(ag);
  const pe = await brief(aScope, aSnap, 'personal');
  console.log('Title:', pe.safe.title);
  console.log('Summary:', pe.safe.summary.slice(0, 240));
  const text = (pe.safe.summary + ' ' + pe.safe.recommendedActions.join(' ')).toLowerCase();
  const teamWords = ['takim genelinde', 'takim genel', 'kaynak planlama', 'kadro', 'staf', 'baska bir takima', 'tum takimlar'];
  const hits = teamWords.filter((w) => text.includes(w));
  console.log('Agent persona team-rebalance hits:', hits.length === 0 ? 'NONE' : hits);

  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
