#!/usr/bin/env node
/**
 * Mail M6.3-realign — Backend buildForwardContext kontratı.
 *
 *  (1) Geçerli email → ctx.subject "Fwd: ..."; alıcılar boş;
 *      quotedBodyHtml orijinal subject + body içerir.
 *  (2) Cross-case binding: email başka case'e aitse null döner.
 *  (3) Cross-tenant: companyId yanlışsa null döner.
 *  (4) Subject sanity: "Re:" başlıklı mail → "Fwd:" eklenmez (var olan
 *      prefix korunur).
 */

import { prisma } from '../server/db/client.js';
import { caseEmailSender } from '../server/lib/caseEmailSender.js';

const TENANT = '__m6-3-forward__';
const TENANT2 = '__m6-3-forward-2__';
const TENANT_NAME = 'M6.3 Forward Smoke';

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

async function setup() {
  await prisma.company.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: TENANT_NAME, isActive: true } });
  await prisma.company.upsert({ where: { id: TENANT2 }, update: {}, create: { id: TENANT2, name: TENANT_NAME + ' 2', isActive: true } });
  await prisma.caseEmail.deleteMany({ where: { companyId: { in: [TENANT, TENANT2] } } });
  const old = await prisma.case.findMany({ where: { companyId: { in: [TENANT, TENANT2] } }, select: { id: true } });
  const ids = old.map((c) => c.id);
  if (ids.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
  }
}

async function cleanup() {
  await prisma.caseEmail.deleteMany({ where: { companyId: { in: [TENANT, TENANT2] } } });
  const old = await prisma.case.findMany({ where: { companyId: { in: [TENANT, TENANT2] } }, select: { id: true } });
  const ids = old.map((c) => c.id);
  if (ids.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
  await prisma.company.delete({ where: { id: TENANT2 } }).catch(() => {});
}

async function mkCase(companyId, caseNumber) {
  return prisma.case.create({
    data: {
      companyId, caseNumber,
      title: 'Forward smoke', description: 'x',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Eposta', companyName: 'Test',
      category: 'Genel', subCategory: 'Genel', requestType: 'Talep',
    },
  });
}

async function mkEmail(c, subject = 'Test mail', extra = {}) {
  return prisma.caseEmail.create({
    data: {
      caseId: c.id, companyId: c.companyId,
      direction: 'inbound', source: 'imap_intake',
      fromAddress: 'sender@firm.local', fromName: 'Sender',
      toAddresses: JSON.stringify([{ address: 'support@varuna.com', name: null }]),
      ccAddresses: JSON.stringify([]),
      bccAddresses: JSON.stringify([]),
      subject,
      bodyHtml: '<p>orijinal gövde</p>',
      bodyText: 'orijinal gövde',
      messageId: '<' + Math.random().toString(36).slice(2) + '@m6-3.local>',
      receivedAt: new Date('2026-06-26T10:00:00Z'),
      ...extra,
    },
  });
}

(async () => {
  try {
    await setup();
    const c1 = await mkCase(TENANT, 'VK-FWD-1');
    const c2 = await mkCase(TENANT, 'VK-FWD-2');
    const c3 = await mkCase(TENANT2, 'VK-FWD-T2');
    const e1 = await mkEmail(c1, 'Sorun bildirimi');
    const e2 = await mkEmail(c2);
    const e3 = await mkEmail(c3);

    console.log('\n=== (1) Geçerli email → ctx ===');
    const ctx = await caseEmailSender.buildForwardContext(c1.id, e1.id, { companyId: TENANT });
    expectTruthy('ctx truthy', !!ctx);
    expect('subject "Fwd: ..."', ctx?.subject, 'Fwd: Sorun bildirimi');
    expect('to boş', ctx?.to?.length, 0);
    expect('cc boş', ctx?.cc?.length, 0);
    expect('bcc boş', ctx?.bcc?.length, 0);
    expectTruthy('quotedBodyHtml orijinal subject içerir', ctx?.quotedBodyHtml?.includes('Sorun bildirimi'));
    expectTruthy('quotedBodyHtml orijinal body içerir', ctx?.quotedBodyHtml?.includes('orijinal gövde'));

    console.log('\n=== (2) Cross-case binding → null ===');
    const wrongCase = await caseEmailSender.buildForwardContext(c2.id, e1.id, { companyId: TENANT });
    expect('cross-case null', wrongCase, null);

    console.log('\n=== (3) Cross-tenant → null ===');
    const wrongTenant = await caseEmailSender.buildForwardContext(c3.id, e3.id, { companyId: TENANT });
    expect('cross-tenant null', wrongTenant, null);

    console.log('\n=== (4) "Re:" başlıklı mail → Fwd: eklenmez ===');
    const eRe = await mkEmail(c1, 'Re: önceki tartışma');
    const ctxRe = await caseEmailSender.buildForwardContext(c1.id, eRe.id, { companyId: TENANT });
    expect('subject = "Re: önceki tartışma" (Fwd eklenmez)', ctxRe?.subject, 'Re: önceki tartışma');
    void e2;
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
