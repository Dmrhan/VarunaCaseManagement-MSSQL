/**
 * inspect-phase1-rollback-target.js
 *
 * Read-only audit for the "Phase 1 rollback hit the wrong job" incident.
 * Run by the user/operator manually; this script does NOT mutate the DB
 * and prints PII (account names + before/after JSON snapshots) only when
 * --verbose is passed. Without --verbose the output is just ids + counts.
 *
 * Usage:
 *   node --env-file=.env scripts/inspect-phase1-rollback-target.js
 *   node --env-file=.env scripts/inspect-phase1-rollback-target.js --verbose
 *   node --env-file=.env scripts/inspect-phase1-rollback-target.js --name "ABALIO" --name "Acme Demo"
 *
 * Flags:
 *   --verbose       Print account names in matches. Off by default to keep
 *                   PII out of logs/screenshots.
 *   --name <substr> Repeatable. Override the default name substrings to
 *                   search for. Default set targets the reported incident:
 *                   ABALIO, Acme Demo, Beta Demo, Gamma Demo.
 *   --limit <n>     Max matches per query (default 20).
 */

import { prisma } from '../server/db/client.js';

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return 20;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 20;
})();
const customNames = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && typeof args[i + 1] === 'string') customNames.push(args[i + 1]);
}
const NAME_NEEDLES = customNames.length > 0 ? customNames : ['ABALIO', 'Acme Demo', 'Beta Demo', 'Gamma Demo'];

function maskName(s) {
  if (!s) return '(empty)';
  if (VERBOSE) return s;
  if (s.length <= 2) return '*'.repeat(s.length);
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(1, s.length - 4))}${s.slice(-2)}`;
}

function header(title) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

async function main() {
  header(`Phase 1 rollback target audit  (verbose=${VERBOSE})`);

  // 1) Account matches (one row per needle).
  header('1) Account rows matching configured needles');
  for (const needle of NAME_NEEDLES) {
    const rows = await prisma.account.findMany({
      where: { name: { contains: needle } },
      orderBy: [{ createdAt: 'desc' }],
      take: LIMIT,
      select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true },
    });
    console.log(`  needle="${needle}" — ${rows.length} match(es)`);
    for (const r of rows) {
      console.log(`    id=${r.id}  isActive=${r.isActive}  created=${r.createdAt?.toISOString()}  updated=${r.updatedAt?.toISOString()}  name=${maskName(r.name)}`);
    }
  }

  // 2) ImportJobRow rows whose snapshots reference any needle.
  // Pure-id output (no JSON dump). Verbose adds the matched account name.
  header('2) ImportJobRow rows whose snapshot mentions any needle');
  const ilikeClauses = NAME_NEEDLES.map((_, i) => `"afterJson"::text ILIKE $${i + 1} OR "beforeJson"::text ILIKE $${i + 1}`).join(' OR ');
  const params = NAME_NEEDLES.map((n) => `%${n}%`);
  const sql = `
    SELECT r."importJobId",
           r."rowNumber",
           r."status",
           r."accountId",
           j."targetType",
           j."fileName",
           j."sourceName",
           j."companyId",
           j."status" AS "jobStatus",
           j."createdAt",
           j."completedAt",
           j."rolledBackAt",
           r."afterJson"::text  AS after_text,
           r."beforeJson"::text AS before_text
    FROM "ImportJobRow" r
    JOIN "ImportJob"    j ON j.id = r."importJobId"
    WHERE ${ilikeClauses}
    ORDER BY j."createdAt" DESC, r."rowNumber" ASC
    LIMIT ${LIMIT}
  `;
  const matches = await prisma.$queryRawUnsafe(sql, ...params);
  const byJob = new Map();
  for (const m of matches) {
    const list = byJob.get(m.importJobId) ?? { meta: m, rows: [] };
    list.rows.push(m);
    byJob.set(m.importJobId, list);
  }
  for (const [jobId, { meta, rows }] of byJob) {
    console.log(`  job=${jobId}  targetType=${meta.targetType}  jobStatus=${meta.jobStatus}  rolledBackAt=${meta.rolledBackAt ? meta.rolledBackAt.toISOString() : 'no'}  completed=${meta.completedAt ? meta.completedAt.toISOString() : 'no'}  file=${meta.fileName ?? meta.sourceName ?? '—'}  company=${meta.companyId}  matches=${rows.length}`);
    for (const r of rows) {
      const after = r.after_text ? JSON.parse(r.after_text) : null;
      const before = r.before_text ? JSON.parse(r.before_text) : null;
      const name = (after && after.name) || (before && before.name) || null;
      console.log(`    row=${r.rowNumber}  status=${r.status}  accountId=${r.accountId ?? '—'}  name=${maskName(name)}`);
    }
  }

  // 3) Cross-target sanity: any Customer 360 jobs in the same companies?
  header('3) Customer 360 jobs in the same companies (cross-target check)');
  const companyIds = [...new Set([...byJob.values()].map((v) => v.meta.companyId))];
  if (companyIds.length === 0) {
    console.log('  (no companies found from step 2)');
  } else {
    const c360 = await prisma.importJob.findMany({
      where: { companyId: { in: companyIds }, targetType: 'customer360' },
      orderBy: [{ createdAt: 'desc' }],
      take: LIMIT,
      select: { id: true, companyId: true, status: true, createdAt: true, completedAt: true, rolledBackAt: true, fileName: true, sourceName: true },
    });
    console.log(`  ${c360.length} Customer 360 job(s) found`);
    for (const j of c360) {
      console.log(`    id=${j.id}  company=${j.companyId}  status=${j.status}  rolledBackAt=${j.rolledBackAt ? j.rolledBackAt.toISOString() : 'no'}  file=${j.fileName ?? j.sourceName ?? '—'}`);
    }
  }

  // 4) Suggested verdict.
  header('4) Verdict hint');
  console.log('  Compare the targetType of jobs above with the wizard the operator was using.');
  console.log('  - If the rolled-back ImportJob has targetType="customer360" but the operator');
  console.log('    was in the Müşteri Ana Kartı wizard, the legacy unfiltered HistoryPanel +');
  console.log('    unguarded rollback route caused a cross-target hit (now fixed at code level).');
  console.log('  - If targetType matches and rolledBackAt is set on a different job than the');
  console.log('    one the operator believed they were viewing, that points to stale UI state');
  console.log('    that also benefits from the new defensive id-mismatch guard.');
  console.log('  - Re-run with --verbose to see exact account names.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[ERROR]', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
