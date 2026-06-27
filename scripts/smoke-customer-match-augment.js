#!/usr/bin/env node
/**
 * Customer match — high-signal augmentation kontratı.
 *
 *  Plan onaylı senaryolar:
 *  (1) 501+ hesaplı tenant; exact-email hedefi 500'lük dilim DIŞINDA →
 *      augment yolu öneride tepede ('E-posta eşleşti' +80)
 *  (2) Learned sender 500'lük dilim dışında → augment learned account'u
 *      havuza ekler; öneride tepede ('Önceki vakadan öğrenildi' +80)
 *  (3) External customer code augment yolu
 *  (4) Eski davranış regression yok — küçük tenant'ta (500 altı) sonuçlar
 *      değişmez
 */

import { prisma } from '../server/db/client.js';
import { customerMatchRepository } from '../server/db/customerMatchRepository.js';

const TENANT = '__cm-augment__';
const TENANT_NAME = 'Customer Match Augment Smoke';

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
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } }).catch(() => {});
  const cs = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  if (cs.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: cs.map((c) => c.id) } } });
    await prisma.case.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  }
  await prisma.learnedSenderAccount.deleteMany({ where: { companyId: TENANT } }).catch(() => {});
  await prisma.accountContact.deleteMany({ where: { account: { companyId: TENANT } } }).catch(() => {});
  await prisma.accountCompany.deleteMany({ where: { companyId: TENANT } }).catch(() => {});
  await prisma.account.deleteMany({ where: { companyId: TENANT } });
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

async function mkCase(caseNumber, signals) {
  return prisma.case.create({
    data: {
      companyId: TENANT, caseNumber,
      title: 'Augment smoke', description: 'x',
      caseType: 'GeneralSupport', status: 'Acik', priority: 'Medium',
      origin: 'Eposta', companyName: TENANT_NAME,
      category: 'Genel', subCategory: 'Genel', requestType: 'Talep',
      customerMatchPending: true,
      customerContactName: signals?.contactName ?? null,
      customerContactEmail: signals?.email ?? null,
      customerContactPhone: signals?.phone ?? null,
      customerCompanyName: signals?.companyName ?? null,
    },
  });
}

async function mkAccountWithEmail({ name, email, baseTs }) {
  // createdAt ile fetchCandidateAccounts orderBy 'asc' sırasını kontrol et
  return prisma.account.create({
    data: {
      companyId: TENANT,
      name,
      email,
      isActive: true,
      createdAt: baseTs,
      updatedAt: baseTs,
    },
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Exact email 500\'lük dilim DIŞINDA — augment yakalar ===');
    // 500 adet eski (createdAt erken) "noise" account → fetchCandidateAccounts
    // top 500'üne girer
    const baseEarly = new Date('2026-01-01T00:00:00Z');
    // Batch insert (createMany) — connection pool tüketmesin
    const noiseData = [];
    for (let i = 0; i < 500; i++) {
      const ts = new Date(baseEarly.getTime() + i * 1000);
      noiseData.push({
        companyId: TENANT,
        name: `Noise ${i}`,
        email: null,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    // Prisma MSSQL createMany 1000 batch sınırı — tek seferde geçer
    await prisma.account.createMany({ data: noiseData });

    // GERÇEK hedef — createdAt çok geç → top 500'e GİRMEZ
    const targetTs = new Date('2026-12-31T23:59:00Z');
    const target = await mkAccountWithEmail({
      name: 'Demirhan İşbakan Test Müşteri',
      email: 'demirhan.isbakan@univera.com.tr',
      baseTs: targetTs,
    });

    // Doğrula: fetchCandidateAccounts top 500'e target dahil DEĞİL
    const candidates500 = await prisma.account.findMany({
      where: { companyId: TENANT, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true },
    });
    expect('top 500 = 500 satır', candidates500.length, 500);
    expect('target top 500 İÇİNDE DEĞİL',
      candidates500.some((a) => a.id === target.id), false);

    const c1 = await mkCase('VK-CMA-1', {
      contactName: 'Demirhan İŞBAKAN',
      email: 'demirhan.isbakan@univera.com.tr',
    });
    const r1 = await customerMatchRepository.suggestCustomerMatches({
      caseId: c1.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('suggestion var', r1?.suggestions?.length > 0);
    const top1 = r1.suggestions[0];
    expect('tepedeki suggestion = target', top1?.accountId, target.id);
    expect('skor >= 80 (exact email)', top1?.score >= 80, true);
    expectTruthy('reason "E-posta eşleşti" içerir',
      top1?.reasons?.some((r) => r.label === 'E-posta eşleşti'));

    console.log('\n=== (2) Learned sender 500\'lük dilim DIŞINDA — augment yakalar ===');
    // Manuel link sonrası: aynı target için 2. mail
    await prisma.learnedSenderAccount.create({
      data: {
        companyId: TENANT,
        senderEmail: 'demirhan.isbakan@univera.com.tr',
        accountId: target.id,
        isRoleAddress: false,
      },
    });
    const c2 = await mkCase('VK-CMA-2', {
      contactName: 'Demirhan İŞBAKAN',
      email: 'demirhan.isbakan@univera.com.tr',
    });
    const r2 = await customerMatchRepository.suggestCustomerMatches({
      caseId: c2.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    const top2 = r2.suggestions[0];
    expect('tepedeki suggestion = target', top2?.accountId, target.id);
    expectTruthy('learned reason VAR',
      top2?.reasons?.some((r) => r.label === 'Önceki vakadan öğrenildi'));

    console.log('\n=== (3) External customer code augment yolu ===');
    const code5 = '12345';
    await prisma.accountCompany.create({
      data: {
        companyId: TENANT,
        accountId: target.id,
        externalCustomerCode: code5,
      },
    });
    const c3 = await mkCase('VK-CMA-3', {
      contactName: 'Test',
      // Email YOK: code'u 5 digit text'ten çekmesin diye description'a katma
    });
    // ExternalCode FIVE_DIGIT_RX text'ten çekiyor — title/description'da olmalı
    await prisma.case.update({
      where: { id: c3.id },
      data: { description: `Müşteri kodu: ${code5}` },
    });
    const r3 = await customerMatchRepository.suggestCustomerMatches({
      caseId: c3.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('externalCode suggestion var', r3?.suggestions?.length > 0);
    expectTruthy('target listede',
      r3.suggestions.some((s) => s.accountId === target.id));
    const targetSugg3 = r3.suggestions.find((s) => s.accountId === target.id);
    expectTruthy('externalCode reason VAR',
      targetSugg3?.reasons?.some((r) => r.type === 'externalCode'));

    console.log('\n=== (3b) Phone exact augment — DB normalize formatta saklı → yakalar ===');
    await reset();
    await prisma.company.upsert({
      where: { id: TENANT }, update: {},
      create: { id: TENANT, name: TENANT_NAME, isActive: true },
    });
    // 500 noise
    const noiseData2 = [];
    const baseEarly2 = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 500; i++) {
      const ts = new Date(baseEarly2.getTime() + i * 1000);
      noiseData2.push({
        companyId: TENANT, name: `Noise ${i}`, email: null, phone: null,
        isActive: true, createdAt: ts, updatedAt: ts,
      });
    }
    await prisma.account.createMany({ data: noiseData2 });
    // Hedef: DB'de NORMALIZE format ('+905324445500'); requester aynı sinyali yollar
    const phoneTargetTs = new Date('2026-12-31T23:59:00Z');
    const phoneTarget = await prisma.account.create({
      data: {
        companyId: TENANT, name: 'Phone Match Target',
        phone: '+905324445500', // normalizePhone çıktısıyla uyumlu
        isActive: true, createdAt: phoneTargetTs, updatedAt: phoneTargetTs,
      },
    });
    const cPhone = await mkCase('VK-CMA-PH', {
      contactName: 'Phone Test',
      phone: '+905324445500', // signals.requesterPhone → normalize aynı
    });
    const rPhone = await customerMatchRepository.suggestCustomerMatches({
      caseId: cPhone.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('phone-augment: suggestion var', rPhone?.suggestions?.length > 0);
    expectTruthy('phone-augment: target listede',
      rPhone.suggestions.some((s) => s.accountId === phoneTarget.id));
    const phoneSugg = rPhone.suggestions.find((s) => s.accountId === phoneTarget.id);
    expectTruthy('phone-augment: "Telefon eşleşti" reason VAR',
      phoneSugg?.reasons?.some((r) => r.label === 'Telefon eşleşti'));

    console.log('\n=== (3c) Codex P2 fix: DB raw + phoneE164 normalize → augment YAKALAR ===');
    // DB'de raw display format (boşluklu); phoneE164 normalize.
    // signals.phones normalize → phoneE164 IN sorgusu hit.
    const rawPhoneTs = new Date('2026-12-31T23:59:30Z');
    const rawTarget = await prisma.account.create({
      data: {
        companyId: TENANT, name: 'Raw+E164 Target',
        phone: '+90 532 444 5599',       // display raw
        phoneE164: '+905324445599',      // WR-A2 normalize
        isActive: true, createdAt: rawPhoneTs, updatedAt: rawPhoneTs,
      },
    });
    const cRaw = await mkCase('VK-CMA-RAW', {
      contactName: 'Raw Phone Test',
      phone: '+905324445599',
    });
    const rRaw = await customerMatchRepository.suggestCustomerMatches({
      caseId: cRaw.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('raw-display + phoneE164 normalize → target önerilir',
      rRaw.suggestions.some((s) => s.accountId === rawTarget.id));
    const rawSugg = rRaw.suggestions.find((s) => s.accountId === rawTarget.id);
    expectTruthy('"Telefon eşleşti" reason VAR (E164 yolu)',
      rawSugg?.reasons?.some((r) => r.label === 'Telefon eşleşti'));

    console.log('\n=== (3d) Slot phone2E164 → augment yakalar ===');
    const slotTs = new Date('2026-12-31T23:59:40Z');
    const slotTarget = await prisma.account.create({
      data: {
        companyId: TENANT, name: 'Slot Phone Target',
        phone: '+90 212 000 0001',
        phoneE164: '+902120000001',
        phone2: '+90 532 999 8877',
        phone2E164: '+905329998877', // sinyalin yakalanacağı slot
        isActive: true, createdAt: slotTs, updatedAt: slotTs,
      },
    });
    const cSlot = await mkCase('VK-CMA-SLOT', {
      contactName: 'Slot Test',
      phone: '+905329998877',
    });
    const rSlot = await customerMatchRepository.suggestCustomerMatches({
      caseId: cSlot.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('slot phone2E164 → target önerilir',
      rSlot.suggestions.some((s) => s.accountId === slotTarget.id));

    console.log('\n=== (3e) Contact phoneE164 → augment yakalar ===');
    const contactTs = new Date('2026-12-31T23:59:50Z');
    const contactTarget = await prisma.account.create({
      data: {
        companyId: TENANT, name: 'Contact Phone Target',
        isActive: true, createdAt: contactTs, updatedAt: contactTs,
        contacts: {
          create: {
            fullName: 'Test Kişi',
            phone: '+90 533 111 2233',
            phoneE164: '+905331112233',
            isActive: true,
          },
        },
      },
    });
    const cContact = await mkCase('VK-CMA-CONTACT', {
      contactName: 'Contact Test',
      phone: '+905331112233',
    });
    const rContact = await customerMatchRepository.suggestCustomerMatches({
      caseId: cContact.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expectTruthy('contact phoneE164 → target önerilir',
      rContact.suggestions.some((s) => s.accountId === contactTarget.id));

    console.log('\n=== (4) Küçük tenant regression — 10 hesap, augment etkisiz ===');
    await reset();
    await prisma.company.upsert({
      where: { id: TENANT }, update: {},
      create: { id: TENANT, name: TENANT_NAME, isActive: true },
    });
    const baseSmall = new Date('2026-06-01T00:00:00Z');
    let smallTarget;
    for (let i = 0; i < 10; i++) {
      const ts = new Date(baseSmall.getTime() + i * 1000);
      const a = await prisma.account.create({
        data: {
          companyId: TENANT,
          name: `Small ${i}`,
          email: i === 5 ? 'demirhan.isbakan@univera.com.tr' : null,
          isActive: true,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      if (i === 5) smallTarget = a;
    }
    const c4 = await mkCase('VK-CMA-4', {
      contactName: 'Demirhan',
      email: 'demirhan.isbakan@univera.com.tr',
    });
    const r4 = await customerMatchRepository.suggestCustomerMatches({
      caseId: c4.id, allowedCompanyIds: [TENANT], limit: 5,
    });
    expect('küçük tenant: tepedeki = smallTarget',
      r4.suggestions[0]?.accountId, smallTarget.id);
    expect('küçük tenant: skor >= 80', r4.suggestions[0]?.score >= 80, true);
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
