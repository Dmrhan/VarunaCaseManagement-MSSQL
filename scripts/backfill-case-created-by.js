/**
 * Case CreatedBy Backfill — "Vaka Sahibi" (creator) alanı.
 *
 * Case.createdByUserId/createdByName yeni alanlar; eski vakalarda boş.
 * Bu script, en eski CaseActivity (actionType='CaseCreated') kaydından
 * actor/actorUserId'yi kopyalar. Dry-run default; --execute olmadan UPDATE yok.
 *
 * Kapsam:
 *   - createdByName NULL olan Case'ler taranır.
 *   - Her Case için en eski (`orderBy: { at: 'asc' }`) actionType='CaseCreated'
 *     CaseActivity bulunur.
 *   - Bulunursa: createdByName <- activity.actor, createdByUserId <- activity.actorUserId
 *   - Bulunamazsa: atlanır, createdByName null kalır (UI '—' fallback'i karşılar).
 *
 * Idempotent: createdByName zaten dolu olan Case'ler where filtresiyle
 * baştan dışlanır; ikinci çalıştırma hiçbir satırı değiştirmez.
 *
 * Çalıştırma:
 *   # dry-run (default — sadece rapor, UPDATE yok)
 *   node --env-file=.env scripts/backfill-case-created-by.js
 *
 *   # execute (gerçek UPDATE)
 *   node --env-file=.env scripts/backfill-case-created-by.js --execute
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

async function main() {
  const candidates = await prisma.case.findMany({
    where: { createdByName: null },
    select: { id: true, caseNumber: true },
  });

  console.log(`createdByName boş olan vaka sayısı: ${candidates.length}`);

  let fixable = 0;
  let unmatched = 0;
  const sample = [];

  for (const c of candidates) {
    const activity = await prisma.caseActivity.findFirst({
      where: { caseId: c.id, actionType: 'CaseCreated' },
      orderBy: { at: 'asc' },
      select: { actor: true, actorUserId: true },
    });

    if (!activity) {
      unmatched++;
      continue;
    }

    fixable++;
    if (sample.length < 10) {
      sample.push({ caseNumber: c.caseNumber, actor: activity.actor, actorUserId: activity.actorUserId });
    }

    if (EXECUTE) {
      await prisma.case.update({
        where: { id: c.id },
        data: { createdByName: activity.actor, createdByUserId: activity.actorUserId },
      });
    }
  }

  console.log(`CaseCreated aktivitesinden doldurulabilir: ${fixable}`);
  console.log(`CaseCreated aktivitesi bulunamayan (atlanan): ${unmatched}`);
  console.log('Örnek (ilk 10):', JSON.stringify(sample, null, 2));

  if (!EXECUTE) {
    console.log('\nDry-run modu — hiçbir satır güncellenmedi. --execute ile çalıştır.');
  } else {
    console.log(`\n${fixable} vaka güncellendi.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
