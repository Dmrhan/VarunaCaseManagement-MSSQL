/**
 * P0 hotfix diagnostics — Account 360 data integrity audit.
 *
 * Hiçbir mutasyon yok; sadece sayım + Akar Gıda deep dive.
 *
 * Çalıştır: `node --env-file=.env scripts/diagnose-account-360.js`
 */

import { prisma } from '../server/db/client.js';

async function main() {
  console.log('🔍 Account 360 diagnostics\n');

  // 1. Account.companyId IS NOT NULL ama AccountCompany kaydı yok
  const accountsWithLegacyCompany = await prisma.account.findMany({
    where: { companyId: { not: null } },
    select: { id: true, name: true, companyId: true, companies: { select: { companyId: true } } },
  });
  const gap1 = accountsWithLegacyCompany.filter((a) => {
    return !a.companies.some((c) => c.companyId === a.companyId);
  });
  console.log(`1. companyId set ama AccountCompany eksik:        ${gap1.length}`);
  if (gap1.length > 0) {
    const perCompany = new Map();
    for (const a of gap1) perCompany.set(a.companyId, (perCompany.get(a.companyId) ?? 0) + 1);
    for (const [k, v] of perCompany) console.log(`     ${k}: ${v}`);
  }

  // 2. Account.companyId IS NULL ve AccountCompany hiç yok (orphan)
  const accountsNullCompany = await prisma.account.findMany({
    where: { companyId: null },
    select: { id: true, name: true, companies: { select: { companyId: true } } },
  });
  const gap2 = accountsNullCompany.filter((a) => a.companies.length === 0);
  console.log(`2. companyId NULL ve hiç AccountCompany yok:      ${gap2.length}`);

  // 3. Case.accountName NOT NULL ama accountId IS NULL
  const gap3 = await prisma.case.count({
    where: { accountId: null, accountName: { not: null } },
  });
  console.log(`3. Case accountName var ama accountId NULL:       ${gap3}`);

  // 4. Case.accountId hedef Account'ta AccountCompany görünmez
  const casesWithAccount = await prisma.case.findMany({
    where: { accountId: { not: null } },
    select: {
      id: true,
      companyId: true,
      accountId: true,
      account: {
        select: { id: true, companyId: true, companies: { select: { companyId: true } } },
      },
    },
  });
  const gap4 = casesWithAccount.filter((c) => {
    if (!c.account) return true; // dangling FK
    const visible = c.account.companies.some((ac) => ac.companyId === c.companyId);
    const legacy = c.account.companyId === c.companyId || c.account.companyId === null;
    return !visible && !legacy;
  });
  console.log(`4. Case.account erişilemez (AccountCompany gap):  ${gap4.length}`);

  // 5. Akar Gıda deep dive
  console.log('\n📌 Akar Gıda Dağıtım A.Ş.');
  const akar = await prisma.account.findFirst({
    where: { name: { contains: 'Akar' } },
    select: {
      id: true,
      name: true,
      companyId: true,
      isActive: true,
      companies: {
        select: { id: true, companyId: true, status: true, externalCustomerCode: true },
      },
    },
  });
  if (!akar) {
    console.log('   ! Akar Gıda bulunamadı');
  } else {
    console.log(`   id: ${akar.id}`);
    console.log(`   companyId (legacy): ${akar.companyId ?? '(null)'}`);
    console.log(`   isActive: ${akar.isActive}`);
    console.log(`   AccountCompany rows: ${akar.companies.length}`);
    for (const c of akar.companies) {
      console.log(`     - ${c.companyId} (status=${c.status}, code=${c.externalCustomerCode ?? '-'})`);
    }
    const byId = await prisma.case.count({ where: { accountId: akar.id } });
    const byName = await prisma.case.count({ where: { accountName: akar.name } });
    console.log(`   Case count by accountId: ${byId}`);
    console.log(`   Case count by exact accountName: ${byName}`);
  }

  // GET /api/accounts?search=AKAR&companyId=COMP-UNIVERA — repository call
  console.log('\n📌 GET /api/accounts?search=AKAR&companyId=COMP-UNIVERA simülasyon:');
  const { accountRepository } = await import('../server/db/accountRepository.js');
  const sysAdmin = await prisma.user.findFirst({ where: { role: 'SystemAdmin' }, select: { id: true } });
  const allCompanies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  const allowed = allCompanies.map((c) => c.id);
  const result = await accountRepository.listAccounts({
    search: 'AKAR',
    companyId: 'COMP-UNIVERA',
    allowedCompanyIds: allowed,
  });
  console.log(`   total=${result.total}, accounts=${result.accounts.length}`);
  for (const a of result.accounts) {
    console.log(`     - ${a.name} (companies=[${a.companies.map((c) => c.companyId).join(',')}])`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('diagnostic error:', err);
  process.exit(1);
});
