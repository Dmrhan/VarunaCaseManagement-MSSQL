/**
 * smoke-account-new-case-prefill.js — WR-C3 / PM-08
 *
 * AccountDetail → "Yeni Vaka" entry point uses the full NewCaseForm and
 * pre-fills `initialContext: { accountId, accountName, companyId }`. The
 * picker / company combobox stay editable. Backend semantics for case
 * creation don't change; this smoke exercises the create payload shapes
 * AccountDetailPage emits + the customerless regression.
 *
 * Scenarios:
 *   1. Single-company account → create with prefilled companyId + accountId.
 *   2. Multi-company account → create when operator picks ONE of the
 *      account's companies (mimics the combobox); a Case created against
 *      that company carries the right (accountId, companyId, accountName).
 *   3. Multi-company → operator changes to a DIFFERENT one of the
 *      account's companies (still valid). Case attaches to that company.
 *   4. Customerless regression: create a customerless Case (accountId=null,
 *      accountName='Müşterisiz vaka') under a company that allows it; the
 *      backend still accepts it independently of C3 prefill changes.
 *   5. Existing NewCaseForm create flow regression: a plain create with
 *      `accountId+companyId` but no prefill returns the same shape it
 *      always has (sanity check that NewCaseForm did not change semantics).
 *
 * Mutation: creates Accounts + Cases under stamped names; cleans up at end.
 *
 * Usage:
 *   node --env-file=.env scripts/smoke-account-new-case-prefill.js
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';

const stamp = Date.now();
const PREFIX = `c3-anc-${stamp}`;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, reason = '') {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`⊘ SKIP ${name}${reason ? ' — ' + reason : ''}`);
}

async function pickCompanies(n) {
  return prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, take: n });
}

async function pickCustomerlessCompany() {
  const settings = await prisma.companySettings.findMany({
    where: { requireCustomerOnCaseCreate: false },
    select: { companyId: true },
  });
  const allowIds = new Set(settings.map((s) => s.companyId));
  const all = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  return all.find((c) => allowIds.has(c.id) || !settings.some((s) => s.companyId === c.id));
}

const createdAccountIds = [];
const createdCaseIds = [];

async function makeAccount({ companyIds, name }) {
  const acc = await prisma.account.create({
    data: {
      name,
      isActive: true,
      // Direct companyId so the account isn't treated as legacy by
      // buildScopeWhere (so it has a clear "primary" tenant).
      companyId: companyIds[0],
      companies: {
        create: companyIds.map((id) => ({ companyId: id, status: 'active' })),
      },
    },
    select: {
      id: true,
      name: true,
      companies: { select: { id: true, companyId: true } },
    },
  });
  createdAccountIds.push(acc.id);
  return acc;
}

async function makeCase(payload) {
  const c = await caseRepository.create(payload);
  createdCaseIds.push(c.id);
  return c;
}

async function cleanup() {
  for (const id of createdCaseIds) {
    await prisma.case.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdAccountIds) {
    await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
    await prisma.account.delete({ where: { id } }).catch(() => {});
  }
}

try {
  // ── Fixtures ──
  const cos = await pickCompanies(3);
  if (cos.length < 2) {
    console.log('SKIP — need ≥2 active companies in dev DB');
    await prisma.$disconnect();
    process.exit(0);
  }
  const [companyA, companyB] = cos;
  const customerlessCo = await pickCustomerlessCompany();

  // 1) Single-company account → prefilled companyId from AccountDetail.
  const singleAcc = await makeAccount({
    companyIds: [companyA.id],
    name: `${PREFIX}-single`,
  });
  {
    const c = await makeCase({
      title: `${PREFIX}-single-case`,
      description: 'C3 single-company prefill',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: companyA.id,
      companyName: companyA.name,
      accountId: singleAcc.id,
      accountName: singleAcc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    });
    record('1) Single-company account → create attaches to that company',
      c.accountId === singleAcc.id && c.companyId === companyA.id && c.accountName === singleAcc.name,
      `accountId=${c.accountId} companyId=${c.companyId} name=${c.accountName}`,
    );
  }

  // 2 + 3) Multi-company account.
  const multiAcc = await makeAccount({
    companyIds: [companyA.id, companyB.id],
    name: `${PREFIX}-multi`,
  });
  {
    const cA = await makeCase({
      title: `${PREFIX}-multi-A`,
      description: 'C3 multi → companyA',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: companyA.id,
      companyName: companyA.name,
      accountId: multiAcc.id,
      accountName: multiAcc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    });
    record('2) Multi-company → operator picks companyA → case attaches to companyA',
      cA.accountId === multiAcc.id && cA.companyId === companyA.id,
      `accountId=${cA.accountId} companyId=${cA.companyId}`,
    );

    const cB = await makeCase({
      title: `${PREFIX}-multi-B`,
      description: 'C3 multi → companyB',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: companyB.id,
      companyName: companyB.name,
      accountId: multiAcc.id,
      accountName: multiAcc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    });
    record('3) Multi-company → operator changes to companyB → case attaches to companyB',
      cB.accountId === multiAcc.id && cB.companyId === companyB.id,
      `accountId=${cB.accountId} companyId=${cB.companyId}`,
    );
  }

  // 4) Customerless regression (independent of C3).
  if (!customerlessCo) {
    skip('4) Customerless regression', 'no customerless-allowed company in dev DB');
  } else {
    const c = await makeCase({
      title: `${PREFIX}-customerless`,
      description: 'C3 must not break customerless flow',
      caseType: 'GeneralSupport',
      priority: 'Low',
      origin: 'Telefon',
      companyId: customerlessCo.id,
      companyName: customerlessCo.name,
      accountId: null,
      accountName: null,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
      customerContactName: `${PREFIX}-requester`,
    });
    record('4) Customerless case still creates (no account, requester context only)',
      c.accountId === null && (c.accountName === null || c.accountName === undefined),
      `accountId=${c.accountId} name=${c.accountName}`,
    );
  }

  // 5) Existing flow regression — create with (account, company) without
  //    going through any prefill path. Backend semantics unchanged.
  const plainAcc = await makeAccount({
    companyIds: [companyA.id],
    name: `${PREFIX}-plain`,
  });
  {
    const c = await makeCase({
      title: `${PREFIX}-plain-case`,
      description: 'pre-C3 baseline create',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: companyA.id,
      companyName: companyA.name,
      accountId: plainAcc.id,
      accountName: plainAcc.name,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
    });
    // Status enum is mapped in Prisma (@map("Açık")); accept either the
    // enum name or the mapped value. The point of this assertion is
    // "create returns a valid open case" — not enum serialization.
    const openStatuses = new Set(['Acik', 'Açık']);
    record('5) Existing NewCaseForm create flow regression — shape unchanged',
      c.accountId === plainAcc.id &&
        c.companyId === companyA.id &&
        openStatuses.has(c.status) &&
        typeof c.caseNumber === 'string',
      `caseNumber=${c.caseNumber} status=${c.status}`,
    );
  }
} finally {
  await cleanup();
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${results.length - failed}/${results.length} passed (${skipped} skipped)`);
process.exit(failed > 0 ? 1 : 0);
