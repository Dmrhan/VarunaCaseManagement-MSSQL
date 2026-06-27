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

    console.log('\n=== (P2-1b) sendCaseEmail inReplyTo → threading O satıra göre ===');
    // ESKİ mail'in messageId'sini al
    const eOldRow = await prisma.caseEmail.findUnique({ where: { id: eOld.id }, select: { messageId: true } });
    const eNewRow = await prisma.caseEmail.findUnique({ where: { id: eNew.id }, select: { messageId: true } });
    expectTruthy('eOld.messageId truthy', !!eOldRow?.messageId);
    expectTruthy('eNew.messageId truthy', !!eNewRow?.messageId);

    // Test için sahte alias kayıt (sender için)
    await prisma.externalMailSetting.upsert({
      where: { companyId: TENANT },
      update: {},
      create: { companyId: TENANT, enabled: true, fromAddress: 'sender@local.test' },
    });

    let capturedHeaders = null;
    const stubSend = async (mailOpts) => {
      capturedHeaders = mailOpts.headers;
      return { ok: true, messageId: mailOpts.headers?.['Message-ID'] ?? 'stub-mid', previewUrl: null };
    };

    // sendCaseEmail w/ inReplyTo=eOld.messageId → threading eOld'a göre
    const send1 = await caseEmailSender.sendCaseEmail(
      {
        caseId: c.id,
        fromAddress: 'sender@local.test',
        to: [{ address: 'rec@dis.com' }],
        subject: 'Re: ESKI MAIL',
        bodyHtml: '<p>yanıt</p>',
        inReplyTo: eOldRow.messageId,
        actor: { userId: null, fullName: 'Smoke' },
      },
      { sendFn: stubSend },
    );
    expect('send ok', send1.ok, true);
    expect('In-Reply-To = eOld.messageId', capturedHeaders?.['In-Reply-To'], eOldRow.messageId);

    // sendCaseEmail inReplyTo YOK → eski davranış (son inbound = eNew)
    capturedHeaders = null;
    const send2 = await caseEmailSender.sendCaseEmail(
      {
        caseId: c.id,
        fromAddress: 'sender@local.test',
        to: [{ address: 'rec@dis.com' }],
        subject: 'Re: son inbound',
        bodyHtml: '<p>yanıt</p>',
        actor: { userId: null, fullName: 'Smoke' },
      },
      { sendFn: stubSend },
    );
    expect('send ok (no inReplyTo)', send2.ok, true);
    expect('In-Reply-To = eNew.messageId (fallback)', capturedHeaders?.['In-Reply-To'], eNewRow.messageId);

    // sendCaseEmail inReplyTo bilinmeyen → fallback son inbound
    capturedHeaders = null;
    const send3 = await caseEmailSender.sendCaseEmail(
      {
        caseId: c.id,
        fromAddress: 'sender@local.test',
        to: [{ address: 'rec@dis.com' }],
        subject: 'Re: hayalet',
        bodyHtml: '<p>yanıt</p>',
        inReplyTo: '<nonexistent@local>',
        actor: { userId: null, fullName: 'Smoke' },
      },
      { sendFn: stubSend },
    );
    expect('send ok (unknown inReplyTo)', send3.ok, true);
    expect('In-Reply-To = eNew (fallback son inbound)', capturedHeaders?.['In-Reply-To'], eNewRow.messageId);

    console.log('\n=== (P2-1c) pendingCustomerReply — eski mail\'e cevapta yeni inbound bekleyen kalır ===');
    // Önceki bloktan c case'inde: eOld (2026-06-20) + eNew (2026-06-26)
    // Şimdiki state: 2 outbound atıldı (P2-1b), son outbound newest.
    // K4 monotonic mantığı: lastEmailInboundAt = eNew.receivedAt (max),
    // lastEmailOutboundAt = sentAtFinal (max), pendingCustomerReply
    // P2-1b'deki son outbound (sentAtFinal=now) sonrası TEMİZLENMİŞ.

    // Önce case'i sıfırla: pendingCustomerReply=true ve lastEmailOutboundAt
    // geçmişe çek ki test temiz olsun
    await prisma.case.update({
      where: { id: c.id },
      data: {
        pendingCustomerReply: true,
        lastEmailInboundAt: new Date('2026-06-26T10:00:00Z'), // eNew
        lastEmailOutboundAt: null,
      },
    });

    // Agent ESKİ inbound'a cevap verir (eOld.messageId, receivedAt 2026-06-20)
    const stubSend2 = async (m) => ({ ok: true, messageId: m.headers['Message-ID'], previewUrl: null });
    await caseEmailSender.sendCaseEmail(
      {
        caseId: c.id,
        fromAddress: 'sender@local.test',
        to: [{ address: 'rec@dis.com' }],
        subject: 'Re: ESKI',
        bodyHtml: '<p>cevap</p>',
        inReplyTo: eOldRow.messageId,
        actor: { userId: null, fullName: 'Smoke' },
      },
      { sendFn: stubSend2 },
    );

    const cAfter1 = await prisma.case.findUnique({
      where: { id: c.id },
      select: { pendingCustomerReply: true },
    });
    expect('eski inbound\'a cevap → pending HÂLÂ TRUE (yeni inbound bekliyor)',
      cAfter1.pendingCustomerReply, true);

    // Şimdi agent YENİ inbound'a cevap verir
    await caseEmailSender.sendCaseEmail(
      {
        caseId: c.id,
        fromAddress: 'sender@local.test',
        to: [{ address: 'rec@dis.com' }],
        subject: 'Re: YENI',
        bodyHtml: '<p>cevap</p>',
        inReplyTo: eNewRow.messageId,
        actor: { userId: null, fullName: 'Smoke' },
      },
      { sendFn: stubSend2 },
    );

    const cAfter2 = await prisma.case.findUnique({
      where: { id: c.id },
      select: { pendingCustomerReply: true },
    });
    expect('yeni inbound\'a cevap → pending FALSE (en yeni mail\'e cevap verildi)',
      cAfter2.pendingCustomerReply, false);

    console.log('\n=== (P2-3) Fallback alias loop koruması ===');
    // FromAlias YOK + ExternalMailSetting.fromAddress dolu → fallback adresi
    await prisma.externalMailSetting.upsert({
      where: { companyId: TENANT },
      update: { fromAddress: 'csmtest@univera.com.tr', enabled: true },
      create: { companyId: TENANT, enabled: true, fromAddress: 'csmtest@univera.com.tr' },
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
