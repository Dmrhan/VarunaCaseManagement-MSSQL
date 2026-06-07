#!/usr/bin/env node
/**
 * smoke-c360-commit-uses-full-rows.js
 *
 * Verifies the persistence bug fix in customer360CommitEngine.persistJob:
 * commit must source ImportJobRow inserts from the FULL normalized row
 * collection, not from `dryRun.preview` (which is UI-capped at 100/entity).
 *
 *   PART A — pure dry-run shape (no DB):
 *     - >100 account fixture → dryRun.preview.account.length === 100 (UI cap)
 *     - dryRun.rowsForCommit.account.length === total source rows (full)
 *     - rowsForCommit preserves rowNumber + normalized + errors + warnings
 *       + shouldSkip
 *     - preview is a strict prefix of rowsForCommit (slice 0..100 equivalence)
 *
 *   PART B — source-grep guardrails:
 *     - dryRun emits `rowsForCommit` field
 *     - persistJob references rowsForCommit (not preview as primary)
 *     - preview UI cap (slice(0, 100)) still present
 *
 *   PART C — runtime persistJob behavior (DB required; graceful skip):
 *     - persist a 150-account fixture
 *     - ImportJobRow count for entityType='account' === 150 (NOT 100)
 *
 * Run: node --env-file=.env scripts/smoke-c360-commit-uses-full-rows.js
 */
import fs from 'node:fs';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── PART A — pure dry-run shape ──────────────────────────────────────────

const { dryRunCustomer360 } = await import('../server/lib/import/customer360DryRun.js');

function makeAccountRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    recordNo: `R${i + 1}`,
    name: `SmokeCust-${String(i + 1).padStart(4, '0')}`,
    vkn: '',
  }));
}

function makeEntities(rows) {
  const out = {};
  for (const [k, v] of Object.entries(rows)) {
    const cols = [...new Set(v.flatMap((r) => Object.keys(r)))];
    out[k] = { columns: cols, mapping: cols.map((c) => ({ source: c, targetKey: c })), rows: v };
  }
  return out;
}

let dryRun = null;
try {
  // dryRunCustomer360 reads Prisma for existing-VKN match. With all blank
  // VKNs we still hit Prisma — graceful skip if DB unreachable, then
  // PART A is partly covered by source-grep in PART B.
  const FIXTURE_N = 150;
  dryRun = await dryRunCustomer360({
    companyId: '__smoke_company__',
    allowedCompanyIds: ['__smoke_company__'],
    entities: makeEntities({ account: makeAccountRows(FIXTURE_N) }),
    sourceMeta: { sourceType: 'file', fileName: 'smoke-150-accounts.xlsx' },
  });
  record('A0: dryRun returned', !!dryRun);
} catch (err) {
  console.log(`[smoke] DB unreachable → PART A runtime skipped (${err?.message || err}).`);
  dryRun = null;
}

if (dryRun) {
  record('A1: preview.account.length === 100 (UI cap intact)', dryRun.preview?.account?.length === 100, `got ${dryRun.preview?.account?.length}`);
  record('A2: rowsForCommit.account.length === 150 (full)', dryRun.rowsForCommit?.account?.length === 150, `got ${dryRun.rowsForCommit?.account?.length}`);

  // Field shape on rowsForCommit
  const first = dryRun.rowsForCommit?.account?.[0];
  record(
    'A3: rowsForCommit entries carry rowNumber/normalized/errors/warnings/shouldSkip',
    first &&
      typeof first.rowNumber === 'number' &&
      typeof first.normalized === 'object' &&
      Array.isArray(first.errors) &&
      Array.isArray(first.warnings) &&
      typeof first.shouldSkip === 'boolean',
  );

  // preview is the slice(0,100) of rowsForCommit
  const previewLast = dryRun.preview.account[99];
  const fullAt99 = dryRun.rowsForCommit.account[99];
  record(
    'A4: preview is a prefix of rowsForCommit (entry 100 matches)',
    previewLast?.rowNumber === fullAt99?.rowNumber && previewLast?.normalized?.name === fullAt99?.normalized?.name,
  );

  // Confirm row 101..150 exist only in rowsForCommit
  const row101 = dryRun.rowsForCommit.account[100];
  record('A5: row index 100 (the 101st) exists in rowsForCommit', !!row101 && typeof row101.rowNumber === 'number');
  record('A5b: that index does NOT exist in preview', dryRun.preview.account[100] === undefined);
}

// ─── PART B — source-grep guardrails ──────────────────────────────────────

const dryRunSrc = fs.readFileSync('server/lib/import/customer360DryRun.js', 'utf8');
record('B1: dryRun emits `rowsForCommit` field', /\browsForCommit\b/.test(dryRunSrc) && /rowsForCommit,\n/.test(dryRunSrc));
record('B2: preview still slice(0, 100)', /preview\[ek\] = fullMapped\.slice\(0, 100\)/.test(dryRunSrc));
record('B3: preview marked UI-ONLY in comment', /UI-ONLY|UI display/.test(dryRunSrc));

const commitSrc = fs.readFileSync('server/lib/import/customer360CommitEngine.js', 'utf8');
record('B4: persistJob references rowsForCommit', /dryRun\.rowsForCommit/.test(commitSrc));
record(
  'B5: persistJob no longer reads dryRun.preview as primary source',
  !/for \(const r of dryRun\.preview\?\.account \?\? \[\]\) \{/.test(commitSrc) &&
    !/dryRun\.preview\?\.\[entity\] \?\? \[\]/.test(commitSrc),
);
record('B6: explanatory comment present', /BUG FIX|persistJob.*preview|capped at the first 100/.test(commitSrc));

// ─── PART C — DB runtime: persist 150-row job, check ImportJobRow count ──

if (!dryRun) {
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

let prisma = null;
try {
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$queryRaw`SELECT 1`;
} catch (err) {
  console.log(`[smoke] DB unreachable → PART C skipped (${err?.message || err}).`);
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

let scopeCompany = null;
try {
  scopeCompany = await prisma.company.findFirst({ select: { id: true } });
} catch { /* ignore */ }
if (!scopeCompany) {
  console.log('[smoke] No company in DB → PART C skipped.');
  await prisma.$disconnect();
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

const TAG = `FULLROW-${process.pid}`;
const createdJobIds = [];
const createdAccountIds = [];

try {
  // Re-run dry-run scoped to a real company so engine reads existingByVkn etc.
  const FIXTURE_N = 150;
  const realDryRun = await dryRunCustomer360({
    companyId: scopeCompany.id,
    allowedCompanyIds: [scopeCompany.id],
    entities: makeEntities({
      account: Array.from({ length: FIXTURE_N }, (_, i) => ({
        recordNo: `RC${i + 1}`,
        name: `${TAG}-${String(i + 1).padStart(4, '0')}`,
        vkn: '',
      })),
    }),
    sourceMeta: { sourceType: 'file', fileName: `${TAG}.xlsx` },
  });
  record('C0: real-company dryRun returned with rowsForCommit', !!realDryRun?.rowsForCommit?.account, `length=${realDryRun?.rowsForCommit?.account?.length}`);
  record('C0b: real-company preview.account capped at 100', realDryRun?.preview?.account?.length === 100);

  // commitCustomer360 invokes persistJob + processJob. We only want to
  // verify persistence; cap tick so we don't actually create 150 Accounts.
  const { commitCustomer360 } = await import('../server/lib/import/customer360CommitEngine.js');
  const commit = await commitCustomer360({
    user: { allowedCompanyIds: [scopeCompany.id] },
    companyId: scopeCompany.id,
    entities: makeEntities({
      account: Array.from({ length: FIXTURE_N }, (_, i) => ({
        recordNo: `RC${i + 1}`,
        name: `${TAG}-${String(i + 1).padStart(4, '0')}`,
        vkn: '',
      })),
    }),
    sourceMeta: { sourceType: 'file', fileName: `${TAG}.xlsx` },
    options: { skipErrors: true, maxRowsPerCall: 1 }, // tick budget 1 → only 1 row written, rest stays pending
    jobId: null,
  });
  if (commit?.job?.id) createdJobIds.push(commit.job.id);

  const rowCount = await prisma.importJobRow.count({
    where: { importJobId: commit.job.id, entityType: 'account' },
  });
  record('C1: persistJob wrote 150 account ImportJobRow (NOT 100 — bug fixed)', rowCount === 150, `count=${rowCount}`);
  record('C2: commit returned progress.hasMore (more rows pending after tick budget exhausted)', commit?.progress?.hasMore === true);

  const pending = await prisma.importJobRow.count({
    where: { importJobId: commit.job.id, entityType: 'account', status: 'pending' },
  });
  record('C3: many pending rows remain (>100; proves rowsForCommit reached persistJob)', pending > 100, `pending=${pending}`);

  // Clean up: delete created Account rows + ImportJob audit
  const ids = await prisma.account.findMany({
    where: { name: { startsWith: `${TAG}-` } },
    select: { id: true },
  });
  for (const a of ids) createdAccountIds.push(a.id);
} catch (err) {
  record('PART C exception', false, err?.message || String(err));
} finally {
  // Cleanup
  try {
    if (createdAccountIds.length > 0) {
      const uniq = [...new Set(createdAccountIds)];
      await prisma.accountCompany.deleteMany({ where: { accountId: { in: uniq } } });
      await prisma.account.deleteMany({ where: { id: { in: uniq } } });
    }
    if (createdJobIds.length > 0) {
      const uniq = [...new Set(createdJobIds)];
      await prisma.importJobRow.deleteMany({ where: { importJobId: { in: uniq } } });
      await prisma.importJob.deleteMany({ where: { id: { in: uniq } } });
    }
  } catch (err) {
    console.log(`[smoke] cleanup warning: ${err?.message || err}`);
  }
  await prisma.$disconnect();
}

function finalize() {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[smoke-c360-commit-uses-full-rows] ${passed}/${total} passed`);
}

finalize();
process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
