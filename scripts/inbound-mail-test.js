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
  // Account.email global unique; çakışmasın diye önce ara, varsa sil.
  const existing = await prisma.account.findFirst({
    where: { email: KNOWN_EMAIL },
  });
  if (existing) {
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
  // Test sırasında oluşturulan vakalar + bağımlı kayıtlar
  const cases = await prisma.case.findMany({
    where: { companyId: TEST_COMPANY_ID },
    select: { id: true },
  });
  const caseIds = cases.map((c) => c.id);
  if (caseIds.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  }
  if (accountId) {
    await prisma.accountCompany.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
  }
  await prisma.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => {});
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
    await runScenario3(caseNumber1);
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
