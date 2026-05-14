/**
 * Manuel smoke — Bilgi Kaynakları (Faz 1.5 Madde 6).
 *
 * Calistir: `node --env-file=.env scripts/smoke-knowledge-sources.js`
 *
 * HTTP'siz: knowledgeSourceRepo + Prisma direkt. Mutate ETMEZ;
 * sadece okur ve autoPopulateIfEmpty path'inin tetiklendigini gozler.
 */

import { prisma } from '../server/db/client.js';
import { knowledgeSourceRepo } from '../server/db/adminRepository.js';

async function listCompanies() {
  return prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function main() {
  console.log('=== Knowledge Sources smoke ===\n');
  const companies = await listCompanies();
  if (companies.length === 0) {
    console.error('Aktif sirket yok — smoke atlanir.');
    process.exit(1);
  }
  console.log(`Aktif sirketler: ${companies.map((c) => `${c.name} (${c.id})`).join(', ')}\n`);

  // --- 1) Her sirket icin kayit sayisi (autoPopulate oncesi) ---
  console.log('--- 1) Mevcut kayit sayisi ---');
  for (const c of companies) {
    const n = await prisma.knowledgeSource.count({ where: { companyId: c.id } });
    console.log(`${c.name.padEnd(20)} kayit sayisi=${n}`);
  }

  // --- 2) Repo list cagrisi (autoPopulate trigger eder) ---
  console.log('\n--- 2) knowledgeSourceRepo.list (SystemAdmin scope = tum sirketler) ---');
  const allIds = companies.map((c) => c.id);
  const t0 = Date.now();
  const items = await knowledgeSourceRepo.list(allIds);
  console.log(`OK durMs=${Date.now() - t0}  total=${items.length}`);

  const byCompany = {};
  for (const it of items) {
    byCompany[it.companyId] = byCompany[it.companyId] ?? [];
    byCompany[it.companyId].push(it);
  }
  for (const c of companies) {
    const arr = byCompany[c.id] ?? [];
    console.log(`\n  ${c.name}  (${arr.length} kaynak)`);
    for (const it of arr) {
      const flag = it.isActive ? 'AKTIF' : 'PASIF';
      console.log(`    [${flag}] ${it.sourceType.padEnd(12)} ${it.name.padEnd(22)} count=${it.contentCount}`);
    }
  }

  // --- 3) Beklenen 4 default tipini dogrula ---
  console.log('\n--- 3) Default 4 tipin (PastCases / ProductDocs / SLARules / Checklists) varligi ---');
  const expectedTypes = ['PastCases', 'ProductDocs', 'SLARules', 'Checklists'];
  for (const c of companies) {
    const arr = byCompany[c.id] ?? [];
    const presentTypes = new Set(arr.map((it) => it.sourceType));
    const missing = expectedTypes.filter((t) => !presentTypes.has(t));
    if (missing.length === 0) {
      console.log(`${c.name.padEnd(20)} ✓ Tum 4 default var`);
    } else {
      console.log(`${c.name.padEnd(20)} ✗ Eksik: ${missing.join(', ')}`);
    }
  }

  // --- 4) contentCount referans tablolarla karsilastir (PastCases icin) ---
  console.log('\n--- 4) contentCount drift kontrolu (PastCases vs gercek Case count) ---');
  for (const c of companies) {
    const arr = byCompany[c.id] ?? [];
    const pastCases = arr.find((it) => it.sourceType === 'PastCases');
    if (!pastCases) {
      console.log(`${c.name.padEnd(20)} PastCases yok`);
      continue;
    }
    const actual = await prisma.case.count({ where: { companyId: c.id } });
    const drift = actual - pastCases.contentCount;
    const status = drift === 0 ? '✓ guncel' : drift > 0 ? `⚠ ${drift} yeni vaka kayitli degil` : `⚠ ${Math.abs(drift)} fazla sayim`;
    console.log(`${c.name.padEnd(20)} kayit=${pastCases.contentCount}  gercek=${actual}  ${status}`);
  }

  // --- 5) Repo update/create yetki noktalari (calismayi mutate etmeden dogrula) ---
  console.log('\n--- 5) Repo metodlari mevcut mu? ---');
  console.log(`  list      ${typeof knowledgeSourceRepo.list === 'function' ? '✓' : '✗'}`);
  console.log(`  create    ${typeof knowledgeSourceRepo.create === 'function' ? '✓' : '✗'}`);
  console.log(`  update    ${typeof knowledgeSourceRepo.update === 'function' ? '✓' : '✗'}`);

  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
