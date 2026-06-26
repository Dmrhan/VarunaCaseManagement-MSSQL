#!/usr/bin/env node
/**
 * Third-party 3rdPartyBekleniyor geçişi smoke — global (companyId=null)
 * kabul, cross-tenant ret, same-tenant kabul.
 *
 * Codex P2 fix doğrulaması (caseRepository.js ~3257).
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';

const TENANT_A = '__tp-global-a__';
const TENANT_B = '__tp-global-b__';

const SYSTEM_ACTOR = Object.freeze({
  userId: null, personId: null, fullName: 'TP Bot',
  email: null, role: null, displayName: 'system:tp-test',
});

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy ${JSON.stringify(actual)}`); }
}

async function setup() {
  console.log('[setup]...');
  for (const id of [TENANT_A, TENANT_B]) {
    await prisma.company.upsert({
      where: { id }, update: {},
      create: { id, name: `TP smoke ${id}`, isActive: true },
    });
    const oldCases = await prisma.case.findMany({ where: { companyId: id }, select: { id: true } });
    const ids = oldCases.map((c) => c.id);
    if (ids.length) {
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.case.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.thirdParty.deleteMany({ where: { name: { startsWith: '__tp-smoke-' } } });

  // 3 ThirdParty: global, A, B
  const tpGlobal = await prisma.thirdParty.create({
    data: { name: '__tp-smoke-global', isActive: true, companyId: null, pausesSla: true },
  });
  const tpA = await prisma.thirdParty.create({
    data: { name: '__tp-smoke-a', isActive: true, companyId: TENANT_A, pausesSla: true },
  });
  const tpB = await prisma.thirdParty.create({
    data: { name: '__tp-smoke-b', isActive: true, companyId: TENANT_B, pausesSla: false },
  });
  return { tpGlobal, tpA, tpB };
}

async function cleanup({ tpGlobal, tpA, tpB }) {
  console.log('\n[cleanup]...');
  for (const id of [TENANT_A, TENANT_B]) {
    const cs = await prisma.case.findMany({ where: { companyId: id }, select: { id: true } });
    const ids = cs.map((c) => c.id);
    if (ids.length) {
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.case.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.thirdParty.deleteMany({ where: { id: { in: [tpGlobal.id, tpA.id, tpB.id] } } });
  for (const id of [TENANT_A, TENANT_B]) {
    await prisma.company.delete({ where: { id } }).catch(() => {});
  }
}

async function createCase(tenant) {
  return caseRepository.create({
    title: 'TP smoke',
    description: 'Test',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Telefon',
    companyId: tenant,
    companyName: `TP smoke ${tenant}`,
    customerContactEmail: 'müşteri@firm.local',
    customerContactName: 'Test',
    category: 'Genel',
    subCategory: 'Diğer',
    requestType: 'Bilgi',
  }, SYSTEM_ACTOR);
}

async function tryTransition(caseRow, tpId) {
  try {
    const updated = await caseRepository.transitionStatus(
      caseRow.id,
      '3rdPartyBekleniyor',
      { thirdPartyId: tpId },
      SYSTEM_ACTOR.displayName,
      [caseRow.companyId],
    );
    return { ok: true, status: updated?.status ?? null };
  } catch (err) {
    return { ok: false, code: err?.code, message: err?.message };
  }
}

(async () => {
  let ctx = null;
  try {
    ctx = await setup();

    console.log('\n=== (a) Global 3. parti (companyId=null) → kabul ===');
    const caseA1 = await createCase(TENANT_A);
    // Önce İncelemeye al
    await caseRepository.transitionStatus(caseA1.id, 'İncelemede', {}, SYSTEM_ACTOR.displayName, [TENANT_A]);
    const r1 = await tryTransition({ id: caseA1.id, companyId: TENANT_A }, ctx.tpGlobal.id);
    expect('ok', r1.ok, true);
    expect('status = 3rdPartyBekleniyor (TR shape)', r1.status, '3rdPartyBekleniyor');

    console.log('\n=== (b) Aynı şirketin 3. partisi → kabul ===');
    const caseA2 = await createCase(TENANT_A);
    await caseRepository.transitionStatus(caseA2.id, 'İncelemede', {}, SYSTEM_ACTOR.displayName, [TENANT_A]);
    const r2 = await tryTransition({ id: caseA2.id, companyId: TENANT_A }, ctx.tpA.id);
    expect('ok', r2.ok, true);

    console.log('\n=== (c) Başka şirketin 3. partisi (cross-tenant) → ret ===');
    const caseA3 = await createCase(TENANT_A);
    await caseRepository.transitionStatus(caseA3.id, 'İncelemede', {}, SYSTEM_ACTOR.displayName, [TENANT_A]);
    const r3 = await tryTransition({ id: caseA3.id, companyId: TENANT_A }, ctx.tpB.id);
    expect('reddedildi', r3.ok, false);
    expect('code = invalid_third_party', r3.code, 'invalid_third_party');

    console.log('\n=== (d) Yok olan tpId → ret ===');
    const caseA4 = await createCase(TENANT_A);
    await caseRepository.transitionStatus(caseA4.id, 'İncelemede', {}, SYSTEM_ACTOR.displayName, [TENANT_A]);
    const r4 = await tryTransition({ id: caseA4.id, companyId: TENANT_A }, '__nonexistent__');
    expect('reddedildi', r4.ok, false);
    expect('code = invalid_third_party', r4.code, 'invalid_third_party');

    console.log('\n=== (e) Global 3. parti, B şirketi → kabul (global her tenant\'a açık) ===');
    const caseB1 = await createCase(TENANT_B);
    await caseRepository.transitionStatus(caseB1.id, 'İncelemede', {}, SYSTEM_ACTOR.displayName, [TENANT_B]);
    const r5 = await tryTransition({ id: caseB1.id, companyId: TENANT_B }, ctx.tpGlobal.id);
    expect('ok', r5.ok, true);

    console.log('\n=== (f) pausesSla global için aynen uygulanır ===');
    const after = await prisma.case.findUnique({
      where: { id: caseA1.id },
      select: { slaPausedAt: true },
    });
    expectTruthy('slaPausedAt set (global tp.pausesSla=true)', !!after.slaPausedAt);
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    if (ctx) try { await cleanup(ctx); } catch (e) { console.error('cleanup hata:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
