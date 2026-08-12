#!/usr/bin/env node
/**
 * M2.3 learned sender smoke — 5 senaryo (a-e).
 *
 * REUSE: customerMatchRepository.suggestCustomerMatches + scoreCandidate
 * + caseRepository.linkAccount + learnedSenderAccountRepo (yeni).
 *
 * Çalıştırma:
 *   npm run smoke:mail-learned
 *
 * Senaryolar:
 *   (a) Email-origin vaka manuel KİŞİSEL gönderene bağlanır → mapping
 *       oluşur; aynı gönderenden yeni inbound → auto-link + 'learned' reason
 *   (b) ROL adres (info@) manuel bağlanır → mapping isRoleAddress=true;
 *       yeni inbound → SADECE öneri (auto-link YOK)
 *   (c) Aynı gönderen farklı hesaba RE-LINK → mapping overwrite (yeni hesap)
 *   (d) Tenant: A'da öğrenilen eşleme B intake'ini ETKİLEMEZ
 *   (e) AUTO-link (intake email match) → mapping OLUŞTURMAZ
 */

import { prisma } from '../server/db/client.js';
import { suggestCustomerMatches } from '../server/db/customerMatchRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';
import { learnedSenderAccountRepo, isRoleAddress }
  from '../server/db/learnedSenderAccountRepository.js';
import { intakeInboundEmail } from '../server/lib/inboundMailIntake.js';
import { parseInboundEml } from '../server/lib/inboundMailParser.js';

const TENANT_A = '__m23-learned-tenant-a__';
const TENANT_B = '__m23-learned-tenant-b__';
const TENANT_A_NAME = 'M2.3 Tenant A';
const TENANT_B_NAME = 'M2.3 Tenant B';

const SYSTEM_ACTOR = Object.freeze({
  userId: null, personId: null, fullName: 'M2.3 Bot',
  email: null, role: null, displayName: 'system:m23-test',
});

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy (${JSON.stringify(actual)})`); }
}

async function cleanupExisting(emails) {
  for (const email of emails) {
    const ex = await prisma.account.findFirst({ where: { email } });
    if (!ex) continue;
    const cs = await prisma.case.findMany({ where: { accountId: ex.id }, select: { id: true } });
    const ids = cs.map((c) => c.id);
    if (ids.length) {
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: ids } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.case.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.learnedSenderAccount.deleteMany({ where: { accountId: ex.id } });
    await prisma.accountContact.deleteMany({ where: { accountId: ex.id } });
    await prisma.accountCompany.deleteMany({ where: { accountId: ex.id } });
    await prisma.account.delete({ where: { id: ex.id } });
  }
}

async function setup() {
  console.log('[setup] tenant A + B + accounts oluşturuluyor...');
  // 2026-07-16 fix — intake artık şirket başına Vaka No Öneki ŞART koşuyor
  // (case_number_prefix_required); test tenant'ları öneksiz kurulunca tüm
  // senaryolar ilk intake'te düşüyordu. Test önekleri gerçek şirketlerle
  // çakışmaz (@unique); upsert UPDATE kolu da yazar — eski koşumlardan
  // kalan öneksiz tenant kayıtları onarılsın.
  const TEST_PREFIX = { [TENANT_A]: 'ZZA', [TENANT_B]: 'ZZB' };
  for (const [id, name] of [[TENANT_A, TENANT_A_NAME], [TENANT_B, TENANT_B_NAME]]) {
    await prisma.company.upsert({
      where: { id },
      update: { caseNumberPrefix: TEST_PREFIX[id] },
      create: { id, name, isActive: true, caseNumberPrefix: TEST_PREFIX[id] },
    });
  }
  await cleanupExisting([
    'personalA@m23-test.local',
    'personalA-other@m23-test.local',
    'role-test-account-a@m23-test.local',
    'tenant-b-account@m23-test.local',
    'autolink-account@m23-test.local',
  ]);

  // Account 1: tenant A, kişisel learned senaryosu (a)
  const accountA1 = await prisma.account.create({
    data: {
      name: 'Tenant A Müşteri 1',
      email: 'personalA@m23-test.local',
      isActive: true,
      companies: { create: { companyId: TENANT_A } },
    },
  });
  // Account 2: tenant A, re-link senaryosu (c)
  const accountA2 = await prisma.account.create({
    data: {
      name: 'Tenant A Müşteri 2',
      email: 'personalA-other@m23-test.local',
      isActive: true,
      companies: { create: { companyId: TENANT_A } },
    },
  });
  // Account 3: tenant A, role address senaryosu (b)
  const accountARole = await prisma.account.create({
    data: {
      name: 'Tenant A Şirketi (role)',
      email: 'role-test-account-a@m23-test.local',
      isActive: true,
      companies: { create: { companyId: TENANT_A } },
    },
  });
  // Account 4: tenant B, izolasyon senaryosu (d)
  const accountB = await prisma.account.create({
    data: {
      name: 'Tenant B Müşteri',
      email: 'tenant-b-account@m23-test.local',
      isActive: true,
      companies: { create: { companyId: TENANT_B } },
    },
  });
  // Account 5: tenant A, auto-link senaryosu (e) — exact email match için
  const accountAuto = await prisma.account.create({
    data: {
      name: 'Auto-Link Müşteri',
      email: 'autolink-account@m23-test.local',
      isActive: true,
      companies: { create: { companyId: TENANT_A } },
    },
  });

  return {
    accountA1: accountA1.id,
    accountA2: accountA2.id,
    accountARole: accountARole.id,
    accountB: accountB.id,
    accountAuto: accountAuto.id,
  };
}

async function cleanup(ctx) {
  console.log('\n[cleanup] geçici test verisi siliniyor...');
  for (const tenant of [TENANT_A, TENANT_B]) {
    const cs = await prisma.case.findMany({ where: { companyId: tenant }, select: { id: true } });
    const ids = cs.map((c) => c.id);
    if (ids.length) {
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: ids } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.case.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.learnedSenderAccount.deleteMany({ where: { companyId: tenant } });
  }
  for (const aid of Object.values(ctx ?? {})) {
    await prisma.accountContact.deleteMany({ where: { accountId: aid } });
    await prisma.accountCompany.deleteMany({ where: { accountId: aid } });
    await prisma.account.delete({ where: { id: aid } }).catch(() => {});
  }
  for (const tenant of [TENANT_A, TENANT_B]) {
    // 2026-07-16 — vaka-no sayacı FK'sı tenant silinmesini engelliyordu
    // (CaseNumberCounter_companyId_fkey); önce sayaç, sonra şirket.
    await prisma.caseNumberCounter.deleteMany({ where: { companyId: tenant } }).catch(() => {});
    await prisma.company.delete({ where: { id: tenant } }).catch(() => {});
  }
  console.log('  → cleanup OK');
}

async function makeInboundCase({ tenant, tenantName, from, name, body, subject = 'M2.3 test' }) {
  const rawEml = `From: "${name}" <${from}>
To: support@varuna.com
Subject: ${subject}
Date: Wed, 25 Jun 2026 17:00:00 +0300
Message-ID: <m23-${Date.now()}-${Math.random().toString(36).slice(2)}@m23-test.local>
Content-Type: text/plain; charset=UTF-8

${body}`;
  const parsed = await parseInboundEml(rawEml);
  if (!parsed.ok) throw new Error('parse fail');
  return intakeInboundEmail({
    parsed: parsed.data,
    companyId: tenant,
    companyName: tenantName,
    actor: SYSTEM_ACTOR,
  });
}

async function runScenarioA({ accountA1 }) {
  console.log('\n=== Senaryo (a) M2.3-1: kişisel gönderen manuel bağla → mapping; sonraki inbound auto-link learned ===');
  // 1) Inbound vaka — bilinmeyen kişisel gönderen
  const inbound1 = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: 'newuser@somecompany.local',
    name: 'Yeni Kullanıcı',
    body: 'İlk kez yazıyorum.',
  });
  expect('inbound 1 created', inbound1.action, 'created');
  expect('match.accountId = null (henüz bilinmiyor)', inbound1.match?.accountId, null);

  // 2) Manuel link → accountA1
  const linked = await caseRepository.linkAccount(
    inbound1.caseId,
    accountA1,
    'Test Operator',
    [TENANT_A],
    { source: 'manual', actorUserId: null },
  );
  expectTruthy('manuel link başarılı', linked && linked.accountId === accountA1);

  // 3) learnedSenderAccount kaydı oluştu mu?
  const learned = await learnedSenderAccountRepo.getByEmail(TENANT_A, 'newuser@somecompany.local');
  expectTruthy('learnedSenderAccount kaydı var', !!learned);
  expect('isRoleAddress=false (kişisel)', learned?.isRoleAddress, false);
  expect('accountId = accountA1', learned?.accountId, accountA1);

  // 4) Yeni inbound aynı gönderenden → auto-link + 'learned' reason
  const inbound2 = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: 'newuser@somecompany.local',
    name: 'Yeni Kullanıcı',
    body: 'Bir sorun daha var.',
  });
  expect('inbound 2 created', inbound2.action, 'created');
  expect('auto-link (learned tetikleyici)', inbound2.match?.accountId, accountA1);
  const learnedReason = inbound2.match?.reasons?.find((r) => r.type === 'learned');
  expectTruthy('learned reason mevcut', !!learnedReason);
  expect('learned reason label = "Önceki vakadan öğrenildi"',
    learnedReason?.label, 'Önceki vakadan öğrenildi');

  return inbound1.caseId;
}

async function runScenarioB({ accountARole }) {
  console.log('\n=== Senaryo (b) M2.3-2: rol gönderen manuel bağla → mapping isRoleAddress=true; yeni inbound SADECE öneri ===');
  // Önce isRoleAddress helper'ını doğrula
  expect('isRoleAddress("info@x.com") = true', isRoleAddress('info@x.com'), true);
  expect('isRoleAddress("support@y.com") = true', isRoleAddress('support@y.com'), true);
  expect('isRoleAddress("personalA@y.com") = false', isRoleAddress('personalA@y.com'), false);

  const roleEmail = 'support@somecompany.local';
  // 1) Inbound vaka — role address gönderen
  const inbound1 = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: roleEmail,
    name: 'Support Team',
    body: 'Bilgi talebi.',
  });
  expect('inbound 1 created', inbound1.action, 'created');

  // 2) Manuel link → accountARole
  await caseRepository.linkAccount(
    inbound1.caseId, accountARole, 'Test Operator', [TENANT_A],
    { source: 'manual', actorUserId: null },
  );

  // 3) learnedSenderAccount isRoleAddress=true
  const learned = await learnedSenderAccountRepo.getByEmail(TENANT_A, roleEmail);
  expectTruthy('learnedSenderAccount kaydı var', !!learned);
  expect('isRoleAddress=true (role address)', learned?.isRoleAddress, true);

  // 4) Yeni inbound aynı gönderenden → öneri var ama AUTO-LINK YOK
  const inbound2 = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: roleEmail,
    name: 'Support Team',
    body: 'Başka bir konu.',
  });
  expect('inbound 2 created', inbound2.action, 'created');
  expect('AUTO-LINK YOK (role address)', inbound2.match?.accountId, null);
  const learnedReason = inbound2.match?.reasons?.find((r) => r.type === 'learned');
  expectTruthy('learned reason mevcut (sadece öneri)', !!learnedReason);

  return inbound1.caseId;
}

async function runScenarioC({ accountA1, accountA2 }) {
  console.log('\n=== Senaryo (c) M2.3-3: aynı gönderen farklı hesaba RE-LINK → overwrite ===');
  // Senaryo (a) sonrası newuser@somecompany.local zaten learnedSender'da
  // accountA1'a bağlı. Şimdi başka bir vaka → linkAccount accountA2.
  const inbound = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: 'newuser@somecompany.local',
    name: 'Yeni Kullanıcı',
    body: 'Re-link senaryosu.',
  });
  // Bu auto-link olur (Senaryo a sonrası learned mapping accountA1) — re-link
  // için manuel olarak accountA2'ye değiştirelim (Supervisor yanlış olduğunu
  // anladı). linkAccount source='manual' tekrar çağrılır.
  await caseRepository.linkAccount(
    inbound.caseId, accountA2, 'Test Supervisor', [TENANT_A],
    { source: 'manual', actorUserId: null },
  );
  const learned = await learnedSenderAccountRepo.getByEmail(TENANT_A, 'newuser@somecompany.local');
  expectTruthy('learnedSenderAccount hâlâ var', !!learned);
  expect('accountId OVERWRITE oldu = accountA2',
    learned?.accountId, accountA2);

  return inbound.caseId;
}

async function runScenarioD({ accountB }) {
  console.log('\n=== Senaryo (d) M2.3-4: tenant izolasyon — A learned eşleme B intake\'ini etkilemez ===');
  // Senaryo (a) ile newuser@somecompany.local tenant A'da learned;
  // (c) sonrası accountA2'ye bağlı. Tenant B intake aynı gönderenle:
  const inbound = await makeInboundCase({
    tenant: TENANT_B, tenantName: TENANT_B_NAME,
    from: 'newuser@somecompany.local',
    name: 'Yeni Kullanıcı',
    body: 'B tenant\'a yazıyorum.',
  });
  expect('B inbound created', inbound.action, 'created');
  expect('auto-link YOK (cross-tenant learned etkisiz)',
    inbound.match?.accountId, null);
  // Vaka B'de açıldı + bilinmeyen müşteri
  void accountB;
  return inbound.caseId;
}

async function runScenarioE({ accountAuto }) {
  console.log('\n=== Senaryo (e) M2.3-5: AUTO-link (intake email exact match) → mapping OLUŞMAZ ===');
  // accountAuto.email = 'autolink-account@m23-test.local'
  // Bu email'den inbound → engine 'email' reason → intake auto-link
  // (source='auto' geçer) → learnedSenderAccount kaydı oluşmamalı.
  const inbound = await makeInboundCase({
    tenant: TENANT_A, tenantName: TENANT_A_NAME,
    from: 'autolink-account@m23-test.local',
    name: 'Auto Match',
    body: 'Exact email match senaryosu.',
  });
  expect('auto-link başarılı (exact email)',
    inbound.match?.accountId, accountAuto);
  // learnedSenderAccount KAYDI yok
  const learned = await learnedSenderAccountRepo.getByEmail(
    TENANT_A, 'autolink-account@m23-test.local',
  );
  expect('learnedSenderAccount yok (auto-link öğrenmez)',
    learned, null);

  return inbound.caseId;
}

(async () => {
  let ctx = null;
  try {
    ctx = await setup();
    await runScenarioA(ctx);
    await runScenarioB(ctx);
    await runScenarioC(ctx);
    await runScenarioD(ctx);
    await runScenarioE(ctx);
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    if (ctx) try { await cleanup(ctx); } catch (e) { console.error('[cleanup] hata:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
