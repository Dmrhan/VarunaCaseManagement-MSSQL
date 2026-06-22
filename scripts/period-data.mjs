import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
const prisma = new PrismaClient();
const SINCE = new Date('2026-06-12T00:00:00');
const cases = await prisma.case.findMany({
  where: { status: 'Cozuldu', resolvedAt: { gte: SINCE } },
  select: { caseNumber: true, companyName: true, description: true, resolutionNote: true, resolvedAt: true },
  orderBy: { resolvedAt: 'desc' },
});
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const out = cases.map((c) => ({ no: c.caseNumber, sirket: c.companyName, sorun: clean(c.description).slice(0, 600), cozum: clean(c.resolutionNote).slice(0, 600) }));
await prisma.$disconnect();
fs.writeFileSync('scripts/period-data.json', JSON.stringify(out, null, 1));
console.log('12-17 Haziran Cozuldu: ' + out.length + ' vaka -> scripts/period-data.json');
console.log('Sirketler: ' + [...new Set(out.map(o=>o.sirket))].join(', '));
