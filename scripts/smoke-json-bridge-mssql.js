/**
 * MSSQL Json köprüsü smoke (Faz 2) — server/db/client.js extension'ının
 * Postgres dönemindeki Json davranışını koruduğunu doğrular.
 *
 * Calistirma: node --env-file=.env scripts/smoke-json-bridge-mssql.js
 */
import { prisma } from '../server/db/client.js';

const SUF = `jsb${Math.random().toString(36).slice(2, 8)}`;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

try {
  const company = await prisma.company.create({ data: { id: `cmp_${SUF}`, name: `Json Bridge Co ${SUF}` } });

  // 1) Obje yazma (stringify YOK — extension halletmeli) + obje okuma
  const kase = await prisma.case.create({
    data: {
      id: `case_${SUF}`,
      caseNumber: `JSB-${SUF}`,
      companyId: company.id,
      companyName: company.name,
      title: 'Json bridge case',
      description: 'x',
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Web',
      requestType: 'Bilgi',
      category: 'Cat',
      subCategory: 'Sub',
      customFields: { renk: 'kırmızı', adet: 3, liste: [1, 2] },
      checklistItems: [{ id: 'c1', done: false }],
    },
  });
  check('create dönüşü obje', typeof kase.customFields === 'object' && kase.customFields?.adet === 3, JSON.stringify(kase.customFields));

  const back = await prisma.case.findUnique({ where: { id: kase.id } });
  check('findUnique obje döner', back.customFields?.renk === 'kırmızı' && Array.isArray(back.checklistItems));

  // DB'de gerçekten string saklandığını doğrula (raw)
  const raw = await prisma.$queryRawUnsafe('SELECT [customFields] FROM [Case] WHERE [id] = @P1', kase.id);
  check('DB ham değeri string JSON', typeof raw[0].customFields === 'string' && raw[0].customFields.startsWith('{'));

  // 2) update ile obje yazma
  await prisma.case.update({ where: { id: kase.id }, data: { customFields: { renk: 'mavi' } } });
  const upd = await prisma.case.findUnique({ where: { id: kase.id } });
  check('update obje yazımı', upd.customFields?.renk === 'mavi');

  // 3) Nested createMany (ImportJob -> ImportJobRow.rawJson) + include okuma
  const job = await prisma.importJob.create({
    data: {
      id: `imp_${SUF}`,
      companyId: company.id,
      targetType: 'account',
      sourceType: 'file',
      status: 'dry_run_completed',
      targetSchemaVersion: 'v1',
      summaryJson: { total: 2, errors: 0 },
      rows: {
        createMany: {
          data: [
            { id: `row1_${SUF}`, rowNumber: 1, status: 'valid', rawJson: { ad: 'Ali' } },
            { id: `row2_${SUF}`, rowNumber: 2, status: 'valid', rawJson: { ad: 'Veli' } },
          ],
        },
      },
    },
  });
  check('nested createMany çalıştı', Boolean(job), `summary=${JSON.stringify(job?.summaryJson)}`);
  check('parent json obje', job.summaryJson?.total === 2);

  const jobBack = await prisma.importJob.findUnique({ where: { id: job.id }, include: { rows: true } });
  check('include edilen child json obje', jobBack.rows.length === 2 && jobBack.rows[0].rawJson?.ad != null, JSON.stringify(jobBack.rows.map((r) => r.rawJson)));

  // 4) null json alan null kalmalı
  check('null json null döner', back.offeredSolutions === null);

  // temizlik
  await prisma.importJobRow.deleteMany({ where: { importJobId: job.id } });
  await prisma.importJob.delete({ where: { id: job.id } });
  await prisma.case.delete({ where: { id: kase.id } });
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
