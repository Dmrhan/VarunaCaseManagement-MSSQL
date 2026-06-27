#!/usr/bin/env node
/**
 * Mail M6.3-realign — GET /api/cases/:id/email-config kontratı.
 *
 * Endpoint mantığı (handler ile aynı):
 *   - ExternalMailSetting yok       → { configured: false, reason: 'no-setting' }
 *   - enabled = false               → { configured: false, reason: 'disabled' }
 *   - listActiveWithSettingFallback = [] → { configured: false, reason: 'no-from' }
 *   - listActive >= 1               → { configured: true,  reason: 'has-alias' }
 *   - listActive = 0 + fromAddress  → { configured: true,  reason: 'fallback-from-address' }
 *
 * Doğrudan helper'lar üzerinden test (HTTP açmadan).
 */

import { prisma } from '../server/db/client.js';
import { externalMailFromAliasRepo } from '../server/db/externalMailFromAliasRepository.js';

const TENANT = '__m6-3-emailcfg__';
const TENANT_NAME = 'M6.3 Email-Config Smoke';

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
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

// Endpoint handler'ının saf mantığı (HTTP layer'sız):
async function resolveConfig(companyId) {
  const setting = await prisma.externalMailSetting.findUnique({
    where: { companyId }, select: { enabled: true, fromAddress: true },
  });
  if (!setting) return { configured: false, reason: 'no-setting' };
  if (!setting.enabled) return { configured: false, reason: 'disabled' };
  const items = await externalMailFromAliasRepo.listActiveWithSettingFallback(companyId);
  if (items.length === 0) return { configured: false, reason: 'no-from' };
  const isFallback = items.length === 1 && items[0].id === 'setting-fallback';
  return {
    configured: true,
    reason: isFallback ? 'fallback-from-address' : 'has-alias',
  };
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Setting yok → no-setting ===');
    let cfg = await resolveConfig(TENANT);
    expect('configured=false', cfg.configured, false);
    expect("reason='no-setting'", cfg.reason, 'no-setting');

    console.log('\n=== (2) Setting var ama enabled=false → disabled ===');
    await prisma.externalMailSetting.create({
      data: { companyId: TENANT, enabled: false, fromAddress: 'foo@bar.com' },
    });
    cfg = await resolveConfig(TENANT);
    expect('configured=false', cfg.configured, false);
    expect("reason='disabled'", cfg.reason, 'disabled');

    console.log('\n=== (3) enabled + fromAddress yok + alias yok → no-from ===');
    await prisma.externalMailSetting.update({
      where: { companyId: TENANT }, data: { enabled: true, fromAddress: null },
    });
    cfg = await resolveConfig(TENANT);
    expect('configured=false', cfg.configured, false);
    expect("reason='no-from'", cfg.reason, 'no-from');

    console.log('\n=== (4) enabled + fromAddress var + alias yok → fallback-from-address ===');
    await prisma.externalMailSetting.update({
      where: { companyId: TENANT }, data: { fromAddress: 'csmtest@univera.com.tr' },
    });
    cfg = await resolveConfig(TENANT);
    expect('configured=true', cfg.configured, true);
    expect("reason='fallback-from-address'", cfg.reason, 'fallback-from-address');

    console.log('\n=== (5) enabled + manuel FromAlias var → has-alias ===');
    await prisma.externalMailSettingFromAlias.create({
      data: {
        companyId: TENANT, address: 'manuel@univera.com.tr',
        displayName: 'Manuel', isDefault: true, isActive: true, sortOrder: 0,
      },
    });
    cfg = await resolveConfig(TENANT);
    expect('configured=true', cfg.configured, true);
    expect("reason='has-alias' (alias varken fallback değil)", cfg.reason, 'has-alias');
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
