#!/usr/bin/env node
/**
 * Backfill: Case.accountName var ama Case.accountId NULL olan vakaları
 * — sadece **tam isim eşleşmesi VE aynı şirket** koşulunda — Account'lara bağla.
 *
 * Idempotent. Fuzzy match YOK. Ambiguous kayıt asla bağlanmaz (Supervisor
 * manuel inceleme için raporlanır).
 *
 * Eşleşme kuralı:
 *   Account.name === Case.accountName (exact)
 *   AND
 *   (Account.companyId === Case.companyId
 *    OR AccountCompany.companyId === Case.companyId)
 *
 * Çalıştır:
 *   node --env-file=.env scripts/backfill-case-account-links.js
 *   node --env-file=.env scripts/backfill-case-account-links.js --dry-run
 */

import { prisma } from '../server/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill:case-account] start ${DRY_RUN ? '(DRY RUN)' : ''}`);

  const cases = await prisma.case.findMany({
    where: { accountId: null, accountName: { not: null } },
    select: { id: true, caseNumber: true, companyId: true, accountName: true },
  });
  console.log(`[backfill:case-account] scanned ${cases.length} cases (accountId NULL + name set)`);

  let linked = 0;
  let skippedNoMatch = 0;
  let skippedAmbiguous = 0;
  const ambiguousSample = [];

  for (const c of cases) {
    // Aynı şirket + tam isim eşleşmesi
    const candidates = await prisma.account.findMany({
      where: {
        name: c.accountName,
        OR: [
          { companyId: c.companyId },
          { companies: { some: { companyId: c.companyId } } },
        ],
      },
      select: { id: true, name: true, companyId: true },
    });

    if (candidates.length === 0) {
      skippedNoMatch += 1;
      continue;
    }
    if (candidates.length > 1) {
      skippedAmbiguous += 1;
      if (ambiguousSample.length < 5) {
        ambiguousSample.push({
          caseNumber: c.caseNumber,
          accountName: c.accountName,
          companyId: c.companyId,
          candidateIds: candidates.map((a) => a.id),
        });
      }
      continue;
    }

    const match = candidates[0];
    if (!DRY_RUN) {
      await prisma.case.update({
        where: { id: c.id },
        data: { accountId: match.id, accountName: match.name },
      });
    }
    linked += 1;
  }

  console.log('[backfill:case-account] summary');
  console.log(`  linked:            ${linked}`);
  console.log(`  skippedNoMatch:    ${skippedNoMatch}`);
  console.log(`  skippedAmbiguous:  ${skippedAmbiguous}`);
  if (ambiguousSample.length) {
    console.log('  ambiguous sample (manuel inceleme gerek):');
    for (const a of ambiguousSample) {
      console.log(`    ${a.caseNumber}: "${a.accountName}" @ ${a.companyId} → [${a.candidateIds.join(', ')}]`);
    }
  }
  if (DRY_RUN) console.log('[backfill:case-account] DRY RUN — hiçbir kayıt yazılmadı');
  console.log('[backfill:case-account] done');

  return { linked, skippedNoMatch, skippedAmbiguous, ambiguousSample };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('backfill-case-account-links.js');
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error('[backfill:case-account] FAILED:', err?.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as runCaseAccountBackfill };
