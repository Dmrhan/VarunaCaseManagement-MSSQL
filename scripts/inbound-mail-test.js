#!/usr/bin/env node
/**
 * Inbound Mail Intake Test — M2 IT-bağımsız doğrulama.
 *
 * Çalıştırma:
 *   npm run mail:inbound-test
 *
 * Senaryolar:
 *   1) Tam-eşleşen müşteri (Account.email = parsed.from.email)
 *      → vaka 'created' + match.accountId TAM eşleşmiş account'a otomatik bağlı
 *   2) Bilinmeyen gönderen
 *      → vaka 'created' + match.accountId=null + customerMatchPending=true
 *   3) Reply (subject'te [VK-<caseNumber>] token)
 *      → action='appended' + caseId=Senaryo 1'in vakası
 *
 * Setup:
 *   - Geçici Company + Account (Account.email=known.customer@varuna-test.local)
 *     oluşturulur
 *   - Test sonunda CLEANUP: Account, Case, CaseNote, CaseActivity, Company silinir
 *
 * NOT: Gerçek DB lookup'ları yapılır (engine + caseRepo davranışı doğrulanır).
 * Test fixture'ları test/fixtures/eml/'de. Reply fixture'ında [VK-__CASE_NUMBER__]
 * placeholder Senaryo 1'in caseNumber'ı ile substitute edilir.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseInboundEml } from '../server/lib/inboundMailParser.js';
import { intakeInboundEmail } from '../server/lib/inboundMailIntake.js';
import { prisma } from '../server/db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'test', 'fixtures', 'eml');

const TEST_COMPANY_ID = '__inbound-mail-test-co__';
const TEST_COMPANY_NAME = 'Inbound Mail Test Co';
// M2.1 — Senaryo 5 (tenant izolasyon) için ikinci tenant.
const TEST_COMPANY_B_ID = '__inbound-mail-test-co-b__';
const TEST_COMPANY_B_NAME = 'Inbound Mail Test Co B';
const KNOWN_EMAIL = 'known.customer@varuna-test.local';
const KNOWN_ACCOUNT_NAME = 'Tanımlı Müşteri (Test)';

const SYSTEM_ACTOR = {
  userId: null,
  personId: null,
  fullName: 'Mail Intake Bot',
  email: null,
  role: null,
  displayName: 'system:mail-intake',
};

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

function readFixture(name) {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

async function setup() {
  console.log('[setup] geçici test company + account oluşturuluyor...');
  await prisma.company.upsert({
    where: { id: TEST_COMPANY_ID },
    update: {},
    create: { id: TEST_COMPANY_ID, name: TEST_COMPANY_NAME, isActive: true },
  });
  // M2.1 — Tenant B (izolasyon testi için).
  await prisma.company.upsert({
    where: { id: TEST_COMPANY_B_ID },
    update: {},
    create: { id: TEST_COMPANY_B_ID, name: TEST_COMPANY_B_NAME, isActive: true },
  });
  // Account.email global unique; çakışmasın diye önce ara, varsa bağlı
  // case'leri ve AccountCompany'leri temizleyip sil (FK ihlali olmadan).
  const existing = await prisma.account.findFirst({
    where: { email: KNOWN_EMAIL },
  });
  if (existing) {
    const orphanCases = await prisma.case.findMany({
      where: { accountId: existing.id },
      select: { id: true },
    });
    const orphanIds = orphanCases.map((c) => c.id);
    if (orphanIds.length) {
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: orphanIds } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: orphanIds } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: orphanIds } } });
      await prisma.case.deleteMany({ where: { id: { in: orphanIds } } });
    }
    await prisma.accountCompany.deleteMany({ where: { accountId: existing.id } });
    await prisma.account.delete({ where: { id: existing.id } });
  }
  const account = await prisma.account.create({
    data: {
      name: KNOWN_ACCOUNT_NAME,
      email: KNOWN_EMAIL,
      isActive: true,
      companies: {
        create: { companyId: TEST_COMPANY_ID },
      },
    },
  });
  console.log(`  → company=${TEST_COMPANY_ID}, account=${account.id} (email=${KNOWN_EMAIL})`);
  return { accountId: account.id };
}

async function cleanup({ accountId }) {
  console.log('\n[cleanup] geçici test verisi siliniyor...');
  // M2.1 — A + B tenant cleanup. CaseAttachment + CaseHistory dahil.
  // (Case.attachments onDelete: Cascade → caseAttachment auto silinir
  // ama disk dosyaları orphan kalır; test'te geçici cases/{caseId}/ dizini
  // STORAGE_ROOT altında, prod'da yok, kabul edilebilir).
  for (const companyId of [TEST_COMPANY_ID, TEST_COMPANY_B_ID]) {
    const cases = await prisma.case.findMany({
      where: { companyId },
      select: { id: true },
    });
    const caseIds = cases.map((c) => c.id);
    if (caseIds.length) {
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.caseNote.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.caseAttachment.deleteMany({ where: { caseId: { in: caseIds } } });
      // caseActivity zaten siliniyor (yukarıda). caseHistory ayrı model değil.
      await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    }
  }
  if (accountId) {
    await prisma.accountCompany.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
  }
  await prisma.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => {});
  await prisma.company.delete({ where: { id: TEST_COMPANY_B_ID } }).catch(() => {});
  console.log('  → cleanup OK');
}

async function runScenario1() {
  console.log('\n=== Senaryo 1: Tanımlı müşteri (Account.email eşleşmesi) ===');
  const raw = readFixture('01-known-customer.eml');
  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  expect('parsed.from.email', parsedRes.data?.from?.email, KNOWN_EMAIL);

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=created', intakeRes.action, 'created');
  expectTruthy('caseId döndü', intakeRes.caseId);
  expectTruthy('match.accountId — Engine email eşleşmesi otomatik bağladı', intakeRes.match?.accountId);
  // DB'de vaka doğrula
  if (intakeRes.caseId) {
    const c = await prisma.case.findUnique({
      where: { id: intakeRes.caseId },
      select: { caseNumber: true, origin: true, accountId: true, customerMatchPending: true, customerContactEmail: true },
    });
    // DB raw değeri: toDb tireyi atıp ASCII identifier'a çevirir → 'Eposta'
    expect('Case.origin = Eposta (DB raw, toDb normalize)', c?.origin, 'Eposta');
    expect('Case.customerContactEmail set', c?.customerContactEmail, KNOWN_EMAIL);
    expectTruthy('Case.accountId set (otomatik bağlandı)', c?.accountId);
    expect('Case.customerMatchPending = false (linked)', c?.customerMatchPending, false);
    return c.caseNumber;
  }
  return null;
}

async function runScenario2() {
  console.log('\n=== Senaryo 2: Bilinmeyen gönderen ===');
  const raw = readFixture('02-unknown-sender.eml');
  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=created', intakeRes.action, 'created');
  expectTruthy('caseId döndü', intakeRes.caseId);
  expect('match.accountId = null (eşleşme yok)', intakeRes.match?.accountId, null);

  if (intakeRes.caseId) {
    const c = await prisma.case.findUnique({
      where: { id: intakeRes.caseId },
      select: { accountId: true, customerMatchPending: true, origin: true },
    });
    expect('Case.accountId = null', c?.accountId, null);
    expect('Case.customerMatchPending = true', c?.customerMatchPending, true);
    // DB raw değeri: toDb tireyi atıp ASCII identifier'a çevirir → 'Eposta'
    expect('Case.origin = Eposta (DB raw, toDb normalize)', c?.origin, 'Eposta');
  }
}

async function runScenario5(refCaseNumberA) {
  // M2.1 Senaryo (iv) — Ek + INLINE görsel + reddedilen ek senaryosu.
  // Kabul edilen: image/png screenshot, image/png logo (inline+cid).
  // Reddedilen: application/x-msdownload virus.exe (allowlist DIŞI).
  console.log('\n=== Senaryo 5 (M2.1 ek+inline): kabul edilen 2 görsel + reddedilen .exe ===');
  const raw = readFixture('05-with-attachments.eml');
  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  const atts = parsedRes.data?.attachments ?? [];
  expect('parser 3 ek çıkardı', atts.length, 3);
  expectTruthy('inline ek var (cid)', atts.some((a) => a.inline === true && a.cid));
  expectTruthy('reddedilecek .exe var', atts.some((a) => /\.exe$/i.test(a.filename ?? '')));

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=created', intakeRes.action, 'created');
  // 2 kabul + 1 atlandı (.exe)
  expect('attachments.stored = 2 (PNG ek + PNG inline)', intakeRes.attachments?.stored, 2);
  expect('attachments.skipped = 1 (.exe reddedildi)', intakeRes.attachments?.skipped?.length, 1);
  expect('skipped reason = mime_not_accepted',
    intakeRes.attachments?.skipped?.[0]?.reason, 'mime_not_accepted');

  if (intakeRes.caseId) {
    const dbAtts = await prisma.caseAttachment.findMany({
      where: { caseId: intakeRes.caseId },
      select: { fileName: true, uploadedBy: true, uploadedByUserId: true, fileSize: true },
    });
    expect('DB CaseAttachment satır sayısı = 2', dbAtts.length, 2);
    expectTruthy('Tüm satırlar uploadedBy="E-posta"',
      dbAtts.every((a) => a.uploadedBy === 'E-posta'));
    expectTruthy('Tüm satırlar uploadedByUserId=null',
      dbAtts.every((a) => a.uploadedByUserId === null));

    // "Dosya yüklendi" CaseActivity kaydı
    const hist = await prisma.caseActivity.count({
      where: { caseId: intakeRes.caseId, action: 'Dosya yüklendi' },
    });
    expect('CaseActivity "Dosya yüklendi" = 2', hist, 2);
  }
  void refCaseNumberA;
}

async function runScenario6(refCaseNumberA) {
  // M2.1 Senaryo (v) — Tenant izolasyon. B intake'i A'nın token'ı ile gelirse:
  // - B'nin companyId'sinde token aranır → bulamaz
  // - Yeni vaka açar (B tenant'ında)
  // - A'nın vakası DOKUNULMAZ
  console.log('\n=== Senaryo 6 (M2.1 tenant izolasyon): A token ile B intake ===');
  if (!refCaseNumberA) {
    console.log('  ! Senaryo 1 caseNumber yok → atlanıyor');
    return;
  }
  const rawTemplate = readFixture('06-cross-tenant-token.eml');
  const raw = rawTemplate.replace(/__CASE_NUMBER_OF_A__/g, refCaseNumberA.replace(/^VK-/, ''));

  // Before snapshot: A vakasının note count'u
  const aBefore = await prisma.case.findFirst({
    where: { caseNumber: refCaseNumberA, companyId: TEST_COMPANY_ID },
    select: { id: true },
  });
  const aNotesBefore = aBefore
    ? await prisma.caseNote.count({ where: { caseId: aBefore.id } })
    : 0;

  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  expectTruthy('subject\'te A tenant token var', /\[VK-/.test(parsedRes.data?.subject ?? ''));

  // B intake — companyId=TEST_COMPANY_B_ID
  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_B_ID,
    companyName: TEST_COMPANY_B_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=created (B tenant\'ta yeni vaka)', intakeRes.action, 'created');

  // A vakası DOKUNULMAMIŞ olmalı
  if (aBefore) {
    const aNotesAfter = await prisma.caseNote.count({ where: { caseId: aBefore.id } });
    expect('A vakası note count DEĞİŞMEDİ', aNotesAfter, aNotesBefore);
  }

  // B'de gerçekten yeni vaka var
  if (intakeRes.caseId) {
    const bCase = await prisma.case.findUnique({
      where: { id: intakeRes.caseId },
      select: { companyId: true },
    });
    expect('Yeni vaka B tenant\'ında', bCase?.companyId, TEST_COMPANY_B_ID);
  }
}

async function runScenario4() {
  // Codex P1 fix doğrulaması — bilinmeyen gönderici, body'de bilinen
  // müşterinin emailini quote ediyor. Engine signal extraction (text
  // regex EMAIL_RX) bu emaili sinyale alır, suggestion top'a known
  // müşteri çıkar. ANCAK auto-link YAPILMAMALI çünkü parsed.from.email
  // !== eşleşen account email'i. Vaka Supervisor sırasına düşmeli.
  console.log('\n=== Senaryo 4 (P1 fix): bilinmeyen gönderici, body\'de tanımlı müşteri emaili quote ediyor ===');
  const raw = readFixture('04-spoofed-quote.eml');
  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  expect('parsed.from.email = spam', parsedRes.data?.from?.email, 'random.spammer@otherorg-test.local');
  expectTruthy('body içinde bilinen müşteri emaili quote edilmiş',
    (parsedRes.data?.text ?? '').includes('known.customer@varuna-test.local'));

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=created', intakeRes.action, 'created');
  // KRİTİK: auto-link YAPILMAMALI — sender !== matched account email.
  expect('match.accountId = null (P1 sender-email guard)', intakeRes.match?.accountId, null);

  if (intakeRes.caseId) {
    const c = await prisma.case.findUnique({
      where: { id: intakeRes.caseId },
      select: { accountId: true, customerMatchPending: true },
    });
    expect('Case.accountId = null (auto-link blocked)', c?.accountId, null);
    expect('Case.customerMatchPending = true (Supervisor sırası)', c?.customerMatchPending, true);
  }
}

async function runScenario7(refCaseNumberA) {
  // Codex P2 fix kanıtı — Per-case attachment cap (FILE_MAX_COUNT=20).
  // Senaryo: A tenant vakasında 18 mevcut attachment dolduralım,
  // sonra subject [VK-xxx] token'lı 3 PNG'li mail gelsin. Beklenen:
  // stored=2 (kalan 2 slot), skipped=1 reason='attachment_cap_reached'.
  console.log('\n=== Senaryo 7 (Codex P2 fix): per-case attachment cap (20) ===');
  if (!refCaseNumberA) {
    console.log('  ! Senaryo 1 caseNumber yok → atlanıyor');
    return;
  }
  const refCase = await prisma.case.findFirst({
    where: { caseNumber: refCaseNumberA, companyId: TEST_COMPANY_ID },
    select: { id: true },
  });
  if (!refCase) {
    console.log('  ! reference case bulunamadı → atlanıyor');
    return;
  }

  // Mevcut attachment count'unu 18'e tamamla
  const existing = await prisma.caseAttachment.count({ where: { caseId: refCase.id } });
  const dummiesNeeded = Math.max(0, 18 - existing);
  for (let i = 0; i < dummiesNeeded; i += 1) {
    await prisma.caseAttachment.create({
      data: {
        caseId: refCase.id,
        companyId: TEST_COMPANY_ID,
        fileName: `dummy-${i}.txt`,
        fileSize: 1,
        mimeType: 'text/plain',
        fileUrl: `__dummy__/${refCase.id}/${i}.txt`,
        uploadedBy: 'test-dummy',
        uploadedByUserId: null,
      },
    });
  }
  const before = await prisma.caseAttachment.count({ where: { caseId: refCase.id } });
  expect('mevcut attachment count = 18 (setup)', before, 18);

  // 3 PNG'li mail (subject token = A vakası) intake et
  const rawTemplate = readFixture('07-three-attachments-cap.eml');
  const raw = rawTemplate.replace(/__CASE_NUMBER__/g, refCaseNumberA.replace(/^VK-/, ''));
  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  expect('parser 3 PNG ek çıkardı', parsedRes.data?.attachments?.length, 3);

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=appended (token eşleşti)', intakeRes.action, 'appended');
  expect('attachments.stored = 2 (kalan slot)', intakeRes.attachments?.stored, 2);
  expect('attachments.skipped = 1', intakeRes.attachments?.skipped?.length, 1);
  expect('skipped reason = attachment_cap_reached',
    intakeRes.attachments?.skipped?.[0]?.reason, 'attachment_cap_reached');

  // DB cap doğrula: tam 20
  const after = await prisma.caseAttachment.count({ where: { caseId: refCase.id } });
  expect('cap sonrası DB attachment count = 20 (FILE_MAX_COUNT)', after, 20);
}

async function runScenario3(refCaseNumber) {
  console.log('\n=== Senaryo 3: Reply (subject token) — mevcut vakaya not ekle ===');
  if (!refCaseNumber) {
    console.log('  ! Senaryo 1 caseNumber yok → bu senaryo atlanıyor');
    return;
  }
  // Reply fixture'da [VK-__CASE_NUMBER__] placeholder substitute
  const rawTemplate = readFixture('03-reply-thread.eml');
  const raw = rawTemplate.replace(/__CASE_NUMBER__/g, refCaseNumber.replace(/^VK-/, ''));

  const parsedRes = await parseInboundEml(raw);
  expect('parse ok', parsedRes.ok, true);
  expect(`subject [${refCaseNumber}] token var`, /\[VK-/.test(parsedRes.data?.subject ?? ''), true);

  const intakeRes = await intakeInboundEmail({
    parsed: parsedRes.data,
    companyId: TEST_COMPANY_ID,
    companyName: TEST_COMPANY_NAME,
    actor: SYSTEM_ACTOR,
  });
  expect('intake ok', intakeRes.ok, true);
  expect('action=appended', intakeRes.action, 'appended');
  expect(`token = ${refCaseNumber}`, intakeRes.token, refCaseNumber);

  // CaseNote oluştu mu?
  if (intakeRes.caseId) {
    const noteCount = await prisma.caseNote.count({ where: { caseId: intakeRes.caseId } });
    expectTruthy(`CaseNote en az 1 (count=${noteCount})`, noteCount >= 1);
  }
}

(async () => {
  let setupRes = null;
  try {
    setupRes = await setup();
    const caseNumber1 = await runScenario1();
    await runScenario2();
    await runScenario4();
    await runScenario5(caseNumber1); // M2.1 ek/inline
    await runScenario6(caseNumber1); // M2.1 tenant izolasyon
    await runScenario3(caseNumber1);
    await runScenario7(caseNumber1); // Codex P2 cap fix
  } catch (err) {
    console.error('\n[test] BEKLENMEYEN HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    if (setupRes) {
      try { await cleanup(setupRes); } catch (err) {
        console.error('[cleanup] hata:', err.message);
      }
    }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
