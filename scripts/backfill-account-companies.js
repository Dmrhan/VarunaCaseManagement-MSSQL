#!/usr/bin/env node
/**
 * Backfill: Account.companyId (legacy) -> AccountCompany kayıtları.
 *
 * Phase A migration sonrası mevcut Account verisi için AccountCompany ilişki
 * tablosunu doldurur. Idempotent: var olan kayıtlar atlanır.
 *
 * Kural:
 *  - Account.companyId IS NOT NULL ise → AccountCompany { accountId, companyId,
 *    status='active', contractStartAt = Account.createdAt ?? now() } yarat
 *  - Account.companyId IS NULL (shared) → atlanır (legacy davranış korunur)
 *  - Account.companyId var ama Company kaydı yoksa → atlanır, warn loglanır
 *  - VKN HİÇBİR ZAMAN loglanmaz
 *
 * Çalıştır:
 *   node --env-file=.env scripts/backfill-account-companies.js
 *   node --env-file=.env scripts/backfill-account-companies.js --dry-run
 */

import { prisma } from '../server/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill] start ${DRY_RUN ? '(DRY RUN)' : ''}`);

  const accounts = await prisma.account.findMany({
    where: { companyId: { not: null } },
    select: { id: true, name: true, companyId: true, createdAt: true },
  });

  console.log(`[backfill] found ${accounts.length} accounts with companyId set`);

  let createdTotal = 0;
  let skippedExisting = 0;
  let skippedOrphanCompany = 0;
  const perCompany = new Map();

  // Distinct companyIds → existence map (orphan FK durumunda erken atla).
  const companyIds = Array.from(new Set(accounts.map((a) => a.companyId)));
  const existingCompanies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true },
  });
  const companyIdSet = new Set(existingCompanies.map((c) => c.id));

  for (const acc of accounts) {
    if (!companyIdSet.has(acc.companyId)) {
      skippedOrphanCompany += 1;
      console.warn(`[backfill] account ${acc.id} → company ${acc.companyId} bulunamadı, atlanıyor`);
      continue;
    }

    const existing = await prisma.accountCompany.findUnique({
      where: { accountId_companyId: { accountId: acc.id, companyId: acc.companyId } },
      select: { id: true },
    });
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    if (DRY_RUN) {
      createdTotal += 1;
      perCompany.set(acc.companyId, (perCompany.get(acc.companyId) ?? 0) + 1);
      continue;
    }

    await prisma.accountCompany.create({
      data: {
        accountId: acc.id,
        companyId: acc.companyId,
        status: 'active',
        contractStartAt: acc.createdAt ?? new Date(),
      },
    });
    createdTotal += 1;
    perCompany.set(acc.companyId, (perCompany.get(acc.companyId) ?? 0) + 1);
  }

  console.log('[backfill] summary');
  console.log(`  created:                ${createdTotal}`);
  console.log(`  skipped (already there): ${skippedExisting}`);
  console.log(`  skipped (orphan FK):     ${skippedOrphanCompany}`);
  console.log('  per company:');
  for (const [companyId, count] of perCompany) {
    console.log(`    ${companyId}: ${count}`);
  }
  if (DRY_RUN) console.log('[backfill] DRY RUN — hiçbir kayıt yazılmadı');
  console.log('[backfill] done');
}

main()
  .catch((err) => {
    console.error('[backfill] FAILED:', err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
