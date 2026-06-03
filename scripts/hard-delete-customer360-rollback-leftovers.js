#!/usr/bin/env node
/**
 * Customer 360 — yanlış import sonrası rollback ile pasife alınmış
 * kayıtları HARD-DELETE eden one-off script.
 *
 * Customer 360 commit engine rollback'i soft-deactivate uygular:
 *   account            → isActive=false
 *   accountCompany     → status='inactive'
 *   accountContact     → isActive=false
 *   accountAddress     → Address.isActive=false (companyId guard)
 *   accountProject     → isActive=false, status='Passive'
 *
 * Yanlış import sonrası kullanıcı DB'de bu pasif satırların kalmasını
 * istemiyor. Bu script yalnız:
 *   - ImportJob.targetType = 'customer360'
 *   - ImportJob.status     = 'rolled_back' veya 'rollback_partial'
 *   - ImportJobRow.action  = 'create' (UPDATED rows ASLA silinmez)
 *   - ImportJobRow.status  = 'rolled_back'
 *   - ImportJobRow.recordId IS NOT NULL
 *   - ImportJobRow.beforeJson IS NULL (created row'un öncesi olmaz)
 *   - canlı DB row hâlâ var ve pasif/inactive (rollback'in koyduğu durumda)
 *   - aynı recordId'ye başka job/row UPDATE etmemiş
 *   - (account için) referans veren Case yok
 * koşullarını sağlayan satırları siler.
 *
 * Default DRY-RUN. Silmek için açıkça:
 *   --confirm-hard-delete-customer360-rollback
 * flag'i gerekir. Sahibi bilinmeyen / şüpheli satırlar atlanır ve
 * rapora dahil edilir. Silmeden önce CSV + JSON backup üretilir.
 *
 * Çalıştırma:
 *   List recent C360 rollback/rollback_partial jobs:
 *     node --env-file=.env scripts/hard-delete-customer360-rollback-leftovers.js --list
 *
 *   Dry-run a specific job (no destructive action):
 *     node --env-file=.env scripts/hard-delete-customer360-rollback-leftovers.js --jobId=<id>
 *
 *   Execute (after dry-run review):
 *     node --env-file=.env scripts/hard-delete-customer360-rollback-leftovers.js \
 *       --jobId=<id> --confirm-hard-delete-customer360-rollback
 *
 * Repeat-safe: aynı job için tekrar koşulursa kalan kayıtları siler;
 * silinmişse 0 raporlar. Aynı recordId iki kez silinmez.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../server/db/client.js';

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function value(name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
}

const LIST_MODE = flag('list');
const JOB_ID = value('jobId');
const EXECUTE = flag('confirm-hard-delete-customer360-rollback');
const BACKUP_DIR_OVERRIDE = value('backup-dir');
const NOW = new Date().toISOString().replace(/[:.]/g, '-');

function maskDb(url) {
  if (!url) return '<unset>';
  return url.replace(/:\/\/[^@]*@/, '://***@');
}

function bannerEnv() {
  console.log(`Connected DB: ${maskDb(process.env.DATABASE_URL)}`);
  console.log(`NODE_ENV    : ${process.env.NODE_ENV ?? '<unset>'}`);
  console.log(`VERCEL      : ${process.env.VERCEL ?? '<unset>'}`);
  const looksProd =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL === 'true' ||
    /\bprod(uction)?|\blive\b/i.test(process.env.DATABASE_URL ?? '');
  if (looksProd) {
    console.log(
      '\n⚠️  Production-like environment detected — bu script burada koşulabilir, ' +
        'ancak silmeden önce mutlaka dry-run çıktısını inceleyin.',
    );
  }
}

function header(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`);
}

// ─── List mode ────────────────────────────────────────────────────────
async function listRecentRollbackJobs() {
  bannerEnv();
  header('Recent Customer 360 rollback/rollback_partial jobs');
  const jobs = await prisma.importJob.findMany({
    where: {
      targetType: 'customer360',
      status: { in: ['rolled_back', 'rollback_partial'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      companyId: true,
      status: true,
      fileName: true,
      sourceName: true,
      totalRows: true,
      createCount: true,
      updateCount: true,
      errorCount: true,
      createdAt: true,
      rolledBackAt: true,
    },
  });
  if (jobs.length === 0) {
    console.log('No rollback/rollback_partial Customer 360 jobs found.');
    return;
  }
  for (const j of jobs) {
    console.log(
      `   ${j.id}   companyId=${j.companyId}   status=${j.status.padEnd(16)}   create=${String(
        j.createCount,
      ).padStart(4)}   update=${String(j.updateCount).padStart(4)}   errors=${String(
        j.errorCount,
      ).padStart(4)}   created=${j.createdAt?.toISOString()}   rolledBackAt=${
        j.rolledBackAt?.toISOString() ?? '<null>'
      }   source="${j.fileName ?? j.sourceName ?? ''}"`,
    );
  }
  console.log(
    '\nDry-run a job:\n  node --env-file=.env scripts/hard-delete-customer360-rollback-leftovers.js --jobId=<id>',
  );
}

// ─── Eligibility analyzer ─────────────────────────────────────────────

const DELETE_ORDER = [
  // Reverse FK / cascade order. AccountProject + Address + AccountContact
  // first (children of Account or AccountCompany), then AccountCompany
  // (child of Account but parent of AccountProject), finally Account.
  'accountProject',
  'accountAddress',
  'accountContact',
  'accountCompany',
  'account',
];

function safe(label, fn) {
  return Promise.resolve(fn()).catch((err) => {
    console.error(`   ! ${label} sorgu hatası — ${err?.message ?? err}`);
    return null;
  });
}

async function analyzeJob(jobId) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      targetType: true,
      status: true,
      fileName: true,
      sourceName: true,
      totalRows: true,
      createCount: true,
      updateCount: true,
      errorCount: true,
      entityCountsJson: true,
      createdAt: true,
      rolledBackAt: true,
    },
  });
  if (!job) {
    throw new Error(`ImportJob not found: ${jobId}`);
  }
  if (job.targetType !== 'customer360') {
    throw new Error(
      `Refusing — job ${jobId} targetType="${job.targetType}", expected "customer360".`,
    );
  }
  if (!['rolled_back', 'rollback_partial'].includes(job.status)) {
    throw new Error(
      `Refusing — job ${jobId} status="${job.status}". Hard-delete only supported for ` +
        `rolled_back / rollback_partial.`,
    );
  }

  header('Job summary');
  console.log(`   id              : ${job.id}`);
  console.log(`   companyId       : ${job.companyId}`);
  console.log(`   status          : ${job.status}`);
  console.log(`   source          : ${job.fileName ?? job.sourceName ?? '<n/a>'}`);
  console.log(`   totalRows       : ${job.totalRows}`);
  console.log(`   createCount     : ${job.createCount}`);
  console.log(`   updateCount     : ${job.updateCount}`);
  console.log(`   errorCount      : ${job.errorCount}`);
  console.log(`   createdAt       : ${job.createdAt?.toISOString()}`);
  console.log(`   rolledBackAt    : ${job.rolledBackAt?.toISOString() ?? '<null>'}`);

  // Per-entity eligibility analysis.
  const eligible = {
    account: [],
    accountCompany: [],
    accountContact: [],
    accountAddress: [],
    accountProject: [],
  };
  const skipped = {
    account: [],
    accountCompany: [],
    accountContact: [],
    accountAddress: [],
    accountProject: [],
  };

  // 1) Pull rolled-back created rows per entity.
  const allRollbackRows = await prisma.importJobRow.findMany({
    where: { importJobId: jobId, action: 'create', status: 'rolled_back' },
    select: {
      id: true,
      entityType: true,
      rowNumber: true,
      action: true,
      status: true,
      recordId: true,
      accountId: true,
      beforeJson: true,
      afterJson: true,
      relationshipKey: true,
      matchKey: true,
    },
  });

  // Helper — was this recordId also touched by another job/row as UPDATE?
  // If yes, treat as "do not delete — owned by other history".
  const recordIds = allRollbackRows.map((r) => r.recordId).filter(Boolean);
  const otherUpdaters = recordIds.length
    ? await prisma.importJobRow.findMany({
        where: {
          recordId: { in: recordIds },
          NOT: [{ importJobId: jobId }],
          OR: [{ action: 'update' }, { status: 'updated' }],
        },
        select: { recordId: true, importJobId: true, action: true, status: true },
      })
    : [];
  const otherUpdaterMap = new Map();
  for (const o of otherUpdaters) {
    if (!otherUpdaterMap.has(o.recordId)) otherUpdaterMap.set(o.recordId, []);
    otherUpdaterMap.get(o.recordId).push(o);
  }

  // 2) For each entity in deletion order, classify rows.
  for (const entity of DELETE_ORDER) {
    const rows = allRollbackRows.filter((r) => r.entityType === entity);
    for (const r of rows) {
      const reasons = [];
      if (!r.recordId) reasons.push('recordId is null');
      if (r.beforeJson) reasons.push('beforeJson is set (looks like updated, not created)');
      if (otherUpdaterMap.has(r.recordId)) {
        reasons.push('recordId is also touched by another job as update');
      }

      // Inspect live DB row state.
      let live = null;
      let liveInactive = false;
      let inboundCaseCount = 0;
      try {
        if (entity === 'account') {
          live = await prisma.account.findUnique({
            where: { id: r.recordId },
            select: { id: true, name: true, vkn: true, isActive: true, companyId: true },
          });
          liveInactive = live ? live.isActive === false : false;
          if (live) {
            inboundCaseCount = await prisma.case.count({ where: { accountId: live.id } });
          }
        } else if (entity === 'accountCompany') {
          live = await prisma.accountCompany.findUnique({
            where: { id: r.recordId },
            select: {
              id: true,
              accountId: true,
              companyId: true,
              externalCustomerCode: true,
              status: true,
            },
          });
          liveInactive = live ? live.status === 'inactive' : false;
        } else if (entity === 'accountContact') {
          live = await prisma.accountContact.findUnique({
            where: { id: r.recordId },
            select: { id: true, accountId: true, fullName: true, isActive: true },
          });
          liveInactive = live ? live.isActive === false : false;
        } else if (entity === 'accountAddress') {
          live = await prisma.address.findUnique({
            where: { id: r.recordId },
            select: { id: true, accountId: true, companyId: true, label: true, isActive: true },
          });
          // Must also belong to this job's companyId (commit-time tenant guard).
          if (live && live.companyId !== job.companyId) {
            reasons.push(`Address.companyId=${live.companyId} but job.companyId=${job.companyId}`);
          }
          liveInactive = live ? live.isActive === false : false;
        } else if (entity === 'accountProject') {
          live = await prisma.accountProject.findUnique({
            where: { id: r.recordId },
            select: {
              id: true,
              accountCompanyId: true,
              name: true,
              status: true,
              isActive: true,
            },
          });
          liveInactive = live ? live.isActive === false : false;
        }
      } catch (err) {
        reasons.push(`live row lookup failed: ${err?.message ?? err}`);
      }

      if (!live) {
        reasons.push('live DB row not found (already hard-deleted?)');
      } else if (!liveInactive) {
        reasons.push('live row is currently active (someone may have reactivated it)');
      }
      if (entity === 'account' && inboundCaseCount > 0) {
        reasons.push(`Account is referenced by ${inboundCaseCount} Case row(s)`);
      }

      const item = {
        rowId: r.id,
        rowNumber: r.rowNumber,
        recordId: r.recordId,
        relationshipKey: r.relationshipKey,
        matchKey: r.matchKey,
        live,
        inboundCaseCount,
      };
      if (reasons.length === 0) {
        eligible[entity].push(item);
      } else {
        skipped[entity].push({ ...item, reasons });
      }
    }
  }

  return { job, eligible, skipped };
}

function printAnalysis(eligible, skipped) {
  header('Eligibility per entity (delete order)');
  let totalElig = 0;
  let totalSkip = 0;
  for (const entity of DELETE_ORDER) {
    const e = eligible[entity].length;
    const s = skipped[entity].length;
    totalElig += e;
    totalSkip += s;
    console.log(`   ${entity.padEnd(20)} eligible=${String(e).padStart(4)}  skipped=${String(s).padStart(4)}`);
    if (e > 0) {
      const sample = eligible[entity].slice(0, 5);
      for (const x of sample) {
        const lbl =
          x.live?.name ?? x.live?.label ?? x.live?.fullName ?? x.live?.externalCustomerCode ?? '';
        console.log(`      ✓ ${x.recordId}  row=${x.rowNumber}  "${lbl}"`);
      }
      if (e > 5) console.log(`      … (+${e - 5} more)`);
    }
    if (s > 0) {
      const sample = skipped[entity].slice(0, 5);
      for (const x of sample) {
        console.log(`      ✗ ${x.recordId ?? '<no-recordId>'}  row=${x.rowNumber}  reasons=${JSON.stringify(x.reasons)}`);
      }
      if (s > 5) console.log(`      … (+${s - 5} more)`);
    }
  }
  console.log(`   ${'─'.repeat(50)}`);
  console.log(`   TOTAL                eligible=${String(totalElig).padStart(4)}  skipped=${String(totalSkip).padStart(4)}`);
}

// ─── Backup ───────────────────────────────────────────────────────────

function writeBackup(jobId, job, eligible, skipped, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const meta = {
    jobId,
    jobCompanyId: job.companyId,
    jobStatus: job.status,
    jobRolledBackAt: job.rolledBackAt ?? null,
    capturedAt: new Date().toISOString(),
    args: process.argv.slice(2),
  };
  writeFileSync(`${backupDir}/meta.json`, JSON.stringify(meta, null, 2));
  writeFileSync(`${backupDir}/eligible.json`, JSON.stringify(eligible, null, 2));
  writeFileSync(`${backupDir}/skipped.json`, JSON.stringify(skipped, null, 2));
  // CSV per entity for eligible rows.
  for (const entity of DELETE_ORDER) {
    if (eligible[entity].length === 0) continue;
    const rows = eligible[entity];
    const cols = ['rowId', 'rowNumber', 'recordId', 'relationshipKey', 'matchKey', 'liveJson'];
    const lines = [cols.join(',')];
    for (const r of rows) {
      const cells = [
        r.rowId,
        r.rowNumber,
        r.recordId,
        r.relationshipKey ?? '',
        r.matchKey ?? '',
        JSON.stringify(r.live ?? {}),
      ].map((v) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(cells.join(','));
    }
    writeFileSync(`${backupDir}/eligible.${entity}.csv`, lines.join('\n'));
  }
  return backupDir;
}

// ─── Execute ──────────────────────────────────────────────────────────

async function executeDelete(eligible) {
  // Single transaction. Deletion in reverse FK order — children first.
  const result = { perEntity: {}, total: 0 };
  await prisma.$transaction(async (tx) => {
    for (const entity of DELETE_ORDER) {
      const ids = eligible[entity].map((e) => e.recordId);
      if (ids.length === 0) {
        result.perEntity[entity] = 0;
        continue;
      }
      let count = 0;
      if (entity === 'accountProject') {
        const r = await tx.accountProject.deleteMany({ where: { id: { in: ids } } });
        count = r.count;
      } else if (entity === 'accountAddress') {
        const r = await tx.address.deleteMany({ where: { id: { in: ids } } });
        count = r.count;
      } else if (entity === 'accountContact') {
        const r = await tx.accountContact.deleteMany({ where: { id: { in: ids } } });
        count = r.count;
      } else if (entity === 'accountCompany') {
        const r = await tx.accountCompany.deleteMany({ where: { id: { in: ids } } });
        count = r.count;
      } else if (entity === 'account') {
        const r = await tx.account.deleteMany({ where: { id: { in: ids } } });
        count = r.count;
      }
      result.perEntity[entity] = count;
      result.total += count;
    }
  });
  return result;
}

// ─── Post-verify ──────────────────────────────────────────────────────

async function verifyPostDelete(job, eligible) {
  header('Post-delete verification');
  const probe = { stillThere: 0, gone: 0 };
  for (const entity of DELETE_ORDER) {
    const ids = eligible[entity].map((e) => e.recordId);
    if (ids.length === 0) continue;
    let count = 0;
    if (entity === 'accountProject') {
      count = await prisma.accountProject.count({ where: { id: { in: ids } } });
    } else if (entity === 'accountAddress') {
      count = await prisma.address.count({ where: { id: { in: ids } } });
    } else if (entity === 'accountContact') {
      count = await prisma.accountContact.count({ where: { id: { in: ids } } });
    } else if (entity === 'accountCompany') {
      count = await prisma.accountCompany.count({ where: { id: { in: ids } } });
    } else if (entity === 'account') {
      count = await prisma.account.count({ where: { id: { in: ids } } });
    }
    probe.stillThere += count;
    probe.gone += ids.length - count;
    console.log(`   ${entity.padEnd(20)} still in DB=${count}  gone=${ids.length - count}`);
  }
  // Tenant-wide sanity: active account count must not have decreased
  // unexpectedly (we never touch active rows).
  const activeAccountCount = await prisma.account.count({
    where: { isActive: true, companyId: job.companyId },
  });
  console.log(`   active accounts (companyId=${job.companyId})   = ${activeAccountCount}`);
  return probe;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  try {
    if (LIST_MODE) {
      await listRecentRollbackJobs();
      return;
    }
    if (!JOB_ID) {
      console.error(
        'Usage:\n' +
          '  --list                                              list recent C360 rollback jobs\n' +
          '  --jobId=<id>                                        dry-run for given job\n' +
          '  --jobId=<id> --confirm-hard-delete-customer360-rollback   execute hard-delete\n' +
          '  --backup-dir=<path>                                 override backup destination',
      );
      process.exitCode = 2;
      return;
    }
    bannerEnv();
    console.log(`Mode        : ${EXECUTE ? 'EXECUTE (hard-delete)' : 'DRY-RUN'}`);
    console.log(`Target jobId: ${JOB_ID}`);

    const { job, eligible, skipped } = await analyzeJob(JOB_ID);
    printAnalysis(eligible, skipped);

    const totalElig = DELETE_ORDER.reduce((acc, e) => acc + eligible[e].length, 0);
    if (totalElig === 0) {
      header('Result');
      console.log('No eligible rows — nothing to delete.');
      return;
    }

    // Backup BEFORE delete (also runs in dry-run mode so the operator
    // has a record of what would be removed).
    const backupDir =
      BACKUP_DIR_OVERRIDE ??
      `tmp/c360-hard-delete-backups/${JOB_ID}-${NOW}`;
    writeBackup(JOB_ID, job, eligible, skipped, backupDir);
    header('Backup');
    console.log(`   Wrote backup to: ${backupDir}/`);
    console.log('     - meta.json');
    console.log('     - eligible.json');
    console.log('     - skipped.json');
    console.log('     - eligible.<entity>.csv (per entity)');

    if (!EXECUTE) {
      header('DRY-RUN summary');
      console.log(`Would delete ${totalElig} row(s) across ${DELETE_ORDER.length} table(s).`);
      console.log(
        'Re-run with --confirm-hard-delete-customer360-rollback to actually delete.',
      );
      return;
    }

    header('EXECUTE — single transaction hard-delete (reverse FK order)');
    const beforeActiveAccounts = await prisma.account.count({
      where: { isActive: true, companyId: job.companyId },
    });
    const result = await executeDelete(eligible);
    for (const entity of DELETE_ORDER) {
      console.log(`   ${entity.padEnd(20)} deleted = ${result.perEntity[entity] ?? 0}`);
    }
    console.log(`   ${'─'.repeat(40)}`);
    console.log(`   TOTAL                deleted = ${result.total}`);

    const probe = await verifyPostDelete(job, eligible);
    if (probe.stillThere > 0) {
      console.error(
        `\n⚠️  ${probe.stillThere} rows are still present after delete — investigate.`,
      );
      process.exitCode = 1;
    }
    const afterActiveAccounts = await prisma.account.count({
      where: { isActive: true, companyId: job.companyId },
    });
    if (afterActiveAccounts !== beforeActiveAccounts) {
      console.error(
        `\n⚠️  Active account count for companyId=${job.companyId} changed: ${beforeActiveAccounts} → ${afterActiveAccounts}. Investigate.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `\n✅ Active account count for companyId=${job.companyId} unchanged (${afterActiveAccounts}).`,
      );
    }
  } catch (err) {
    console.error('\nScript failed:', err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
