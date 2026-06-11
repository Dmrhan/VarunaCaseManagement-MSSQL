/**
 * MSSQL sema smoke (Faz 1) — Prisma client ile temel read/write dogrulamasi.
 *
 * Kapsam:
 *  1. Company create/read/delete (temel CRUD)
 *  2. Enum-string alan yazimi (User.role) + CHECK constraint reddi
 *  3. JSON-string alan yazimi (Case.customFields roundtrip)
 *  4. Filtered unique: ActionItem.dedupKey NULL x 2 satir kabul etmeli,
 *     ayni dedupKey x 2 reddetmeli (P2002), upsert calismali
 *
 * Calistirma: node --env-file=.env scripts/smoke-mssql-schema.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SUF = `smk${Math.random().toString(36).slice(2, 8)}`;
let fail = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
}

async function main() {
  // 1) Company CRUD
  const company = await prisma.company.create({
    data: { id: `cmp_${SUF}`, name: `Smoke Co ${SUF}` },
  });
  const fetched = await prisma.company.findUnique({ where: { id: company.id } });
  check('company create/read', fetched?.name === company.name);

  // 2) Enum-string: gecerli rol kabul, gecersiz rol CHECK reddi
  const user = await prisma.user.create({
    data: {
      id: `usr_${SUF}`,
      email: `${SUF}@smoke.local`,
      fullName: 'Smoke User',
      role: 'Agent',
    },
  });
  check('user create with enum-string role', user.role === 'Agent');

  let checkRejected = false;
  try {
    await prisma.user.create({
      data: {
        id: `usr2_${SUF}`,
        email: `${SUF}2@smoke.local`,
        fullName: 'Bad Role',
        role: 'NotARole',
      },
    });
  } catch {
    checkRejected = true;
  }
  check('invalid enum value rejected by CHECK', checkRejected);

  // 3) JSON-string alan (Case.customFields)
  const kase = await prisma.case.create({
    data: {
      id: `case_${SUF}`,
      caseNumber: `SMK-${SUF}`,
      companyId: company.id,
      companyName: company.name,
      title: 'Smoke case',
      description: 'MSSQL smoke',
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Web',
      requestType: 'Bilgi',
      category: 'SmokeCat',
      subCategory: 'SmokeSub',
      customFields: JSON.stringify({ smoke: true, n: 42 }),
    },
  });
  const kaseBack = await prisma.case.findUnique({ where: { id: kase.id } });
  const parsed = JSON.parse(kaseBack.customFields);
  check('case create + json roundtrip', parsed.smoke === true && parsed.n === 42);

  // 4) Filtered unique: iki NULL dedupKey OK, duplicate dedupKey P2002
  const ai1 = await prisma.actionItem.create({
    data: { id: `ai1_${SUF}`, kind: 'mention', userId: user.id, companyId: company.id, reasonLabel: 'x' },
  });
  const ai2 = await prisma.actionItem.create({
    data: { id: `ai2_${SUF}`, kind: 'mention', userId: user.id, companyId: company.id, reasonLabel: 'y' },
  });
  check('two NULL dedupKey rows allowed', Boolean(ai1 && ai2));

  await prisma.actionItem.create({
    data: { id: `ai3_${SUF}`, kind: 'mention', userId: user.id, companyId: company.id, reasonLabel: 'z', dedupKey: `dk_${SUF}` },
  });
  let dupRejected = false;
  try {
    await prisma.actionItem.create({
      data: { id: `ai4_${SUF}`, kind: 'mention', userId: user.id, companyId: company.id, reasonLabel: 'w', dedupKey: `dk_${SUF}` },
    });
  } catch (e) {
    dupRejected = e?.code === 'P2002';
  }
  check('duplicate dedupKey rejected with P2002', dupRejected);

  // upsert via dedupKey (emitActionItem ile ayni kalip)
  const upserted = await prisma.actionItem.upsert({
    where: { dedupKey: `dk_${SUF}` },
    create: { id: `ai5_${SUF}`, kind: 'mention', userId: user.id, companyId: company.id, reasonLabel: 'u', dedupKey: `dk_${SUF}` },
    update: { reasonLabel: 'updated' },
  });
  check('upsert by dedupKey works', upserted.reasonLabel === 'updated');

  // temizlik
  await prisma.actionItem.deleteMany({ where: { companyId: company.id } });
  await prisma.case.delete({ where: { id: kase.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.company.delete({ where: { id: company.id } });
  const gone = await prisma.company.findUnique({ where: { id: company.id } });
  check('cleanup complete', gone === null);
}

main()
  .catch((e) => {
    console.error('SMOKE ERROR', e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURE(S)`);
    process.exit(fail === 0 ? 0 : 1);
  });
