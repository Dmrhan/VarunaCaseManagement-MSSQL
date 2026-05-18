/**
 * Smoke: 4 demo persona — role + scope + sidebar gate.
 *
 * verifyJwt'in yaptığını reprodüce eder (User + UserCompany'den allowedCompanyIds),
 * sonra her persona için:
 *   - User.role doğru mu
 *   - SystemAdmin → tüm aktif şirketleri görür
 *   - Admin → kendi yetkili şirketleri görür
 *   - Supervisor → scoped vaka sayısı (PARAM+UNIVERA)
 *   - Agent → canReadAccounts=false (Müşteriler sidebar/route 403)
 *   - Yönetim sidebar gate: SystemAdmin only
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-demo-personas.js`
 */

import { prisma } from '../server/db/client.js';

// accountService.ts'deki helper'ları frontend ile aynı kuralla inline tut (alias yüzünden TS import yapamıyoruz).
const ACCOUNT_READ_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
const ACCOUNT_WRITE_ROLES = ['Admin', 'SystemAdmin'];
const canReadAccounts = (role) => ACCOUNT_READ_ROLES.includes(role);
const canWriteAccounts = (role) => ACCOUNT_WRITE_ROLES.includes(role);

const results = [];
function record(persona, name, ok, detail = '') {
  results.push({ persona, name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} [${persona}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function computeAllowedCompanyIds(user) {
  if (user.role === 'SystemAdmin') {
    const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
    return all.map((c) => c.id);
  }
  const links = await prisma.userCompany.findMany({
    where: { userId: user.id, isActive: true },
    select: { companyId: true },
  });
  return links.map((l) => l.companyId);
}

async function smokePersona(email, expectations) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true, personId: true },
  });
  if (!user) {
    record(email, 'user exists in DB', false);
    return;
  }
  record(email, `User.role === '${expectations.role}'`, user.role === expectations.role, `got=${user.role}`);
  record(email, 'isActive', user.isActive === true);

  const allowedCompanyIds = await computeAllowedCompanyIds(user);
  const allowedSorted = [...allowedCompanyIds].sort();
  const expectedSorted = [...expectations.allowedCompanyIds].sort();
  const allowedOk = JSON.stringify(allowedSorted) === JSON.stringify(expectedSorted);
  record(email, `allowedCompanyIds matches expected`, allowedOk, `got=[${allowedSorted.join(',')}]`);

  // canReadAccounts gating (sidebar Müşteriler)
  const reads = canReadAccounts(user.role);
  record(email, `canReadAccounts === ${expectations.canReadAccounts}`, reads === expectations.canReadAccounts);

  // canWriteAccounts (Müşteri Ekle/Düzenle butonları)
  const writes = canWriteAccounts(user.role);
  record(email, `canWriteAccounts === ${expectations.canWriteAccounts}`, writes === expectations.canWriteAccounts);

  // Yönetim sidebar gate — App.tsx: user?.role === 'SystemAdmin'
  const adminPanel = user.role === 'SystemAdmin';
  record(email, `Admin (Yönetim) panel visible === ${expectations.adminPanel}`, adminPanel === expectations.adminPanel);

  // Scoped case count — verifyJwt sonrası caseRepository.list pattern'i
  const scopeFilter =
    allowedCompanyIds.length > 0 ? { companyId: { in: allowedCompanyIds } } : { companyId: { in: [] } };
  const caseCount = await prisma.case.count({ where: scopeFilter });
  record(email, `scoped case count matches`, caseCount === expectations.expectedCaseCount, `got=${caseCount}`);
}

async function run() {
  console.log('🧪 Demo persona smoke başlıyor...\n');

  // Toplam vaka — multi-tenant kanıt için
  const totalCases = await prisma.case.count();
  const cases = await prisma.case.groupBy({
    by: ['companyId'],
    _count: { _all: true },
  });
  console.log(`DB: ${totalCases} toplam vaka`);
  cases.forEach((c) => console.log(`   ${c.companyId}: ${c._count._all}`));
  console.log();

  // Şirket bazında vaka sayısını çıkar
  const casesByCompany = Object.fromEntries(cases.map((c) => [c.companyId, c._count._all]));
  const PARAM = 'COMP-PARAM';
  const UNIVERA = 'COMP-UNIVERA';
  const FINROTA = 'COMP-FINROTA';

  // SystemAdmin → tüm aktif şirketler
  await smokePersona('sysadmin@varuna.dev', {
    role: 'SystemAdmin',
    allowedCompanyIds: [PARAM, UNIVERA, FINROTA],
    canReadAccounts: true,
    canWriteAccounts: true,
    adminPanel: true,
    expectedCaseCount: totalCases,
  });

  // Admin → 3 şirket
  await smokePersona('admin@varuna.dev', {
    role: 'Admin',
    allowedCompanyIds: [PARAM, UNIVERA, FINROTA],
    canReadAccounts: true,
    canWriteAccounts: true,
    adminPanel: false,
    expectedCaseCount: totalCases,
  });

  // Supervisor → PARAM + UNIVERA (scoped)
  await smokePersona('supervisor@varuna.dev', {
    role: 'Supervisor',
    allowedCompanyIds: [PARAM, UNIVERA],
    canReadAccounts: true,
    canWriteAccounts: false,
    adminPanel: false,
    expectedCaseCount: (casesByCompany[PARAM] ?? 0) + (casesByCompany[UNIVERA] ?? 0),
  });

  // Agent → PARAM only; Müşteriler kapalı
  await smokePersona('agent@varuna.dev', {
    role: 'Agent',
    allowedCompanyIds: [PARAM],
    canReadAccounts: false,
    canWriteAccounts: false,
    adminPanel: false,
    expectedCaseCount: casesByCompany[PARAM] ?? 0,
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('[smoke] FAILED:');
    failed.forEach((f) => console.log(`  - [${f.persona}] ${f.name} ${f.detail ?? ''}`));
    process.exitCode = 1;
  } else {
    console.log('[smoke] ALL GREEN');
  }

  await prisma.$disconnect();
}

run();
