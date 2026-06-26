#!/usr/bin/env node
/**
 * Mail M6.2a sender smoke.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 10 (M6.2 smoke
 * planı). Bu smoke composer UI öncesi backend katmanını doğrular.
 *
 * Senaryolar:
 *  1) From-validation: tenant alias değil → reddedilir (from_invalid)
 *  2) From-validation: tenant aktif alias → kabul
 *  3) Threading: subject [VK-] token + Message-ID üretildi
 *  4) Threading: önceki inbound varsa In-Reply-To/References zincirleri
 *  5) Sanitize: outbound bodyHtml'den script/iframe drop
 *  6) CaseEmail(outbound, source='manual_send') yazıldı + K4 reset
 *     (pendingCustomerReply=false)
 *  7) Reply-context: inbound varsa to=[from]+to (alias filtreli),
 *     subject "Re: "
 */

import { prisma } from '../server/db/client.js';
import { caseEmailSender, _internal } from '../server/lib/caseEmailSender.js';

// Smoke stub — gerçek SMTP'ye gitmeden başarılı response döner. Sender
// içindeki DB akışı + threading + sanitize tam çalışır.
const mailStub = async ({ subject, headers }) => ({
  ok: true,
  rawSource: 'mail-stub',
  messageId: headers?.['Message-ID'] ?? '<stub@m6-2a-test>',
  previewUrl: null,
  meta: { proxiedAt: new Date().toISOString(), transport: 'stub', source: 'test' },
});
import { caseEmailRepository } from '../server/db/caseEmailRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';
import { externalMailFromAliasRepo } from '../server/db/externalMailFromAliasRepository.js';

const TENANT = '__m6-2a-tenant__';
const TENANT_NAME = 'M6.2a Tenant';
const ALIAS_ADDR = 'support@m62a.local';

const SYSTEM_ACTOR = Object.freeze({
  userId: null, personId: null, fullName: 'M6.2a Bot',
  email: null, role: null, displayName: 'system:m6-2a-test',
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
  await prisma.company.upsert({
    where: { id: TENANT }, update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } });
  const oldCases = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  for (const c of oldCases) {
    await prisma.caseActivity.deleteMany({ where: { caseId: c.id } });
    await prisma.caseNote.deleteMany({ where: { caseId: c.id } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: c.id } });
  }
  await prisma.case.deleteMany({ where: { companyId: TENANT } });
  await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: TENANT } });

  // FromAlias ekle
  await externalMailFromAliasRepo.upsert(TENANT, {
    address: ALIAS_ADDR,
    displayName: 'Destek',
    isDefault: true,
    isActive: true,
  });
}

async function cleanup() {
  console.log('\n[cleanup]...');
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } });
  const cs = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  for (const c of cs) {
    await prisma.caseActivity.deleteMany({ where: { caseId: c.id } });
    await prisma.caseNote.deleteMany({ where: { caseId: c.id } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: c.id } });
  }
  await prisma.case.deleteMany({ where: { companyId: TENANT } });
  await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: TENANT } });
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
}

async function createTestCase() {
  return caseRepository.create({
    title: 'Sender smoke',
    description: 'Test',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Eposta',
    companyId: TENANT,
    companyName: TENANT_NAME,
    customerContactEmail: 'müşteri@firm.local',
    customerContactName: 'Test Müşteri',
    category: 'Genel',
    subCategory: 'Diğer',
    requestType: 'Bilgi',
  }, SYSTEM_ACTOR);
}

async function senaryo1FromInvalid(caseId) {
  console.log('\n=== (1) From spoof reddedilir ===');
  const r = await caseEmailSender.sendCaseEmail({
    caseId,
    fromAddress: 'evil@unknown.com',
    to: [{ address: 'müşteri@firm.local' }],
    subject: 'X',
    bodyHtml: '<p>spoof</p>',
    actor: SYSTEM_ACTOR,
  }, { sendFn: mailStub });
  expect('from_invalid', r.ok, false);
  expect('code = from_invalid', r.code, 'from_invalid');
  // CaseEmail satırı YAZILMAMIŞ olmalı
  const after = await caseEmailRepository.listForCase(caseId);
  expect('CaseEmail count = 0 (reject sonrası)', after.length, 0);
}

async function senaryo2Send(caseId, caseNumber) {
  console.log('\n=== (2-3-4-5-6) Aktif alias ile gönderim ===');

  // Önce bir inbound CaseEmail ekle — threading test edebilelim
  await caseEmailRepository.appendInbound({
    caseId,
    companyId: TENANT,
    from: { address: 'müşteri@firm.local', name: 'Test Müşteri' },
    to: [{ address: ALIAS_ADDR, name: 'Destek' }],
    subject: `[${caseNumber}] İlk talep`,
    bodyHtml: '<p>Yardım lazım.</p>',
    bodyText: 'Yardım lazım.',
    messageId: '<inbound-1@m62a-test.local>',
  });

  // Gönderim
  const r = await caseEmailSender.sendCaseEmail({
    caseId,
    fromAddress: ALIAS_ADDR,
    to: [{ address: 'müşteri@firm.local', name: 'Test Müşteri' }],
    subject: 'Yanıt — bilgi',
    // XSS test: script/iframe drop edilmeli
    bodyHtml: '<p>Merhaba <b>müşteri</b></p><script>alert(1)</script><iframe src="evil"></iframe>',
    actor: SYSTEM_ACTOR,
  }, { sendFn: mailStub });
  expect('ok', r.ok, true);
  expectTruthy('messageId üretildi', !!r.messageId);
  expectTruthy('messageId @host format', typeof r.messageId === 'string' && r.messageId.includes('@'));
  expectTruthy('emailId set', !!r.emailId);

  // DB satırı + K4
  const list = await caseEmailRepository.listForCase(caseId);
  expect('CaseEmail count = 2 (inbound + outbound)', list.length, 2);
  const outbound = list.find((e) => e.direction === 'outbound');
  expectTruthy('outbound satır var', !!outbound);
  expect('source = manual_send', outbound?.source, 'manual_send');
  expect('subject [VK-] token eklendi', outbound?.subject?.includes(`[${caseNumber}]`), true);
  expectTruthy('In-Reply-To = inbound messageId', outbound?.inReplyTo === '<inbound-1@m62a-test.local>');
  expectTruthy('refs zinciri', !!outbound?.refs);

  // Sanitize doğrulama
  expect('<script> drop', outbound?.bodyHtml?.includes('<script>'), false);
  expect('<iframe> drop', outbound?.bodyHtml?.includes('<iframe>'), false);
  expectTruthy('<b> korundu', outbound?.bodyHtml?.includes('<b>müşteri</b>'));

  // K4
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: { lastEmailOutboundAt: true, pendingCustomerReply: true },
  });
  expectTruthy('lastEmailOutboundAt set', !!c.lastEmailOutboundAt);
  expect('pendingCustomerReply=false (outbound reset)', c.pendingCustomerReply, false);
}

async function senaryo3ReplyContext(caseId) {
  console.log('\n=== (7) Reply-context: alias filtresi + K6 reply-all ===');
  const ctx = await caseEmailSender.buildReplyContext(caseId);
  expectTruthy('ctx var', !!ctx);
  expectTruthy('subject "Re: " ekli', ctx?.subject?.startsWith('Re: '));
  expectTruthy('to[0] inbound from', ctx?.to?.[0]?.address === 'müşteri@firm.local');
  expect('to alias filtre — ALIAS_ADDR YOK', ctx?.to?.some((t) => t.address === ALIAS_ADDR), false);
  expectTruthy('inReplyTo set', !!ctx?.inReplyTo);
}

async function senaryoMissingRecipients(caseId) {
  console.log('\n=== Recipients missing reddedilir ===');
  const r = await caseEmailSender.sendCaseEmail({
    caseId,
    fromAddress: ALIAS_ADDR,
    to: [],
    subject: 'X',
    bodyHtml: '<p>X</p>',
    actor: SYSTEM_ACTOR,
  }, { sendFn: mailStub });
  expect('reddedildi', r.ok, false);
  expect('code = recipients_missing', r.code, 'recipients_missing');
}

(async () => {
  let caseRow = null;
  try {
    await setup();
    caseRow = await createTestCase();
    const caseId = caseRow.id;
    await senaryo1FromInvalid(caseId);
    // Yeni vaka — senaryo 1 sonrası temiz state
    await prisma.caseEmail.deleteMany({ where: { caseId } });
    await prisma.case.update({ where: { id: caseId }, data: { pendingCustomerReply: false, lastEmailInboundAt: null, lastEmailOutboundAt: null } });
    await senaryo2Send(caseId, caseRow.caseNumber);
    await senaryo3ReplyContext(caseId);
    await senaryoMissingRecipients(caseId);
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
