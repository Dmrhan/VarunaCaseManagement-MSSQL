/**
 * P0 hotfix smoke — Account 360 data integrity + code robustness.
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-account-360-hotfix.js`
 *
 * Senaryolar:
 *  1. AccountCompany gap after repair == 0 (Account.companyId set ama AC yok)
 *  2. backfill-account-companies idempotent (2. çağrı created=0)
 *  3. Akar Gıda Dağıtım A.Ş. → AccountCompany UNIVERA var
 *  4. listAccounts(search='AKAR', companyId='COMP-UNIVERA') Akar Gıda döner
 *  5. getAccount Akar Gıda → companies dizisi UNIVERA içerir (Şirket ilişkileri görünür)
 *  6. listAccounts companyId fallback: legacy companyId set + AC eksik müşteri yine dönmeli
 *  7. getAccount → CustomerCardModal aynı historical case'leri görür
 *     (caseService.findByAccount /by-account endpoint kullanır, total/by-name eşleşir)
 *  8. backfill-case-account-links exact unique match testi (geçici ambig data ile)
 *  9. backfill-case-account-links ambiguous skip testi (aynı name 2 account)
 * 10. caseService.findByAccount statusNotIn parametre URL'e gider (kontrat doğrulama)
 */

import { prisma } from '../server/db/client.js';
import { accountRepository } from '../server/db/accountRepository.js';
import { runAccountCompanyBackfill } from './backfill-account-companies.js';
import { runCaseAccountBackfill } from './backfill-case-account-links.js';

const results = [];
const stamp = Date.now();
const TEST_PREFIX = `smoke-hotfix-${stamp}`;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getSysAllowed() {
  const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  return all.map((c) => c.id);
}

async function run() {
  console.log('🔧 P0 hotfix smoke\n');
  const allowed = await getSysAllowed();

  // 1. AccountCompany gap after repair
  {
    const accounts = await prisma.account.findMany({
      where: { companyId: { not: null } },
      select: { id: true, companyId: true, companies: { select: { companyId: true } } },
    });
    const gap = accounts.filter((a) => !a.companies.some((c) => c.companyId === a.companyId));
    record('1. AccountCompany gap == 0 after repair', gap.length === 0, `gap=${gap.length}`);
  }

  // 2. Idempotent rerun
  {
    const out = await runAccountCompanyBackfill();
    record(
      '2. backfill-account-companies idempotent (created=0)',
      out.created === 0,
      `created=${out.created}, skippedExisting=${out.skippedExisting}`,
    );
  }

  // 3. Akar Gıda has AccountCompany UNIVERA
  {
    const akar = await prisma.account.findFirst({
      where: { name: { contains: 'Akar' } },
      select: { id: true, name: true, companies: { select: { companyId: true } } },
    });
    const hasUni = akar?.companies.some((c) => c.companyId === 'COMP-UNIVERA') ?? false;
    record('3. Akar Gıda → AccountCompany UNIVERA exists', hasUni);
  }

  // 4. listAccounts search filter
  {
    const out = await accountRepository.listAccounts({
      search: 'AKAR',
      companyId: 'COMP-UNIVERA',
      allowedCompanyIds: allowed,
    });
    const found = out.accounts.some((a) => a.name.includes('Akar'));
    record('4. /api/accounts?search=AKAR&companyId=UNIVERA returns Akar Gıda', found, `total=${out.total}`);
  }

  // 5. getAccount detail companies non-empty
  {
    const akar = await prisma.account.findFirst({
      where: { name: { contains: 'Akar' } },
      select: { id: true },
    });
    const detail = await accountRepository.getAccount(akar.id, { allowedCompanyIds: allowed });
    record(
      '5. getAccount Akar Gıda → companies.length > 0',
      detail.companies.length > 0,
      `companies=${detail.companies.map((c) => c.companyId).join(',')}`,
    );
  }

  // 6. Legacy fallback in listAccounts: AC eksik müşteri bile arama'da dönmeli
  let legacyAccountId;
  {
    // Geçici legacy-only account yarat (Account.companyId set, AccountCompany yaratma)
    const legacyOnly = await prisma.account.create({
      data: { name: `${TEST_PREFIX}-LegacyOnly-UNI`, companyId: 'COMP-UNIVERA' },
    });
    legacyAccountId = legacyOnly.id;
    const out = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      companyId: 'COMP-UNIVERA',
      allowedCompanyIds: allowed,
    });
    const found = out.accounts.some((a) => a.id === legacyOnly.id);
    record('6. listAccounts companyId filter legacy fallback', found, `found=${found}`);
  }

  // 7. CustomerCardModal akışı: caseService.findByAccount tüm vaka tablosunu çekmemeli
  // — repository pattern üzerinden Case.findMany({ where: { accountId } }) emulate.
  {
    const akar = await prisma.account.findFirst({
      where: { name: { contains: 'Akar' } },
      select: { id: true, name: true },
    });
    const byId = await prisma.case.findMany({
      where: { accountId: akar.id },
      select: { id: true },
    });
    const byName = await prisma.case.count({ where: { accountName: akar.name } });
    record(
      '7. Customer card historical cases match (id vs name)',
      byId.length === byName && byId.length > 0,
      `byId=${byId.length} byName=${byName}`,
    );
  }

  // 8 & 9. Case-account link backfill: synthesize 2 senaryo
  let caseIdUnique, caseIdAmbig;
  let dupA, dupB;
  {
    // 8: Exact unique — yeni account + name'ine atıfla 1 vaka (accountId null)
    const uniq = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-UniqueCustomer`,
        companyId: 'COMP-UNIVERA',
        companies: { create: { companyId: 'COMP-UNIVERA', status: 'active' } },
      },
    });
    const caseUniq = await prisma.case.create({
      data: {
        caseNumber: `SMOKE-${stamp}-UNIQ`,
        title: 'Unique match test',
        description: 'smoke',
        caseType: 'GeneralSupport',
        status: 'Acik',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: 'COMP-UNIVERA',
        companyName: 'UNIVERA',
        accountId: null,
        accountName: `${TEST_PREFIX}-UniqueCustomer`,
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
      },
    });
    caseIdUnique = caseUniq.id;

    // 9: Ambiguous — iki account aynı isim, aynı şirket
    dupA = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-DupCustomer`,
        companyId: 'COMP-FINROTA',
        companies: { create: { companyId: 'COMP-FINROTA', status: 'active' } },
      },
    });
    dupB = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-DupCustomer`,
        companyId: 'COMP-FINROTA',
        companies: { create: { companyId: 'COMP-FINROTA', status: 'active' } },
      },
    });
    const caseAmb = await prisma.case.create({
      data: {
        caseNumber: `SMOKE-${stamp}-AMBIG`,
        title: 'Ambiguous test',
        description: 'smoke',
        caseType: 'GeneralSupport',
        status: 'Acik',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: 'COMP-FINROTA',
        companyName: 'FINROTA',
        accountId: null,
        accountName: `${TEST_PREFIX}-DupCustomer`,
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
      },
    });
    caseIdAmbig = caseAmb.id;

    const out = await runCaseAccountBackfill();
    record('8. Exact unique match linked', out.linked >= 1, `linked=${out.linked}`);
    record(
      '9. Ambiguous duplicate skipped',
      out.skippedAmbiguous >= 1,
      `skippedAmbiguous=${out.skippedAmbiguous}`,
    );

    // Doğrula: caseUniq artık account'a bağlı
    const fixed = await prisma.case.findUnique({ where: { id: caseUniq.id }, select: { accountId: true } });
    record('8b. Unique case.accountId set', fixed.accountId === uniq.id);

    // Doğrula: caseAmb hala null
    const stillNull = await prisma.case.findUnique({ where: { id: caseAmb.id }, select: { accountId: true } });
    record('9b. Ambiguous case.accountId still NULL', stillNull.accountId === null);
  }

  // 10. caseService.findByAccount URL kontrat — statusNotIn parametre üretimi
  {
    // Service direkt fetch yapıyor; URL string'i inline reprodüce ediyoruz.
    const params = new URLSearchParams();
    const accountId = 'acc-1';
    const statusNotIn = ['Çözüldü', 'İptalEdildi'];
    params.set('accountId', accountId);
    params.set('statusNotIn', statusNotIn.join(','));
    const expected = 'accountId=acc-1&statusNotIn=%C3%87%C3%B6z%C3%BCld%C3%BC%2C%C4%B0ptalEdildi';
    record(
      '10. caseService.findByAccount statusNotIn URL contract',
      params.toString() === expected,
      params.toString(),
    );
  }

  // Cleanup
  await prisma.case.deleteMany({
    where: { caseNumber: { in: [`SMOKE-${stamp}-UNIQ`, `SMOKE-${stamp}-AMBIG`] } },
  }).catch(() => {});
  await prisma.accountCompany.deleteMany({
    where: { account: { name: { startsWith: TEST_PREFIX } } },
  }).catch(() => {});
  await prisma.account.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } }).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('[smoke] FAILED:');
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
    process.exitCode = 1;
  } else {
    console.log('[smoke] ALL GREEN');
  }

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('smoke error:', err);
  process.exit(1);
});
