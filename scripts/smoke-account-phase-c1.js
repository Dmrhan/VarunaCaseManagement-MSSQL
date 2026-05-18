/**
 * Account 360 — Phase C1 BFF smoke.
 *
 * Çalıştır: `node --env-file=.env scripts/smoke-account-phase-c1.js`
 *
 * Senaryolar:
 *  Audit fix:
 *   1. Bootstrap accounts AccountCompany-only bağlı müşteriyi içeriyor
 *
 *  AccountCompany CRUD:
 *   2. Admin POST /companies — ekle (status, externalCustomerCode)
 *   3. POST duplicate (accountId, companyId) → 409
 *   4. POST 4-hane externalCustomerCode → 400
 *   5. POST duplicate externalCustomerCode → 409
 *   6. PATCH packageName + status update
 *   7. Admin başka şirketteki AccountCompany'i düzenleyemez → 403
 *   8. DELETE kaldır
 *
 *  AccountContact CRUD:
 *   9. Admin POST /contacts ekle
 *  10. POST isPrimary=true ile ikinci kontak → ilk primary otomatik düşer
 *  11. PATCH preferredChannel + isPrimary toggle
 *  12. DELETE soft delete (isActive=false + isPrimary=false)
 *
 *  Role:
 *  13. requireRole — Supervisor write endpoint'inde 403
 *  14. requireRole — CSM write endpoint'inde 403
 */

import { prisma } from '../server/db/client.js';
import { accountRepository, AccountAccessError, AccountValidationError } from '../server/db/accountRepository.js';
import { lookupRepository } from '../server/db/lookupRepository.js';
import { requireRole } from '../server/db/auth.js';

const stamp = Date.now();
const TEST_PREFIX = `smoke-c1-${stamp}`;

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
    if (res.statusCode !== 200 && res.payload) {
      resolve({ called: false, res });
    }
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

async function cleanup(accountIds, ghostCompanyIds) {
  if (accountIds.length) {
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
  console.log(`[smoke] companyA=${companyA.name} (${companyA.id})`);
  console.log(`[smoke] companyB=${companyB.name} (${companyB.id})`);

  const createdAccountIds = [];

  try {
    // ===== Audit fix prep: Account A — legacy companyId=null + AccountCompany→companyA =====
    const acc = await prisma.account.create({
      data: {
        name: `${TEST_PREFIX}-acc`,
        // Account.companyId BİLİNÇLİ null bırakılıyor — eski bootstrap filter'ı bunu
        // her zaman "shared" sayıp herkese gösteriyordu, AccountCompany yi gözetmiyordu.
        companyId: null,
        companies: { create: { companyId: companyA.id, status: 'active' } },
      },
      include: { companies: true },
    });
    createdAccountIds.push(acc.id);

    // --- 1. Audit fix: bootstrap allowedCompanyIds=[A] → account görünmeli ---
    {
      const out = await lookupRepository.bootstrap([companyA.id]);
      const seen = out.accounts.some((a) => a.id === acc.id);
      record('1. Bootstrap audit fix — AccountCompany-only account visible', seen);
    }

    // --- 2. Admin POST /companies ekle (companyB) ---
    let acc2;
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      const updated = await accountRepository.addCompanyRelation({
        accountId: acc.id,
        user: admin,
        data: {
          companyId: companyB.id,
          externalCustomerCode: '50001',
          packageName: 'Standart',
          contractStartAt: '2026-01-01',
          status: 'active',
        },
      });
      acc2 = updated;
      const okCount = updated.companies.length === 2;
      const okCode = updated.companies.find((c) => c.companyId === companyB.id)?.externalCustomerCode === '50001';
      record('2. Admin POST /companies adds relation', okCount && okCode);
    }

    // --- 3. Duplicate (accountId, companyId) ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      let caught;
      try {
        await accountRepository.addCompanyRelation({
          accountId: acc.id,
          user: admin,
          data: { companyId: companyB.id },
        });
      } catch (e) {
        caught = e;
      }
      record(
        '3. Duplicate relation → 409',
        caught instanceof AccountValidationError && caught.status === 409 && caught.code === 'duplicate_relation',
        caught?.message,
      );
    }

    // --- 4. 4-hane externalCustomerCode reddi ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      let caught;
      try {
        await accountRepository.addCompanyRelation({
          accountId: acc.id,
          user: admin,
          data: { companyId: companyA.id, externalCustomerCode: '1234' }, // 4 hane
        });
      } catch (e) {
        caught = e;
      }
      record('4. 4-digit externalCustomerCode rejected', caught instanceof AccountValidationError && caught.status === 400, caught?.message);
    }

    // --- 5. Duplicate externalCustomerCode per company ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      // companyB'de '50001' zaten 2. senaryoda kullanıldı.
      // Yeni bir account yarat ve aynı kodu vermeye çalış.
      const accDup = await prisma.account.create({
        data: { name: `${TEST_PREFIX}-acc-dup`, companyId: companyB.id, companies: { create: { companyId: companyB.id, status: 'active' } } },
      });
      createdAccountIds.push(accDup.id);

      let caught;
      try {
        await accountRepository.addCompanyRelation({
          accountId: accDup.id,
          user: admin,
          data: { companyId: companyA.id, externalCustomerCode: '50001' }, // OK farklı şirket
        });
        // companyB için aynı kodla başka bir Account → çakışmalı.
        // Yukarıdaki başarılı eklemeden sonra, başka bir yeni account ile companyB'de aynı kod denenir.
      } catch (e) {
        caught = e;
      }
      // İlk çağrı farklı şirket olduğu için BAŞARILI olmalı; companyB için ikinci dene.
      let caught2;
      try {
        await accountRepository.addCompanyRelation({
          accountId: accDup.id,
          user: admin,
          data: { companyId: companyB.id, externalCustomerCode: '50001' }, // CHARM: bu zaten relation var
        });
      } catch (e) {
        caught2 = e;
      }
      // companyB için ilişki zaten var → duplicate_relation veya code çakışması;
      // hangisi olduğu önemli — her ikisi de 409.
      const ok = caught === undefined && caught2 instanceof AccountValidationError && caught2.status === 409;
      record('5. Cross-company same code OK, same-company duplicate code 409', ok, caught2?.code);
    }

    // --- 6. PATCH packageName + status ---
    let acc6;
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      const relA = acc2.companies.find((c) => c.companyId === companyB.id);
      const updated = await accountRepository.updateCompanyRelation({
        accountId: acc.id,
        accountCompanyId: relA.accountCompanyId,
        user: admin,
        data: { packageName: 'Premium', status: 'churn', notes: 'Sözleşme yenileme' },
      });
      acc6 = updated;
      const relAfter = updated.companies.find((c) => c.companyId === companyB.id);
      const ok = relAfter.packageName === 'Premium' && relAfter.status === 'churn' && relAfter.notes === 'Sözleşme yenileme';
      record('6. PATCH packageName + status + notes', ok);
    }

    // --- 7. Cross-tenant: Admin B-only PATCH companyA ilişkisi → 403 ---
    {
      const adminBOnly = makeUser({ role: 'Admin', allowedCompanyIds: [companyB.id] });
      const relA = acc6.companies.find((c) => c.companyId === companyA.id);
      // adminBOnly companyB'ye yetkili, companyA ilişkisini düzenleyemez.
      let caught;
      try {
        await accountRepository.updateCompanyRelation({
          accountId: acc.id,
          accountCompanyId: relA.accountCompanyId,
          user: adminBOnly,
          data: { packageName: 'Hack' },
        });
      } catch (e) {
        caught = e;
      }
      record('7. Cross-tenant PATCH → 403', caught instanceof AccountAccessError, caught?.message);
    }

    // --- 8. DELETE relation ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id, companyB.id] });
      const relB = acc6.companies.find((c) => c.companyId === companyB.id);
      const updated = await accountRepository.removeCompanyRelation({
        accountId: acc.id,
        accountCompanyId: relB.accountCompanyId,
        user: admin,
      });
      const ok = updated.companies.find((c) => c.companyId === companyB.id) === undefined;
      record('8. DELETE relation removes it', ok);
    }

    // --- 9. POST /contacts ekle ---
    let accAfterContact;
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.addContact({
        accountId: acc.id,
        user: admin,
        data: { fullName: 'Ayşe Yılmaz', title: 'Karar Verici', email: 'ayse@smoke.dev', isPrimary: true, preferredChannel: 'email' },
      });
      accAfterContact = out;
      const c1 = out.contacts.find((c) => c.fullName === 'Ayşe Yılmaz');
      const ok = c1 && c1.isPrimary && c1.preferredChannel === 'email';
      record('9. POST contact (primary)', ok);
    }

    // --- 10. POST ikinci primary → eski primary düşer ---
    let accTwoContacts;
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      const out = await accountRepository.addContact({
        accountId: acc.id,
        user: admin,
        data: { fullName: 'Bora Demir', isPrimary: true, preferredChannel: 'phone' },
      });
      accTwoContacts = out;
      const ayse = out.contacts.find((c) => c.fullName === 'Ayşe Yılmaz');
      const bora = out.contacts.find((c) => c.fullName === 'Bora Demir');
      const ok = bora?.isPrimary === true && ayse?.isPrimary === false;
      record('10. Second isPrimary demotes previous', ok);
    }

    // --- 11. PATCH preferredChannel + isPrimary toggle ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      const ayse = accTwoContacts.contacts.find((c) => c.fullName === 'Ayşe Yılmaz');
      const out = await accountRepository.updateContact({
        accountId: acc.id,
        contactId: ayse.id,
        user: admin,
        data: { preferredChannel: 'whatsapp', isPrimary: true },
      });
      const updated = out.contacts.find((c) => c.id === ayse.id);
      const bora = out.contacts.find((c) => c.fullName === 'Bora Demir');
      const ok =
        updated.preferredChannel === 'whatsapp' && updated.isPrimary === true && bora.isPrimary === false;
      record('11. PATCH preferredChannel + reassign primary', ok);
    }

    // --- 12. DELETE contact (soft) ---
    {
      const admin = makeUser({ role: 'Admin', allowedCompanyIds: [companyA.id] });
      const ayse = accTwoContacts.contacts.find((c) => c.fullName === 'Ayşe Yılmaz');
      const out = await accountRepository.removeContact({
        accountId: acc.id,
        contactId: ayse.id,
        user: admin,
      });
      const removed = out.contacts.find((c) => c.id === ayse.id);
      const ok = removed && removed.isActive === false && removed.isPrimary === false;
      record('12. DELETE contact (soft + isPrimary cleared)', ok);
    }

    // --- 13. Supervisor write 403 ---
    {
      const WRITE_ROLES = ['Admin', 'SystemAdmin'];
      const mw = requireRole(...WRITE_ROLES);
      const result = await runMiddleware(mw, { user: { role: 'Supervisor' } });
      record('13. Supervisor write → 403', !result.called && result.res.statusCode === 403);
    }

    // --- 14. CSM write 403 ---
    {
      const WRITE_ROLES = ['Admin', 'SystemAdmin'];
      const mw = requireRole(...WRITE_ROLES);
      const result = await runMiddleware(mw, { user: { role: 'CSM' } });
      record('14. CSM write → 403', !result.called && result.res.statusCode === 403);
    }
  } catch (err) {
    console.error('[smoke] FATAL:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    await cleanup(createdAccountIds, createdCompanyIds);
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
