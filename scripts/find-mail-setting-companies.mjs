#!/usr/bin/env node
/**
 * Tek seferlik teşhis — ExternalMailSetting kaydı OLAN şirketleri listele.
 *
 * Kullanıcı UNIVERA gibi isim çakışması durumunda hangi companyId'nin
 * setting'i barındırdığını ve hangisinin barındırmadığını görebilir.
 *
 * Kullanım:
 *   node scripts/find-mail-setting-companies.mjs [--name <pattern>]
 *
 * Örnek:
 *   node scripts/find-mail-setting-companies.mjs --name UNIVERA
 */

import { prisma } from '../server/db/client.js';

function arg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const nameFilter = arg('name');

async function main() {
  // 1) Setting kaydı olan tüm şirketler
  const settings = await prisma.externalMailSetting.findMany({
    select: { companyId: true, enabled: true, fromAddress: true },
  });
  const settingMap = new Map();
  for (const s of settings) settingMap.set(s.companyId, s);

  // 2) Filtre — isimle eşleşen tüm şirketler (setting var/yok fark etmez)
  const where = nameFilter
    ? { name: { contains: nameFilter } }
    : {};
  const companies = await prisma.company.findMany({
    where,
    select: { id: true, name: true, isActive: true },
    orderBy: { name: 'asc' },
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Filtre: ${nameFilter ? `name içeren "${nameFilter}"` : '(yok)'}`);
  console.log(`Eşleşen şirket sayısı: ${companies.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('name'.padEnd(40), 'companyId'.padEnd(40), 'isActive', 'mailSetting', 'enabled', 'fromAddress');
  console.log('-'.repeat(160));
  for (const c of companies) {
    const s = settingMap.get(c.id);
    console.log(
      (c.name ?? '—').slice(0, 40).padEnd(40),
      c.id.padEnd(40),
      String(c.isActive).padEnd(8),
      String(!!s).padEnd(11),
      String(s?.enabled ?? '—').padEnd(7),
      s?.fromAddress ?? '—',
    );
  }

  // Alias sayısı toplamı
  const aliasCounts = await prisma.externalMailSettingFromAlias.groupBy({
    by: ['companyId'],
    _count: true,
    where: nameFilter
      ? { company: { name: { contains: nameFilter } } }
      : undefined,
  });
  if (aliasCounts.length) {
    console.log('\n— FromAlias sayıları —');
    for (const a of aliasCounts) {
      console.log(`  ${a.companyId}: ${a._count} alias`);
    }
  }
}

main()
  .catch((err) => {
    console.error('HATA:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
