import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const C = 'COMP-UNIVERA';
const maxO = await prisma.taxonomyDef.aggregate({ where: { companyId: C, taxonomyType: 'operationType' }, _max: { sortOrder: true } });
let it = await prisma.taxonomyDef.findFirst({ where: { companyId: C, taxonomyType: 'operationType', code: 'ot.iptal_etme' } });
if (!it) it = await prisma.taxonomyDef.create({ data: { companyId: C, taxonomyType: 'operationType', code: 'ot.iptal_etme', label: 'İptal etme', isActive: true, sortOrder: (maxO._max.sortOrder ?? 0) + 1 } });
await prisma.$disconnect();
console.log('Iptal etme:', it.code, it.id, 'aktif:', it.isActive);
