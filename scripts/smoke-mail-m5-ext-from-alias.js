#!/usr/bin/env node
/**
 * Mail M5-extension — FromAlias smoke.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.4.
 *
 * Senaryolar:
 *  (1) Repo: list/upsert/setDefault/remove/findByAddress
 *  (2) Backfill doğrulama: mevcut COMP-UNIVERA backfill satırı VAR
 *  (3) Validation: validateOutboundFrom (spoof önleme)
 *  (4) Default tek satır kuralı: yeni default → eski default false
 *  (5) Tenant izolasyon: company A alias'ı B'de görünmez
 */

import { prisma } from '../server/db/client.js';
import { externalMailFromAliasRepo, _internal } from '../server/db/externalMailFromAliasRepository.js';

const TENANT_A = '__m5ext-tenant-a__';
const TENANT_B = '__m5ext-tenant-b__';

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy ${JSON.stringify(actual)}`); }
}

async function setup() {
  console.log('[setup] tenant + alias temizliği...');
  for (const id of [TENANT_A, TENANT_B]) {
    await prisma.company.upsert({
      where: { id }, update: {},
      create: { id, name: `M5-ext ${id}`, isActive: true },
    });
    await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: id } });
  }
}

async function cleanup() {
  console.log('\n[cleanup]...');
  for (const id of [TENANT_A, TENANT_B]) {
    await prisma.externalMailSettingFromAlias.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } }).catch(() => {});
  }
}

async function senaryo1() {
  console.log('\n=== (1) Repo: upsert + list + findByAddress + remove ===');
  // Yeni alias
  const r1 = await externalMailFromAliasRepo.upsert(TENANT_A, {
    address: 'support@a.local',
    displayName: 'Support',
    isDefault: true,
  });
  expect('upsert ok', r1.ok, true);
  expectTruthy('alias id var', !!r1.alias?.id);

  // Liste
  const list = await externalMailFromAliasRepo.list(TENANT_A);
  expect('list count = 1', list.length, 1);
  expect('list[0] isDefault', list[0].isDefault, true);

  // findByAddress (case-insensitive değil; ham eşleşme + normalize)
  const found = await externalMailFromAliasRepo.findByAddress(TENANT_A, 'support@a.local');
  expectTruthy('findByAddress bulundu', !!found);

  // Aynı address ekleme reddedilir (duplicate)
  const dup = await externalMailFromAliasRepo.upsert(TENANT_A, {
    address: 'support@a.local',
  });
  expect('dup reddedildi', dup.ok, false);
  expect('dup code = address_already_exists', dup.code, 'address_already_exists');
}

async function senaryo2() {
  console.log('\n=== (2) Default tek satır kuralı + setDefault ===');
  // İkinci alias ekle (default değil)
  const r2 = await externalMailFromAliasRepo.upsert(TENANT_A, {
    address: 'sales@a.local',
    displayName: 'Sales',
    isDefault: false,
  });
  expect('upsert sales ok', r2.ok, true);

  const before = await externalMailFromAliasRepo.list(TENANT_A);
  const defaults = before.filter((a) => a.isDefault);
  expect('1 default (support@a.local)', defaults.length, 1);
  expect('default = support@a.local', defaults[0]?.address, 'support@a.local');

  // setDefault → sales@a.local
  const salesId = before.find((a) => a.address === 'sales@a.local')?.id;
  const sd = await externalMailFromAliasRepo.setDefault(TENANT_A, salesId);
  expect('setDefault ok', sd.ok, true);

  const after = await externalMailFromAliasRepo.list(TENANT_A);
  const afterDefaults = after.filter((a) => a.isDefault);
  expect('hala 1 default', afterDefaults.length, 1);
  expect('yeni default = sales@a.local', afterDefaults[0]?.address, 'sales@a.local');
}

async function senaryo3() {
  console.log('\n=== (3) Validation: validateOutboundFrom (spoof önleme) ===');
  // İzin verilen
  const ok1 = await externalMailFromAliasRepo.validateOutboundFrom(TENANT_A, 'support@a.local');
  expect('aktif alias OK', ok1.ok, true);

  // İzinsiz adres
  const fail1 = await externalMailFromAliasRepo.validateOutboundFrom(TENANT_A, 'evil@unknown.com');
  expect('izinsiz reddedildi', fail1.ok, false);
  expect('code = address_not_allowed', fail1.code, 'address_not_allowed');

  // Case-insensitive
  const ok2 = await externalMailFromAliasRepo.validateOutboundFrom(TENANT_A, 'SUPPORT@A.LOCAL');
  expect('case-insensitive OK', ok2.ok, true);
}

async function senaryo4() {
  console.log('\n=== (4) Tenant izolasyon: A alias\'ı B\'de görünmez ===');
  // B'de hiç alias yok
  const list = await externalMailFromAliasRepo.list(TENANT_B);
  expect('B alias count = 0', list.length, 0);
  // B için validation
  const v = await externalMailFromAliasRepo.validateOutboundFrom(TENANT_B, 'support@a.local');
  expect('B\'de A adresi reddedildi', v.ok, false);
}

async function senaryo5() {
  console.log('\n=== (5) Backfill: mevcut COMP-UNIVERA alias\'ı VAR ===');
  // Migration 17 backfill: COMP-UNIVERA fromAddress dolu → 1 alias
  const list = await externalMailFromAliasRepo.listActive('COMP-UNIVERA');
  expectTruthy('COMP-UNIVERA en az 1 aktif alias', list.length >= 1);
  expectTruthy('en az 1 default', list.some((a) => a.isDefault));
}

async function senaryo6() {
  console.log('\n=== (6) normalize helper ===');
  expect('boş trim', _internal.normalizeAddress('  '), null);
  expect('normal trim', _internal.normalizeAddress(' x@y.com '), 'x@y.com');
  expect('null input', _internal.normalizeAddress(null), null);
  // 320'den uzun reddedilir
  const long = 'a'.repeat(321) + '@x.com';
  expect('overlong reject', _internal.normalizeAddress(long), null);
}

async function senaryo7Toggle() {
  console.log('\n=== (7) Codex fix — partial update toggle (address create-only zorunlu) ===');
  // Mevcut alias toggle: address göndermeden sadece isActive değiştir
  const list = await externalMailFromAliasRepo.list(TENANT_A);
  const target = list.find((a) => a.address === 'support@a.local');
  if (!target) { fail++; console.log('  ✗ Setup fail — support@a.local yok'); return; }
  const toggleOff = await externalMailFromAliasRepo.upsert(TENANT_A, {
    id: target.id,
    isActive: false,
  });
  expect('toggle off ok', toggleOff.ok, true);
  expect('address korundu', toggleOff.alias?.address, 'support@a.local');
  expect('isActive=false', toggleOff.alias?.isActive, false);
  const toggleOn = await externalMailFromAliasRepo.upsert(TENANT_A, {
    id: target.id,
    isActive: true,
  });
  expect('toggle on ok', toggleOn.ok, true);
  expect('isActive=true', toggleOn.alias?.isActive, true);

  // Create + address eksikliği → address_invalid kalsın
  const r = await externalMailFromAliasRepo.upsert(TENANT_A, { isActive: true });
  expect('create + address eksik → address_invalid', r.ok, false);
  expect('code = address_invalid', r.code, 'address_invalid');
}

(async () => {
  try {
    await setup();
    await senaryo1();
    await senaryo2();
    await senaryo3();
    await senaryo4();
    await senaryo5();
    await senaryo6();
    await senaryo7Toggle();
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
