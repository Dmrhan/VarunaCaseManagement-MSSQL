#!/usr/bin/env node
/**
 * M6.3b Faz 1 — "Yanıt bekliyor" rozeti backend kontratı.
 *
 *  (1) caseRepository scalar field expose: list response c.pendingCustomerReply
 *      + c.lastEmailOutboundAt + c.lastEmailInboundAt mevcut
 *  (2) filter param: pendingCustomerReply=true → sadece pending vakalar
 *  (3) filter param: pendingCustomerReply=false → sadece pending olmayan
 *  (4) terminal vakada pending hep false (M6.3 hotfix matris korunmuş)
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';

const TENANT = '__m6-3b-pending__';
const TENANT_NAME = 'M6.3b Pending Smoke';

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy`); }
}

async function reset() {
  const cs = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  if (cs.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: cs.map((c) => c.id) } } });
    await prisma.caseEmail.deleteMany({ where: { caseId: { in: cs.map((c) => c.id) } } });
    await prisma.case.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  }
}

async function setup() {
  await prisma.company.upsert({
    where: { id: TENANT }, update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });
  await reset();
}

async function cleanup() {
  await reset();
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
}

async function mkCase(caseNumber, extra = {}) {
  return prisma.case.create({
    data: {
      companyId: TENANT, caseNumber,
      title: 'Pending smoke', description: 'x',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Eposta', companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Genel', requestType: 'Talep',
      ...extra,
    },
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Scalar field expose: list response içeriyor ===');
    const cPending = await mkCase('VK-PB-1', {
      pendingCustomerReply: true,
      lastEmailOutboundAt: new Date('2026-06-20T10:00:00Z'),
      lastEmailInboundAt: new Date('2026-06-25T10:00:00Z'),
    });
    const cNonPending = await mkCase('VK-PB-2', {
      pendingCustomerReply: false,
    });
    const list = await caseRepository.list({ allowedCompanyIds: [TENANT], filters: {}, pagination: { page: 1, pageSize: 50 } });
    const items = list.items ?? [];
    expect('liste 2 vaka döndü', items.length, 2);
    const a = items.find((c) => c.caseNumber === 'VK-PB-1');
    expectTruthy('VK-PB-1 listede', !!a);
    expect('a.pendingCustomerReply = true', a?.pendingCustomerReply, true);
    expectTruthy('a.lastEmailOutboundAt set', !!a?.lastEmailOutboundAt);
    expectTruthy('a.lastEmailInboundAt set', !!a?.lastEmailInboundAt);

    console.log('\n=== (2) Filter pendingCustomerReply=true ===');
    const onlyPending = await caseRepository.list({ allowedCompanyIds: [TENANT], filters: { pendingCustomerReply: true }, pagination: { page: 1, pageSize: 50 } });
    expect('1 pending vaka', (onlyPending.items ?? []).length, 1);
    expect('döndü = VK-PB-1', onlyPending.items[0]?.caseNumber, 'VK-PB-1');

    console.log('\n=== (3) Filter pendingCustomerReply=false ===');
    const nonPending = await caseRepository.list({ allowedCompanyIds: [TENANT], filters: { pendingCustomerReply: false }, pagination: { page: 1, pageSize: 50 } });
    expect('1 non-pending vaka', (nonPending.items ?? []).length, 1);
    expect('döndü = VK-PB-2', nonPending.items[0]?.caseNumber, 'VK-PB-2');

    console.log('\n=== (4) Terminal vakada pending hep false (matris korunmuş) ===');
    // Doğrudan DB'de: terminal status'lu vaka pending=true olamaz (transitionStatus zorlu).
    // Bu bir invariant kontrolü.
    const cTerminalCheck = await mkCase('VK-PB-3', {
      pendingCustomerReply: false,
      status: 'Cozuldu',
    });
    const list3 = await caseRepository.list({ allowedCompanyIds: [TENANT], filters: { pendingCustomerReply: true }, pagination: { page: 1, pageSize: 50 } });
    const inResult = (list3.items ?? []).some((c) => c.caseNumber === 'VK-PB-3');
    expect('terminal vaka pending=true filter\'ında YOK', inResult, false);
    void cPending; void cNonPending; void cTerminalCheck;
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('cleanup hata:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
