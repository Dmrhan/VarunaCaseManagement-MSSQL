/**
 * Account 360 — Phase C2 BFF smoke.
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-account-phase-c2.js`
 *
 * Senaryolar:
 *   1. AccountProduct: Admin create
 *   2. AccountProduct: Duplicate productCode in same accountCompany → 409
 *   3. AccountProduct: Supervisor write → 403 (requireRole)
 *   4. AccountProduct: CSM write → 403
 *   5. AccountProduct: cross-tenant write (Admin B-only) → 403 (AccountAccessError)
 *   6. GET /products: Supervisor scoped listesi alıyor
 *   7. PATCH product: productName + isActive update
 *   8. DELETE product: soft delete (isActive=false + endedAt set)
 *   9. Case create: accountId dolu (mevcut akış kırılmadı)
 *  10. Case create: accountId null (müşterisiz vaka)
 *  11. AccountSearchPicker eşdeğeri: accountRepository.listAccounts search='X' scope döner
 *  12. customer-context: accountId varsa enriched payload (externalCode + products + primaryContact)
 *  13. customer-context: accountId null vakada context null döner
 */

import { prisma } from '../server/db/client.js';
import {
  accountRepository,
  AccountAccessError,
  AccountValidationError,
} from '../server/db/accountRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';
import { requireRole } from '../server/db/auth.js';

const stamp = Date.now();
const TEST_PREFIX = `smoke-c2-${stamp}`;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function makeUser({ role, allowedCompanyIds }) {
  return { role, allowedCompanyIds, id: `${TEST_PREFIX}-${role}` };
}

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    const next = () => resolve({ called: true, res });
    mw(req, res, next);
    if (res.statusCode !== 200 && res.payload) resolve({ called: false, res });
  });
}

async function pickTwoCompanies() {
  const existing = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    take: 2,
  });
  if (existing.length >= 2) return { companies: existing, createdCompanyIds: [] };
  const need = 2 - existing.length;
  const ghosts = [];
  const createdCompanyIds = [];
  for (let i = 0; i < need; i++) {
    const g = await prisma.company.create({
      data: { name: `${TEST_PREFIX}-ghost-co-${i}`, isActive: true },
      select: { id: true, name: true },
    });
    ghosts.push(g);
    createdCompanyIds.push(g.id);
  }
  return { companies: [...existing, ...ghosts], createdCompanyIds };
}

async function cleanup({ accountIds, caseIds, ghostCompanyIds }) {
  if (caseIds.length) {
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {});
  }
  if (accountIds.length) {
    await prisma.accountProduct
      .deleteMany({ where: { accountCompany: { accountId: { in: accountIds } } } })
      .catch(() => {});
    await prisma.accountCompany.deleteMany({ where: { accountId: { in: accountIds } } }).catch(() => {});
    await prisma.accountContact.deleteMany({ where: { accountId: { in: accountIds } } }).catch(() => {});
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => {});
  }
  for (const id of ghostCompanyIds) {
    await prisma.company.delete({ where: { id } }).catch(() => {});
  }
}

async function run() {
  console.log(`[smoke] start ${TEST_PREFIX}`);
  const { companies, createdCompanyIds } = await pickTwoCompanies();
  const [companyA, companyB] = companies;
  console.log(`[smoke] companyA=${companyA.name}`);
  console.log(`[smoke] companyB=${companyB.name}`);

  const createdAccountIds = [];
  const createdCaseIds = [];

  try {
    // Setup: Account A + AccountCompany A → companyA + AccountCompany B → companyB
    const adminAB = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
    const acc = await accountRepository.createAccount({
      user: adminAB,
      data: {
        name: `${TEST_PREFIX}-acc`,
        vkn: `${stamp}1`,
        companies: [
          { companyId: companyA.id, externalCustomerCode: '60001', packageName: 'Premium' },
          { companyId: companyB.id, externalCustomerCode: '60002', packageName: 'Standart' },
        ],
        phone: '+90 212 555 0000',
      },
    });
    createdAccountIds.push(acc.id);
    const acA = acc.companies.find((c) => c.companyId === companyA.id);
    const acB = acc.companies.find((c) => c.companyId === companyB.id);

    // Primary contact for context test
    await accountRepository.addContact({
      accountId: acc.id,
      user: adminAB,
      data: { fullName: 'Ayşe Yılmaz', isPrimary: true, phone: '+90 555 111 22 33', email: 'ayse@smoke.dev', preferredChannel: 'email' },
    });

    // --- 1. POST product ---
    let productId;
    {
      const r = await accountRepository.addProduct({
        accountId: acc.id,
        user: adminAB,
        data: { accountCompanyId: acA.accountCompanyId, productName: 'ERP — Finans', productCode: 'ERP-FIN' },
      });
      productId = r.id;
      record('1. Admin POST product', !!productId);
    }

    // --- 2. Duplicate productCode same accountCompany ---
    {
      let caught;
      try {
        await accountRepository.addProduct({
          accountId: acc.id,
          user: adminAB,
          data: { accountCompanyId: acA.accountCompanyId, productName: 'Başka', productCode: 'ERP-FIN' },
        });
      } catch (e) {
        caught = e;
      }
      record(
        '2. Duplicate productCode same accountCompany → 409',
        caught instanceof AccountValidationError && caught.status === 409 && caught.code === 'duplicate_product_code',
        caught?.message,
      );
    }

    // --- 3. Supervisor write 403 (requireRole) ---
    {
      const mw = requireRole('Admin', 'SystemAdmin');
      const out = await runMiddleware(mw, { user: { role: 'Supervisor' } });
      record('3. Supervisor write → 403', !out.called && out.res.statusCode === 403);
    }

    // --- 4. CSM write 403 ---
    {
      const mw = requireRole('Admin', 'SystemAdmin');
      const out = await runMiddleware(mw, { user: { role: 'CSM' } });
      record('4. CSM write → 403', !out.called && out.res.statusCode === 403);
    }

    // --- 5. Cross-tenant: Admin B-only product PATCH on A's product ---
    {
      const adminBOnly = makeUser({ role: 'Admin', allowedCompanyIds: [companyB.id] });
      let caught;
      try {
        await accountRepository.updateProduct({
          accountId: acc.id,
          productId,
          user: adminBOnly,
          data: { productName: 'Hack' },
        });
      } catch (e) {
        caught = e;
      }
      record('5. Cross-tenant product PATCH → 403', caught instanceof AccountAccessError);
    }

    // --- 6. GET products: Supervisor scoped (sadece companyA için) ---
    // Önce companyB AccountCompany'sine de bir ürün ekle
    await accountRepository.addProduct({
      accountId: acc.id,
      user: adminAB,
      data: { accountCompanyId: acB.accountCompanyId, productName: 'Mobil', productCode: 'MOB-01' },
    });
    {
      const supervisorAOnly = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.listProducts({ accountId: acc.id, user: supervisorAOnly });
      const ok =
        out.products.length === 1 &&
        out.products[0].companyId === companyA.id &&
        out.products[0].productName === 'ERP — Finans';
      record('6. Supervisor scoped GET products', ok, `count=${out.products.length}`);
    }

    // --- 7. PATCH product ---
    {
      await accountRepository.updateProduct({
        accountId: acc.id,
        productId,
        user: adminAB,
        data: { productName: 'ERP — Finans v2' },
      });
      const out = await accountRepository.listProducts({ accountId: acc.id, user: adminAB });
      const p = out.products.find((p) => p.id === productId);
      record('7. PATCH product name', p?.productName === 'ERP — Finans v2');
    }

    // --- 8. DELETE product (soft) ---
    {
      await accountRepository.removeProduct({ accountId: acc.id, productId, user: adminAB });
      const out = await accountRepository.listProducts({ accountId: acc.id, user: adminAB });
      const p = out.products.find((p) => p.id === productId);
      record('8. Soft delete product', p?.isActive === false && !!p?.endedAt);
    }

    // --- 9. Case create with accountId ---
    let caseWithAccount;
    {
      caseWithAccount = await caseRepository.create({
        title: `${TEST_PREFIX}-case-with`,
        description: 'smoke',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: companyA.id,
        companyName: companyA.name,
        accountId: acc.id,
        accountName: acc.name,
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
      });
      createdCaseIds.push(caseWithAccount.id);
      record('9. Case create with accountId', caseWithAccount.accountId === acc.id);
    }

    // --- 10. Case create with accountId=null ---
    let caseWithoutAccount;
    {
      caseWithoutAccount = await caseRepository.create({
        title: `${TEST_PREFIX}-case-without`,
        description: 'smoke without account',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: companyA.id,
        companyName: companyA.name,
        // accountId/accountName yok
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
      });
      createdCaseIds.push(caseWithoutAccount.id);
      record('10. Case create with accountId=null', caseWithoutAccount.accountId == null);
    }

    // --- 11. Account search picker eşdeğeri ---
    {
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.listAccounts({
        allowedCompanyIds: supervisor.allowedCompanyIds,
        search: TEST_PREFIX,
      });
      record('11. Account search returns scoped result', out.accounts.some((a) => a.id === acc.id));
    }

    // --- 12. customer-context: enriched ---
    {
      const context = await accountRepository.getCaseCustomerContext({
        accountId: caseWithAccount.accountId,
        companyId: caseWithAccount.companyId,
        allowedCompanyIds: [companyA.id],
      });
      const ok =
        context?.accountId === acc.id &&
        context?.company?.externalCustomerCode === '60001' &&
        context?.company?.packageName === 'Premium' &&
        context?.primaryContact?.fullName === 'Ayşe Yılmaz' &&
        Array.isArray(context?.company?.activeProducts);
      record('12. customer-context enriched (code+package+primary+products)', ok, JSON.stringify({
        ec: context?.company?.externalCustomerCode,
        pkg: context?.company?.packageName,
        contact: context?.primaryContact?.fullName,
      }));
    }

    // --- 13. customer-context: accountId null → null ---
    {
      const context = await accountRepository.getCaseCustomerContext({
        accountId: caseWithoutAccount.accountId,
        companyId: caseWithoutAccount.companyId,
        allowedCompanyIds: [companyA.id],
      });
      record('13. customer-context for accountless case → null', context === null);
    }
  } catch (err) {
    console.error('[smoke] FATAL:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    await cleanup({ accountIds: createdAccountIds, caseIds: createdCaseIds, ghostCompanyIds: createdCompanyIds });
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('[smoke] FAILED:');
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
    process.exitCode = 1;
  } else {
    console.log('[smoke] ALL GREEN');
  }
}

run();
