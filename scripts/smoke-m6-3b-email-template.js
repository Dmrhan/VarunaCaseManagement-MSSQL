#!/usr/bin/env node
/**
 * M6.3b Faz 3 — CaseEmailTemplate backend kontratı.
 *
 *  (1) CaseEmailTemplate DB CRUD: list/listActive/getById/upsert/remove
 *  (2) Per-tenant scope (cross-tenant erişim engelli)
 *  (3) Placeholder engine: {{varName}} interpolation + missing whitelist
 *  (4) name uniqueness per-tenant (P2002 → name_already_exists)
 */

import { prisma } from '../server/db/client.js';
import { caseEmailTemplateRepo } from '../server/db/caseEmailTemplateRepository.js';
import { renderTemplate, listSystemPlaceholders } from '../server/lib/emailTemplateRender.js';

const TENANT_A = '__m6-3b-tpl-a__';
const TENANT_B = '__m6-3b-tpl-b__';

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
  await prisma.caseEmailTemplate.deleteMany({ where: { companyId: { in: [TENANT_A, TENANT_B] } } });
  await prisma.company.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: TENANT_A, name: 'Tenant A', isActive: true } });
  await prisma.company.create({ data: { id: TENANT_B, name: 'Tenant B', isActive: true } });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Create + list + listActive ===');
    const t1 = await caseEmailTemplateRepo.upsert(TENANT_A, {
      name: 'İade Onay',
      category: 'İade',
      subject: 'RE: {{case.number}} İade onaylandı',
      bodyHtml: '<p>Sayın {{requester.name}},</p><p>İadeniz onaylandı.</p>',
      variables: JSON.stringify(['case.number', 'requester.name']),
    });
    expect('create ok', t1.ok, true);
    expectTruthy('id set', !!t1.template.id);

    const t2 = await caseEmailTemplateRepo.upsert(TENANT_A, {
      name: 'Bilgi Talebi',
      bodyHtml: '<p>Bilgi: {{case.title}}</p>',
      isActive: false,
    });
    expect('create 2 ok', t2.ok, true);

    const all = await caseEmailTemplateRepo.list(TENANT_A);
    expect('list 2 row', all.length, 2);
    const onlyActive = await caseEmailTemplateRepo.listActive(TENANT_A);
    expect('listActive 1 row (sadece active)', onlyActive.length, 1);
    expect('listActive[0] = İade Onay', onlyActive[0].name, 'İade Onay');

    console.log('\n=== (2) Per-tenant scope ===');
    const tB = await caseEmailTemplateRepo.upsert(TENANT_B, {
      name: 'Tenant B Şablon',
      bodyHtml: '<p>x</p>',
    });
    expect('B create ok', tB.ok, true);

    // A'nın template id'sini B scope ile getById → null
    const crossGet = await caseEmailTemplateRepo.getById(TENANT_B, t1.template.id);
    expect('cross-tenant getById → null', crossGet, null);

    // A'nın template'ini B scope ile delete → not_found
    const crossDel = await caseEmailTemplateRepo.remove(TENANT_B, t1.template.id);
    expect('cross-tenant delete → not_found', crossDel.code, 'not_found');

    console.log('\n=== (3) Placeholder engine ===');
    const placeholders = listSystemPlaceholders();
    expect('6 sistem placeholder', placeholders.length, 6);
    expectTruthy('case.number listede', placeholders.includes('case.number'));
    expectTruthy('agent.fullName listede', placeholders.includes('agent.fullName'));

    const rendered = renderTemplate(
      { subject: 'RE: {{case.number}}', bodyHtml: 'Sayın {{requester.name}}, {{unknown.var}}' },
      { caseNumber: 'VK-001', accountName: 'Acme', customerContactName: 'Ali Veli', customerContactEmail: 'ali@v.com', title: 'Test' },
      { fullName: 'Agent A' },
    );
    expect('subject render', rendered.subject, 'RE: VK-001');
    expect('body render', rendered.bodyHtml, 'Sayın Ali Veli, ');
    expect('missing var', rendered.missing[0], 'unknown.var');

    console.log('\n=== (4) Update path + name uniqueness ===');
    const upd = await caseEmailTemplateRepo.upsert(TENANT_A, {
      id: t1.template.id,
      name: 'İade Onay (rev)',
    });
    expect('update ok', upd.ok, true);
    expect('yeni name', upd.template.name, 'İade Onay (rev)');

    // Aynı isimle ikinci kez create → name_already_exists
    const dup = await caseEmailTemplateRepo.upsert(TENANT_A, {
      name: 'İade Onay (rev)',
      bodyHtml: '<p>x</p>',
    });
    expect('duplicate name reject', dup.ok, false);
    expect('code = name_already_exists', dup.code, 'name_already_exists');

    console.log('\n=== (5) Validation: name + body required ===');
    const noName = await caseEmailTemplateRepo.upsert(TENANT_A, { bodyHtml: '<p>x</p>' });
    expect('name boş → name_required', noName.code, 'name_required');

    const noBody = await caseEmailTemplateRepo.upsert(TENANT_A, { name: 'X', bodyHtml: '' });
    expect('body boş → body_required', noBody.code, 'body_required');
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
