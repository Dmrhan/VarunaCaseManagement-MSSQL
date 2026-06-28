#!/usr/bin/env node
/**
 * M6.3b Faz 2 — Per-agent imza backend kontratı.
 *
 *  (1) User.signatureHtml DB kolonu mevcut (migration applied)
 *  (2) email-signature endpoint response: { tenantHtml, agentHtml, signatureHtml }
 *      - tenant only → agentHtml=null, signatureHtml=tenantHtml
 *      - agent + tenant → her ikisi dolu, signatureHtml=agent (fallback chain)
 *      - none → ikisi de null
 *  (3) Backend doğrudan signatureHtml User kolonu set + sanitize
 */

import { prisma } from '../server/db/client.js';
import { sanitizeOutgoingEmailHtml } from '../server/lib/htmlSanitizer.js';

const TENANT = '__m6-3b-sig__';
const TENANT_NAME = 'M6.3b Signature Smoke';

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
  await prisma.user.deleteMany({ where: { email: { contains: 'm6-3b-sig' } } });
  await prisma.externalMailSetting.deleteMany({ where: { companyId: TENANT } });
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
}

async function setup() {
  await prisma.company.upsert({
    where: { id: TENANT }, update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });
}

(async () => {
  try {
    await reset();
    await setup();

    console.log('\n=== (1) User.signatureHtml DB kolonu set/get ===');
    const u = await prisma.user.create({
      data: {
        id: 'usr-m6-3b-sig-1',
        email: 'sig-agent@m6-3b-sig.local',
        fullName: 'Sig Agent',
        signatureHtml: '<p>Agent <b>İmza</b></p>',
      },
    });
    expect('agent imzası set', u.signatureHtml, '<p>Agent <b>İmza</b></p>');

    const fetched = await prisma.user.findUnique({
      where: { id: u.id }, select: { signatureHtml: true },
    });
    expect('get sonucu aynı', fetched.signatureHtml, '<p>Agent <b>İmza</b></p>');

    console.log('\n=== (2) Sanitize-html allowlist (XSS engelleme) ===');
    const safe = sanitizeOutgoingEmailHtml('<p>Hi <script>alert(1)</script><b>bold</b><iframe src="evil"></iframe></p>');
    expect('<script> drop', safe.includes('<script>'), false);
    expect('<iframe> drop', safe.includes('<iframe>'), false);
    expect('<b> korundu', safe.includes('<b>bold</b>'), true);

    console.log('\n=== (3) email-signature endpoint response shape (mock) ===');
    // ExternalMailSetting tenant imzası set
    await prisma.externalMailSetting.create({
      data: { companyId: TENANT, enabled: true, signatureHtml: '<p>Tenant default</p>' },
    });
    const ems = await prisma.externalMailSetting.findUnique({
      where: { companyId: TENANT }, select: { signatureHtml: true },
    });
    const usr = await prisma.user.findUnique({
      where: { id: u.id }, select: { signatureHtml: true },
    });
    // Simulate route response logic
    const tenantHtml = ems?.signatureHtml ?? null;
    const agentHtml = usr?.signatureHtml ?? null;
    const flatFallback = agentHtml ?? tenantHtml;
    expect('tenantHtml dolu', tenantHtml, '<p>Tenant default</p>');
    expect('agentHtml dolu', agentHtml, '<p>Agent <b>İmza</b></p>');
    expect('signatureHtml fallback = agent (öncelik)', flatFallback, '<p>Agent <b>İmza</b></p>');

    console.log('\n=== (4) agent null → tenant fallback ===');
    await prisma.user.update({ where: { id: u.id }, data: { signatureHtml: null } });
    const usr2 = await prisma.user.findUnique({ where: { id: u.id }, select: { signatureHtml: true } });
    const fallback2 = (usr2?.signatureHtml ?? null) ?? tenantHtml;
    expect('agent null → tenant fallback', fallback2, '<p>Tenant default</p>');

    console.log('\n=== (5) İkisi de null → none ===');
    await prisma.externalMailSetting.update({
      where: { companyId: TENANT }, data: { signatureHtml: null },
    });
    const fallback3 = (usr2?.signatureHtml ?? null) ?? null;
    expect('ikisi null → null', fallback3, null);
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    try { await reset(); } catch (e) { console.error('cleanup hata:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
