/**
 * Actor Identity Backfill — Faz 2 (audit 2026-06-18).
 *
 * Runtime write path'leri PR #96 ile server-authoritative oldu; bu script
 * geçmiş DB kayıtlarındaki Mock User / mock-user sentinel'lerini canlı
 * User.fullName ile düzeltir. Dry-run default; --execute olmadan UPDATE yok.
 *
 * Kapsam (Faz 2 PR):
 *   1) CaseActivity.actor           IN sentinels & actorUserId       NOT NULL → User.fullName ile UPDATE
 *   2) CaseNote.authorName          IN sentinels & authorId          NOT NULL → User.fullName ile UPDATE
 *   3) CaseAttachment.uploadedBy    IN sentinels & uploadedByUserId  NOT NULL → User.fullName ile UPDATE
 *   4) Unresolved (auto-backfill yok):
 *      - Yukarıdaki 3 tablo + FK NULL satırlar
 *      - CaseCallLog.callerId = 'mock-user' (gerçek caller bilinmiyor)
 *
 * Çıktı:
 *   - tablo bazında total / auto-fixable / unresolved
 *   - örnek 10 kayıt (her tablo için)
 *   - --execute ise: kaç satır gerçekten güncellendi
 *
 * Çalıştırma:
 *   # dry-run (default — sadece raporlar, UPDATE yok)
 *   node --env-file=.env scripts/backfill-actor-identity.js
 *
 *   # execute (transaction içinde UPDATE)
 *   node --env-file=.env scripts/backfill-actor-identity.js --execute
 *
 * Guardrails:
 *   - Schema migration YOK.
 *   - --execute olmadan prisma write çağrılmaz (transaction içinde değil — hiç).
 *   - FK NULL satırlara dokunulmaz; "Bilinmeyen" gibi anonim etiket
 *     yazmıyoruz (kullanıcı talimatı: unresolved raporla, otomatik backfill yok).
 *   - Idempotent: iki kez koşmak ek değişiklik yapmaz (sentinel kaldıkça
 *     sadece yeni Mock User satırlarını yakalar; mevcut User.fullName'leri
 *     yeniden yazmaz çünkü where sentinel filtresi ile).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

const MOCK_USER_SENTINELS = ['Mock User', 'mock-user', 'mock_user'];

const SAMPLE_LIMIT = 10;
const BATCH_SIZE = 200;

function header(title) {
  console.log('\n' + '─'.repeat(60));
  console.log(title);
  console.log('─'.repeat(60));
}

function sub(title) {
  console.log('\n  ' + title);
}

/**
 * fkField NOT NULL satırlar için User.id → fullName lookup yapıp
 * { ok: [{id, oldVal, newVal}], unresolved: [{id, fkUserId}] } döner.
 *
 * displayField: backfill edilecek string kolon adı (ör 'actor', 'authorName', 'uploadedBy')
 * fkField: User FK kolon adı (ör 'actorUserId', 'authorId', 'uploadedByUserId')
 */
async function collectRows(model, displayField, fkField) {
  const sentinelWhere = { [displayField]: { in: MOCK_USER_SENTINELS } };

  const total = await prisma[model].count({ where: sentinelWhere });

  // FK NOT NULL → auto-fixable
  const fixableRows = await prisma[model].findMany({
    where: { ...sentinelWhere, [fkField]: { not: null } },
    select: { id: true, [displayField]: true, [fkField]: true },
  });

  const userIds = [...new Set(fixableRows.map((r) => r[fkField]).filter(Boolean))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const ok = [];
  const fkOrphan = []; // FK var ama User yok (silinmiş) — unresolved
  for (const r of fixableRows) {
    const u = userMap.get(r[fkField]);
    if (!u) {
      fkOrphan.push({ id: r.id, fkUserId: r[fkField], oldVal: r[displayField] });
      continue;
    }
    const newVal = (u.fullName ?? '').trim() || (u.email ?? '').trim() || u.id;
    if (newVal === r[displayField]) continue; // zaten doğru
    ok.push({ id: r.id, oldVal: r[displayField], newVal });
  }

  // FK NULL → tamamen unresolved
  const unresolvedNullFkCount = await prisma[model].count({
    where: { ...sentinelWhere, [fkField]: null },
  });
  const unresolvedSamples = await prisma[model].findMany({
    where: { ...sentinelWhere, [fkField]: null },
    select: { id: true, [displayField]: true },
    take: SAMPLE_LIMIT,
  });

  return {
    total,
    autoFixable: ok.length,
    fkOrphanCount: fkOrphan.length,
    unresolvedNullFkCount,
    ok,
    fkOrphan,
    unresolvedSamples,
  };
}

async function reportTable(label, result, displayField, fkField) {
  sub(`📊 ${label}`);
  console.log(`     total sentinel        : ${result.total}`);
  console.log(`     auto-fixable          : ${result.autoFixable}`);
  console.log(`     unresolved (FK NULL)  : ${result.unresolvedNullFkCount}`);
  console.log(`     unresolved (FK orphan): ${result.fkOrphanCount}`);

  if (result.ok.length) {
    console.log(`     örnek auto-fix (${Math.min(SAMPLE_LIMIT, result.ok.length)}):`);
    for (const r of result.ok.slice(0, SAMPLE_LIMIT)) {
      console.log(`       - id=${r.id}  "${r.oldVal}" → "${r.newVal}"`);
    }
  }
  if (result.unresolvedSamples.length) {
    console.log(`     örnek unresolved-FK-null (${result.unresolvedSamples.length}):`);
    for (const r of result.unresolvedSamples) {
      console.log(`       - id=${r.id}  ${displayField}="${r[displayField]}"  ${fkField}=NULL`);
    }
  }
  if (result.fkOrphan.length) {
    console.log(`     örnek unresolved-FK-orphan (${Math.min(SAMPLE_LIMIT, result.fkOrphan.length)}):`);
    for (const r of result.fkOrphan.slice(0, SAMPLE_LIMIT)) {
      console.log(`       - id=${r.id}  oldVal="${r.oldVal}"  fkUserId=${r.fkUserId} (User tablosunda yok)`);
    }
  }
}

/**
 * --execute mode: ok listesini transaction içinde batch UPDATE'lerle uygula.
 * Çok büyük setlerde tek $transaction patlamasın diye BATCH_SIZE'lı bölünür.
 */
async function applyUpdates(model, displayField, ok) {
  if (ok.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < ok.length; i += BATCH_SIZE) {
    const slice = ok.slice(i, i + BATCH_SIZE);
    const ops = slice.map((r) =>
      prisma[model].update({
        where: { id: r.id },
        data: { [displayField]: r.newVal },
      }),
    );
    const res = await prisma.$transaction(ops);
    updated += res.length;
  }
  return updated;
}

async function reportCallLogUnresolved() {
  sub('📊 CaseCallLog.callerId="mock-user" (auto-backfill yok)');
  const total = await prisma.caseCallLog.count({ where: { callerId: 'mock-user' } });
  console.log(`     total sentinel        : ${total}`);
  console.log(`     auto-fixable          : 0  (gerçek caller bilinmiyor)`);
  console.log(`     unresolved            : ${total}`);
  if (total > 0) {
    const samples = await prisma.caseCallLog.findMany({
      where: { callerId: 'mock-user' },
      select: { id: true, caseId: true, callerName: true, callDate: true },
      take: SAMPLE_LIMIT,
      orderBy: { callDate: 'desc' },
    });
    console.log(`     örnek (${samples.length}):`);
    for (const r of samples) {
      console.log(
        `       - id=${r.id}  caseId=${r.caseId}  callerName="${r.callerName}"  callDate=${r.callDate.toISOString()}`,
      );
    }
  }
  return { total, autoFixable: 0, unresolved: total };
}

async function main() {
  header(`Actor Identity Backfill — ${EXECUTE ? 'EXECUTE MODE' : 'DRY-RUN (varsayılan)'}`);
  console.log(`Sentinel set: ${MOCK_USER_SENTINELS.map((s) => `"${s}"`).join(', ')}`);
  console.log(`Batch boyutu: ${BATCH_SIZE} (execute mode'da transaction başına)`);

  const activity = await collectRows('caseActivity', 'actor', 'actorUserId');
  await reportTable('CaseActivity.actor', activity, 'actor', 'actorUserId');

  const note = await collectRows('caseNote', 'authorName', 'authorId');
  await reportTable('CaseNote.authorName', note, 'authorName', 'authorId');

  const attachment = await collectRows('caseAttachment', 'uploadedBy', 'uploadedByUserId');
  await reportTable('CaseAttachment.uploadedBy', attachment, 'uploadedBy', 'uploadedByUserId');

  const callLog = await reportCallLogUnresolved();

  // Özet
  header('Özet');
  const totalAutoFixable = activity.autoFixable + note.autoFixable + attachment.autoFixable;
  const totalUnresolved =
    activity.unresolvedNullFkCount +
    activity.fkOrphanCount +
    note.unresolvedNullFkCount +
    note.fkOrphanCount +
    attachment.unresolvedNullFkCount +
    attachment.fkOrphanCount +
    callLog.unresolved;

  console.log(`  auto-fixable toplam : ${totalAutoFixable}`);
  console.log(`  unresolved toplam   : ${totalUnresolved}`);
  console.log(`  4 tablo total sentinel: ${activity.total + note.total + attachment.total + callLog.total}`);

  if (!EXECUTE) {
    header('DRY-RUN tamam. UPDATE yapılmadı.');
    console.log('Apply etmek için: node --env-file=.env scripts/backfill-actor-identity.js --execute');
    await prisma.$disconnect();
    process.exit(0);
  }

  // EXECUTE: transaction içinde batch UPDATE'ler
  header('EXECUTE — transaction içinde UPDATE');
  const updActivity = await applyUpdates('caseActivity', 'actor', activity.ok);
  console.log(`  CaseActivity.actor       updated: ${updActivity}`);
  const updNote = await applyUpdates('caseNote', 'authorName', note.ok);
  console.log(`  CaseNote.authorName      updated: ${updNote}`);
  const updAttachment = await applyUpdates('caseAttachment', 'uploadedBy', attachment.ok);
  console.log(`  CaseAttachment.uploadedBy updated: ${updAttachment}`);
  console.log(`  CaseCallLog.callerId="mock-user" updated: 0 (otomatik backfill yok)`);

  console.log(`\n✅ Toplam ${updActivity + updNote + updAttachment} satır güncellendi.`);
  console.log(`   Unresolved kayıtlar dokunulmadı: ${totalUnresolved}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
