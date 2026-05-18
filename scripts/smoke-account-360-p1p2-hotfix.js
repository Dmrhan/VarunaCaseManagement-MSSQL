/**
 * P1/P2 hotfix smoke — picker access + scoped counts/status filters.
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-account-360-p1p2-hotfix.js`
 *
 * Senaryolar:
 *  1. Agent GET /api/accounts list → 200 (requireRole geçer)
 *  2. Agent GET /api/accounts/:id → 403
 *  3. Agent POST/PATCH → 403
 *  4. Supervisor/Admin list + detail erişimi unchanged
 *  5. Multi-company account case count yalnız allowedCompanyIds vakalarını sayar
 *  6. status filter — Agent görmediği şirketteki status'u match etmez (leak yok)
 *  7. companyId + status filter birlikte çalışır
 *  8. List response notes/segment içermez
 */

import { prisma } from '../server/db/client.js';
import { accountRepository } from '../server/db/accountRepository.js';
import { requireRole } from '../server/db/auth.js';

const stamp = Date.now();
const TEST_PREFIX = `smoke-p1p2-${stamp}`;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function runMw(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      payload: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(p) {
        this.payload = p;
        return this;
      },
    };
    const next = () => resolve({ called: true, res });
    mw(req, res, next);
    if (res.statusCode !== 200 && res.payload) resolve({ called: false, res });
  });
}

const LIST_ROLES = ['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
const DETAIL_READ_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
const WRITE_ROLES = ['Admin', 'SystemAdmin'];

async function run() {
  console.log('🔧 P1/P2 hotfix smoke\n');

  // Senaryo veri: 2 şirket account multi-company, FINROTA'da hidden status='churn'
  const companies = await prisma.company.findMany({
    where: { isActive: true, id: { in: ['COMP-PARAM', 'COMP-UNIVERA', 'COMP-FINROTA'] } },
    select: { id: true },
  });
  const have = new Set(companies.map((c) => c.id));
  if (!have.has('COMP-PARAM') || !have.has('COMP-UNIVERA') || !have.has('COMP-FINROTA')) {
    console.error('Bu smoke 3 demo şirketi gerektirir (PARAM/UNIVERA/FINROTA).');
    process.exit(1);
  }

  // 1. Agent list 200 (middleware)
  {
    const out = await runMw(requireRole(...LIST_ROLES), { user: { role: 'Agent' } });
    record('1. Agent GET /api/accounts list → 200', out.called === true);
  }

  // 2. Agent detail 403
  {
    const out = await runMw(requireRole(...DETAIL_READ_ROLES), { user: { role: 'Agent' } });
    record('2. Agent GET /api/accounts/:id → 403', !out.called && out.res.statusCode === 403);
  }

  // 3. Agent write 403
  {
    const out = await runMw(requireRole(...WRITE_ROLES), { user: { role: 'Agent' } });
    record('3. Agent POST/PATCH → 403', !out.called && out.res.statusCode === 403);
  }

  // 4. Supervisor list + detail OK
  {
    const list = await runMw(requireRole(...LIST_ROLES), { user: { role: 'Supervisor' } });
    const detail = await runMw(requireRole(...DETAIL_READ_ROLES), { user: { role: 'Supervisor' } });
    record('4a. Supervisor list 200', list.called === true);
    record('4b. Supervisor detail 200', detail.called === true);

    const adminWrite = await runMw(requireRole(...WRITE_ROLES), { user: { role: 'Admin' } });
    record('4c. Admin write 200', adminWrite.called === true);
  }

  // ---- DB senaryo: multi-company account + cross-tenant case ----
  const acc = await prisma.account.create({
    data: {
      name: `${TEST_PREFIX}-MultiCo`,
      companyId: 'COMP-PARAM',
      companies: {
        create: [
          { companyId: 'COMP-PARAM', status: 'active' },
          { companyId: 'COMP-FINROTA', status: 'churn' }, // hidden tenant churn
        ],
      },
    },
    include: { companies: true },
  });
  // 2 vaka: PARAM (visible) + FINROTA (hidden)
  const casePARAM = await prisma.case.create({
    data: {
      caseNumber: `SMOKE-${stamp}-P`,
      title: 'param case',
      description: 'x',
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: 'COMP-PARAM',
      companyName: 'PARAM',
      accountId: acc.id,
      accountName: acc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    },
  });
  const caseFIN = await prisma.case.create({
    data: {
      caseNumber: `SMOKE-${stamp}-F`,
      title: 'finrota case',
      description: 'x',
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: 'COMP-FINROTA',
      companyName: 'FINROTA',
      accountId: acc.id,
      accountName: acc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    },
  });

  // 5. Case count scope: Agent allowed=[PARAM] → 1 vaka sayılır, 2 değil
  {
    const out = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      allowedCompanyIds: ['COMP-PARAM'],
    });
    const row = out.accounts.find((a) => a.id === acc.id);
    record(
      '5. Multi-company case count scoped to allowedCompanyIds',
      row?.totalCaseCount === 1 && row?.openCaseCount === 1,
      `total=${row?.totalCaseCount}, open=${row?.openCaseCount} (expected 1/1)`,
    );
  }

  // 6. Status filter leak — Agent allowed=[PARAM] iken status='churn' query
  //    FINROTA-only churn match'ini DÖNMEMELİ.
  {
    const out = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      status: 'churn',
      allowedCompanyIds: ['COMP-PARAM'],
    });
    const leaked = out.accounts.some((a) => a.id === acc.id);
    record('6. status filter does not leak hidden tenant', !leaked, `leaked=${leaked}`);
  }

  // 6b. Supervisor allowed=[PARAM,FINROTA] iken status='churn' → görür.
  {
    const out = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      status: 'churn',
      allowedCompanyIds: ['COMP-PARAM', 'COMP-FINROTA'],
    });
    const seen = out.accounts.some((a) => a.id === acc.id);
    record('6b. status filter visible tenant → match', seen);
  }

  // 7. companyId + status birlikte
  {
    // PARAM scope'unda status='active' → eşleşmeli
    const out1 = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      companyId: 'COMP-PARAM',
      status: 'active',
      allowedCompanyIds: ['COMP-PARAM', 'COMP-FINROTA'],
    });
    const match1 = out1.accounts.some((a) => a.id === acc.id);
    // PARAM scope'unda status='churn' → eşleşmemeli (PARAM AC active)
    const out2 = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      companyId: 'COMP-PARAM',
      status: 'churn',
      allowedCompanyIds: ['COMP-PARAM', 'COMP-FINROTA'],
    });
    const match2 = out2.accounts.some((a) => a.id === acc.id);
    record('7. companyId + status combine (PARAM/active match)', match1 && !match2,
      `active=${match1}, churn=${match2}`);
  }

  // 8. Response notes/segment yok
  {
    const out = await accountRepository.listAccounts({
      search: TEST_PREFIX,
      allowedCompanyIds: ['COMP-PARAM', 'COMP-FINROTA'],
    });
    const row = out.accounts.find((a) => a.id === acc.id);
    const hasNotes = row?.companies?.some((c) => 'notes' in c);
    const hasSegment = row?.companies?.some((c) => 'segment' in c);
    record('8. List response excludes notes + segment', !hasNotes && !hasSegment,
      `hasNotes=${hasNotes}, hasSegment=${hasSegment}`);
  }

  // Cleanup
  await prisma.case.deleteMany({ where: { id: { in: [casePARAM.id, caseFIN.id] } } }).catch(() => {});
  await prisma.accountCompany.deleteMany({ where: { accountId: acc.id } }).catch(() => {});
  await prisma.account.delete({ where: { id: acc.id } }).catch(() => {});

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
