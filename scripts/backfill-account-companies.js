#!/usr/bin/env node
/**
 * Backfill: Account.companyId (legacy) -> AccountCompany kayıtları.
 *
 * Idempotent. Phase A migration sonrası mevcut Account verisi için
 * AccountCompany ilişki tablosunu doldurur. P0 hotfix sonrası seed:scenarios
 * sonrasında da güvenle çalıştırılabilir.
 *
 * Kural:
 *  - Account.companyId IS NOT NULL ise → AccountCompany { accountId, companyId,
 *    status='active', contractStartAt = Account.createdAt ?? now() } yarat
 *  - Account.companyId IS NULL (shared) → skippedNoCompanyId (dokunulmaz)
 *  - Account.companyId orphan FK → skippedOrphanCompany + warn
 *  - VKN ve diğer hassas alanlar HİÇBİR ZAMAN loglanmaz
 *
 * Çalıştır:
 *   node --env-file=.env scripts/backfill-account-companies.js
 *   node --env-file=.env scripts/backfill-account-companies.js --dry-run
 */

import { prisma } from '../server/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill] start ${DRY_RUN ? '(DRY RUN)' : ''}`);

  // Tüm Account'ları gez — companyId NULL olanlar da raporlanır (skippedNoCompanyId).
  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      companyId: true,
      createdAt: true,
      companies: { select: { companyId: true } },
    },
  });
  console.log(`[backfill] scanned ${accounts.length} accounts`);

  let created = 0;
  let skippedExisting = 0;
  let skippedNoCompanyId = 0;
  let skippedOrphanCompany = 0;
  const perCompany = new Map();

  // Company existence cache (orphan FK detection)
  const distinctIds = Array.from(
    new Set(accounts.map((a) => a.companyId).filter((id) => id != null)),
  );
  const existingCompanies = distinctIds.length
    ? await prisma.company.findMany({
        where: { id: { in: distinctIds } },
        select: { id: true },
      })
    : [];
  const companyIdSet = new Set(existingCompanies.map((c) => c.id));

  for (const acc of accounts) {
    if (acc.companyId == null) {
      skippedNoCompanyId += 1;
      continue;
    }
    if (!companyIdSet.has(acc.companyId)) {
      skippedOrphanCompany += 1;
      console.warn(`[backfill] account ${acc.id} → company ${acc.companyId} bulunamadı, atlanıyor`);
      continue;
    }
    // Idempotent check
    const alreadyLinked = acc.companies.some((c) => c.companyId === acc.companyId);
    if (alreadyLinked) {
      skippedExisting += 1;
      continue;
    }

    if (!DRY_RUN) {
      await prisma.accountCompany.create({
        data: {
          accountId: acc.id,
          companyId: acc.companyId,
          status: 'active',
          contractStartAt: acc.createdAt ?? new Date(),
        },
      });
    }
    created += 1;
    perCompany.set(acc.companyId, (perCompany.get(acc.companyId) ?? 0) + 1);
  }

  console.log('[backfill] summary');
  console.log(`  created:               ${created}`);
  console.log(`  skippedExisting:       ${skippedExisting}`);
  console.log(`  skippedNoCompanyId:    ${skippedNoCompanyId}`);
  console.log(`  skippedOrphanCompany:  ${skippedOrphanCompany}`);
  console.log('  per company:');
  for (const [companyId, count] of perCompany) {
    console.log(`    ${companyId}: ${count}`);
  }
  if (DRY_RUN) console.log('[backfill] DRY RUN — hiçbir kayıt yazılmadı');
  console.log('[backfill] done');

  return { created, skippedExisting, skippedNoCompanyId, skippedOrphanCompany, perCompany };
}

// Module olarak import edilirse main() otomatik çalışmaz; CLI'da direkt invoke.
const isDirectRun = process.argv[1] && process.argv[1].endsWith('backfill-account-companies.js');
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error('[backfill] FAILED:', err?.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as runAccountCompanyBackfill };
