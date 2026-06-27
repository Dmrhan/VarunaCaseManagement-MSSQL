#!/usr/bin/env node
/**
 * Mail M6.3 Codex P2 fix paketi — 3 fix kontratı.
 *
 *  (P2-1) buildReplyContext({ emailId }) — verilen mail satırını baz alır
 *  (P2-3) buildReplyContext fallback alias loop koruması — fromAddress
 *         fallback adresi inbound to/cc'den filtrelenir
 *  (P2-2) MailComposer late-signature forward quote korunur (UI testi
 *         backend smoke kapsamı dışında — frontend behavior; sadece
 *         kontrat doğrulaması: forward initialForwardContext.quotedBodyHtml
 *         korunur — bunu test etmek için React render gerek; bu smoke
 *         backend odaklı)
 */

import { prisma } from '../server/db/client.js';
import { caseEmailSender } from '../server/lib/caseEmailSender.js';

const TENANT = '__m6-3-codex-p2__';
const TENANT_NAME = 'M6.3 Codex P2 Smoke';

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
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } });
  const cs = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  if (cs.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: cs.map(c => c.id) } } });
    await prisma.case.deleteMany({ where: { id: { in: cs.map(c => c.id) } } });
  }
  await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: TENANT } });
  await prisma.externalMailSetting.deleteMany({ where: { companyId: TENANT } });
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

async function mkCase(caseNumber) {
  return prisma.case.create({
    data: {
      companyId: TENANT, caseNumber,
      title: 'Codex P2 smoke', description: 'x',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Eposta', companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Genel', requestType: 'Talep',
    },
  });
}

async function mkInbound(c, fromAddress, subject, receivedAt, toAddresses = []) {
  return prisma.caseEmail.create({
    data: {
      caseId: c.id, companyId: c.companyId,
      direction: 'inbound', source: 'imap_intake',
      fromAddress, fromName: fromAddress.split('@')[0],
      toAddresses: JSON.stringify(toAddresses.length ? toAddresses : [{ address: 'support@varuna.com', name: null }]),
      ccAddresses: JSON.stringify([]),
      bccAddresses: JSON.stringify([]),
      subject,
      bodyHtml: '<p>x</p>', bodyText: 'x',
      messageId: '<' + Math.random().toString(36).slice(2) + '@codex-p2.local>',
      receivedAt,
    },
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (P2-1) buildReplyContext({emailId}) — verilen satırı baz alır ===');
    const c = await mkCase('VK-CXP2-1');
    const eOld = await mkInbound(c, 'eski@firm.com', 'ESKI MAIL', new Date('2026-06-20T10:00:00Z'));
    const eNew = await mkInbound(c, 'yeni@firm.com', 'YENI MAIL', new Date('2026-06-26T10:00:00Z'));

    // emailId YOK → son inbound (yeni mail)
    const ctxNoId = await caseEmailSender.buildReplyContext(c.id);
    expect('emailId yok → subject "Re: YENI MAIL"', ctxNoId?.subject, 'Re: YENI MAIL');
    expect('emailId yok → to = yeni@firm.com', ctxNoId?.to?.[0]?.address, 'yeni@firm.com');

    // emailId = ESKI → ESKI mail baz alınır
    const ctxOld = await caseEmailSender.buildReplyContext(c.id, { emailId: eOld.id });
    expect('emailId=ESKI → subject "Re: ESKI MAIL"', ctxOld?.subject, 'Re: ESKI MAIL');
    expect('emailId=ESKI → to = eski@firm.com', ctxOld?.to?.[0]?.address, 'eski@firm.com');

    // Cross-case binding: başka case'in mail id'si → fallback son inbound
    const c2 = await mkCase('VK-CXP2-2');
    const eCross = await mkInbound(c2, 'crosscase@firm.com', 'CROSS', new Date('2026-06-25T10:00:00Z'));
    const ctxCross = await caseEmailSender.buildReplyContext(c.id, { emailId: eCross.id });
    expect('cross-case emailId → fallback yeni inbound', ctxCross?.subject, 'Re: YENI MAIL');
    void eNew;

    console.log('\n=== (P2-3) Fallback alias loop koruması ===');
    // FromAlias YOK + ExternalMailSetting.fromAddress dolu → fallback adresi
    await prisma.externalMailSetting.create({
      data: { companyId: TENANT, enabled: true, fromAddress: 'csmtest@univera.com.tr' },
    });
    // Bir inbound mail to'da bu fallback adresi var olsun (sanki tenant
    // kendi adresini cc'lemiş)
    const c3 = await mkCase('VK-CXP2-3');
    await mkInbound(
      c3, 'musteri@dis.com', 'LOOP TEST',
      new Date('2026-06-26T10:00:00Z'),
      [{ address: 'csmtest@univera.com.tr', name: null }, { address: 'baska@firm.com', name: null }],
    );
    const ctxLoop = await caseEmailSender.buildReplyContext(c3.id);
    expectTruthy('reply ctx truthy', !!ctxLoop);
    const recipients = (ctxLoop?.to ?? []).map((r) => r.address.toLowerCase());
    expect('fallback adresi to LİSTESİNDE YOK (loop önlendi)',
      recipients.includes('csmtest@univera.com.tr'), false);
    expect('musteri@dis.com to listesinde VAR',
      recipients.includes('musteri@dis.com'), true);
    expect('baska@firm.com to listesinde VAR',
      recipients.includes('baska@firm.com'), true);
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
