/**
 * Actor Identity Backfill — Faz 2 (audit 2026-06-18, anonim etiket v2).
 *
 * Runtime write path'leri PR #96 ile server-authoritative oldu; bu script
 * geçmiş DB kayıtlarındaki Mock User / mock-user sentinel'lerini düzeltir.
 * Dry-run default; --execute olmadan UPDATE yok.
 *
 * Strateji (Faz 2 v2):
 *   - FK NOT NULL → User.fullName ile gerçek isim (truthful)
 *   - FK NULL    → 'Bilinmeyen kullanıcı' anonim etiket (UI'da Mock User görünmesin
 *                  ama gerçek kişi tahmin edilmesin)
 *   - CaseCallLog.callerId='mock-user' → callerId semantik olarak User.id bekliyor;
 *                  string değişimi raporları etkileyebilir. Default'ta SKIP.
 *                  Bilinçli onay için ayrı flag: --include-calllog (yine de execute
 *                  mode'da olmalı).
 *
 * Kapsam:
 *   1) CaseActivity.actor        IN sentinels:
 *        actorUserId NOT NULL    → User.fullName UPDATE
 *        actorUserId NULL        → 'Bilinmeyen kullanıcı' UPDATE
 *        FK orphan (User silinmiş) → 'Bilinmeyen kullanıcı' UPDATE
 *   2) CaseNote.authorName       IN sentinels: aynı pattern
 *   3) CaseAttachment.uploadedBy IN sentinels: aynı pattern
 *   4) CaseCallLog.callerId='mock-user':
 *        Default SKIP. --include-calllog ile 'unknown-user' string UPDATE.
 *        callerName alanı (gerçek müşteri ismi) dokunulmaz.
 *
 * Çıktı:
 *   - tablo bazında total / fk-fixable / anonymous-fixable / skipped
 *   - örnek 10 kayıt (her sınıf için)
 *   - --execute ise: kaç satır gerçekten güncellendi
 *   - --execute sonrası kalan sentinel count raporu (idempotency kanıtı)
 *
 * Çalıştırma:
 *   # dry-run (default — sadece raporlar, UPDATE yok)
 *   node --env-file=.env scripts/backfill-actor-identity.js
 *
 *   # execute (transaction içinde UPDATE; CaseCallLog skip)
 *   node --env-file=.env scripts/backfill-actor-identity.js --execute
 *
 *   # execute + CaseCallLog dahil
 *   node --env-file=.env scripts/backfill-actor-identity.js --execute --include-calllog
 *
 * Guardrails:
 *   - Schema migration YOK.
 *   - --execute olmadan prisma write çağrılmaz.
 *   - Gerçek kişiye tahmin YOK: FK NULL satırlar User.fullName almaz, sadece
 *     anonim 'Bilinmeyen kullanıcı' etiketi alır.
 *   - CaseCallLog --include-calllog flag'i olmadan dokunulmaz.
 *   - Idempotent: iki kez koşmak ek değişiklik yapmaz (sentinel where filtresi
 *     anonim etiket yazılan satırları artık yakalamaz).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const INCLUDE_CALLLOG = args.includes('--include-calllog');

const MOCK_USER_SENTINELS = ['Mock User', 'mock-user', 'mock_user'];
const ANONYMOUS_LABEL = 'Bilinmeyen kullanıcı';
const CALLLOG_UNKNOWN_VALUE = 'unknown-user';

const SAMPLE_LIMIT = 10;
const BATCH_SIZE = 200;
// MSSQL parametre limiti 2100 (Codex review P2 — PR #98). User.findMany'i
// id: { in: [...] } ile çağırırken büyük tenantlarda fail etmesin diye
// USER_LOOKUP_BATCH < 2100 tutulur; BATCH_SIZE değerinden bağımsız.
const USER_LOOKUP_BATCH = 1500;

function header(title) {
  console.log('\n' + '─'.repeat(60));
  console.log(title);
  console.log('─'.repeat(60));
}

function sub(title) {
  console.log('\n  ' + title);
}

/**
 * Codex P2 (PR #98) — MSSQL 2100 parametre limiti.
 * Büyük tenantlarda findMany({ where: { id: { in: [...]  } } }) patlamasın
 * diye userIds USER_LOOKUP_BATCH'a bölünür; her batch ayrı sorgu.
 */
async function findUsersByIdsBatched(userIds) {
  if (userIds.length === 0) return [];
  const out = [];
  for (let i = 0; i < userIds.length; i += USER_LOOKUP_BATCH) {
    const slice = userIds.slice(i, i + USER_LOOKUP_BATCH);
    const found = await prisma.user.findMany({
      where: { id: { in: slice } },
      select: { id: true, fullName: true, email: true },
    });
    out.push(...found);
  }
  return out;
}

/**
 * 3 sınıfa ayırır:
 *   - fkOk        : FK NOT NULL + User var       → User.fullName ile UPDATE
 *   - anonymous   : FK NULL veya FK orphan       → 'Bilinmeyen kullanıcı' ile UPDATE
 *   - alreadyOk   : oldVal === newVal            → skip (idempotent)
 *
 * displayField: backfill edilecek string kolon (ör 'actor', 'authorName', 'uploadedBy')
 * fkField: User FK kolon adı (ör 'actorUserId', 'authorId', 'uploadedByUserId')
 */
async function collectRows(model, displayField, fkField) {
  const sentinelWhere = { [displayField]: { in: MOCK_USER_SENTINELS } };

  const total = await prisma[model].count({ where: sentinelWhere });

  // FK NOT NULL — fkOk veya orphan
  const fkRows = await prisma[model].findMany({
    where: { ...sentinelWhere, [fkField]: { not: null } },
    select: { id: true, [displayField]: true, [fkField]: true },
  });
  const userIds = [...new Set(fkRows.map((r) => r[fkField]).filter(Boolean))];
  // Codex review P2 (PR #98): MSSQL 2100 parametre limiti — büyük tenantlarda
  // unchunked findMany patlamasın diye USER_LOOKUP_BATCH'lı sorgu.
  const users = await findUsersByIdsBatched(userIds);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const fkOk = [];
  const fkOrphan = []; // FK var ama User silinmiş — anonim etikete düşer
  for (const r of fkRows) {
    const u = userMap.get(r[fkField]);
    if (!u) {
      fkOrphan.push({ id: r.id, oldVal: r[displayField], fkUserId: r[fkField] });
      continue;
    }
    const newVal = (u.fullName ?? '').trim() || (u.email ?? '').trim() || u.id;
    if (newVal === r[displayField]) continue;
    fkOk.push({ id: r.id, oldVal: r[displayField], newVal });
  }

  // FK NULL satırlar
  const fkNullRows = await prisma[model].findMany({
    where: { ...sentinelWhere, [fkField]: null },
    select: { id: true, [displayField]: true },
  });

  // Anonymous batch: FK NULL ∪ FK orphan — hepsi 'Bilinmeyen kullanıcı' etiketi
  const anonymous = [
    ...fkNullRows.map((r) => ({ id: r.id, oldVal: r[displayField], newVal: ANONYMOUS_LABEL })),
    ...fkOrphan.map((r) => ({ id: r.id, oldVal: r.oldVal, newVal: ANONYMOUS_LABEL })),
  ];

  // Örnek payload'lar (rapor için)
  const fkNullSamples = fkNullRows.slice(0, SAMPLE_LIMIT);
  const fkOrphanSamples = fkOrphan.slice(0, SAMPLE_LIMIT);

  return {
    total,
    fkOkCount: fkOk.length,
    anonymousCount: anonymous.length,
    fkNullCount: fkNullRows.length,
    fkOrphanCount: fkOrphan.length,
    fkOk,
    anonymous,
    fkNullSamples,
    fkOrphanSamples,
    displayField,
    fkField,
  };
}

async function reportTable(label, result) {
  sub(`📊 ${label}`);
  console.log(`     total sentinel             : ${result.total}`);
  console.log(`     fk-fixable (User.fullName) : ${result.fkOkCount}`);
  console.log(`     anonymous (${ANONYMOUS_LABEL}): ${result.anonymousCount}`);
  console.log(`       ↳ FK NULL                : ${result.fkNullCount}`);
  console.log(`       ↳ FK orphan              : ${result.fkOrphanCount}`);

  if (result.fkOk.length) {
    console.log(`     örnek fk-fixable (${Math.min(SAMPLE_LIMIT, result.fkOk.length)}):`);
    for (const r of result.fkOk.slice(0, SAMPLE_LIMIT)) {
      console.log(`       - id=${r.id}  "${r.oldVal}" → "${r.newVal}"`);
    }
  }
  if (result.fkNullSamples.length) {
    console.log(`     örnek anonymous (FK NULL, ${result.fkNullSamples.length}):`);
    for (const r of result.fkNullSamples) {
      console.log(`       - id=${r.id}  ${result.displayField}="${r[result.displayField]}"  ${result.fkField}=NULL → "${ANONYMOUS_LABEL}"`);
    }
  }
  if (result.fkOrphanSamples.length) {
    console.log(`     örnek anonymous (FK orphan, ${result.fkOrphanSamples.length}):`);
    for (const r of result.fkOrphanSamples) {
      console.log(`       - id=${r.id}  oldVal="${r.oldVal}"  fkUserId=${r.fkUserId} → "${ANONYMOUS_LABEL}"`);
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

async function reportCallLog() {
  sub(`📊 CaseCallLog.callerId="mock-user" ${INCLUDE_CALLLOG ? '(--include-calllog AKTİF)' : '(default SKIP)'}`);
  const total = await prisma.caseCallLog.count({ where: { callerId: 'mock-user' } });
  console.log(`     total sentinel        : ${total}`);
  if (INCLUDE_CALLLOG) {
    console.log(`     planned UPDATE        : ${total} → callerId="${CALLLOG_UNKNOWN_VALUE}" (callerName dokunulmaz)`);
  } else {
    console.log(`     planned UPDATE        : 0  (--include-calllog flag gerekli; callerId semantik User.id bekliyor)`);
  }
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
  return { total, planned: INCLUDE_CALLLOG ? total : 0 };
}

async function applyCallLogUpdate() {
  // CaseCallLog.callerId NULL kabul etmiyor (NVarChar(450) NOT NULL); sentinel
  // değeri 'unknown-user' ile değiştir. callerName dokunulmaz.
  const rows = await prisma.caseCallLog.findMany({
    where: { callerId: 'mock-user' },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const ops = slice.map((r) =>
      prisma.caseCallLog.update({
        where: { id: r.id },
        data: { callerId: CALLLOG_UNKNOWN_VALUE },
      }),
    );
    const res = await prisma.$transaction(ops);
    updated += res.length;
  }
  return updated;
}

async function postExecuteSentinelCount() {
  const a = await prisma.caseActivity.count({ where: { actor: { in: MOCK_USER_SENTINELS } } });
  const n = await prisma.caseNote.count({ where: { authorName: { in: MOCK_USER_SENTINELS } } });
  const at = await prisma.caseAttachment.count({ where: { uploadedBy: { in: MOCK_USER_SENTINELS } } });
  const cl = await prisma.caseCallLog.count({ where: { callerId: 'mock-user' } });
  return { caseActivity: a, caseNote: n, caseAttachment: at, caseCallLog: cl };
}

async function main() {
  header(
    `Actor Identity Backfill — ${EXECUTE ? 'EXECUTE MODE' : 'DRY-RUN (varsayılan)'}` +
      `${INCLUDE_CALLLOG ? ' + INCLUDE-CALLLOG' : ''}`,
  );
  console.log(`Sentinel set: ${MOCK_USER_SENTINELS.map((s) => `"${s}"`).join(', ')}`);
  console.log(`Anonim etiket: "${ANONYMOUS_LABEL}" (FK NULL + FK orphan)`);
  console.log(`Batch boyutu: ${BATCH_SIZE} (execute mode'da transaction başına)`);

  const activity = await collectRows('caseActivity', 'actor', 'actorUserId');
  await reportTable('CaseActivity.actor', activity);

  const note = await collectRows('caseNote', 'authorName', 'authorId');
  await reportTable('CaseNote.authorName', note);

  const attachment = await collectRows('caseAttachment', 'uploadedBy', 'uploadedByUserId');
  await reportTable('CaseAttachment.uploadedBy', attachment);

  const callLog = await reportCallLog();

  // Özet
  header('Özet');
  const totalFkOk = activity.fkOkCount + note.fkOkCount + attachment.fkOkCount;
  const totalAnonymous = activity.anonymousCount + note.anonymousCount + attachment.anonymousCount;
  const grandTotal = activity.total + note.total + attachment.total + callLog.total;

  console.log(`  fk-fixable (User.fullName)   : ${totalFkOk}`);
  console.log(`  anonymous ("${ANONYMOUS_LABEL}"): ${totalAnonymous}`);
  console.log(`  CaseCallLog ${INCLUDE_CALLLOG ? 'planned' : 'SKIP'}: ${callLog.planned}`);
  console.log(`  4 tablo total sentinel       : ${grandTotal}`);

  if (!EXECUTE) {
    header('DRY-RUN tamam. UPDATE yapılmadı.');
    console.log('Apply etmek için: node --env-file=.env scripts/backfill-actor-identity.js --execute');
    console.log('CaseCallLog dahil için: --execute --include-calllog');
    await prisma.$disconnect();
    process.exit(0);
  }

  // EXECUTE: transaction içinde batch UPDATE'ler
  header('EXECUTE — transaction içinde UPDATE');
  const updActA = await applyUpdates('caseActivity', 'actor', activity.fkOk);
  const updActB = await applyUpdates('caseActivity', 'actor', activity.anonymous);
  console.log(`  CaseActivity.actor        fk-fixable=${updActA}  anonymous=${updActB}`);

  const updNoteA = await applyUpdates('caseNote', 'authorName', note.fkOk);
  const updNoteB = await applyUpdates('caseNote', 'authorName', note.anonymous);
  console.log(`  CaseNote.authorName       fk-fixable=${updNoteA}  anonymous=${updNoteB}`);

  const updAttA = await applyUpdates('caseAttachment', 'uploadedBy', attachment.fkOk);
  const updAttB = await applyUpdates('caseAttachment', 'uploadedBy', attachment.anonymous);
  console.log(`  CaseAttachment.uploadedBy fk-fixable=${updAttA}  anonymous=${updAttB}`);

  let updCallLog = 0;
  if (INCLUDE_CALLLOG) {
    updCallLog = await applyCallLogUpdate();
    console.log(`  CaseCallLog.callerId      updated=${updCallLog} (sentinel → "${CALLLOG_UNKNOWN_VALUE}")`);
  } else {
    console.log(`  CaseCallLog.callerId      SKIP (--include-calllog flag yok)`);
  }

  const totalUpdated = updActA + updActB + updNoteA + updNoteB + updAttA + updAttB + updCallLog;
  console.log(`\n✅ Toplam ${totalUpdated} satır güncellendi.`);

  // Idempotency kanıtı — execute sonrası sentinel count
  header('Post-execute sentinel count (idempotency)');
  const after = await postExecuteSentinelCount();
  console.log(`  CaseActivity.actor sentinel kalan    : ${after.caseActivity}`);
  console.log(`  CaseNote.authorName sentinel kalan   : ${after.caseNote}`);
  console.log(`  CaseAttachment.uploadedBy kalan      : ${after.caseAttachment}`);
  console.log(`  CaseCallLog.callerId='mock-user' kalan: ${after.caseCallLog}`);
  const allClean =
    after.caseActivity === 0 &&
    after.caseNote === 0 &&
    after.caseAttachment === 0 &&
    (INCLUDE_CALLLOG ? after.caseCallLog === 0 : true);
  console.log(`  ${allClean ? '✅ runtime path artık temiz' : '⚠️ kalan sentinel var — gözden geçir'}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
