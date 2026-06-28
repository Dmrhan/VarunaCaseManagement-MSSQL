#!/usr/bin/env node
/**
 * M4.1 FAZ B — Müşteri bildirim altyapı genişlemesi smoke.
 *
 *  (1) ALLOWED_EVENTS — case_created + status_changed kabul (createRule)
 *  (2) ALLOWED_AUDIENCE_TYPES — requester kabul (createRule)
 *  (3) Render empty marker → empty string (M6.3b parite)
 *  (4) emitEvent case_created — requester resolver email dolu → dispatch Sent
 *  (5) emitEvent case_created — customerContactEmail boş → no_channel_available
 *  (6) emitEvent case_created — opt-out (allowCustomerNotifications=false)
 *  (7) emitEvent status_changed → dispatch
 *
 * Mutasyon: yarattığı tüm satırları finally bloğunda temizler.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import {
  createTemplate,
  createRule,
  renderTemplate,
  emitEvent,
} from '../server/db/notificationRepository.js';

const PREFIX = `m41_${randomUUID().slice(0, 8).replace(/-/g, '_')}`;
const COMP = `${PREFIX}-c`;
const ACC_OK = `${PREFIX}-acc-ok`;
const ACC_OPT = `${PREFIX}-acc-opt`;
const CASE_OK = `${PREFIX}-case-1`;
const CASE_NO_EMAIL = `${PREFIX}-case-2`;
const CASE_OPT = `${PREFIX}-case-3`;
const ADMIN = `${PREFIX}-admin`;

const created = { tpls: [], rules: [], dispatches: [], cases: [], accs: [], acs: [] };

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
  // cascade-like: dispatches → rules → templates → cases → accountCompany → accounts → user → company
  await prisma.notificationDispatch.deleteMany({ where: { companyId: COMP } }).catch(() => {});
  await prisma.notificationRule.deleteMany({ where: { companyId: COMP } }).catch(() => {});
  await prisma.notificationTemplate.deleteMany({ where: { companyId: COMP } }).catch(() => {});
  await prisma.case.deleteMany({ where: { id: { in: [CASE_OK, CASE_NO_EMAIL, CASE_OPT] } } }).catch(() => {});
  await prisma.accountCompany.deleteMany({ where: { companyId: COMP } }).catch(() => {});
  await prisma.account.deleteMany({ where: { id: { in: [ACC_OK, ACC_OPT] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: ADMIN } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: COMP } }).catch(() => {});
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: COMP, name: 'M4.1 Test' } });
  await prisma.user.create({
    data: {
      id: ADMIN,
      email: `${PREFIX}-admin@smoke.test`,
      fullName: `${PREFIX}-admin`,
    },
  });
  await prisma.account.create({ data: { id: ACC_OK, name: 'Acme' } });
  await prisma.account.create({ data: { id: ACC_OPT, name: 'OptOut' } });
  await prisma.accountCompany.create({
    data: { accountId: ACC_OK, companyId: COMP, allowCustomerNotifications: true },
  });
  await prisma.accountCompany.create({
    data: { accountId: ACC_OPT, companyId: COMP, allowCustomerNotifications: false },
  });
  const baseCase = {
    title: 'x',
    description: 'x',
    companyId: COMP,
    companyName: 'M4.1 Test',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    category: 'Yazılım',
    subCategory: 'Genel',
    requestType: 'Talep',
  };
  await prisma.case.create({
    data: {
      ...baseCase,
      id: CASE_OK,
      caseNumber: `VK-${PREFIX}-1`,
      accountId: ACC_OK,
      customerContactEmail: 'sender@test.com',
      customerContactName: 'Mail Sender',
      origin: 'Eposta',
    },
  });
  await prisma.case.create({
    data: {
      ...baseCase,
      id: CASE_NO_EMAIL,
      caseNumber: `VK-${PREFIX}-2`,
      accountId: ACC_OK,
      customerContactEmail: null,
      origin: 'Web',
    },
  });
  await prisma.case.create({
    data: {
      ...baseCase,
      id: CASE_OPT,
      caseNumber: `VK-${PREFIX}-3`,
      accountId: ACC_OPT,
      customerContactEmail: 'optout@test.com',
      origin: 'Eposta',
    },
  });
}

(async () => {
  try {
    await setup();
    const allowed = [COMP];
    const user = { id: ADMIN };

    console.log('\n=== (1) ALLOWED_EVENTS — case_created + status_changed kabul ===');
    const tpl = await createTemplate({
      data: {
        companyId: COMP,
        key: `${PREFIX}_ack`,
        name: 'ACK',
        subjectTemplate: 'Talebiniz alındı [{{case.number}}]',
        bodyTemplate: 'Sayın {{account.name}}, {{case.number}} alındı.',
        requiredVariables: ['case.number', 'account.name'],
      },
      user,
      allowedCompanyIds: allowed,
    });
    expectTruthy('template created', !!tpl.id);

    const r1 = await createRule({
      data: {
        companyId: COMP,
        name: 'R1-case_created',
        event: 'case_created',
        isMatchAll: true,
        audience: [{ type: 'requester' }],
        templateId: tpl.id,
        channel: 'Email',
        mode: 'LogOnly', // smoke için LogOnly — gerçek mail göndermez
      },
      user,
      allowedCompanyIds: allowed,
    });
    expectTruthy('R1 case_created rule created', !!r1.id);

    const r2 = await createRule({
      data: {
        companyId: COMP,
        name: 'R2-status_changed',
        event: 'status_changed',
        isMatchAll: true,
        audience: [{ type: 'requester' }],
        templateId: tpl.id,
        channel: 'Email',
        mode: 'LogOnly',
      },
      user,
      allowedCompanyIds: allowed,
    });
    expectTruthy('R2 status_changed rule created', !!r2.id);

    console.log('\n=== (2) ALLOWED_AUDIENCE_TYPES — requester kabul (rule audience persisted) ===');
    expectTruthy('R1 audience type=requester', r1.audience?.[0]?.type === 'requester');

    console.log('\n=== (3) Render — empty marker → empty string (M6.3b parite) ===');
    const out = renderTemplate('Sayın {{account.name}}, {{missing.var}}', {
      'account.name': '',
    });
    expect('empty value → empty string', out.rendered, 'Sayın , ');
    expectTruthy('missing[] empty value de toplanır', out.missing.includes('account.name'));
    expectTruthy('missing[] bilinmeyen değişken de toplanır', out.missing.includes('missing.var'));
    expectTruthy('marker "[X eksik]" YOK', !out.rendered.includes('eksik'));

    console.log('\n=== (4) emitEvent case_created — email dolu → dispatch Sent ===');
    const d1 = await emitEvent({ event: 'case_created', caseId: CASE_OK });
    expectTruthy('dispatch satırı oluştu', Array.isArray(d1) && d1.length > 0);
    const d1Row = d1[0];
    expect('audienceType = requester', d1Row?.audienceType, 'requester');
    expect('audienceIdentifier = email', d1Row?.audienceIdentifier, 'sender@test.com');
    // LogOnly + Email semantiği: state=Pending (sadece LogOnly + InApp → Sent).
    // Yine de audienceIdentifier email'i tutar; suppressionReason yok.
    expect('state = Pending (LogOnly + Email)', d1Row?.state, 'Pending');
    expect('suppressionReason yok', d1Row?.suppressionReason ?? null, null);

    console.log('\n=== (5) emitEvent case_created — email BOŞ → no_channel_available ===');
    const d2 = await emitEvent({ event: 'case_created', caseId: CASE_NO_EMAIL });
    expectTruthy('dispatch oluştu (Pending kayıt)', Array.isArray(d2) && d2.length > 0);
    const d2Row = d2[0];
    expect('suppressionReason = no_channel_available', d2Row?.suppressionReason, 'no_channel_available');
    expect('state = Pending (keepPending)', d2Row?.state, 'Pending');

    console.log('\n=== (6) emitEvent case_created — opt-out ===');
    const d3 = await emitEvent({ event: 'case_created', caseId: CASE_OPT });
    expectTruthy('dispatch oluştu (Suppressed)', Array.isArray(d3) && d3.length > 0);
    const d3Row = d3[0];
    expect('suppressionReason = customer_opted_out', d3Row?.suppressionReason, 'customer_opted_out');
    expect('audienceIdentifier = opted_out', d3Row?.audienceIdentifier, 'opted_out');
    expect('state = Suppressed', d3Row?.state, 'Suppressed');

    console.log('\n=== (7) emitEvent status_changed — dispatch tetiklenir ===');
    const d4 = await emitEvent({ event: 'status_changed', caseId: CASE_OK });
    expectTruthy('status_changed dispatch oluştu', Array.isArray(d4) && d4.length > 0);
    expect('status_changed audienceType = requester', d4[0]?.audienceType, 'requester');
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    try { await reset(); } catch (e) { console.error('cleanup:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
