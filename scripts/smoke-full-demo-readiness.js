/**
 * Full Demo Readiness Smoke.
 *
 * Asserts the dataset produced by `npm run db:seed:full-demo` (+ supporting
 * cron runs) meets the demo coverage spec for QA / sales / handoff scenarios.
 *
 * Read-only.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-full-demo-readiness.js
 */

import { prisma } from '../server/db/client.js';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const totalCases = await prisma.case.count();
record('1. ≥150 cases total', totalCases >= 150, `count=${totalCases}`);

const byCompany = await prisma.case.groupBy({ by: ['companyId'], _count: { _all: true } });
const param = byCompany.find((g) => g.companyId === 'COMP-PARAM')?._count._all ?? 0;
const univera = byCompany.find((g) => g.companyId === 'COMP-UNIVERA')?._count._all ?? 0;
const finrota = byCompany.find((g) => g.companyId === 'COMP-FINROTA')?._count._all ?? 0;
record('2a. PARAM ≥50 cases', param >= 50, `count=${param}`);
record('2b. UNIVERA ≥50 cases', univera >= 50, `count=${univera}`);
record('2c. FINROTA ≥50 cases', finrota >= 50, `count=${finrota}`);

const qaScored = await prisma.case.count({ where: { qaScoredAt: { not: null } } });
record('3. ≥20 QA-scored cases', qaScored >= 20, `count=${qaScored}`);

const activeAlerts = await prisma.patternAlert.count({ where: { status: 'active' } });
record('4. ≥1 active PatternAlert', activeAlerts >= 1, `count=${activeAlerts}`);

const users = await prisma.user.findMany({
  where: { email: { in: ['agent@varuna.dev','supervisor@varuna.dev','csm@varuna.dev','admin@varuna.dev'] } },
  select: { id: true, email: true },
});
for (const u of users) {
  const remCount = await prisma.caseReminder.count({ where: { userId: u.id } });
  record(`5. ≥1 reminder for ${u.email}`, remCount >= 1, `count=${remCount}`);
}

const mentions = await prisma.caseMention.count();
record('6a. ≥1 CaseMention', mentions >= 1, `count=${mentions}`);
const notifs = await prisma.caseNotification.count();
record('6b. ≥1 CaseNotification', notifs >= 1, `count=${notifs}`);

const watcherTotal = await prisma.caseWatcher.count();
record('7. ≥4 CaseWatcher (≥1 per persona × 4)', watcherTotal >= 4, `count=${watcherTotal}`);

const contacts = await prisma.accountContact.count({ where: { isActive: true } });
record('8. AccountContact > 0', contacts > 0, `count=${contacts}`);

const products = await prisma.accountProduct.count({ where: { isActive: true } });
record('9. AccountProduct > 0', products > 0, `count=${products}`);

const pending = await prisma.case.count({ where: { customerMatchPending: true, accountId: null, customerContactName: { not: null } } });
record('10. ≥1 pending customerless case with requester context', pending >= 1, `count=${pending}`);

const matchedFromCustomerless = await prisma.caseActivity.count({
  where: { action: { contains: 'Müşteri eşleştirildi' } },
});
record('11. ≥1 matched customerless case (activity log)', matchedFromCustomerless >= 1, `count=${matchedFromCustomerless}`);

// Suggestion engine sanity — at least one pending case with requester phone
// should produce a phone-match suggestion.
const { suggestCustomerMatches } = await import('../server/db/customerMatchRepository.js');
const allActiveCompanies = (await prisma.company.findMany({ where: { isActive: true }, select: { id: true } })).map((c) => c.id);
const pendingWithPhone = await prisma.case.findFirst({
  where: { customerMatchPending: true, customerContactPhone: { not: null } },
  select: { id: true, customerContactPhone: true },
});
if (pendingWithPhone) {
  const r = await suggestCustomerMatches({ caseId: pendingWithPhone.id, allowedCompanyIds: allActiveCompanies });
  const hasPhoneMatch = r?.suggestions?.some((s) => s.reasons?.some((rr) => rr.type === 'phone'));
  record('12. Suggestion engine produces phone-match for a pending case', hasPhoneMatch, `caseId=${pendingWithPhone.id}`);
} else {
  record('12. Suggestion engine produces phone-match for a pending case', false, 'no pending case with phone');
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
