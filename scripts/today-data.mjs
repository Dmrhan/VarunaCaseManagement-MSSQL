import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
const prisma = new PrismaClient();
const SINCE = new Date('2026-06-17T00:00:00');
const cases = await prisma.case.findMany({
  where: { status: 'Cozuldu', resolvedAt: { gte: SINCE } },
  select: { caseNumber: true, companyName: true, description: true, resolutionNote: true, customFields: true, resolvedAt: true },
  orderBy: { resolvedAt: 'desc' },
});
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const out = cases.map((c) => {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; st = cf?.smartTicket ?? {}; } catch {}
  const cl = st.closure ?? {};
  return { no: c.caseNumber, sirket: c.companyName, sorun: clean(c.description).slice(0, 400), cozum: clean(c.resolutionNote).slice(0, 400),
    acilis: { platform: st.platformLabel||'', isSureci: st.businessProcessLabel||'', islemTipi: st.operationTypeLabel||'', etkilenenNesne: st.affectedObjectLabel||'', etki: st.impactLabel||'' },
    kapanis: { kokNedenGrubu: cl.rootCauseGroupLabel||'', kokNedenDetayi: cl.rootCauseDetailLabel||'', cozumTipi: cl.resolutionTypeLabel||'', kaliciOnlem: cl.permanentPreventionLabel||'' } };
});
await prisma.$disconnect();
fs.writeFileSync('scripts/today-data.json', JSON.stringify(out, null, 1));
console.log('Bugun cozulen: ' + out.length + ' -> scripts/today-data.json');
