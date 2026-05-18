/**
 * Customer Match Suggestions focused smoke (Phase D Step 2).
 *
 * Read-only suggest çağrıları yapar; DB mutasyonu sadece smoke setup için
 * (test account/case yarat + sonunda temizle).
 *
 * Çalıştır: node --env-file=.env scripts/smoke-customer-match-suggestions.js
 *
 * Senaryolar:
 *   1. Phone match → reasons.phone hit + score ≥ 50
 *   2. Email match → reasons.email hit + score ≥ 50
 *   3. External code match → reasons.externalCode hit + score ≥ 60
 *   4. Name similarity → reasons.name hit
 *   5. No match → suggestions boş
 *   6. Cross-company candidate excluded
 *   7. Linked case → empty + reason 'case_already_linked'
 */

import { prisma } from '../server/db/client.js';
import { suggestCustomerMatches } from '../server/db/customerMatchRepository.js';

const stamp = Date.now();
const PREFIX = `cms-smoke-${stamp}`;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickTwoCompanies() {
  const all = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  if (all.length < 2) throw new Error('Smoke için en az 2 aktif şirket gerekli — db:seed çalıştır.');
  return all.slice(0, 2).map((c) => c.id);
}

async function makeCase(companyId, overrides = {}) {
  return prisma.case.create({
    data: {
      caseNumber: overrides.caseNumber ?? `${PREFIX}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: overrides.title ?? 'smoke',
      description: overrides.description ?? 'smoke',
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Telefon',
      companyId,
      companyName: 'X',
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
      customerMatchPending: overrides.accountId ? false : true,
      ...overrides,
    },
  });
}

async function makeAccount(companyId, opts = {}) {
  return prisma.account.create({
    data: {
      name: opts.name ?? `${PREFIX}-acc`,
      phone: opts.phone ?? null,
      email: opts.email ?? null,
      companyId,
      companies: {
        create: {
          companyId,
          status: 'active',
          externalCustomerCode: opts.externalCustomerCode ?? null,
          packageName: opts.packageName ?? null,
          products: opts.products
            ? { create: opts.products.map((p) => ({ productName: p, isActive: true })) }
            : undefined,
        },
      },
    },
    include: { companies: true },
  });
}

async function cleanup(ids) {
  const { caseIds, accountIds } = ids;
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {});
  await prisma.accountProduct
    .deleteMany({ where: { accountCompany: { accountId: { in: accountIds } } } })
    .catch(() => {});
  await prisma.accountCompany.deleteMany({ where: { accountId: { in: accountIds } } }).catch(() => {});
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => {});
}

async function run() {
  console.log('🔍 customer-match-suggestions smoke\n');
  const [companyA, companyB] = await pickTwoCompanies();
  const allowed = [companyA, companyB];
  const caseIds = [];
  const accountIds = [];

  try {
    // 1. Phone match
    {
      const phone = `+90 555 ${100000 + (stamp % 1000)}`;
      const acc = await makeAccount(companyA, { name: `${PREFIX}-phone-acc`, phone });
      accountIds.push(acc.id);
      const c = await makeCase(companyA, {
        title: 'Aradı',
        description: `Müşteri ${phone} numarasından aradı`,
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      record(
        '1. Phone match → suggestion + reason.phone',
        !!hit && hit.score >= 50 && hit.reasons.some((r) => r.type === 'phone'),
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 2. Email match
    {
      const email = `smoke-${stamp}@cms.dev`;
      const acc = await makeAccount(companyA, { name: `${PREFIX}-email-acc`, email });
      accountIds.push(acc.id);
      const c = await makeCase(companyA, {
        title: 'Mail',
        description: `İletişim için ${email} adresi verildi`,
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      record(
        '2. Email match → suggestion + reason.email',
        !!hit && hit.score >= 50 && hit.reasons.some((r) => r.type === 'email'),
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 3. External code match
    {
      const code = '88123';
      const acc = await makeAccount(companyA, { name: `${PREFIX}-code-acc`, externalCustomerCode: code });
      accountIds.push(acc.id);
      const c = await makeCase(companyA, {
        title: 'Kod',
        description: `Müşteri kodu ${code} olan sistemde sorun var`,
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      record(
        '3. External code match → reason.externalCode',
        !!hit && hit.score >= 60 && hit.reasons.some((r) => r.type === 'externalCode'),
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 4. Name similarity
    {
      const acc = await makeAccount(companyA, { name: `${PREFIX} ÖzelBenzerlik Holding` });
      accountIds.push(acc.id);
      const c = await makeCase(companyA, {
        title: 'OzelBenzerlik holding entegrasyon hatası',
        description: 'müşteri kayıtsız',
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      record(
        '4. Name similarity → reason.name',
        !!hit && hit.reasons.some((r) => r.type === 'name'),
        hit ? `score=${hit.score}` : 'no hit',
      );
    }

    // 5. No match
    {
      const c = await makeCase(companyA, {
        title: 'Tamamen alakasız vaka başlığı',
        description: 'Hiçbir ipucu yok',
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      // Diğer testlerden kalan eşleşmeler PARAM'da olabilir — sadece bu test'in
      // synth account'larına bakmıyoruz; out.suggestions yüksek skorlu olmamalı.
      const topScore = out.suggestions[0]?.score ?? 0;
      record(
        '5. No match → suggestions empty or low-only',
        out.suggestions.every((s) => s.score < 40),
        `top=${topScore}`,
      );
    }

    // 6. Cross-company candidate excluded
    {
      const accB = await makeAccount(companyB, { name: `${PREFIX}-CrossExclusive`, phone: '+90 111 222 3344' });
      accountIds.push(accB.id);
      const c = await makeCase(companyA, {
        title: 'Aradı',
        description: 'Telefon +90 111 222 3344 bizi aradı',
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const leaked = out.suggestions.some((s) => s.accountId === accB.id);
      record('6. Cross-company candidate excluded', !leaked, leaked ? 'B-account leaked into A scope' : '');
    }

    // 7. Linked case → empty + reason 'case_already_linked'
    {
      const acc = await makeAccount(companyA, { name: `${PREFIX}-linked` });
      accountIds.push(acc.id);
      const c = await prisma.case.create({
        data: {
          caseNumber: `${PREFIX}-linked-${Math.random().toString(36).slice(2, 6)}`,
          title: 'Linked',
          description: 'already linked',
          caseType: 'GeneralSupport',
          status: 'Acik',
          priority: 'Medium',
          origin: 'Telefon',
          companyId: companyA,
          companyName: 'X',
          accountId: acc.id,
          accountName: acc.name,
          customerMatchPending: false,
          category: 'Yazılım',
          subCategory: 'Genel',
          requestType: 'Talep',
        },
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      record(
        '7. Linked case → empty + case_already_linked',
        out.suggestions.length === 0 && out.reason === 'case_already_linked',
        `reason=${out.reason}`,
      );
    }

    // 8. Privacy — yanıtta notes/segment alanları yok
    {
      const acc = await makeAccount(companyA, { name: `${PREFIX}-privacy`, phone: '+90 999 888 7777' });
      // Account'un AccountCompany'sine notes set et — yine de response'a sızmamalı.
      await prisma.accountCompany.updateMany({
        where: { accountId: acc.id },
        data: { notes: 'GIZLI iç not — sızmamalı', segment: 'SIZMASIN' },
      });
      accountIds.push(acc.id);
      const c = await makeCase(companyA, {
        title: 'Aradı',
        description: '+90 999 888 7777 numaralı kişi aradı',
      });
      caseIds.push(c.id);
      const out = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: allowed });
      const hit = out.suggestions.find((s) => s.accountId === acc.id);
      const noNotesOrSegment = hit
        ? !JSON.stringify(hit).includes('GIZLI') && !JSON.stringify(hit).includes('SIZMASIN') &&
          !hit.companies.some((c) => 'notes' in c || 'segment' in c)
        : true;
      record('8. Privacy — notes/segment not exposed', noNotesOrSegment);
    }
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    await cleanup({ caseIds, accountIds });
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
