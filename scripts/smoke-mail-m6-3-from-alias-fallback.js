#!/usr/bin/env node
/**
 * Mail M6.3-realign — FromAlias fallback (ExternalMailSetting.fromAddress).
 *
 * Senaryolar:
 *  (1) FromAlias kayıt var → listActiveWithSettingFallback alias rows döndürür
 *  (2) FromAlias YOK + ExternalMailSetting.fromAddress dolu → sentetik tek
 *      alias (id='setting-fallback', isDefault=true)
 *  (3) "Display <email>" parse — fromAddress format
 *  (4) Salt email parse — angle bracket yok
 *  (5) Hiçbir şey yok → boş liste
 *  (6) validateOutboundFrom → fallback adresi kabul eder
 *  (7) validateOutboundFrom → farklı adres reddeder
 */

import { prisma } from '../server/db/client.js';
import { externalMailFromAliasRepo } from '../server/db/externalMailFromAliasRepository.js';

const TENANT = '__m6-3-fallback__';
const TENANT_NAME = 'M6.3 Fallback Smoke';

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
  await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: TENANT } });
  await prisma.externalMailSetting.deleteMany({ where: { companyId: TENANT } });
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

async function setSetting(fromAddress) {
  return prisma.externalMailSetting.upsert({
    where: { companyId: TENANT },
    update: { fromAddress },
    create: { companyId: TENANT, fromAddress, enabled: true },
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) FromAlias kayıt var → listActive sonucu ===');
    await prisma.externalMailSettingFromAlias.create({
      data: {
        companyId: TENANT, address: 'real@firm.com', displayName: 'Gerçek',
        isDefault: true, isActive: true, sortOrder: 0,
      },
    });
    const r1 = await externalMailFromAliasRepo.listActiveWithSettingFallback(TENANT);
    expect('1 alias döndü', r1.length, 1);
    expect('alias address = real@firm.com', r1[0].address, 'real@firm.com');
    expectTruthy('alias id sentetik DEĞİL', r1[0].id !== 'setting-fallback');

    console.log('\n=== (2) FromAlias YOK + ExternalMailSetting.fromAddress dolu → sentetik fallback ===');
    await reset();
    await setSetting('csmtest@univera.com.tr');
    const r2 = await externalMailFromAliasRepo.listActiveWithSettingFallback(TENANT);
    expect('1 sentetik alias', r2.length, 1);
    expect('id = setting-fallback', r2[0].id, 'setting-fallback');
    expect('address = csmtest@univera.com.tr', r2[0].address, 'csmtest@univera.com.tr');
    expect('isDefault = true', r2[0].isDefault, true);
    expect('displayName boş (salt email)', r2[0].displayName, null);

    console.log('\n=== (3) "Display <email>" parse ===');
    await reset();
    await setSetting('Varuna Destek <support@univera.com.tr>');
    const r3 = await externalMailFromAliasRepo.listActiveWithSettingFallback(TENANT);
    expect('1 alias', r3.length, 1);
    expect('address = support@...', r3[0].address, 'support@univera.com.tr');
    expect('displayName = "Varuna Destek"', r3[0].displayName, 'Varuna Destek');

    console.log('\n=== (4) Salt email, angle yok ===');
    await reset();
    await setSetting('admin@firm.local');
    const r4 = await externalMailFromAliasRepo.listActiveWithSettingFallback(TENANT);
    expect('address = admin@firm.local', r4[0].address, 'admin@firm.local');
    expect('displayName null', r4[0].displayName, null);

    console.log('\n=== (5) Hiçbir şey yok → boş liste ===');
    await reset();
    const r5 = await externalMailFromAliasRepo.listActiveWithSettingFallback(TENANT);
    expect('boş liste', r5.length, 0);

    console.log('\n=== (6) validateOutboundFrom → fallback adresi kabul ===');
    await reset();
    await setSetting('csmtest@univera.com.tr');
    const v1 = await externalMailFromAliasRepo.validateOutboundFrom(TENANT, 'csmtest@univera.com.tr');
    expect('ok = true', v1.ok, true);
    expect('case-insensitive', (await externalMailFromAliasRepo.validateOutboundFrom(TENANT, 'CSMTEST@UNIVERA.COM.TR')).ok, true);

    console.log('\n=== (7) validateOutboundFrom → farklı adres reddet ===');
    const v2 = await externalMailFromAliasRepo.validateOutboundFrom(TENANT, 'attacker@evil.com');
    expect('ok = false', v2.ok, false);
    expect('code = address_not_allowed', v2.code, 'address_not_allowed');
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
