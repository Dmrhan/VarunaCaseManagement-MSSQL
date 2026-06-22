// 9 kapanis/acilis alaninin gecerli taksonomi label'larini cekip JSON'a yazar.
// Oneri ureten ajanlar SADECE bu label'lari kullansin diye.
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';

const prisma = new PrismaClient();
const TYPES = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact',
  'rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];

const rows = await prisma.taxonomyDef.findMany({
  where: { companyId: 'COMP-UNIVERA', isActive: true, taxonomyType: { in: TYPES } },
  select: { id: true, taxonomyType: true, label: true, parentId: true, sortOrder: true },
  orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
});
const idToLabel = new Map(rows.map((r) => [r.id, r.label]));

const out = {};
for (const t of TYPES) out[t] = [];
for (const r of rows) {
  if (r.taxonomyType === 'rootCauseDetail') {
    // decouple: tum detaylar gecerli; grup bilgisini referans olarak ekle
    out.rootCauseDetail.push(`${r.label}  (grup: ${idToLabel.get(r.parentId) ?? '-'})`);
  } else {
    out[r.taxonomyType].push(r.label);
  }
}
await prisma.$disconnect();
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'taxonomy-options.json'), JSON.stringify(out, null, 2));
for (const t of TYPES) console.log(`${t}: ${out[t].length} secenek`);
console.log('-> scripts/taxonomy-options.json');
