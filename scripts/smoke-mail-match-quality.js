#!/usr/bin/env node
/**
 * M2.2 match quality smoke — 5 senaryo (a-e).
 *
 * REUSE: server/db/customerMatchRepository.js suggestCustomerMatches
 * + extractSignalsFromCase + scoreCandidate (yeni fonksiyon YAZILMADI).
 *
 * Çalıştırma:
 *   npm run smoke:mail-match
 *
 * Senaryolar:
 *   (a) İki numara son-7 hane aynı ama TAM farklı → telefon eşleşMEZ (M2.2-1)
 *   (b) Inbound mail, gövdede signature telefonu → telefon gürültü
 *       eşleşmesi YOK (M2.2-2/3)
 *   (c) Exact gönderen email → hâlâ auto-link (regresyon yok)
 *   (d) Domain: gönderen @acme.com, başka müşteride contact @acme.com →
 *       'domain' önerisi ÇIKAR; gönderen @gmail.com → domain önerisi
 *       ÇIKMAZ (M2.2-5 + blocklist)
 *   (e) Placeholder telefon (>3 hesapta) → reason sayılmaz (M2.2-4)
 */

import { prisma } from '../server/db/client.js';
import { suggestCustomerMatches } from '../server/db/customerMatchRepository.js';
import {
  intakeInboundEmail,
  stripSignatureAndQuotes,
} from '../server/lib/inboundMailIntake.js';
import { parseInboundEml } from '../server/lib/inboundMailParser.js';

const TENANT = '__m22-match-quality__';
const TENANT_NAME = 'M2.2 Match Quality Co';
const SYSTEM_ACTOR = Object.freeze({
  userId: null, personId: null, fullName: 'M2.2 Bot',
  email: null, role: null, displayName: 'system:m22-test',
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

async function setup() {
  console.log('[setup] geçici tenant + accounts oluşturuluyor...');
  await prisma.company.upsert({
    where: { id: TENANT },
    update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });

  // Önceki test artıkları temizliği
  for (const email of [
    'acme-known@m22-test.local',
    'acme-other@m22-test.local',
    'unknown@gmail.com',
    'placeholder-tester@m22-test.local',
  ]) {
    const ex = await prisma.account.findFirst({ where: { email } });
    if (ex) {
      const cs = await prisma.case.findMany({ where: { accountId: ex.id }, select: { id: true } });
      const ids = cs.map((c) => c.id);
      if (ids.length) {
        await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: ids } } }).catch(() => {});
        await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
        await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
        await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
        await prisma.case.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.accountContact.deleteMany({ where: { accountId: ex.id } });
      await prisma.accountCompany.deleteMany({ where: { accountId: ex.id } });
      await prisma.account.delete({ where: { id: ex.id } });
    }
  }

  // Account A: domain @acme.com'da, exact email yok (Senaryo d)
  const accountA = await prisma.account.create({
    data: {
      name: 'Acme Tanımlı Müşteri',
      email: 'acme-known@m22-test.local',
      phone: '+905320001122', // Senaryo a için tam farklı numara
      isActive: true,
      companies: { create: { companyId: TENANT } },
      contacts: {
        create: {
          fullName: 'Acme Contact',
          email: 'contact@acme.com', // Senaryo d: aday domain
          phone: '+908881112233', // Senaryo a için "son 7 hane benzer" tuzağı
          isPrimary: true,
          isActive: true,
        },
      },
    },
  });

  // Account B: placeholder telefon paylaşımı için ek 3 hesap (M2.2-4)
  const placeholderPhone = '+905555555555';
  const placeholderAccounts = [];
  for (let i = 0; i < 4; i += 1) {
    const a = await prisma.account.create({
      data: {
        name: `Placeholder Co ${i}`,
        email: i === 0 ? 'placeholder-tester@m22-test.local' : null,
        phone: placeholderPhone,
        isActive: true,
        companies: { create: { companyId: TENANT } },
      },
    });
    placeholderAccounts.push(a.id);
  }

  return { accountAId: accountA.id, placeholderAccounts, placeholderPhone };
}

async function cleanup({ accountAId, placeholderAccounts }) {
  console.log('\n[cleanup] geçici test verisi siliniyor...');
  const cases = await prisma.case.findMany({
    where: { companyId: TENANT }, select: { id: true },
  });
  const caseIds = cases.map((c) => c.id);
  if (caseIds.length) {
    await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: caseIds } } }).catch(() => {});
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  }
  const allAccountIds = [accountAId, ...placeholderAccounts].filter(Boolean);
  for (const aid of allAccountIds) {
    await prisma.accountContact.deleteMany({ where: { accountId: aid } });
    await prisma.accountCompany.deleteMany({ where: { accountId: aid } });
    await prisma.account.delete({ where: { id: aid } }).catch(() => {});
  }
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
  console.log('  → cleanup OK');
}

async function makeInboundCase({ from, name, body }) {
  const rawEml = `From: "${name}" <${from}>
To: support@varuna.com
Subject: M2.2 test
Date: Wed, 25 Jun 2026 16:00:00 +0300
Message-ID: <m22-${Date.now()}-${Math.random().toString(36).slice(2)}@m22-test.local>
Content-Type: text/plain; charset=UTF-8

${body}`;
  const parsed = await parseInboundEml(rawEml);
  if (!parsed.ok) throw new Error('parse fail');
  const r = await intakeInboundEmail({
    parsed: parsed.data,
    companyId: TENANT,
    companyName: TENANT_NAME,
    actor: SYSTEM_ACTOR,
  });
  return r;
}

async function runScenarioA() {
  // Senaryo (a) — Phone exact: son-7 benzer ama tam farklı eşleşMEZ.
  // Account A contact phone: +908881112233 → normalize 908881112233
  // Test signal: +900001112233 → son 7 hane 1112233 BENZER ama tam farklı.
  console.log('\n=== Senaryo (a) M2.2-1: phone exact match, suffix eşleşMEZ ===');
  const c = await prisma.case.create({
    data: {
      caseNumber: `VK-M22-A-${Date.now().toString(36).toUpperCase()}`,
      title: 'M2.2 phone exact test',
      description: 'manuel phase D, son-7 hane çakışması',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Telefon', // Manuel — text regex aktif
      companyId: TENANT, companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Telefon', requestType: 'Bilgi',
      customerMatchPending: true,
      customerContactPhone: '+900001112233', // son 7 hane aynı, tam farklı
    },
  });
  const r = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: [TENANT] });
  const hasPhoneReason = (r.suggestions ?? []).some(
    (s) => s.reasons?.some((rs) => rs.type === 'phone'),
  );
  expect('phone reason YOK (suffix eşleşmesi engellendi)', hasPhoneReason, false);
  return c.id;
}

async function runScenarioB({ accountAId }) {
  // Senaryo (b) — Inbound + signature telefonu gürültüsü.
  // Bilinmeyen gönderici (acme'den DEĞİL); signature'da Account A'nın
  // contact telefonu var. Inbound olduğu için gövdeden phone KAZIMAMALI.
  console.log('\n=== Senaryo (b) M2.2-2/3: inbound signature telefonu gürültü değil ===');
  const r = await makeInboundCase({
    from: 'unknown@unrelated.example',
    name: 'Yabancı',
    body: `Merhaba

Demo talep ediyorum.

Saygılar
--
Foo Bar
Tel: +908881112233
unrelated@example`,
  });
  expectTruthy('intake OK', r.ok);
  const sug = await suggestCustomerMatches({
    caseId: r.caseId,
    allowedCompanyIds: [TENANT],
  });
  const phoneReason = (sug.suggestions ?? [])
    .flatMap((s) => s.reasons ?? [])
    .find((rs) => rs.type === 'phone');
  expect('phone reason YOK (signature gürültüsü kazınmadı)',
    phoneReason ? true : false, false);
  // accountA hala önerilmemeli (sadece signature'da telefon eşleşmesi olurdu)
  const hitA = (sug.suggestions ?? []).some((s) => s.accountId === accountAId);
  expect('Account A önerilMEDİ (inbound origin gövdeden çekmedi)', hitA, false);
  return r.caseId;
}

async function runScenarioC({ accountAId }) {
  // Senaryo (c) — Exact gönderen email auto-link (regresyon).
  // Account A.email = 'acme-known@m22-test.local'; intake from = aynı.
  console.log('\n=== Senaryo (c) regression: exact email → auto-link ===');
  const r = await makeInboundCase({
    from: 'acme-known@m22-test.local',
    name: 'Tanımlı Müşteri',
    body: 'Tanımlı müşteriden geldi.',
  });
  expectTruthy('intake OK', r.ok);
  expect('match.accountId = Account A (auto-link)', r.match?.accountId, accountAId);
  return r.caseId;
}

async function runScenarioD({ accountAId }) {
  // Senaryo (d) — Domain önerisi.
  // 1) from=@acme.com, Account A'nın contact'ında @acme.com var → domain reason
  // 2) from=@gmail.com → blocklist; domain reason YOK
  console.log('\n=== Senaryo (d) M2.2-5: domain önerisi + blocklist ===');

  // Sub-d1: @acme.com
  const r1 = await makeInboundCase({
    from: 'new-person@acme.com',
    name: 'Acme Yeni Kişi',
    body: 'Bu kullanıcı tanımlı değil ama acme domain\'inde.',
  });
  expectTruthy('intake OK', r1.ok);
  const sug1 = await suggestCustomerMatches({
    caseId: r1.caseId, allowedCompanyIds: [TENANT],
  });
  const domainOnA = (sug1.suggestions ?? []).find((s) => s.accountId === accountAId);
  const domainReason1 = domainOnA?.reasons?.find((r) => r.type === 'domain');
  expectTruthy('Account A önerildi (domain üzerinden)', !!domainOnA);
  expectTruthy('domain reason mevcut + label = "Aynı e-posta domaini"',
    domainReason1 && domainReason1.label === 'Aynı e-posta domaini');

  // Sub-d2: @gmail.com (blocklist)
  const r2 = await makeInboundCase({
    from: 'random@gmail.com',
    name: 'Random Gmail',
    body: 'Gmail kullanıcısı.',
  });
  expectTruthy('intake OK', r2.ok);
  const sug2 = await suggestCustomerMatches({
    caseId: r2.caseId, allowedCompanyIds: [TENANT],
  });
  const domainReasonGmail = (sug2.suggestions ?? [])
    .flatMap((s) => s.reasons ?? [])
    .find((rs) => rs.type === 'domain');
  expect('@gmail.com için domain reason YOK (blocklist)',
    domainReasonGmail ? true : false, false);

  return [r1.caseId, r2.caseId];
}

async function runScenarioE({ placeholderPhone }) {
  // Senaryo (e) — Placeholder telefon (>3 hesapta) reason sayılmaz.
  // Setup'ta placeholderPhone 4 farklı hesapta → threshold (3) aşılır.
  console.log('\n=== Senaryo (e) M2.2-4: placeholder telefon discriminator değil ===');
  const c = await prisma.case.create({
    data: {
      caseNumber: `VK-M22-E-${Date.now().toString(36).toUpperCase()}`,
      title: 'Placeholder phone test',
      description: '-',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Telefon', // manuel
      companyId: TENANT, companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Telefon', requestType: 'Bilgi',
      customerMatchPending: true,
      customerContactPhone: placeholderPhone,
    },
  });
  const r = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: [TENANT] });
  const phoneReason = (r.suggestions ?? [])
    .flatMap((s) => s.reasons ?? [])
    .find((rs) => rs.type === 'phone');
  expect('phone reason YOK (placeholder >3 hesapta → discriminator değil)',
    phoneReason ? true : false, false);
  return c.id;
}

async function runScenarioF({ accountAId }) {
  // Codex P2 fix kanıtı — TR national format ↔ E.164 canonicalize.
  // Account A.phone = '+905320001122'. User customerless case'te
  // '0532 000 1122' (TR national format) girer → normalizePhoneE164
  // her ikisini de '+905320001122'e çevirir → exact match.
  // Eski naive normalize (sadece whitespace/parantez sil) bu eşleşmeyi
  // SKIP ederdi → manuel Phase D phone-based öneri kaybolurdu.
  console.log('\n=== Senaryo (f) Codex P2: TR national format → E.164 canonicalize ===');
  const c = await prisma.case.create({
    data: {
      caseNumber: `VK-M22-F-${Date.now().toString(36).toUpperCase()}`,
      title: 'TR national phone test',
      description: '-',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Telefon', // manuel — text kazıma aktif
      companyId: TENANT, companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Telefon', requestType: 'Bilgi',
      customerMatchPending: true,
      // Account A.phone = '+905320001122' (E.164); user TR national girer:
      customerContactPhone: '0532 000 1122',
    },
  });
  const r = await suggestCustomerMatches({ caseId: c.id, allowedCompanyIds: [TENANT] });
  const hitA = (r.suggestions ?? []).find((s) => s.accountId === accountAId);
  expectTruthy('Account A önerildi (canonicalize sonrası exact match)', !!hitA);
  const phoneReason = hitA?.reasons?.find((rs) => rs.type === 'phone');
  expectTruthy('phone reason mevcut (TR national ↔ E.164)', !!phoneReason);
  return c.id;
}

(async () => {
  let ctx = null;
  try {
    ctx = await setup();
    await runScenarioA();
    await runScenarioB(ctx);
    await runScenarioC(ctx);
    await runScenarioD(ctx);
    await runScenarioE(ctx);
    await runScenarioF(ctx);
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
