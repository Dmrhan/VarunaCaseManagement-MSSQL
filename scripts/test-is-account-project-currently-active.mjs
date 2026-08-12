/**
 * WR-Proje-Kapanış fix — isAccountProjectCurrentlyActive() canlı DB testi.
 * Gerçek production kodunu (server/db/caseRepository.js) doğrudan import eder.
 *
 * Çalıştır: node --env-file-if-exists=.env scripts/test-is-account-project-currently-active.mjs
 */
import { PrismaClient } from '@prisma/client';
import { isAccountProjectCurrentlyActive } from '../server/db/caseRepository.js';

const url = process.env.DATABASE_URL + ';connectionLimit=2;poolTimeout=30';
const prisma = new PrismaClient({ datasources: { db: { url } } });

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✔' : '✘'} ${name}`);
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`   beklenen: ${expected}, gelen: ${actual}`);
  }
}

async function main() {
  expect('1) projectId null → false', await isAccountProjectCurrentlyActive(null), false);
  expect('2) projectId undefined → false', await isAccountProjectCurrentlyActive(undefined), false);
  expect('3) var olmayan projectId → false', await isAccountProjectCurrentlyActive('__nonexistent_project__'), false);

  const active = await prisma.accountProject.findFirst({
    where: { isActive: true, status: 'Active' },
    select: { id: true, name: true },
  });
  if (active) {
    expect(`4) gerçek aktif proje (${active.name}) → true`, await isAccountProjectCurrentlyActive(active.id), true);
  } else {
    console.log('⊘ 4) atlandı — DB\'de aktif proje bulunamadı');
  }

  const stale = await prisma.accountProject.findFirst({
    where: { OR: [{ isActive: false }, { status: { not: 'Active' } }] },
    select: { id: true, name: true, isActive: true, status: true },
  });
  if (stale) {
    expect(
      `5) stale proje (${stale.name}, isActive:${stale.isActive}, status:${stale.status}) → false`,
      await isAccountProjectCurrentlyActive(stale.id),
      false,
    );
  } else {
    console.log('⊘ 5) atlandı — DB\'de stale (pasif/Completed/Cancelled) proje bulunamadı');
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
