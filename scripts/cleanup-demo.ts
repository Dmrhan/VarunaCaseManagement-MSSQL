/**
 * Scenario seed cleanup — `DEMO-ACC-*` prefix'li demo account'lari siler.
 *
 * Kullanim: `npx tsx scripts/cleanup-demo.ts`
 *
 * Bagli vakasi olan account'lari silmez (guvenlik). Eger gercek vaka
 * DEMO-ACC-* id'sine bagliysa script abort eder ve liste basar.
 *
 * Notlar:
 *  - Yalniz `DEMO-ACC-` prefix'iyle baslayan kayitlari hedef alir.
 *  - Production'da yanlislikla demo veri kalmissa temizleme aracidir.
 *  - DEMO- prefix'li vakalar (DEMO-UNI-001 vs.) ayrica silinmek istenirse
 *    benzer pattern eklenebilir.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.account.findMany({
    where: { id: { startsWith: 'DEMO-ACC-' } },
    select: { id: true, name: true, _count: { select: { cases: true } } },
  });
  console.log(`Bulunan demo account: ${before.length}`);
  const withCases = before.filter((a) => a._count.cases > 0);
  if (withCases.length > 0) {
    console.error('⚠ Bu account\'lara bagli vaka var — silmeyi durdurdum:');
    for (const a of withCases) console.error(`  ${a.id} | cases=${a._count.cases}`);
    process.exit(1);
  }
  const res = await prisma.account.deleteMany({
    where: { id: { startsWith: 'DEMO-ACC-' } },
  });
  console.log(`✓ Silinen: ${res.count}`);
  const after = await prisma.account.count({ where: { id: { startsWith: 'DEMO-ACC-' } } });
  console.log(`Kalan demo account: ${after}`);
}

main()
  .catch((e) => {
    console.error('FAIL:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
