/**
 * WR-NOTIFICATION-CENTER Phase 2A — backfill historical CaseMention rows
 * into the unified Aksiyonlarım inbox.
 *
 * Contract (planning card §5.B + R5 + R6 + R7 + R8.b + backfill scope):
 *   - Scans the last N days (default 30) of `CaseMention`.
 *   - Idempotent: uses the same `buildMentionDedupKey` helper as the
 *     live adapter; reruns produce zero new rows (skipped_dedup grows).
 *   - R6: self-mentions (actor === recipient) skipped on both paths.
 *   - R8.b: emits only when mentioned user has an active UserCompany
 *     for the case's company; otherwise counted in
 *     skipped_no_membership / skipped_inactive_membership.
 *   - R7: state mapping respects old bell read/unread semantics:
 *       CaseMention.seenAt == null  → Pending  (FYI count)
 *       CaseMention.seenAt != null  → Done     (migrated-read; no count)
 *   - Dry-run is the default; --execute is required to write.
 *   - --cleanup mode removes ONLY rows whose dedupKey is owned by this
 *     backfill, identified by the same helper-generated dedupKey set
 *     (still scoped through the same drift checks). We DON'T provide
 *     cleanup here in Phase 2A — backfill is a one-shot, not a
 *     reversible operation; cleanup belongs in retention cron Phase 4.
 *
 * Tenant scope:
 *   --tenant <id|name>  optional. When omitted, ALL tenants are scanned
 *   (operator runs manually; never wired to cron). When supplied, the
 *   value is matched first against Company.id, then Company.name.
 *
 * Report:
 *   {
 *     tenant_scoped: <id|null>,
 *     window_days:   <N>,
 *     scanned:       <int>,
 *     created_pending: <int>,
 *     created_done:    <int>,
 *     skipped_dedup:   <int>,
 *     skipped_self_mention:        <int>,
 *     skipped_no_membership:       <int>,
 *     skipped_inactive_membership: <int>,
 *     dry_run:       <bool>,
 *   }
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-mention-to-inbox.js [options]
 *
 * Flags:
 *   --dry-run         (default; no writes)
 *   --execute         (perform writes)
 *   --tenant <ID|name>
 *   --window-days N   (default 30)
 *   --quiet           (suppress per-skip log noise)
 */

import { prisma } from '../server/db/client.js';
import {
  buildMentionDedupKey,
} from '../server/db/actionItemRepository.js';

// ─────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: true, execute: false, tenant: null, windowDays: 30, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (a === '--quiet') args.quiet = true;
    else if (a === '--tenant') {
      args.tenant = argv[++i] ?? null;
    } else if (a === '--window-days') {
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
Usage: node --env-file=.env scripts/backfill-mention-to-inbox.js [options]

Options:
  --dry-run               (default) report what would be created/skipped
  --execute               write ActionItem rows
  --tenant <id|name>      restrict to a single tenant (matched by id then name)
  --window-days N         default 30; backfill window in days
  --quiet                 suppress per-skip log noise
  --help                  print this message
`);
}

// ─────────────────────────────────────────────────────────────────
// Tenant resolution (optional)
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
// Membership cache — reduces N+1 lookups when many mentions share
// the same (userId, companyId) pair.
// ─────────────────────────────────────────────────────────────────

const membershipCache = new Map(); // key=`${userId}:${companyId}` → 'active'|'inactive'|'missing'

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
    createdAt: { gte: since },
    ...(tenant ? { companyId: tenant.id } : {}),
  };

  const total = await prisma.caseMention.count({ where });
  const report = {
    tenant_scoped: tenant ? tenant.id : null,
    tenant_name: tenant ? tenant.name : null,
    window_days: args.windowDays,
    scanned: 0,
    created_pending: 0,
    created_done: 0,
    skipped_dedup: 0,
    skipped_self_mention: 0,
    skipped_no_membership: 0,
    skipped_inactive_membership: 0,
    dry_run: args.dryRun,
  };

  console.log(
    `🔄 mention-inbox backfill — ${args.dryRun ? 'DRY-RUN' : 'EXECUTE'} — ` +
      `tenant=${tenant ? tenant.name : 'all'} window=${args.windowDays}d scanned-target=${total}`,
  );

  // Stream in batches; bounded memory.
  const PAGE = 500;
  let cursor = null;
  // Snapshot case info (caseNumber, title) once per case for label fill.
  const caseInfoCache = new Map(); // caseId → { caseNumber, title }

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

  // Actor display cache.
  const actorCache = new Map();
  async function actorDisplay(userId) {
    if (actorCache.has(userId)) return actorCache.get(userId);
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
    const disp = u?.fullName || u?.email || 'Kullanıcı';
    actorCache.set(userId, disp);
    return disp;
  }

  // Note content cache (for preview).
  const noteContentCache = new Map();
  async function noteContent(noteId) {
    if (noteContentCache.has(noteId)) return noteContentCache.get(noteId);
    const n = await prisma.caseNote.findUnique({
      where: { id: noteId },
      select: { content: true },
    });
    const c = n?.content ?? '';
    noteContentCache.set(noteId, c);
    return c;
  }

  function buildPreview(raw) {
    if (!raw) return '';
    const stripped = String(raw)
      .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) return '';
    return stripped.length <= 80 ? stripped : stripped.slice(0, 80) + '…';
  }

  // Paginate via cursor on id.
  while (true) {
    const batch = await prisma.caseMention.findMany({
      where,
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        caseId: true,
        noteId: true,
        companyId: true,
        mentionedUserId: true,
        mentionedBy: true,
        seenAt: true,
        createdAt: true,
      },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      report.scanned += 1;
      // R6 — self-mention skip
      if (row.mentionedUserId === row.mentionedBy) {
        report.skipped_self_mention += 1;
        continue;
      }
      // R8.b — UserCompany active membership check
      const verdict = await classifyMembership(row.mentionedUserId, row.companyId);
      if (verdict === 'missing') {
        report.skipped_no_membership += 1;
        continue;
      }
      if (verdict === 'inactive') {
        report.skipped_inactive_membership += 1;
        continue;
      }
      // Idempotency — same dedupKey?
      const dedupKey = buildMentionDedupKey({
        caseId: row.caseId,
        noteId: row.noteId,
        mentionedUserId: row.mentionedUserId,
      });
      const existing = await prisma.actionItem.findUnique({
        where: { dedupKey },
        select: { id: true },
      });
      if (existing) {
        report.skipped_dedup += 1;
        continue;
      }

      // R7 — state mapping.
      //
      // CONTRACT — dry-run report semantics:
      //   created_pending / created_done are "would-create" counts in
      //   --dry-run mode and "actually-created" counts in --execute
      //   mode. The counter increments BEFORE the prisma.create call so
      //   operators see operator-impact preview without writing.
      //   Eligibility / skip / dedup checks run identically in both
      //   modes, so the dry-run impact projection equals the next
      //   --execute outcome (with the same input set).
      const isSeen = !!row.seenAt;
      const c = await caseInfo(row.caseId);
      const display = await actorDisplay(row.mentionedBy);
      const preview = buildPreview(await noteContent(row.noteId));
      const reasonLabel = preview
        ? `@${display} ${c.caseNumber ?? ''} yorumunda senden bahsetti: "${preview}".`.replace(/  +/g, ' ').trim()
        : `@${display} ${c.caseNumber ?? ''} yorumunda senden bahsetti.`.replace(/  +/g, ' ').trim();

      if (isSeen) {
        report.created_done += 1;
        if (!args.dryRun) {
          await prisma.actionItem.create({
            data: {
              kind: 'mention',
              userId: row.mentionedUserId,
              companyId: row.companyId,
              objectType: 'CaseMention',
              objectId: null,
              caseId: row.caseId,
              caseNumber: c.caseNumber,
              caseTitle: c.title,
              generatedBy: `user:${row.mentionedBy}`,
              groupKey: `${row.caseId}:mention`,
              dedupKey,
              priority: 50,
              actionRequired: false,
              reasonLabel,
              state: 'Done',
              doneAt: row.seenAt,
              doneByUserId: row.mentionedUserId,
              doneOutcome: 'migrated-read',
              firstSeenAt: row.seenAt,
              createdAt: row.createdAt,
            },
          });
        }
      } else {
        report.created_pending += 1;
        if (!args.dryRun) {
          await prisma.actionItem.create({
            data: {
              kind: 'mention',
              userId: row.mentionedUserId,
              companyId: row.companyId,
              objectType: 'CaseMention',
              objectId: null,
              caseId: row.caseId,
              caseNumber: c.caseNumber,
              caseTitle: c.title,
              generatedBy: `user:${row.mentionedBy}`,
              groupKey: `${row.caseId}:mention`,
              dedupKey,
              priority: 50,
              actionRequired: false,
              reasonLabel,
              state: 'Pending',
              createdAt: row.createdAt,
            },
          });
        }
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  // Output
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
