/**
 * Türkçe arama / collation smoke (Faz 2).
 *
 * 1. mode:'insensitive' sqlserver'da kabul ediliyor mu? (Postgres-only arg)
 * 2. Turkish_100_CI_AS_SC_UTF8 collation: case-insensitive contains,
 *    İ/i ve ı/I eşleşmeleri.
 *
 * Calistirma: node --env-file=.env scripts/smoke-turkish-search-mssql.js
 */
import { prisma } from '../server/db/client.js';

const SUF = `trs${Math.random().toString(36).slice(2, 8)}`;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

try {
  const company = await prisma.company.create({ data: { id: `cmp_${SUF}`, name: `TR Search Co ${SUF}` } });
  await prisma.account.create({
    data: {
      id: `acc1_${SUF}`,
      name: `İSTANBUL IŞIK SİGORTA ${SUF}`,
      customerType: 'Corporate',
      companyId: company.id,
    },
  });

  // 1) mode:'insensitive' destekleniyor mu?
  let modeSupported = true;
  let modeError = '';
  try {
    await prisma.account.findMany({
      where: { name: { contains: 'istanbul', mode: 'insensitive' } },
    });
  } catch (e) {
    modeSupported = false;
    modeError = (e.message || '').split('\n').filter(Boolean).slice(-1)[0];
  }
  console.log(`INFO  mode:'insensitive' sqlserver'da ${modeSupported ? 'KABUL' : 'RED'} ${modeError}`);

  // 2) plain contains — collation davranışı
  const lcResult = await prisma.account.findMany({ where: { name: { contains: `istanbul işik sigorta ${SUF}`.slice(0, 0) || 'istanbul' } } });
  check('lowercase "istanbul" CI eşleşme', lcResult.some((a) => a.id === `acc1_${SUF}`), `found=${lcResult.length}`);

  const dotted = await prisma.account.findMany({ where: { name: { contains: 'İSTANBUL' } } });
  check('"İSTANBUL" eşleşme', dotted.some((a) => a.id === `acc1_${SUF}`));

  // Türkçe kuralı: i ↔ İ (noktalı), ı ↔ I (noktasız)
  const isik = await prisma.account.findMany({ where: { name: { contains: 'ışık' } } });
  console.log(`INFO  'ışık' (noktasız) ile 'IŞIK' eşleşmesi: ${isik.some((a) => a.id === `acc1_${SUF}`) ? 'EVET' : 'HAYIR'}`);

  // temizlik
  await prisma.account.delete({ where: { id: `acc1_${SUF}` } });
  await prisma.company.delete({ where: { id: company.id } });
  check('cleanup', true);
} catch (e) {
  console.error('SMOKE ERROR', e);
  fail++;
} finally {
  await prisma.$disconnect();
  console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
