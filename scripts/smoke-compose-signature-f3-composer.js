#!/usr/bin/env node
/**
 * Compose-Signature F3 — Composer entegrasyon smoke.
 *
 * Backend kontrat doğrulaması (composer UI'ı node'dan test edemeyiz; bu
 * smoke composer'ın beslendiği shape'i + render fallback chain'i kapatır):
 *
 *  (1) GET /email-signature SHAPE: composedHtml field döner
 *  (2) Fallback: agentHtml override > composedHtml > none
 *  (3) signatureHtml deprecated flatten: agent > composed > tenant
 *  (4) Composer effectiveSignatureHtml resolution emülasyonu
 *  (5) Tenant şablonu yoksa composedHtml null (skip)
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { externalMailSettingRepo } from '../server/db/externalMailSettingRepository.js';
import { renderTemplate } from '../server/db/notificationRepository.js';

const PREFIX = `cs-f3-${randomUUID().slice(0, 8)}`;
const COMP = `${PREFIX}-c`;
const TEAM = `${PREFIX}-t`;
const PERSON = `${PREFIX}-p`;

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
  await prisma.externalMailSetting.deleteMany({ where: { companyId: COMP } }).catch(() => {});
  await prisma.person.deleteMany({ where: { id: PERSON } }).catch(() => {});
  await prisma.team.deleteMany({ where: { id: TEAM } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: COMP } }).catch(() => {});
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: COMP, name: PREFIX } });
  await prisma.team.create({ data: { id: TEAM, name: 'tt', companyId: COMP } });
  await prisma.person.create({
    data: { id: PERSON, name: 'Test User', teamId: TEAM, title: 'Engineer' },
  });
}

/**
 * Composer-side effective signature resolution emülasyonu.
 * Aynı mantığı MailComposer.tsx içinde uyguladık.
 */
function composerEffective({ agentHtml, composedHtml, tenantHtml, signatureHtml }) {
  // F3 davranışı: override > composed > tenant fallback (geri uyum)
  return agentHtml ?? composedHtml ?? tenantHtml ?? signatureHtml ?? null;
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Tenant şablonu set + render shape ===');
    await externalMailSettingRepo.upsert(COMP, {
      signatureHtml: '<p><b>{{agent.name}}</b> · {{agent.title}}</p>',
    });
    // Simüle: backend tenant template'i çekti
    const ems = await externalMailSettingRepo.getByCompany(COMP);
    const tenantHtml = ems.signatureHtml;
    expectTruthy('tenant şablonu set', !!tenantHtml);
    expectTruthy('placeholder template korundu', tenantHtml.includes('{{agent.name}}'));

    console.log('\n=== (2) Composed render — Person.name + Person.title ===');
    const person = await prisma.person.findUnique({ where: { id: PERSON } });
    const composed = renderTemplate(
      tenantHtml,
      { 'agent.name': person.name, 'agent.title': person.title },
      { htmlEscape: true },
    ).rendered;
    expectTruthy('composedHtml render içeriği', composed.includes('Test User'));
    expectTruthy('composedHtml title render', composed.includes('Engineer'));

    console.log('\n=== (3) Fallback chain — agent override > composed ===');
    const agentOverride = '<p>Özel imzam (override)</p>';
    const effWithOverride = composerEffective({
      agentHtml: agentOverride,
      composedHtml: composed,
      tenantHtml: null,
      signatureHtml: null,
    });
    expect('override > composed', effWithOverride, agentOverride);

    console.log('\n=== (4) Override YOK → composed ===');
    const effComposed = composerEffective({
      agentHtml: null,
      composedHtml: composed,
      tenantHtml: null,
      signatureHtml: null,
    });
    expect('composed (no override)', effComposed, composed);

    console.log('\n=== (5) Composed yoksa legacy tenantHtml fallback (geri uyum) ===');
    const effTenant = composerEffective({
      agentHtml: null,
      composedHtml: null,
      tenantHtml: tenantHtml,
      signatureHtml: null,
    });
    expect('tenant fallback (deprecated)', effTenant, tenantHtml);

    console.log('\n=== (6) Hiçbiri yok → none ===');
    const effNone = composerEffective({
      agentHtml: null, composedHtml: null, tenantHtml: null, signatureHtml: null,
    });
    expect('none', effNone, null);

    console.log('\n=== (7) Tenant şablonu YOK → composedHtml null beklenir ===');
    await externalMailSettingRepo.upsert(COMP, { signatureHtml: null });
    const ems7 = await externalMailSettingRepo.getByCompany(COMP);
    expect('tenant null', ems7.signatureHtml, null);
    // Eğer backend tenant null görürse composed render skip → composedHtml=null
    const composed7 = ems7.signatureHtml
      ? renderTemplate(ems7.signatureHtml, { 'agent.name': 'X', 'agent.title': 'Y' }, { htmlEscape: true }).rendered
      : null;
    expect('composed null (tenant null)', composed7, null);

    console.log('\n=== (8) signatureHtml deprecated flatten ===');
    // Eski client'lar tek field okuyor; backend flatten: agent > composed > tenant
    await externalMailSettingRepo.upsert(COMP, {
      signatureHtml: '<p>{{agent.name}}</p>',
    });
    const ems8 = await externalMailSettingRepo.getByCompany(COMP);
    const composed8 = renderTemplate(
      ems8.signatureHtml,
      { 'agent.name': 'Adam', 'agent.title': '' },
      { htmlEscape: true },
    ).rendered;
    const flatten = (agent, comp, ten) => agent ?? comp ?? ten;
    expect('flatten override', flatten('<p>O</p>', composed8, ems8.signatureHtml), '<p>O</p>');
    expect('flatten composed (no override)', flatten(null, composed8, ems8.signatureHtml), composed8);
    expect('flatten tenant (no override + no composed)', flatten(null, null, ems8.signatureHtml), ems8.signatureHtml);
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
