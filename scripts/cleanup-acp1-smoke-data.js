#!/usr/bin/env node
/**
 * ACP1 (action-center-phase1) smoke data cleanup — DRY RUN default;
 * --execute opt-in.
 *
 * scripts/smoke-action-center-phase1.js interrupt edildiğinde
 * finally{} cleanup'ı çalışmaz ve `acp1_${Date.now()}` prefix'li
 * Team / Person / User / UserCompany / Case + transitive ActionItem /
 * CaseResolutionApproval / CaseActivity / CaseNote / CaseMention /
 * CaseNotification / CaseWatcher / NotificationDispatch +
 * ResolutionApprovalPolicy satırları DB'de kalır.
 *
 * Bu script:
 *   • Acp1 prefix'li tüm leaked entity'leri tarar
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
 *   --prefix=acp1_     smoke prefix (default acp1_; gnf_/mif_/mir_/cns_
 *                      de kullanılabilir ama bu script'in DELETE plan'ı
 *                      ACP1 tablolarına optimize)
 *   --confirm-smoke-db prod-like DB güvenlik kontrolünü açıkça onayla
 *                      (NODE_ENV=production veya VERCEL=1 ise yine red)
 *
 * Run:
 *   node --env-file=.env scripts/cleanup-acp1-smoke-data.js
 *   node --env-file=.env scripts/cleanup-acp1-smoke-data.js --execute
 */

import { prisma } from '../server/db/client.js';

const args = process.argv.slice(2);
const PREFIX =
  args.find((a) => a.startsWith('--prefix='))?.slice('--prefix='.length) ?? 'acp1_';
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
    console.log(`🔍 ACP1 smoke data — ${phaseLabel} (prefix="${PREFIX}")`);
    console.log(`Connected DB: ${maskDbUrl(process.env.DATABASE_URL)}`);
    console.log(`NODE_ENV    : ${process.env.NODE_ENV ?? '<unset>'}`);
    console.log(`VERCEL      : ${process.env.VERCEL ?? '<unset>'}`);
  }

  const prodMarkers = looksProdLike();
  if (prodMarkers.length > 0) {
    console.log('\n⛔  Production-like environment detected:');
    prodMarkers.forEach((r) => console.log(`     - ${r}`));
    if (!CONFIRM_SMOKE_DB) {
      console.log('\nRefusing without --confirm-smoke-db.');
      process.exitCode = 2;
      return null;
    }
    console.log('\n--confirm-smoke-db passed; proceeding.');
  }

  const startsWith = { startsWith: PREFIX };

  header('Discovery — root entities (prefix-matched)');

  const teams = await prisma.team.findMany({
    where: { name: startsWith },
    select: { id: true, name: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Team                  : ${teams.length}`);
  teams.slice(0, PRINT_SAMPLE).forEach((t) =>
    console.log(`   ${fmtRow(t, ['name', 'companyId', 'createdAt'])}`),
  );

  const persons = await prisma.person.findMany({
    where: { OR: [{ name: startsWith }, { email: startsWith }] },
    select: { id: true, name: true, email: true, teamId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Person                : ${persons.length}`);
  persons.slice(0, PRINT_SAMPLE).forEach((p) =>
    console.log(`   ${fmtRow(p, ['name', 'email', 'teamId'])}`),
  );

  const users = await prisma.user.findMany({
    where: { OR: [{ email: startsWith }, { fullName: startsWith }] },
    select: { id: true, email: true, fullName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`User                  : ${users.length}`);
  users.slice(0, PRINT_SAMPLE).forEach((u) =>
    console.log(`   ${fmtRow(u, ['email', 'fullName'])}`),
  );

  const cases = await prisma.case.findMany({
    where: { title: startsWith },
    select: { id: true, caseNumber: true, title: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Case                  : ${cases.length}`);
  cases.slice(0, PRINT_SAMPLE).forEach((c) =>
    console.log(`   ${fmtRow(c, ['caseNumber', 'title', 'companyId', 'createdAt'])}`),
  );

  const policies = await prisma.resolutionApprovalPolicy.findMany({
    where: { name: startsWith },
    select: { id: true, name: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`ResolutionApprovalPolicy: ${policies.length}`);
  policies.slice(0, PRINT_SAMPLE).forEach((p) =>
    console.log(`   ${fmtRow(p, ['name', 'companyId'])}`),
  );

  const userIds = users.map((u) => u.id);
  const caseIds = cases.map((c) => c.id);
  const teamIds = teams.map((t) => t.id);
  const personIds = persons.map((p) => p.id);
  const policyIds = policies.map((p) => p.id);

  header('Discovery — transitive children (by caseId / userId / policyId)');

  const userCompanies = userIds.length
    ? await prisma.userCompany.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true, companyId: true, isActive: true },
      })
    : [];
  console.log(`UserCompany           : ${userCompanies.length}`);

  // ActionItem: caseId OR userId (the leak-tenant fixtures use userId in our set)
  const actionItems = caseIds.length || userIds.length
    ? await prisma.actionItem.findMany({
        where: {
          OR: [
            ...(caseIds.length ? [{ caseId: { in: caseIds } }] : []),
            ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ],
        },
        select: { id: true, kind: true, caseId: true, userId: true, state: true },
      })
    : [];
  console.log(`ActionItem            : ${actionItems.length}`);
  actionItems.slice(0, PRINT_SAMPLE).forEach((a) =>
    console.log(`   ${fmtRow(a, ['kind', 'caseId', 'userId', 'state'])}`),
  );

  const approvals = caseIds.length
    ? await prisma.caseResolutionApproval.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, policyId: true, state: true },
      })
    : [];
  console.log(`CaseResolutionApproval: ${approvals.length}`);
  approvals.slice(0, PRINT_SAMPLE).forEach((a) =>
    console.log(`   ${fmtRow(a, ['caseId', 'policyId', 'state'])}`),
  );

  const dispatches = caseIds.length
    ? await prisma.notificationDispatch.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true },
      })
    : [];
  console.log(`NotificationDispatch  : ${dispatches.length}`);

  const notifications = caseIds.length
    ? await prisma.caseNotification.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, eventType: true },
      })
    : [];
  console.log(`CaseNotification      : ${notifications.length}`);

  const watchers = caseIds.length
    ? await prisma.caseWatcher.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, userId: true },
      })
    : [];
  console.log(`CaseWatcher           : ${watchers.length}`);

  const notes = caseIds.length
    ? await prisma.caseNote.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true, parentNoteId: true },
      })
    : [];
  console.log(`CaseNote              : ${notes.length}`);

  const mentions = caseIds.length
    ? await prisma.caseMention.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, caseId: true },
      })
    : [];
  console.log(`CaseMention           : ${mentions.length}`);

  const activitiesCount = caseIds.length
    ? await prisma.caseActivity.count({ where: { caseId: { in: caseIds } } })
    : 0;
  console.log(`CaseActivity          : ${activitiesCount} (count only)`);

  // Phase 2 delete order
  header('Phase 2 — proposed DELETE order (reverse FK)');
  const plan = [
    ['ActionItem',              actionItems.length],
    ['NotificationDispatch',    dispatches.length],
    ['CaseResolutionApproval',  approvals.length],
    ['CaseActivity',            activitiesCount],
    ['CaseMention',             mentions.length],
    ['CaseNotification',        notifications.length],
    ['CaseWatcher',             watchers.length],
    ['CaseNote',                notes.length],
    ['Case',                    cases.length],
    ['ResolutionApprovalPolicy', policies.length],
    ['UserCompany',             userCompanies.length],
    ['User',                    users.length],
    ['Person',                  persons.length],
    ['Team',                    teams.length],
  ];
  for (const [table, count] of plan) {
    console.log(`   ${String(count).padStart(5, ' ')}  ${table}`);
  }
  const totalAffected = plan.reduce((acc, [, n]) => acc + (typeof n === 'number' ? n : 0), 0);
  console.log(`   ${'─'.repeat(40)}`);
  console.log(`   ${String(totalAffected).padStart(5, ' ')}  TOTAL`);

  header('Summary');
  if (totalAffected === 0) {
    console.log(`✓ No leaked "${PREFIX}" data found.`);
  } else {
    console.log(`Found ${totalAffected} leaked rows across ${plan.length} tables.`);
    if (!EXECUTE) {
      console.log('No data was deleted. Re-run with --execute to delete.');
    }
  }

  return {
    teamIds, personIds, userIds, caseIds, policyIds,
    userCompanyIds: userCompanies.map((u) => u.id),
    actionItemIds: actionItems.map((a) => a.id),
    approvalIds: approvals.map((a) => a.id),
    dispatchIds: dispatches.map((d) => d.id),
    notificationIds: notifications.map((n) => n.id),
    watcherIds: watchers.map((w) => w.id),
    noteIds: notes.map((n) => n.id),
    mentionIds: mentions.map((m) => m.id),
    activitiesCount,
    totalAffected,
  };
}

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

  if (inv.caseIds.length || inv.actionItemIds.length || inv.userIds.length) {
    if (inv.actionItemIds.length) {
      await step('ActionItem (by id)', (tx) =>
        tx.actionItem.deleteMany({ where: { id: { in: inv.actionItemIds } } }),
      );
    }
    if (inv.caseIds.length) {
      await step('ActionItem (by caseId)', (tx) =>
        tx.actionItem.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('NotificationDispatch', (tx) =>
        tx.notificationDispatch.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('CaseResolutionApproval', (tx) =>
        tx.caseResolutionApproval.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('CaseActivity', (tx) =>
        tx.caseActivity.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('CaseMention', (tx) =>
        tx.caseMention.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('CaseNotification', (tx) =>
        tx.caseNotification.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
      await step('CaseWatcher', (tx) =>
        tx.caseWatcher.deleteMany({ where: { caseId: { in: inv.caseIds } } }),
      );
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
  }
  if (inv.policyIds.length) {
    await step('ResolutionApprovalPolicy', (tx) =>
      tx.resolutionApprovalPolicy.deleteMany({ where: { id: { in: inv.policyIds } } }),
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
    if (before === null) return;
    if (!EXECUTE) return;
    if (before.totalAffected === 0) {
      header('EXECUTE');
      console.log('Nothing to delete.');
      return;
    }
    const prodMarkers = looksProdLike();
    if (prodMarkers.length > 0 && !CONFIRM_SMOKE_DB) {
      console.error('\n⛔  Production-like env at execute-time — refusing.');
      process.exitCode = 2;
      return;
    }
    const result = await executeDelete(before);
    header('Post-delete verification');
    console.log(`Deleted ${result.totalDeleted} rows.`);
    if (result.failures.length > 0) {
      console.error(`⚠️  ${result.failures.length} step(s) FAILED:`);
      result.failures.forEach((f) => console.error(`     - ${f.table}: ${f.error}`));
    }
    const after = await discover({ phaseLabel: 'POST-EXECUTE verification', printBanner: false });
    if (!after) return;
    header('Final report');
    console.log(`Before  : ${before.totalAffected} rows`);
    console.log(`Deleted : ${result.totalDeleted} rows`);
    console.log(`After   : ${after.totalAffected} rows`);
    if (after.totalAffected === 0) {
      console.log(`\n✅ Clean — no "${PREFIX}" rows remaining.`);
    } else {
      console.error(`\n⚠️  ${after.totalAffected} rows still match "${PREFIX}".`);
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
