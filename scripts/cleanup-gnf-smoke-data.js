#!/usr/bin/env node
/**
 * GNF smoke data cleanup — DRY RUN default; --execute opt-in.
 *
 * `scripts/smoke-generic-notification-flow.js` ile başka prefix'li smoke
 * dosyaları interrupt edildiğinde finally{} cleanup'ı çalışmaz. Bu
 * script:
 *
 *   • Smoke prefix'li (gnf_ default) tüm leaked entity'leri tarar
 *   • DB kimliğini ve prod-likeness'i raporlar
 *   • Tablo başına sayım + ilk birkaç örnek satır gösterir
 *   • --execute YOK ise: yapılacak DELETE sırasını yazdırır, silmez
 *   • --execute VAR ise: reverse-FK sırasında per-table transactional
 *     delete uygular, before/after sayım + final doğrulama yapar
 *
 * Flags:
 *   --dry-run          (default davranış; flag verilmeden de dry-run)
 *   --execute          gerçekten sil. Prod-like env'de --confirm-smoke-db
 *                      ZORUNLU; aksi halde refüze edilir.
 *   --prefix=gnf_      smoke prefix (default gnf_; mif_, mir_, cns_ de
 *                      kullanılabilir)
 *   --confirm-smoke-db prod-like DB güvenlik kontrolünü açıkça onayla
 *                      (NODE_ENV=production veya VERCEL=1 ise yine red)
 *
 * Run: node --env-file=.env scripts/cleanup-gnf-smoke-data.js
 *      node --env-file=.env scripts/cleanup-gnf-smoke-data.js --execute
 */

import { prisma } from '../server/db/client.js';

const args = process.argv.slice(2);
const PREFIX =
  args.find((a) => a.startsWith('--prefix='))?.slice('--prefix='.length) ?? 'gnf_';
const CONFIRM_SMOKE_DB = args.includes('--confirm-smoke-db');
const EXECUTE = args.includes('--execute');
const PRINT_SAMPLE = 5;

function maskDbUrl(url) {
  if (!url) return '<unset>';
  return url.replace(/:\/\/[^@]*@/, '://***@');
}

function looksProdLike() {
  const reasons = [];
  if (process.env.NODE_ENV === 'production') reasons.push('NODE_ENV=production');
  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
    reasons.push('VERCEL marker set');
  }
  const url = process.env.DATABASE_URL ?? '';
  // Heuristic hostname tokens — adjust if your prod uses different patterns.
  if (/\bprod(uction)?\b/i.test(url)) reasons.push('DATABASE_URL hostname contains "prod"');
  if (/\blive\b/i.test(url)) reasons.push('DATABASE_URL hostname contains "live"');
  return reasons;
}

function header(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`);
}

function fmtRow(obj, fields) {
  return fields.map((f) => `${f}=${JSON.stringify(obj[f])}`).join(' ');
}

async function discover({ phaseLabel = 'DRY RUN inventory', printBanner = true } = {}) {
  if (printBanner) {
    console.log(`🔍 GNF smoke data — ${phaseLabel} (prefix="${PREFIX}")`);
    console.log(`Connected DB: ${maskDbUrl(process.env.DATABASE_URL)}`);
    console.log(`NODE_ENV    : ${process.env.NODE_ENV ?? '<unset>'}`);
    console.log(`VERCEL      : ${process.env.VERCEL ?? '<unset>'}`);
  }

  // ── Safety: refuse production-like envs (also gates --execute) ─────
  const prodMarkers = looksProdLike();
  if (prodMarkers.length > 0) {
    console.log('\n⛔  Production-like environment detected:');
    prodMarkers.forEach((r) => console.log(`     - ${r}`));
    if (!CONFIRM_SMOKE_DB) {
      console.log('\nRefusing to inventory without --confirm-smoke-db.');
      console.log('Re-run with --confirm-smoke-db ONLY if this is the correct DB.');
      process.exitCode = 2;
      return null;
    }
    console.log('\n--confirm-smoke-db passed; proceeding.');
  }

  // Smoke prefix patterns — every smoke file uses `${PREFIX}-{label}` and
  // sometimes `${PREFIX}-{label}-user@smoke.test`. Match the prefix at
  // string start; exact, not loose contains.
  const startsWith = { startsWith: PREFIX };

  header('Discovery — root entities (prefix-matched)');

  // Teams
  const teams = await prisma.team.findMany({
    where: { name: startsWith },
    select: { id: true, name: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Team           : ${teams.length}`);
  teams.slice(0, PRINT_SAMPLE).forEach((t) => console.log(`   ${fmtRow(t, ['name', 'companyId', 'createdAt'])}`));

  // Persons
  const persons = await prisma.person.findMany({
    where: {
      OR: [{ name: startsWith }, { email: startsWith }],
    },
    select: { id: true, name: true, email: true, teamId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Person         : ${persons.length}`);
  persons.slice(0, PRINT_SAMPLE).forEach((p) => console.log(`   ${fmtRow(p, ['name', 'email', 'teamId'])}`));

  // Users
  const users = await prisma.user.findMany({
    where: {
      OR: [{ email: startsWith }, { fullName: startsWith }],
    },
    select: { id: true, email: true, fullName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`User           : ${users.length}`);
  users.slice(0, PRINT_SAMPLE).forEach((u) => console.log(`   ${fmtRow(u, ['email', 'fullName'])}`));

  // Cases
  const cases = await prisma.case.findMany({
    where: { title: startsWith },
    select: { id: true, caseNumber: true, title: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Case           : ${cases.length}`);
  cases.slice(0, PRINT_SAMPLE).forEach((c) => console.log(`   ${fmtRow(c, ['caseNumber', 'title', 'companyId', 'createdAt'])}`));

  // Collected key sets for transitive lookups
  const userIds = users.map((u) => u.id);
  const caseIds = cases.map((c) => c.id);
  const teamIds = teams.map((t) => t.id);
  const personIds = persons.map((p) => p.id);

  header('Discovery — transitive children (by caseId / userId)');

  // UserCompany rows — userId in leaked users
  const userCompanies = userIds.length
    ? await prisma.userCompany.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true, companyId: true, isActive: true },
      })
    : [];
  console.log(`UserCompany    : ${userCompanies.length}`);
  userCompanies.slice(0, PRINT_SAMPLE).forEach((uc) =>
    console.log(`   ${fmtRow(uc, ['id', 'userId', 'companyId', 'isActive'])}`),
  );

  // ActionItem — by caseId OR userId (covers leak fixtures planted in
  // other tenants' caseId space but still owned by our gnf users)
  const actionItems = (caseIds.length || userIds.length)
    ? await prisma.actionItem.findMany({
        where: {
          OR: [
            ...(caseIds.length ? [{ caseId: { in: caseIds } }] : []),
            ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ],
        },
        select: { id: true, kind: true, caseId: true, userId: true, companyId: true, state: true, dedupKey: true },
      })
    : [];
  console.log(`ActionItem     : ${actionItems.length}`);
  actionItems.slice(0, PRINT_SAMPLE).forEach((a) =>
    console.log(`   ${fmtRow(a, ['kind', 'caseId', 'userId', 'state'])}`),
  );

  // CaseNotification — by caseId (schema uses `recipient`, not userId)
  const notifications = caseIds.length
    ? await prisma.caseNotification.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, recipient: true, eventType: true, readAt: true },
      })
    : [];
  console.log(`CaseNotification: ${notifications.length}`);
  notifications.slice(0, PRINT_SAMPLE).forEach((n) =>
    console.log(`   ${fmtRow(n, ['eventType', 'caseId', 'recipient', 'readAt'])}`),
  );

  // CaseWatcher — by caseId
  const watchers = caseIds.length
    ? await prisma.caseWatcher.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, userId: true, addedBy: true },
      })
    : [];
  console.log(`CaseWatcher    : ${watchers.length}`);
  watchers.slice(0, PRINT_SAMPLE).forEach((w) =>
    console.log(`   ${fmtRow(w, ['caseId', 'userId'])}`),
  );

  // CaseNote — by caseId
  const notes = caseIds.length
    ? await prisma.caseNote.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, authorName: true, parentNoteId: true, createdAt: true },
      })
    : [];
  console.log(`CaseNote       : ${notes.length}`);
  notes.slice(0, PRINT_SAMPLE).forEach((n) =>
    console.log(`   ${fmtRow(n, ['caseId', 'authorName', 'parentNoteId'])}`),
  );

  // CaseActivity — by caseId
  const activities = caseIds.length
    ? await prisma.caseActivity.count({ where: { caseId: { in: caseIds } } })
    : 0;
  console.log(`CaseActivity   : ${activities} (count only — high volume per case)`);

  // CaseMention — by caseId
  const mentions = caseIds.length
    ? await prisma.caseMention.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, noteId: true, mentionedUserId: true },
      })
    : [];
  console.log(`CaseMention    : ${mentions.length}`);
  mentions.slice(0, PRINT_SAMPLE).forEach((m) =>
    console.log(`   ${fmtRow(m, ['caseId', 'mentionedUserId'])}`),
  );

  // ── Phase 2 delete order (would-execute) ──────────────────────────
  header('Phase 2 — proposed DELETE order (NOT executed)');

  const plan = [
    ['ActionItem',        actionItems.length,    'by id IN […] OR caseId IN [cases] (leak fixtures'],
    ['CaseNotification',  notifications.length,  'by caseId IN [cases]'],
    ['CaseMention',       mentions.length,       'by caseId IN [cases]'],
    ['CaseWatcher',       watchers.length,       'by caseId IN [cases]'],
    ['CaseActivity',      activities,            'by caseId IN [cases]'],
    ['CaseNote',          notes.length,          'by caseId IN [cases] — replies first via parentNoteId'],
    ['Case',              cases.length,          'by id IN [cases]'],
    ['UserCompany',       userCompanies.length,  'by userId IN [users]'],
    ['User',              users.length,          'by id IN [users]'],
    ['Person',            persons.length,        'by id IN [persons]'],
    ['Team',              teams.length,          'by id IN [teams]'],
  ];
  for (const [table, count, criteria] of plan) {
    console.log(`   ${String(count).padStart(5, ' ')}  ${table.padEnd(18, ' ')}  ${criteria}`);
  }

  const totalAffected = plan.reduce((acc, [, n]) => acc + (typeof n === 'number' ? n : 0), 0);
  console.log(`   ${'─'.repeat(72)}`);
  console.log(`   ${String(totalAffected).padStart(5, ' ')}  TOTAL rows that would be deleted`);

  // ── Summary ──────────────────────────────────────────────────────
  header('Summary');
  if (totalAffected === 0) {
    console.log(`✓ No leaked "${PREFIX}" data found. DB is clean for this prefix.`);
  } else {
    console.log(`Found ${totalAffected} leaked rows across ${plan.length} tables.`);
    if (!EXECUTE) {
      console.log('Phase 2 would delete in the order above (reverse FK order).');
      console.log('No data was deleted in this phase. Re-run with --execute to delete.');
    }
  }

  return {
    teamIds,
    personIds,
    userIds,
    caseIds,
    userCompanyIds: userCompanies.map((uc) => uc.id),
    actionItemIds: actionItems.map((a) => a.id),
    notificationIds: notifications.map((n) => n.id),
    watcherIds: watchers.map((w) => w.id),
    noteIds: notes.map((n) => n.id),
    mentionIds: mentions.map((m) => m.id),
    activitiesCount: activities,
    totalAffected,
  };
}

/**
 * Per-table transactional delete in reverse-FK order. Each operation is
 * its own transaction so a single-table failure does not leave the
 * whole cleanup half-applied AND so the partial-progress count is
 * surfaceable in the failure summary. Returns { perTable, totalDeleted,
 * failures }.
 */
async function executeDelete(inv) {
  const ops = [];

  async function step(table, fn) {
    try {
      const result = await prisma.$transaction(async (tx) => fn(tx));
      const count = result?.count ?? 0;
      ops.push({ table, ok: true, count });
      console.log(`   ✓ ${table.padEnd(28, ' ')} ${String(count).padStart(5, ' ')} rows`);
    } catch (err) {
      ops.push({ table, ok: false, error: err?.message ?? String(err) });
      console.error(`   ✗ ${table.padEnd(28, ' ')} FAILED — ${err?.message ?? err}`);
    }
  }

  header('EXECUTE — per-table transactional deletes');

  if (inv.actionItemIds.length || inv.caseIds.length) {
    await step('ActionItem (by id)', (tx) =>
      tx.actionItem.deleteMany({ where: { id: { in: inv.actionItemIds } } }),
    );
    if (inv.caseIds.length) {
      await step('ActionItem (by caseId)', (tx) =>
        tx.actionItem.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
    }
  }
  if (inv.caseIds.length) {
    await step('CaseNotification', (tx) =>
      tx.caseNotification.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
    );
    await step('CaseMention', (tx) =>
      tx.caseMention.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
    );
    await step('CaseWatcher', (tx) =>
      tx.caseWatcher.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
    );
    await step('CaseActivity', (tx) =>
      tx.caseActivity.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
    );
    // CaseNote: delete replies first (parentNoteId IS NOT NULL) so the
    // parent's onDelete:SetNull cascade has nothing to mutate. For our
    // leaked dataset replies are 0, but the two-step keeps the script
    // safe for future leaks that include thread replies.
    await step('CaseNote (replies)', (tx) =>
      tx.caseNote.deleteMany({
        where: { caseId: { in: inv.caseIds }, parentNoteId: { not: null } },
      }),
    );
    await step('CaseNote (top-level)', (tx) =>
      tx.caseNote.deleteMany({
        where: { caseId: { in: inv.caseIds }, parentNoteId: null },
      }),
    );
    await step('Case', (tx) =>
      tx.case.deleteMany({ where: { id: { in: inv.caseIds } } }),
    );
  }
  if (inv.userCompanyIds.length) {
    await step('UserCompany', (tx) =>
      tx.userCompany.deleteMany({ where: { id: { in: inv.userCompanyIds } } }),
    );
  }
  if (inv.userIds.length) {
    await step('User', (tx) =>
      tx.user.deleteMany({ where: { id: { in: inv.userIds } } }),
    );
  }
  if (inv.personIds.length) {
    await step('Person', (tx) =>
      tx.person.deleteMany({ where: { id: { in: inv.personIds } } }),
    );
  }
  if (inv.teamIds.length) {
    await step('Team', (tx) =>
      tx.team.deleteMany({ where: { id: { in: inv.teamIds } } }),
    );
  }

  const totalDeleted = ops.reduce((acc, o) => acc + (o.ok ? o.count : 0), 0);
  const failures = ops.filter((o) => !o.ok);
  return { perTable: ops, totalDeleted, failures };
}

async function main() {
  try {
    const before = await discover();
    if (before === null) return; // prod guard refused

    if (!EXECUTE) {
      return;
    }

    if (before.totalAffected === 0) {
      header('EXECUTE');
      console.log('Nothing to delete — DB already clean.');
      return;
    }

    // Re-check production guard before destructive op (defense in depth;
    // discover() already checked but env can race in CI orchestration).
    const prodMarkers = looksProdLike();
    if (prodMarkers.length > 0 && !CONFIRM_SMOKE_DB) {
      console.error('\n⛔  Production-like env at execute-time — refusing to delete.');
      process.exitCode = 2;
      return;
    }

    const result = await executeDelete(before);

    header('Post-delete verification');
    console.log(`Deleted ${result.totalDeleted} rows across ${result.perTable.length} steps.`);
    if (result.failures.length > 0) {
      console.error(`⚠️  ${result.failures.length} step(s) FAILED:`);
      result.failures.forEach((f) => console.error(`     - ${f.table}: ${f.error}`));
    }

    // Re-run discovery; quiet header so the second pass is visibly the
    // verification, not a fresh inventory.
    const after = await discover({ phaseLabel: 'POST-EXECUTE verification', printBanner: false });
    if (!after) return; // shouldn't happen; prod guard would have fired earlier

    header('Final report');
    console.log(`Before  : ${before.totalAffected} rows`);
    console.log(`Deleted : ${result.totalDeleted} rows`);
    console.log(`After   : ${after.totalAffected} rows`);
    if (after.totalAffected === 0) {
      console.log(`\n✅ Clean — no "${PREFIX}" rows remaining.`);
    } else {
      console.error(`\n⚠️  ${after.totalAffected} rows still match "${PREFIX}". Investigate before re-running.`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('\nScript failed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
