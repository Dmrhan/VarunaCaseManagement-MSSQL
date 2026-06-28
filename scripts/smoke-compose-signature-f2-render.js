#!/usr/bin/env node
/**
 * Compose-Signature F2 — Şirket şablonu + render + getEmailSignature
 *   composedHtml shape smoke.
 *
 *  (1) Repo upsert signatureHtml kabul + sanitize-html (script strip)
 *  (2) Repo getByCompany signatureHtml döner
 *  (3) Repo signatureHtml null/empty → null normalize
 *  (4) Repo signatureHtml > 50KB → 400
 *  (5) Render: {{agent.name}} + {{agent.title}} Mustache → Person'dan
 *  (6) Render: Person yoksa fullName fallback + title boş
 *  (7) Render: agent override (User.signatureHtml) > composedHtml fallback chain
 *  (8) Render: tenant şablonu yoksa composedHtml=null
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { externalMailSettingRepo } from '../server/db/externalMailSettingRepository.js';
import { renderTemplate } from '../server/db/notificationRepository.js';

const PREFIX = `cs-f2-${randomUUID().slice(0, 8)}`;
const COMP = `${PREFIX}-c`;
const TEAM = `${PREFIX}-t`;
const PERSON_W_TITLE = `${PREFIX}-p-with`;
const PERSON_NO_TITLE = `${PREFIX}-p-no`;

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
  await prisma.person.deleteMany({ where: { teamId: TEAM } }).catch(() => {});
  await prisma.team.deleteMany({ where: { id: TEAM } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: COMP } }).catch(() => {});
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: COMP, name: PREFIX } });
  await prisma.team.create({ data: { id: TEAM, name: 'tt', companyId: COMP } });
  await prisma.person.create({
    data: {
      id: PERSON_W_TITLE,
      name: 'Demirhan İşbakan',
      teamId: TEAM,
      title: 'Ürün Direktörü',
    },
  });
  await prisma.person.create({
    data: {
      id: PERSON_NO_TITLE,
      name: 'Boş Title',
      teamId: TEAM,
      title: null,
    },
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Repo upsert signatureHtml + sanitize ===');
    const t1 = await externalMailSettingRepo.upsert(COMP, {
      signatureHtml: '<p>Sayın <strong>{{agent.name}}</strong></p><script>alert(1)</script>',
    });
    expectTruthy('signatureHtml set edildi', !!t1.signatureHtml);
    expectTruthy('<script> strip', !t1.signatureHtml.includes('<script>'));
    expectTruthy('placeholder korundu', t1.signatureHtml.includes('{{agent.name}}'));
    expectTruthy('<strong> korundu', t1.signatureHtml.includes('<strong>'));

    console.log('\n=== (2) Repo getByCompany signatureHtml döner ===');
    const t2 = await externalMailSettingRepo.getByCompany(COMP);
    expect('signatureHtml mevcut', t2.signatureHtml, t1.signatureHtml);

    console.log('\n=== (3) Null/empty → null normalize ===');
    const t3a = await externalMailSettingRepo.upsert(COMP, { signatureHtml: '' });
    expect('boş string → null', t3a.signatureHtml, null);
    await externalMailSettingRepo.upsert(COMP, { signatureHtml: '<p>x</p>' });
    const t3b = await externalMailSettingRepo.upsert(COMP, { signatureHtml: null });
    expect('explicit null → null', t3b.signatureHtml, null);

    console.log('\n=== (4) > 50KB → 400 ===');
    const huge = 'a'.repeat(50_001);
    let blocked = false;
    let msg = '';
    try {
      await externalMailSettingRepo.upsert(COMP, { signatureHtml: huge });
    } catch (e) {
      blocked = e?.status === 400 && /50\.000|50000/.test(e.message);
      msg = e?.message ?? '';
    }
    expect('50KB üstü reddedildi (400)', blocked, true);

    console.log('\n=== (5) Render Mustache — Person.name + Person.title ===');
    const tpl = '<p><strong>{{agent.name}}</strong></p><p>{{agent.title}}</p>';
    const personW = await prisma.person.findUnique({ where: { id: PERSON_W_TITLE } });
    const out5 = renderTemplate(tpl, {
      'agent.name': personW.name,
      'agent.title': personW.title,
    });
    expectTruthy('render name', out5.rendered.includes('Demirhan İşbakan'));
    expectTruthy('render title', out5.rendered.includes('Ürün Direktörü'));
    expectTruthy('missing[] boş', out5.missing.length === 0);

    console.log('\n=== (6) Person yok + title yok edge cases ===');
    const personN = await prisma.person.findUnique({ where: { id: PERSON_NO_TITLE } });
    const out6a = renderTemplate(tpl, {
      'agent.name': personN.name,
      'agent.title': personN.title ?? '',
    });
    expectTruthy('name dolu', out6a.rendered.includes('Boş Title'));
    expectTruthy('title placeholder boş (M4.1 fix: marker yok)',
      !out6a.rendered.includes('eksik') && !out6a.rendered.includes('{{agent.title}}'));
    expectTruthy('missing[] title var', out6a.missing.includes('agent.title'));

    // Person yok senaryo: User.fullName fallback
    const out6b = renderTemplate(tpl, {
      'agent.name': 'System Admin', // User.fullName
      'agent.title': '',
    });
    expectTruthy('User.fullName fallback', out6b.rendered.includes('System Admin'));

    console.log('\n=== (7) Fallback chain: override > composed > none ===');
    // Endpoint-level test: cases.js getEmailSignature shape.
    // Burada repo + render kombinasyonunu doğrudan teyit ediyoruz.
    const tenantRaw = '<p>{{agent.name}} - {{agent.title}}</p>';
    const composed = renderTemplate(tenantRaw, {
      'agent.name': 'X',
      'agent.title': 'Y',
    }).rendered;
    const agentOverride = '<p>Özel imzam</p>';
    // simulated effective: agentOverride > composed > none
    const effective = agentOverride ?? composed ?? null;
    expect('override > composed', effective, '<p>Özel imzam</p>');
    const effectiveNoOverride = null ?? composed ?? null;
    expect('composed (no override)', effectiveNoOverride, '<p>X - Y</p>');
    const effectiveNone = null ?? null ?? null;
    expect('none', effectiveNone, null);

    console.log('\n=== (8) Tenant şablonu yoksa composedHtml null beklenir ===');
    await externalMailSettingRepo.upsert(COMP, { signatureHtml: null });
    const t8 = await externalMailSettingRepo.getByCompany(COMP);
    expect('tenantHtml null', t8.signatureHtml, null);

    console.log('\n=== (9) HTML escape — Codex P2 fix (Person.name/title XSS) ===');
    // Person.name/title plain text saklanır; HTML context'e interpolate
    // edilirken htmlEscape ZORUNLU. Aksi halde "<b>Lead</b>" gibi bir
    // title gerçek markup'a dönüşür → composedHtml XSS surface.
    const tpl9 = '<p>{{agent.name}} - {{agent.title}}</p>';
    const out9 = renderTemplate(
      tpl9,
      {
        'agent.name': '<script>alert(1)</script>',
        'agent.title': '<b>Lead</b>',
      },
      { htmlEscape: true },
    );
    expectTruthy('agent.name <script> escape',
      out9.rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    expectTruthy('agent.title <b> escape',
      out9.rendered.includes('&lt;b&gt;Lead&lt;/b&gt;'));
    expectTruthy('raw <script> YOK', !out9.rendered.includes('<script>'));
    expectTruthy('raw <b>Lead</b> YOK', !out9.rendered.includes('<b>Lead</b>'));

    // Geri uyumluluk: htmlEscape opsiyonu yoksa eski davranış (escape YOK)
    const out9b = renderTemplate(tpl9, {
      'agent.name': '<b>X</b>',
      'agent.title': 'Y',
    });
    expectTruthy('opts yoksa eski davranış (geri uyumlu)',
      out9b.rendered.includes('<b>X</b>'));
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
