/**
 * Account 360 — Phase A BFF smoke.
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-account-phase-a.js`
 *
 * 12 senaryo:
 *   1. Supervisor list scope çalışır
 *   2. CSM list scope çalışır
 *   3. Agent 403 — requireRole
 *   4. Search çalışır (name + vkn prefix)
 *   5. Detail — visibleCompanies sadece izinli şirketler
 *   6. Admin create
 *   7. Duplicate VKN → 409
 *   8. Duplicate externalCustomerCode → 409
 *   9. Agent create → 403 (requireRole)
 *  10. Admin update
 *  11. Cross-tenant — Supervisor B-only iken A-only account 403
 *  12. Legacy companyId=null account list'te görünür
 *
 * Mutate: Test sonunda yarattığı Account/AccountCompany kayıtlarını siler.
 */

import { prisma } from '../server/db/client.js';
import {
  accountRepository,
  AccountAccessError,
  AccountValidationError,
  maskVkn,
} from '../server/db/accountRepository.js';
import { requireRole } from '../server/db/auth.js';

const stamp = Date.now();
const TEST_PREFIX = `smoke-acct-${stamp}`;

let results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? '✓' : '✗';
  console.log(`${tag} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickTwoCompanies() {
  const existing = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    take: 2,
  });
  if (existing.length >= 2) return { companies: existing, createdCompanyIds: [] };

  // Eksik şirketleri geçici (ghost) olarak yarat — test sonunda silinir.
  const need = 2 - existing.length;
  const createdCompanyIds = [];
  const ghosts = [];
  for (let i = 0; i < need; i++) {
    const ghost = await prisma.company.create({
      data: { name: `${TEST_PREFIX}-ghost-co-${i}`, isActive: true },
      select: { id: true, name: true },
    });
    ghosts.push(ghost);
    createdCompanyIds.push(ghost.id);
  }
  return { companies: [...existing, ...ghosts], createdCompanyIds };
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
    mw(req, res, () => next());
    if (res.statusCode !== 200 && res.payload) {
      resolve({ called: false, res });
    }
  });
}

async function cleanup(accountIds) {
  if (!accountIds.length) return;
  try {
    // AccountCompany cascade silinir, Account silmek için önce ilgili kayıtları temizle.
    await prisma.accountCompany.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.accountContact.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  } catch (err) {
    console.warn('[smoke] cleanup error:', err?.message);
  }
}

async function run() {
  console.log(`[smoke] start ${TEST_PREFIX}`);
  const { companies, createdCompanyIds } = await pickTwoCompanies();
  const [companyA, companyB] = companies;
  const ghostSet = new Set(createdCompanyIds);
  console.log(`[smoke] companyA=${companyA.name} (${companyA.id})${ghostSet.has(companyA.id) ? ' [ghost]' : ''}`);
  console.log(`[smoke] companyB=${companyB.name} (${companyB.id})${ghostSet.has(companyB.id) ? ' [ghost]' : ''}`);

  const createdIds = [];

  try {
    // Setup: yarat 3 test account — A-only, B-only, legacy null.
    const accA = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-companyA`,
        vkn: `${stamp}1`,
        companyId: companyA.id,
        companies: { create: { companyId: companyA.id, status: 'active', externalCustomerCode: '10001' } },
      },
    });
    createdIds.push(accA.id);

    const accB = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-companyB`,
        vkn: `${stamp}2`,
        companyId: companyB.id,
        companies: { create: { companyId: companyB.id, status: 'active', externalCustomerCode: '20001' } },
      },
    });
    createdIds.push(accB.id);

    const accNull = await prisma.account.create({
      data: { name: `${TEST_PREFIX}-shared`, vkn: `${stamp}3` },
    });
    createdIds.push(accNull.id);

    // --- 1. Supervisor list scope ---
    {
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.listAccounts({
        allowedCompanyIds: supervisor.allowedCompanyIds,
        search: TEST_PREFIX,
      });
      const seenNames = out.accounts.map((a) => a.name).sort();
      const expected = [`${TEST_PREFIX}-companyA`, `${TEST_PREFIX}-shared`].sort();
      const ok = JSON.stringify(seenNames) === JSON.stringify(expected);
      record('1. Supervisor list scope', ok, ok ? '' : `got=${seenNames.join(',')}`);
    }

    // --- 2. CSM list scope ---
    {
      const csm = makeUser({ role: 'CSM', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.listAccounts({
        allowedCompanyIds: csm.allowedCompanyIds,
        search: TEST_PREFIX,
      });
      const seenNames = out.accounts.map((a) => a.name).sort();
      const expected = [`${TEST_PREFIX}-companyA`, `${TEST_PREFIX}-shared`].sort();
      record('2. CSM list scope', JSON.stringify(seenNames) === JSON.stringify(expected));
    }

    // --- 3. Agent 403 (requireRole) ---
    {
      const READ_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
      const mw = requireRole(...READ_ROLES);
      const result = await runMiddleware(mw, { user: { role: 'Agent' } });
      const ok = !result.called && result.res.statusCode === 403;
      record('3. Agent 403 read', ok, `status=${result.res.statusCode}`);
    }

    // --- 4. Search çalışır (vkn startsWith) ---
    {
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.listAccounts({
        allowedCompanyIds: supervisor.allowedCompanyIds,
        search: `${stamp}1`,
      });
      const ok = out.accounts.length === 1 && out.accounts[0].id === accA.id;
      record('4. Search by vkn prefix', ok, `found=${out.accounts.length}`);
    }

    // --- 5. Detail — sadece izinli şirketler döner ---
    {
      // Acc'yi iki şirkete bağla, supervisor sadece A'ya yetkili — B görünmemeli.
      await prisma.accountCompany.create({
        data: { accountId: accA.id, companyId: companyB.id, status: 'active' },
      });
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyA.id] });
      const detail = await accountRepository.getAccount(accA.id, {
        allowedCompanyIds: supervisor.allowedCompanyIds,
      });
      const okCompanies =
        detail.companies.length === 1 && detail.companies[0].companyId === companyA.id;
      const okVknMasked = detail.vknMasked && !detail.vknMasked.includes(`${stamp}1`.slice(3, -3));
      record('5. Detail visibleCompanies + VKN masked', okCompanies && okVknMasked,
        `companies=${detail.companies.length} vknMasked=${detail.vknMasked}`);
    }

    // --- 6. Admin create ---
    let createdByAdmin;
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      createdByAdmin = await accountRepository.createAccount({
        user: admin,
        data: {
          name: `${TEST_PREFIX}-admin-new`,
          vkn: `${stamp}4`,
          phone: '0212-555-0000',
          email: 'admin-new@smoke.dev',
          companies: [
            { companyId: companyA.id, externalCustomerCode: '30001', packageName: 'Standart' },
          ],
        },
      });
      createdIds.push(createdByAdmin.id);
      const ok =
        createdByAdmin.name === `${TEST_PREFIX}-admin-new` &&
        createdByAdmin.companies.length === 1 &&
        createdByAdmin.vknMasked.startsWith(`${stamp}4`.slice(0, 3));
      record('6. Admin create', ok);
    }

    // --- 7. Duplicate VKN ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      let caught = null;
      try {
        await accountRepository.createAccount({
          user: admin,
          data: {
            name: `${TEST_PREFIX}-dup-vkn`,
            vkn: `${stamp}4`, // aynı vkn
            companies: [{ companyId: companyA.id }],
          },
        });
      } catch (err) {
        caught = err;
      }
      const ok = caught instanceof AccountValidationError && caught.status === 409 && caught.code === 'duplicate_vkn';
      record('7. Duplicate VKN → 409', ok, caught?.message);
    }

    // --- 8. Duplicate externalCustomerCode per company ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      let caught = null;
      try {
        await accountRepository.createAccount({
          user: admin,
          data: {
            name: `${TEST_PREFIX}-dup-code`,
            vkn: `${stamp}5`,
            companies: [{ companyId: companyA.id, externalCustomerCode: '30001' }],
          },
        });
      } catch (err) {
        caught = err;
      }
      const ok = caught instanceof AccountValidationError && caught.status === 409 && caught.code === 'duplicate_external_code';
      record('8. Duplicate externalCustomerCode → 409', ok, caught?.message);
    }

    // --- 9. Agent write → 403 (requireRole) ---
    {
      const WRITE_ROLES = ['Admin', 'SystemAdmin'];
      const mw = requireRole(...WRITE_ROLES);
      const result = await runMiddleware(mw, { user: { role: 'Agent' } });
      record('9. Agent write 403', !result.called && result.res.statusCode === 403);
    }

    // --- 10. Admin update ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      const updated = await accountRepository.updateAccount({
        accountId: createdByAdmin.id,
        user: admin,
        data: { phone: '0212-999-9999', email: 'updated@smoke.dev' },
      });
      const ok = updated.phone === '0212-999-9999' && updated.email === 'updated@smoke.dev';
      record('10. Admin update', ok);
    }

    // --- 11. Cross-tenant: Supervisor B-only iken A-only account → 403 ---
    {
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyB.id] });
      // createdByAdmin sadece A'ya bağlı; companyId=A; legacy de A.
      let caught = null;
      try {
        await accountRepository.getAccount(createdByAdmin.id, {
          allowedCompanyIds: supervisor.allowedCompanyIds,
        });
      } catch (err) {
        caught = err;
      }
      const ok = caught instanceof AccountAccessError;
      record('11. Cross-tenant detail → 403', ok, caught?.message);
    }

    // --- 12. Legacy companyId=null account list'te görünür ---
    {
      // allowedCompanyIds = [B] iken accNull (companyId=null) görünmeli (shared kuralı).
      const supervisor = makeUser({ role: 'Supervisor', allowedCompanyIds: [companyB.id] });
      const out = await accountRepository.listAccounts({
        allowedCompanyIds: supervisor.allowedCompanyIds,
        search: TEST_PREFIX,
      });
      const ok = out.accounts.some((a) => a.id === accNull.id);
      record('12. Legacy null account visible (shared)', ok, `seenIds=${out.accounts.map((a) => a.id).join(',')}`);
    }

    // --- Bonus: maskVkn sanity ---
    {
      const m = maskVkn('1234567890');
      const ok = m === '123****890';
      record('* maskVkn sanity', ok, `got=${m}`);
    }
  } catch (err) {
    console.error('[smoke] FATAL:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    await cleanup(createdIds);
    for (const ghostId of createdCompanyIds) {
      try {
        await prisma.company.delete({ where: { id: ghostId } });
      } catch (err) {
        console.warn('[smoke] ghost company cleanup error:', err?.message);
      }
    }
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
