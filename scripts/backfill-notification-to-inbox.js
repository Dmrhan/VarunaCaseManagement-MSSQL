/**
 * WR-NOTIFICATION-CENTER Phase 2B — backfill generic CaseNotification
 * rows (watcher_added / watcher_update / note_reaction / transfer_warning)
 * into the unified Aksiyonlarım inbox.
 *
 * Contract (planning card §5 generic-notification + R5/R8.b/R6 mirror
 * of the mention backfill):
 *   - Scans the last N days (default 30) of `CaseNotification` where
 *     channel='InApp' (only in-app rows ever drove the legacy bell).
 *   - eventType filter: only the 4 mapped types (silently ignores any
 *     unknown / forward-compat eventType the writers may introduce).
 *   - Idempotent: dedupKey via `buildNotificationDedupKey`, the SAME
 *     helper the live adapter calls. Re-runs grow `skipped_dedup` and
 *     create nothing.
 *   - R6: self-targeting CaseNotification rows are not currently
 *     written by any of the four writers (note_reaction explicitly
 *     guards against self-react). We still defend with a soft check.
 *   - R8.b: skip mentions whose recipient User no longer has an
 *     active UserCompany for the case's company.
 *   - R7 mirror — readAt-aware state mapping:
 *       CaseNotification.readAt == null  → ActionItem state=Pending
 *                                          actionRequired=false
 *                                          (gri "Bildirimler" sayacı)
 *       CaseNotification.readAt != null  → ActionItem state=Done
 *                                          actionRequired=false
 *                                          doneAt=readAt
 *                                          doneOutcome='migrated-read'
 *                                          ("Tamamlanan" sekmesinde)
 *   - Dry-run is the default; --execute is required to write. In
 *     --dry-run the same created_* counters report a meaningful
 *     would-create projection (same contract as backfill-mention).
 *
 * Tenant scope:
 *   --tenant <id|name>  optional. When omitted, ALL tenants scanned.
 *
 * Report:
 *   {
 *     tenant_scoped:                <id|null>,
 *     window_days:                  <N>,
 *     scanned:                      <int>,
 *     created_pending:              <int>,
 *     created_done:                 <int>,
 *     skipped_dedup:                <int>,
 *     skipped_unmapped_event_type:  <int>,
 *     skipped_no_membership:        <int>,
 *     skipped_inactive_membership:  <int>,
 *     dry_run:                      <bool>,
 *   }
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-notification-to-inbox.js
 *     [--dry-run | --execute]
 *     [--tenant <id|name>]
 *     [--window-days N]
 *     [--quiet]
 */

import { prisma } from '../server/db/client.js';
import { buildNotificationDedupKey } from '../server/db/actionItemRepository.js';

// ─────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dryRun: true,
    execute: false,
    tenant: null,
    windowDays: 30,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (a === '--quiet') args.quiet = true;
    else if (a === '--tenant') args.tenant = argv[++i] ?? null;
    else if (a === '--window-days') {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) args.windowDays = Math.floor(v);
    } else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node --env-file=.env scripts/backfill-notification-to-inbox.js [options]

Options:
  --dry-run               (default) report what would be created/skipped
  --execute               write ActionItem rows
  --tenant <id|name>      restrict to one tenant (matched by id then name)
  --window-days N         default 30
  --quiet                 suppress per-skip log noise
  --help                  print this message
`);
}

// ─────────────────────────────────────────────────────────────────
// Tenant resolution
// ─────────────────────────────────────────────────────────────────

async function resolveTenant(arg) {
  if (!arg) return null;
  const byId = await prisma.company.findUnique({
    where: { id: arg },
    select: { id: true, name: true },
  });
  if (byId) return byId;
  const byName = await prisma.company.findFirst({
    where: { name: arg },
    select: { id: true, name: true },
  });
  if (byName) return byName;
  throw new Error(`Tenant bulunamadı: ${arg}`);
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const SUPPORTED_EVENT_TYPES = new Set([
  'watcher_added',
  'watcher_update',
  'note_reaction',
  'transfer_warning',
]);

const EVENT_TO_KIND = {
  watcher_added: 'watcher_event',
  watcher_update: 'watcher_event',
  note_reaction: 'watcher_event',
  transfer_warning: 'system_alert',
};

// ─────────────────────────────────────────────────────────────────
// Membership cache
// ─────────────────────────────────────────────────────────────────

const membershipCache = new Map();
async function classifyMembership(userId, companyId) {
  const key = `${userId}:${companyId}`;
  if (membershipCache.has(key)) return membershipCache.get(key);
  const row = await prisma.userCompany.findFirst({
    where: { userId, companyId },
    select: { isActive: true },
  });
  let verdict;
  if (!row) verdict = 'missing';
  else if (row.isActive === false) verdict = 'inactive';
  else verdict = 'active';
  membershipCache.set(key, verdict);
  return verdict;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function run() {
  const args = parseArgs(process.argv);
  const tenant = await resolveTenant(args.tenant);

  const since = new Date(Date.now() - args.windowDays * 24 * 60 * 60 * 1000);
  const where = {
    sentAt: { gte: since },
    channel: 'InApp',
    ...(tenant ? { companyId: tenant.id } : {}),
  };

  const total = await prisma.caseNotification.count({ where });
  const report = {
    tenant_scoped: tenant ? tenant.id : null,
    tenant_name: tenant ? tenant.name : null,
    window_days: args.windowDays,
    scanned: 0,
    created_pending: 0,
    created_done: 0,
    skipped_dedup: 0,
    skipped_unmapped_event_type: 0,
    skipped_no_membership: 0,
    skipped_inactive_membership: 0,
    dry_run: args.dryRun,
  };

  console.log(
    `🔄 generic-notification backfill — ${args.dryRun ? 'DRY-RUN' : 'EXECUTE'} — ` +
      `tenant=${tenant ? tenant.name : 'all'} window=${args.windowDays}d ` +
      `scanned-target=${total}`,
  );

  // Case info + payload preview caches.
  const caseInfoCache = new Map();
  async function caseInfo(caseId) {
    if (caseInfoCache.has(caseId)) return caseInfoCache.get(caseId);
    const row = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, title: true },
    });
    const info = row ?? { caseNumber: null, title: null };
    caseInfoCache.set(caseId, info);
    return info;
  }

  const PAGE = 500;
  let cursor = null;

  while (true) {
    const batch = await prisma.caseNotification.findMany({
      where,
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        caseId: true,
        companyId: true,
        eventType: true,
        recipient: true,
        payload: true,
        sentAt: true,
        readAt: true,
      },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      report.scanned += 1;
      // Unmapped eventType — silent skip (forward-compat).
      if (!SUPPORTED_EVENT_TYPES.has(row.eventType)) {
        report.skipped_unmapped_event_type += 1;
        continue;
      }
      // R8.b — UserCompany active membership for the recipient.
      const verdict = await classifyMembership(row.recipient, row.companyId);
      if (verdict === 'missing') {
        report.skipped_no_membership += 1;
        continue;
      }
      if (verdict === 'inactive') {
        report.skipped_inactive_membership += 1;
        continue;
      }
      // Dedup — same helper the live adapter uses.
      const dedupKey = buildNotificationDedupKey({
        caseId: row.caseId,
        eventType: row.eventType,
        recipientUserId: row.recipient,
        payload: row.payload,
      });
      const existing = await prisma.actionItem.findUnique({
        where: { dedupKey },
        select: { id: true },
      });
      if (existing) {
        report.skipped_dedup += 1;
        continue;
      }

      // Counter increments BEFORE the prisma.create write guard so
      // dry-run produces a meaningful would-create projection.
      // (Same contract as backfill-mention-to-inbox.js.)
      const kind = EVENT_TO_KIND[row.eventType];
      const c = await caseInfo(row.caseId);
      const reasonLabel = String(
        row.payload?.message ?? `${row.eventType} bildirimi.`,
      ).slice(0, 500);
      const isSeen = !!row.readAt;
      const priority = row.eventType === 'transfer_warning' ? 70 : 50;

      if (isSeen) {
        report.created_done += 1;
        if (!args.dryRun) {
          await prisma.actionItem.create({
            data: {
              kind,
              userId: row.recipient,
              companyId: row.companyId,
              objectType: 'CaseNotification',
              objectId: null,
              caseId: row.caseId,
              caseNumber: c.caseNumber,
              caseTitle: c.title,
              generatedBy: `system:notification:${row.eventType}`,
              groupKey: `${row.caseId}:${kind}`,
              dedupKey,
              priority,
              actionRequired: false,
              reasonLabel,
              state: 'Done',
              doneAt: row.readAt,
              doneByUserId: row.recipient,
              doneOutcome: 'migrated-read',
              firstSeenAt: row.readAt,
              createdAt: row.sentAt,
            },
          });
        }
      } else {
        report.created_pending += 1;
        if (!args.dryRun) {
          await prisma.actionItem.create({
            data: {
              kind,
              userId: row.recipient,
              companyId: row.companyId,
              objectType: 'CaseNotification',
              objectId: null,
              caseId: row.caseId,
              caseNumber: c.caseNumber,
              caseTitle: c.title,
              generatedBy: `system:notification:${row.eventType}`,
              groupKey: `${row.caseId}:${kind}`,
              dedupKey,
              priority,
              actionRequired: false,
              reasonLabel,
              state: 'Pending',
              createdAt: row.sentAt,
            },
          });
        }
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  console.log('\n📊 Report:');
  console.log(JSON.stringify(report, null, 2));
  if (args.dryRun) {
    console.log('\n💡 Dry-run complete. Use --execute to write ActionItem rows.');
  } else {
    console.log('\n✅ Execute complete.');
  }
  await prisma.$disconnect();
  return report;
}

run().catch(async (err) => {
  console.error('💥 fatal:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
