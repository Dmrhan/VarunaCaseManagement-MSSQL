/**
 * WR-Proje-Kapanış — hasActiveProjectsForCaseAccount() gerçek DB testi.
 * Fonksiyon Prisma'ya bağımlı (saf değil) — bu yüzden mock yerine CANLI DB'ye
 * karşı, mevcut verinin kendisinden türetilen beklenen sonuçlarla test edilir.
 * Gerçek production kodunu (server/db/caseRepository.js) doğrudan import eder.
 *
 * Çalıştır: node --env-file-if-exists=.env scripts/test-has-active-projects-for-case-account.mjs
 */
import { PrismaClient } from '@prisma/client';
import { hasActiveProjectsForCaseAccount } from '../server/db/caseRepository.js';

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
  // 1) accountId yok → false, DB'ye hiç gitmez (savunma).
  expect(
    '1) accountId null → false (DB sorgusu yok)',
    await hasActiveProjectsForCaseAccount({ accountId: null, companyId: 'COMP-UNIVERA' }),
    false,
  );

  // 2) AccountCompany bulunamayan bir accountId → false.
  expect(
    '2) AccountCompany yok → false',
    await hasActiveProjectsForCaseAccount({ accountId: '__nonexistent_account__', companyId: 'COMP-UNIVERA' }),
    false,
  );

  // 3) Gerçek veriden: en az 1 aktif (isActive:true, status:'Active') projesi
  //    olan bir AccountCompany bul → helper true dönmeli.
  const withActive = await prisma.accountCompany.findFirst({
    where: { projects: { some: { isActive: true, status: 'Active' } } },
    select: { accountId: true, companyId: true },
  });
  if (withActive) {
    expect(
      `3) aktif projesi olan gerçek müşteri (${withActive.accountId}) → true`,
      await hasActiveProjectsForCaseAccount(withActive),
      true,
    );
  } else {
    console.log('⊘ 3) atlandı — DB\'de aktif projeli AccountCompany bulunamadı');
  }

  // 4) Gerçek veriden: AccountCompany var AMA hiç aktif (isActive:true AND
  //    status:'Active') projesi yok → helper false dönmeli (pasif/tamamlanmış
  //    projeler sayılmamalı).
  const withoutActive = await prisma.accountCompany.findFirst({
    where: { projects: { none: { isActive: true, status: 'Active' } } },
    select: { accountId: true, companyId: true },
  });
  if (withoutActive) {
    expect(
      `4) aktif projesi olmayan gerçek müşteri (${withoutActive.accountId}) → false`,
      await hasActiveProjectsForCaseAccount(withoutActive),
      false,
    );
  } else {
    console.log('⊘ 4) atlandı — DB\'de aktif proje yoksuz AccountCompany bulunamadı');
  }

  console.log(`\n${pass} geçti, ${fail} başarısız.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
