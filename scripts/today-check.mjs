import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SINCE = new Date('2026-06-17T00:00:00');
const cases = await prisma.case.findMany({
  where: { status: 'Cozuldu', resolvedAt: { gte: SINCE } },
  select: { caseNumber: true, companyName: true, title: true, description: true, resolutionNote: true, customFields: true, resolvedAt: true },
  orderBy: { resolvedAt: 'desc' },
});
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
console.log(`Bugun (17.06) cozulen: ${cases.length}\n`);
const out = [];
for (const c of cases) {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; st = cf?.smartTicket ?? {}; } catch {}
  const cl = st.closure ?? {};
  out.push({ no: c.caseNumber, sirket: c.companyName,
    sorun: clean(c.description).slice(0, 220), cozum: clean(c.resolutionNote).slice(0, 220),
    acilis: `${st.platformLabel||'-'} / ${st.businessProcessLabel||'-'} / ${st.operationTypeLabel||'-'} / ${st.affectedObjectLabel||'-'} / ${st.impactLabel||'-'}`,
    kapanis: `${cl.rootCauseGroupLabel||'-'} / ${cl.rootCauseDetailLabel||'-'} / ${cl.resolutionTypeLabel||'-'} / ${cl.permanentPreventionLabel||'-'}` });
}
await prisma.$disconnect();
for (const o of out) {
  console.log(`### ${o.no} [${o.sirket}]`);
  console.log(`SORUN: ${o.sorun}`);
  console.log(`COZUM: ${o.cozum}`);
  console.log(`ACILIS : ${o.acilis}`);
  console.log(`KAPANIS: ${o.kapanis}`);
  console.log('');
}
