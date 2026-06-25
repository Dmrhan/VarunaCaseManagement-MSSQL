#!/usr/bin/env node
/**
 * Outbound Dispatch Test — M4 IT-bağımsız doğrulama.
 *
 * Çalıştırma:
 *   npm run mail:outbound-test
 *
 * Senaryolar:
 *   (a) Active + Email + customer → executor çağrılır, dispatch state Pending'den
 *       çıkar (Sent veya Failed — network varsa Sent; bloklu ortamda Failed,
 *       her iki durumda attempts=1).
 *   (b) opt-out (AccountCompany.allowCustomerNotifications=false) → dispatch
 *       state=Suppressed reason='customer_opted_out'; executor ÇAĞRILMAZ
 *       (attempts=0).
 *   (c) LogOnly + Email → dispatch state=Pending kalır (Phase 2 davranışı);
 *       executor ÇAĞRILMAZ (attempts=0).
 *   (d) Idempotency (suppressDuplicateWithinMinutes>0): ikinci emitEvent ikinci
 *       dispatch'i state=Suppressed reason='duplicate_within_window' ile kayda
 *       alır.
 *   (e) Round-trip: applyCaseTokenToSubject çıktısı M2 inboundMailIntake
 *       parser'ının SUBJECT_CASE_TOKEN_RE pattern'i ile EŞLEŞİR.
 *
 * Setup/teardown: geçici Company + Account + AccountCompany + AccountContact +
 * Case + NotificationTemplate + NotificationRule. Sonunda cleanup.
 *
 * Network: senaryo (a) Ethereal'a gerçek SMTP gönderim dener. Outbound 587
 * bloklu ortamda Failed olur — assertion executor çağrısına bakar (attempts=1),
 * Sent/Failed ayrımına değil.
 */

import { prisma } from '../server/db/client.js';
import {
  emitEvent,
  applyCaseTokenToSubject,
  buildDispatchMessageId,
} from '../server/db/notificationRepository.js';

const TENANT = '__m4-outbound-test__';
const TENANT_NAME = 'M4 Outbound Test Co';
const KNOWN_EMAIL = 'm4-outbound-customer@varuna-test.local';

// MAIL_TRANSPORT=ethereal (default) — env'de smtp set edilirse executor o
// transport'u kullanır. M4 testi sender wrapping davranışını assert eder,
// gerçek SMTP gönderiminin başarılı olması zorunlu değil (bkz. JSDoc).
process.env.MAIL_TRANSPORT = process.env.MAIL_TRANSPORT || 'ethereal';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy (${JSON.stringify(actual)})`); }
}

async function setup() {
  console.log('[setup] geçici tenant + case + notification rule oluşturuluyor...');
  await prisma.company.upsert({
    where: { id: TENANT },
    update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });

  // Önceki test artığı template/rule'ları temizle (companyId scope).
  const existingCases = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  const exIds = existingCases.map((c) => c.id);
  if (exIds.length) {
    await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: exIds } } });
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: exIds } } });
    await prisma.case.deleteMany({ where: { id: { in: exIds } } });
  }
  await prisma.notificationRule.deleteMany({ where: { companyId: TENANT } });
  await prisma.notificationTemplate.deleteMany({ where: { companyId: TENANT } });

  // Existing account (varsa) cleanup
  const exAcc = await prisma.account.findFirst({ where: { email: KNOWN_EMAIL } });
  if (exAcc) {
    const orphan = await prisma.case.findMany({ where: { accountId: exAcc.id }, select: { id: true } });
    const ids = orphan.map((c) => c.id);
    if (ids.length) {
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.case.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.accountContact.deleteMany({ where: { accountId: exAcc.id } });
    await prisma.accountCompany.deleteMany({ where: { accountId: exAcc.id } });
    await prisma.account.delete({ where: { id: exAcc.id } });
  }

  const account = await prisma.account.create({
    data: {
      name: 'M4 Outbound Customer (Test)',
      email: KNOWN_EMAIL,
      isActive: true,
      companies: { create: { companyId: TENANT } },
      contacts: {
        create: {
          fullName: 'Yetkili Müşteri',
          email: KNOWN_EMAIL,
          isPrimary: true,
          isActive: true,
        },
      },
    },
  });

  // Template (subject/body)
  const template = await prisma.notificationTemplate.create({
    data: {
      companyId: TENANT,
      key: 'case_closed_customer_test',
      name: 'Vaka Kapandı (test)',
      subjectTemplate: 'Vakanız tamamlandı',
      bodyTemplate: 'Sayın müşteri, vakanız kapatılmıştır.',
      version: 1,
      isActive: true,
      requiredVariables: '[]',
    },
  });

  // Active+Email+customer_primary_contact rule (event=case_closed)
  const rule = await prisma.notificationRule.create({
    data: {
      companyId: TENANT,
      name: 'M4 Active Email — case_closed',
      event: 'case_closed',
      conditions: '{}',
      isMatchAll: true,
      audience: JSON.stringify([{ type: 'customer_primary_contact' }]),
      templateId: template.id,
      channel: 'Email',
      mode: 'Active',
      isActive: true,
      suppressDuplicateWithinMinutes: 60,
    },
  });

  // LogOnly+Email+customer rule (Senaryo c için)
  const logOnlyTemplate = await prisma.notificationTemplate.create({
    data: {
      companyId: TENANT,
      key: 'case_closed_logonly_test',
      name: 'LogOnly test',
      subjectTemplate: 'LogOnly konu',
      bodyTemplate: 'LogOnly gövde',
      version: 1,
      isActive: true,
      requiredVariables: '[]',
    },
  });
  const logOnlyRule = await prisma.notificationRule.create({
    data: {
      companyId: TENANT,
      name: 'M4 LogOnly Email — case_reopened',
      event: 'case_reopened',
      conditions: '{}',
      isMatchAll: true,
      audience: JSON.stringify([{ type: 'customer_primary_contact' }]),
      templateId: logOnlyTemplate.id,
      channel: 'Email',
      mode: 'LogOnly',
      isActive: true,
    },
  });

  console.log(`  → company=${TENANT}, account=${account.id}, template=${template.id}, rule=${rule.id}`);
  return { accountId: account.id, templateId: template.id, ruleId: rule.id, logOnlyRuleId: logOnlyRule.id, logOnlyTemplateId: logOnlyTemplate.id };
}

async function cleanup({ accountId, templateId, ruleId, logOnlyRuleId, logOnlyTemplateId, createdCaseIds }) {
  console.log('\n[cleanup] geçici test verisi siliniyor...');
  const caseIds = (createdCaseIds ?? []).filter(Boolean);
  if (caseIds.length) {
    await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  }
  if (ruleId) await prisma.notificationRule.delete({ where: { id: ruleId } }).catch(() => {});
  if (logOnlyRuleId) await prisma.notificationRule.delete({ where: { id: logOnlyRuleId } }).catch(() => {});
  if (templateId) await prisma.notificationTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (logOnlyTemplateId) await prisma.notificationTemplate.delete({ where: { id: logOnlyTemplateId } }).catch(() => {});
  if (accountId) {
    await prisma.accountContact.deleteMany({ where: { accountId } });
    await prisma.accountCompany.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
  }
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
  console.log('  → cleanup OK');
}

async function createTestCase({ accountId, accountName, suffix }) {
  return prisma.case.create({
    data: {
      caseNumber: `VK-M4-${suffix}-${Date.now().toString(36).toUpperCase()}`,
      title: `M4 test case ${suffix}`,
      description: `M4 outbound test ${suffix}`,
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Eposta',
      companyId: TENANT,
      companyName: TENANT_NAME,
      accountId,
      accountName,
      category: 'Genel',
      subCategory: 'E-posta',
      requestType: 'Bilgi',
    },
  });
}

async function runScenarioA({ accountId }) {
  console.log('\n=== Senaryo (a): Active+Email+customer → executor çağrılır ===');
  const c = await createTestCase({ accountId, accountName: 'M4 Outbound Customer (Test)', suffix: 'A' });
  await emitEvent({ event: 'case_closed', caseId: c.id });
  const dispatch = await prisma.notificationDispatch.findFirst({
    where: { caseId: c.id, event: 'case_closed' },
  });
  expectTruthy('Dispatch oluştu', dispatch);
  if (dispatch) {
    expect('mode=Active', dispatch.mode, 'Active');
    expect('channel=Email', dispatch.channel, 'Email');
    // Executor çağrıldı → state Pending'den çıktı (Sent veya Failed) + attempts=1
    expectTruthy('state Pending\'den çıktı (executor çağrıldı)', dispatch.state !== 'Pending');
    expect('attempts = 1 (executor çağrıldı)', dispatch.attempts, 1);
    // Sent ise providerMessageId ve dispatchedAt set; Failed ise failureReason
    if (dispatch.state === 'Sent') {
      expectTruthy('dispatchedAt set (Sent path)', !!dispatch.dispatchedAt);
      // providerMessageId nullable olabilir (mailProvider ethereal her zaman messageId döndürür ama defansif)
    } else if (dispatch.state === 'Failed') {
      expectTruthy('failureReason set (Failed path)', !!dispatch.failureReason);
    }
  }
  return c.id;
}

async function runScenarioB({ accountId }) {
  console.log('\n=== Senaryo (b): opt-out → executor ÇAĞRILMAZ, state=Suppressed ===');
  // AccountCompany.allowCustomerNotifications=false
  await prisma.accountCompany.updateMany({
    where: { accountId, companyId: TENANT },
    data: { allowCustomerNotifications: false },
  });
  const c = await createTestCase({ accountId, accountName: 'M4 Outbound Customer (Test)', suffix: 'B' });
  await emitEvent({ event: 'case_closed', caseId: c.id });
  const dispatch = await prisma.notificationDispatch.findFirst({
    where: { caseId: c.id, event: 'case_closed' },
  });
  expectTruthy('Dispatch oluştu', dispatch);
  if (dispatch) {
    expect('state=Suppressed', dispatch.state, 'Suppressed');
    expect('suppressionReason=customer_opted_out', dispatch.suppressionReason, 'customer_opted_out');
    expect('attempts=0 (executor çağrılMADI)', dispatch.attempts, 0);
  }
  // Restore
  await prisma.accountCompany.updateMany({
    where: { accountId, companyId: TENANT },
    data: { allowCustomerNotifications: true },
  });
  return c.id;
}

async function runScenarioC({ accountId }) {
  console.log('\n=== Senaryo (c): LogOnly+Email → executor ÇAĞRILMAZ ===');
  const c = await createTestCase({ accountId, accountName: 'M4 Outbound Customer (Test)', suffix: 'C' });
  await emitEvent({ event: 'case_reopened', caseId: c.id });
  const dispatch = await prisma.notificationDispatch.findFirst({
    where: { caseId: c.id, event: 'case_reopened' },
  });
  expectTruthy('Dispatch oluştu', dispatch);
  if (dispatch) {
    expect('mode=LogOnly', dispatch.mode, 'LogOnly');
    expect('state=Pending (executor çağrılmadı)', dispatch.state, 'Pending');
    expect('attempts=0', dispatch.attempts, 0);
  }
  return c.id;
}

async function runScenarioD({ accountId }) {
  console.log('\n=== Senaryo (d): idempotency → ikinci tetik suppress ===');
  const c = await createTestCase({ accountId, accountName: 'M4 Outbound Customer (Test)', suffix: 'D' });
  // İlk tetik
  await emitEvent({ event: 'case_closed', caseId: c.id });
  // Hemen ikinci tetik (suppressDuplicateWithinMinutes=60 → idempotency key collision)
  await emitEvent({ event: 'case_closed', caseId: c.id });
  const dispatches = await prisma.notificationDispatch.findMany({
    where: { caseId: c.id, event: 'case_closed' },
    orderBy: { createdAt: 'asc' },
  });
  expect('2 dispatch oluştu', dispatches.length, 2);
  if (dispatches.length === 2) {
    // İlk dispatch executor'a gitmiş (state Pending'den çıkmış)
    expectTruthy('1. dispatch executor çağrıldı (Sent veya Failed)',
      dispatches[0].state !== 'Pending');
    // 2. dispatch suppress
    expect('2. dispatch state=Suppressed', dispatches[1].state, 'Suppressed');
    expect('2. dispatch reason=duplicate_within_window',
      dispatches[1].suppressionReason, 'duplicate_within_window');
    expect('2. dispatch attempts=0', dispatches[1].attempts, 0);
  }
  return c.id;
}

function runScenarioE() {
  console.log('\n=== Senaryo (e): Round-trip — subject token M2 parser ile eşleşir ===');
  // M2 parser pattern (server/lib/inboundMailIntake.js:46):
  //   const SUBJECT_CASE_TOKEN_RE = /\[(VK-[0-9A-Z]+)\]/i;
  const M2_PATTERN = /\[(VK-[0-9A-Z]+)\]/i;
  const caseNumber = 'VK-TESTM4ROUND';
  const original = 'Vakanız tamamlandı';
  const wrapped = applyCaseTokenToSubject(original, caseNumber);
  expectTruthy('subject [VK-xxx] token ile başlar', wrapped.startsWith(`[${caseNumber}]`));
  const m = wrapped.match(M2_PATTERN);
  expectTruthy('M2 parser pattern eşleşti', !!m);
  expect('parser çıkardığı token = caseNumber', m?.[1], caseNumber);
  // Idempotent: token zaten varsa eklemiyor
  const wrappedAgain = applyCaseTokenToSubject(wrapped, caseNumber);
  expect('idempotent (mevcut token yine eklenmedi)', wrappedAgain, wrapped);
  // Message-ID format
  const messageId = buildDispatchMessageId('cmqXYZ123');
  expectTruthy('Message-ID <varuna-...@varuna.local>', /^<varuna-.+@.+>$/.test(messageId));
}

(async () => {
  let ctx = null;
  const createdCaseIds = [];
  try {
    ctx = await setup();
    createdCaseIds.push(await runScenarioA(ctx));
    createdCaseIds.push(await runScenarioB(ctx));
    createdCaseIds.push(await runScenarioC(ctx));
    createdCaseIds.push(await runScenarioD(ctx));
    runScenarioE();
  } catch (err) {
    console.error('\n[test] BEKLENMEYEN HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    if (ctx) {
      try { await cleanup({ ...ctx, createdCaseIds }); } catch (err) {
        console.error('[cleanup] hata:', err.message);
      }
    }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
