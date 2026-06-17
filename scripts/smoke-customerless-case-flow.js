/**
 * Customerless Case Flow focused smoke (Phase D Step 2 completion).
 *
 * Müşterisiz vaka intake'i + requester-context tabanlı suggestion engine'i
 * uçtan-uca doğrular. Read-only değil — setup için case/account ve kısa süreli
 * CompanySettings mutasyonu yapar; sonunda her şey temizlenir.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-customerless-case-flow.js
 *
 * Senaryolar:
 *   1. allow-customerless company → caseRepository.create(accountId=null) başarılı
 *   2. strict company (requireCustomerOnCaseCreate=true) → 400 customer_required
 *   3. Customerless + requester phone → suggestion phone match (score ≥ 50)
 *   4. Customerless + requester email → suggestion email match (score ≥ 50)
 *   5. Customerless + requester company name → suggestion name match
 *   6. Linked case → suggestions empty + 'case_already_linked'
 *   7. Cross-company candidate (requester phone in companyB) → exclude
 *
 * Güvenlik:
 *   - Bir tek companyB için requireCustomerOnCaseCreate=true geçici set edilir,
 *     finally bloğunda eski hâline döndürülür.
 *   - Yaratılan tüm case/account satırları finally'de silinir.
 *   - Üretilen telefon/email değerleri sentetik — gerçek müşteri bilgisi değil.
 */

import { prisma } from '../server/db/client.js';
import { caseRepository, CaseValidationError } from './_actor-fixture.js';
import { suggestCustomerMatches } from '../server/db/customerMatchRepository.js';

const stamp = Date.now();
const PREFIX = `ccf-smoke-${stamp}`;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickTwoCompanies() {
  const all = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    take: 2,
  });
  if (all.length < 2) {
    throw new Error('Smoke için en az 2 aktif şirket gerekli — db:seed çalıştır.');
  }
  return all.map((c) => ({ id: c.id, name: c.name }));
}

async function makeAccount(companyId, opts = {}) {
  return prisma.account.create({
    data: {
      name: opts.name ?? `${PREFIX}-acc`,
      phone: opts.phone ?? null,
      email: opts.email ?? null,
      companyId,
      companies: { create: { companyId, status: 'active' } },
    },
  });
}

const baseCaseInput = (companyId, companyName, extras = {}) => ({
  title: extras.title ?? 'smoke title',
  description: extras.description ?? 'smoke desc',
  caseType: 'GeneralSupport',
  priority: 'Medium',
  origin: 'Telefon',
  companyId,
  companyName,
  category: 'Yazılım',
  subCategory: 'Genel',
  requestType: 'Talep',
  ...extras,
});

async function run() {
  console.log('🔍 customerless-case-flow smoke\n');

  const [companyA, companyB] = await pickTwoCompanies();
  const allowed = [companyA.id, companyB.id];

  // companyB üzerinde requireCustomerOnCaseCreate'i geçici olarak true yap;
  // sonunda eski hâline döndür.
  const existingB = await prisma.companySettings.findUnique({
    where: { companyId: companyB.id },
    select: { requireCustomerOnCaseCreate: true },
  });
  const restoreB = existingB ? !!existingB.requireCustomerOnCaseCreate : false;
  const existedB = !!existingB;

  const caseIds = [];
  const accountIds = [];

  try {
    await prisma.companySettings.upsert({
      where: { companyId: companyB.id },
      create: { companyId: companyB.id, requireCustomerOnCaseCreate: true },
      update: { requireCustomerOnCaseCreate: true },
    });

    // 1) allow-customerless company → caseRepository.create başarılı
    {
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-customerless-ok`,
          description: 'müşterisiz akış — accountId yok',
        }),
      );
      caseIds.push(created.id);
      const ok =
        !created.accountId &&
        created.customerMatchPending === true;
      record(
        '1. allow-customerless company → create(accountId=null) succeeds',
        ok,
        `case=${created.caseNumber} pending=${created.customerMatchPending}`,
      );
    }

    // 2) strict company → CaseValidationError customer_required
    {
      let caught = null;
      try {
        const c = await caseRepository.create(
          baseCaseInput(companyB.id, companyB.name, {
            title: `${PREFIX}-strict-violation`,
            description: 'should fail',
          }),
        );
        caseIds.push(c.id);
      } catch (err) {
        caught = err;
      }
      const ok =
        caught instanceof CaseValidationError &&
        caught.code === 'customer_required' &&
        caught.status === 400;
      record(
        '2. strict company → 400 customer_required',
        ok,
        caught ? `code=${caught.code} status=${caught.status}` : 'no error thrown',
      );
    }

    // 3) Customerless + requester phone → phone match (score ≥ 50)
    {
      const phone = `+90 555 ${100000 + (stamp % 900000)}`;
      const acc = await makeAccount(companyA.id, {
        name: `${PREFIX}-phone-acc`,
        phone,
      });
      accountIds.push(acc.id);
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-req-phone`,
          description: 'müşterisiz; başvuran numarasından geliyor',
          customerContactPhone: phone,
          customerContactName: 'Test İletişim',
        }),
      );
      caseIds.push(created.id);
      const out = await suggestCustomerMatches({
        caseId: created.id,
        allowedCompanyIds: allowed,
      });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      const ok =
        !!hit &&
        hit.score >= 50 &&
        hit.reasons.some((r) => r.type === 'phone');
      record(
        '3. requester phone → suggestion phone match (score ≥ 50)',
        ok,
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 4) Customerless + requester email → email match (score ≥ 50)
    {
      const email = `req-${stamp}@ccf.dev`;
      const acc = await makeAccount(companyA.id, {
        name: `${PREFIX}-email-acc`,
        email,
      });
      accountIds.push(acc.id);
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-req-email`,
          description: 'müşterisiz; başvuran e-posta bıraktı',
          customerContactEmail: email,
        }),
      );
      caseIds.push(created.id);
      const out = await suggestCustomerMatches({
        caseId: created.id,
        allowedCompanyIds: allowed,
      });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      const ok =
        !!hit &&
        hit.score >= 50 &&
        hit.reasons.some((r) => r.type === 'email');
      record(
        '4. requester email → suggestion email match (score ≥ 50)',
        ok,
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 5) Customerless + requester company name → name match
    {
      const acc = await makeAccount(companyA.id, {
        name: `${PREFIX} ÖzelFirmaAdi Holding`,
      });
      accountIds.push(acc.id);
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-req-company`,
          description: 'müşteri kayıtsız — firma bilgisi başvuranda',
          customerCompanyName: `${PREFIX} OzelFirmaAdi`,
        }),
      );
      caseIds.push(created.id);
      const out = await suggestCustomerMatches({
        caseId: created.id,
        allowedCompanyIds: allowed,
      });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      const ok = !!hit && hit.reasons.some((r) => r.type === 'name');
      record(
        '5. requester company name → suggestion name match',
        ok,
        hit ? `score=${hit.score} reason=${hit.reasons.map((r) => r.type).join(',')}` : 'no hit',
      );
    }

    // 6) Linked case → suggestions empty + reason
    {
      const acc = await makeAccount(companyA.id, { name: `${PREFIX}-linked-acc` });
      accountIds.push(acc.id);
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-linked-case`,
          description: 'müşteri bağlı',
          accountId: acc.id,
          accountName: acc.name,
        }),
      );
      caseIds.push(created.id);
      const out = await suggestCustomerMatches({
        caseId: created.id,
        allowedCompanyIds: allowed,
      });
      const ok = out.suggestions.length === 0 && out.reason === 'case_already_linked';
      record(
        '6. linked case → empty + case_already_linked',
        ok,
        `reason=${out.reason} count=${out.suggestions.length}`,
      );
    }

    // 7) Cross-company candidate exclude — requester phone account companyB'de,
    //    case companyA'da; companyB account önerilerde GÖZÜKMEMELİ.
    {
      const phone = `+90 222 ${200000 + (stamp % 900000)}`;
      const accB = await makeAccount(companyB.id, {
        name: `${PREFIX}-crossB-acc`,
        phone,
      });
      accountIds.push(accB.id);
      const created = await caseRepository.create(
        baseCaseInput(companyA.id, companyA.name, {
          title: `${PREFIX}-cross-company`,
          description: 'A scope vakası ama numara B account',
          customerContactPhone: phone,
        }),
      );
      caseIds.push(created.id);
      // İzin companyA'ya sınırlı — companyB hidden olmalı
      const out = await suggestCustomerMatches({
        caseId: created.id,
        allowedCompanyIds: [companyA.id],
      });
      const leaked = out.suggestions.some((s) => s.accountId === accB.id);
      record(
        '7. cross-company candidate excluded',
        !leaked,
        leaked ? 'B-account leaked into A scope' : 'no leak',
      );
    }
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    // Cleanup — case, account, accountCompany; CompanySettings'i restore et.
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {});
    await prisma.accountCompany.deleteMany({ where: { accountId: { in: accountIds } } }).catch(() => {});
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => {});

    if (existedB) {
      await prisma.companySettings
        .update({
          where: { companyId: companyB.id },
          data: { requireCustomerOnCaseCreate: restoreB },
        })
        .catch(() => {});
    } else {
      await prisma.companySettings
        .delete({ where: { companyId: companyB.id } })
        .catch(() => {});
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
