/**
 * Kapanış decouple — mevcut kapanış taksonomisi satırlarındaki parentId'i null'lar.
 *
 * Ürün kararı: kapanış kategorileri birbirine bağlı OLMAMALI (rootCauseDetail
 * artık rootCauseGroup'a bağlı değil; tüm detaylar her grupta seçilebilir).
 * Bu script eski hiyerarşik veriyi düzler. TaxonomyDef.parentId kolonu şemada
 * forward-compat için kalır ama kapanış tiplerinde null olur.
 *
 * Idempotent: yalnız parentId != null olan kapanış satırlarını günceller; iki
 * kez koşmak ek değişiklik yapmaz.
 *
 * Çalıştırma:
 *   node --env-file=.env scripts/backfill-null-closure-taxonomy-parent.js [--company COMP-UNIVERA] [--dry]
 *   (--company verilmezse TÜM şirketlere uygulanır; --dry yalnız raporlar)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const companyArg = (() => {
  const i = args.indexOf('--company');
  return i >= 0 ? args[i + 1] : null;
})();

// parentId yalnız rootCauseDetail'de set ediliyordu; güvenli olması için tüm
// kapanış tiplerini kapsıyoruz (hepsi artık düz/bağımsız).
const CLOSURE_TYPES = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];

const where = {
  taxonomyType: { in: CLOSURE_TYPES },
  parentId: { not: null },
  ...(companyArg ? { companyId: companyArg } : {}),
};

const affected = await prisma.taxonomyDef.findMany({
  where,
  select: { id: true, companyId: true, taxonomyType: true, code: true, label: true, parentId: true },
});

console.log(
  `Hedef: ${affected.length} satır (parentId != null, kapanış tipleri)` +
    `${companyArg ? ` — şirket=${companyArg}` : ' — tüm şirketler'}`,
);
for (const r of affected.slice(0, 20)) {
  console.log(`  - ${r.companyId} ${r.taxonomyType} ${r.code} (${r.label}) parentId=${r.parentId}`);
}
if (affected.length > 20) console.log(`  … +${affected.length - 20} satır daha`);

if (DRY) {
  console.log('DRY RUN — --dry kaldırınca parentId=null yapılır.');
  await prisma.$disconnect();
  process.exit(0);
}

const res = await prisma.taxonomyDef.updateMany({ where, data: { parentId: null } });
console.log(`✅ ${res.count} satır güncellendi (parentId=null).`);

await prisma.$disconnect();
