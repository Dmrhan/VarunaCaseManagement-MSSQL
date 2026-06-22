import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const C = 'COMP-UNIVERA';

// 1) "Görünüm problemi" (yetki/görünmeme) işlem tipini aktifleştir
const upd = await prisma.taxonomyDef.updateMany({
  where: { companyId: C, taxonomyType: 'operationType', code: 'ot.gorunum_problemi' },
  data: { isActive: true },
});

// 2) "Kurulum" kök neden grubu
const maxG = await prisma.taxonomyDef.aggregate({ where: { companyId: C, taxonomyType: 'rootCauseGroup' }, _max: { sortOrder: true } });
let grp = await prisma.taxonomyDef.findFirst({ where: { companyId: C, taxonomyType: 'rootCauseGroup', code: 'rcg.kurulum' } });
if (!grp) {
  grp = await prisma.taxonomyDef.create({ data: { companyId: C, taxonomyType: 'rootCauseGroup', code: 'rcg.kurulum', label: 'Kurulum', isActive: true, sortOrder: (maxG._max.sortOrder ?? 0) + 1 } });
}

// 3) "Kurulum" kök neden detayı (parent = Kurulum grubu)
const maxD = await prisma.taxonomyDef.aggregate({ where: { companyId: C, taxonomyType: 'rootCauseDetail' }, _max: { sortOrder: true } });
let det = await prisma.taxonomyDef.findFirst({ where: { companyId: C, taxonomyType: 'rootCauseDetail', code: 'rcd.kurulum' } });
if (!det) {
  det = await prisma.taxonomyDef.create({ data: { companyId: C, taxonomyType: 'rootCauseDetail', code: 'rcd.kurulum', label: 'Kurulum', parentId: grp.id, isActive: true, sortOrder: (maxD._max.sortOrder ?? 0) + 1 } });
}
await prisma.$disconnect();
console.log('Görünüm problemi aktiflestirildi:', upd.count);
console.log('Kurulum grubu:', grp.code, grp.id);
console.log('Kurulum detayi:', det.code, det.id, '(parent='+grp.id+')');
