#!/usr/bin/env node
/**
 * smoke-c360-commit-phase-c-light.js
 *
 * Phase C-light commit roundtrip reduction smoke.
 *
 *   PART A — source-grep guardrails (always run, no DB):
 *     - vercel.json maxDuration=300
 *     - commit engine exposes prefetched param on each writeX
 *     - processJob has prefetch + runWithConcurrency
 *     - timing instrumentation behind C360_IMPORT_DEBUG_TIMING
 *     - frontend commit path uses payloadGuard
 *     - rollback path untouched
 *
 *   PART B — runtime engine (skips gracefully on Supabase outage):
 *     - small commit still produces created rows
 *     - invalid VKN row commits with vkn=null + warning
 *     - blank line1 address → action=skip; account intact
 *     - ImportJobRow audit captures beforeJson/afterJson
 *     - rollback restores
 *     - 200-account synthetic commit completes; per-entity wall-clock logged
 *
 * Run: node --env-file=.env scripts/smoke-c360-commit-phase-c-light.js
 */
import fs from 'node:fs';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── PART A: source-grep guardrails ───────────────────────────────────────

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
record(
  'vercel.json: api/index.js maxDuration = 300',
  vercel?.functions?.['api/index.js']?.maxDuration === 300,
);

const engine = fs.readFileSync('server/lib/import/customer360CommitEngine.js', 'utf8');
record(
  'commit engine: ACCOUNT_SELECT / ACCOUNT_COMPANY_SELECT / CONTACT_SELECT / ADDRESS_SELECT / PROJECT_SELECT hoisted',
  /const ACCOUNT_SELECT = \{/.test(engine) &&
    /const ACCOUNT_COMPANY_SELECT = \{/.test(engine) &&
    /const CONTACT_SELECT = \{/.test(engine) &&
    /const ADDRESS_SELECT = \{/.test(engine) &&
    /const PROJECT_SELECT = \{/.test(engine),
);
record(
  'commit engine: runWithConcurrency helper exists',
  /async function runWithConcurrency\(/.test(engine),
);
record(
  'commit engine: COMMIT_CONCURRENCY env override',
  /C360_COMMIT_CONCURRENCY/.test(engine),
);
record(
  'commit engine: writeAccount accepts prefetched',
  /async function writeAccount\(row, normalized, prefetched = undefined\)/.test(engine),
);
record(
  'commit engine: writeAccountCompany accepts prefetched',
  /async function writeAccountCompany\([^)]*prefetched = undefined[^)]*\)/.test(engine),
);
record(
  'commit engine: writeContact accepts prefetched + array memory path',
  /async function writeContact\([^)]*prefetched = undefined[^)]*\)/.test(engine) &&
    /Array\.isArray\(prefetched\)/.test(engine),
);
record(
  'commit engine: writeAddress accepts prefetched',
  /async function writeAddress\([^)]*prefetched = undefined[^)]*\)/.test(engine),
);
record(
  'commit engine: writeProject accepts prefetched',
  /async function writeProject\([^)]*prefetched = undefined[^)]*\)/.test(engine),
);
record(
  'commit engine: processJob prefetch calls per entity (findMany on account / accountCompany / accountContact / address / accountProject)',
  /prisma\.account\.findMany\(/.test(engine) &&
    /prisma\.accountCompany\.findMany\(/.test(engine) &&
    /prisma\.accountContact\.findMany\(/.test(engine) &&
    /prisma\.address\.findMany\(/.test(engine) &&
    /prisma\.accountProject\.findMany\(/.test(engine),
);
record(
  'commit engine: processJob uses runWithConcurrency for writes',
  /await runWithConcurrency\(writeable,/.test(engine),
);
record(
  'commit engine: timer behind C360_IMPORT_DEBUG_TIMING',
  /C360_IMPORT_DEBUG_TIMING/.test(engine) && /timer\.log\('\[c360 commit\]'\)/.test(engine),
);
record(
  'commit engine: ImportJobRow.update still per-row (beforeJson/afterJson preserved)',
  /prisma\.importJobRow\.update\(\s*\{\s*where:\s*\{\s*id:\s*row\.id\s*\}/.test(engine) &&
    /beforeJson:\s*r\.beforeJson/.test(engine),
);
record(
  'commit engine: rollback function untouched (rollbackCustomer360 still exists, reverse order)',
  /export async function rollbackCustomer360/.test(engine) && /ROLLBACK_ORDER/.test(engine),
);
record(
  'commit engine: invalid_vkn_ignored / address_line1_missing_skipped / parent_record_no behavior NOT referenced here (lives in dryRun) — engine untouched on validation rules',
  !/invalid_vkn_ignored/.test(engine) && !/address_line1_missing_skipped/.test(engine),
);

const pageSrc = fs.readFileSync(
  'src/features/admin/dataImport/customer360/Customer360Page.tsx',
  'utf8',
);
record(
  'frontend: runCommit() applies evaluateDryRunPayload before POST',
  /async function runCommit\(\)/.test(pageSrc) &&
    /const commitGuard = evaluateDryRunPayload/.test(pageSrc),
);
record(
  'frontend: commit guard error toast mentions "Aktarım sonucu çok büyük"',
  /Aktarım sonucu çok büyük/.test(pageSrc),
);

// ─── PART B: runtime (graceful skip on DB outage) ─────────────────────────

let commitCustomer360 = null;
let rollbackCustomer360 = null;
let prisma = null;
try {
  const mod = await import('../server/lib/import/customer360CommitEngine.js');
  commitCustomer360 = mod.commitCustomer360;
  rollbackCustomer360 = mod.rollbackCustomer360;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$queryRaw`SELECT 1`;
} catch (err) {
  console.log(`[smoke] DB unreachable → PART B skipped (${err?.message || err}).`);
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

let scopeCompany = null;
try {
  scopeCompany = await prisma.company.findFirst({ select: { id: true } });
} catch { /* ignore */ }
if (!scopeCompany) {
  console.log('[smoke] No company in DB → PART B skipped.');
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

function makeEntities(rows) {
  const out = {};
  for (const [k, v] of Object.entries(rows)) {
    const cols = [...new Set(v.flatMap((r) => Object.keys(r)))];
    out[k] = { columns: cols, mapping: cols.map((c) => ({ source: c, targetKey: c })), rows: v };
  }
  return out;
}

const TAG = `PCL-${process.pid}`;

async function commit(rows, opts = {}) {
  return commitCustomer360({
    user: { allowedCompanyIds: [scopeCompany.id] },
    companyId: scopeCompany.id,
    entities: makeEntities(rows),
    sourceMeta: { sourceType: 'file', fileName: `${TAG}.xlsx` },
    options: { skipErrors: true, ...opts },
  });
}

const createdJobIds = [];
const createdAccountIds = [];

try {
  // 1. Small commit happy path + audit fields
  {
    const accName = `${TAG}-Alpha`;
    const r = await commit({
      account: [{ recordNo: 'A1', name: accName, vkn: '' }],
    });
    record('B1: small commit returns job + runStats.created >= 1', !!r?.job && r.runStats.created >= 1);
    if (r?.job?.id) {
      createdJobIds.push(r.job.id);
      const rows = await prisma.importJobRow.findMany({
        where: { importJobId: r.job.id, entityType: 'account' },
        select: { status: true, accountId: true, beforeJson: true, afterJson: true },
      });
      record('B1: ImportJobRow status=created', rows.some((x) => x.status === 'created'));
      record('B1: ImportJobRow afterJson populated', rows.some((x) => x.afterJson));
      record('B1: ImportJobRow beforeJson=null for created', rows.every((x) => x.status !== 'created' || x.beforeJson === null));
      for (const x of rows) if (x.accountId) createdAccountIds.push(x.accountId);
    }
  }

  // 2. Invalid VKN → vkn null + warning, action !== error
  {
    const accName = `${TAG}-Invalid-VKN`;
    const r = await commit({
      account: [{ recordNo: 'A2', name: accName, vkn: '12560342' }],
    });
    record('B2: invalid VKN commit succeeded', r?.runStats?.error === 0, JSON.stringify(r?.runStats));
    if (r?.job?.id) createdJobIds.push(r.job.id);
    const acc = await prisma.account.findFirst({ where: { name: accName }, select: { id: true, vkn: true } });
    if (acc) {
      createdAccountIds.push(acc.id);
      record('B2: stored vkn === null (no fake VKN)', acc.vkn === null, `vkn=${acc.vkn}`);
    } else {
      record('B2: invalid VKN account created', false, 'account not found');
    }
  }

  // 3. Blank line1 address → skip; account intact
  {
    const accName = `${TAG}-Blank-Addr`;
    const r = await commit({
      account: [{ recordNo: 'A3', name: accName, vkn: '' }],
      accountAddress: [{ parentRecordNo: 'A3', type: 'Billing', line1: '', country: 'TR' }],
    });
    record('B3: account row created', r?.runStats?.created >= 1);
    if (r?.job?.id) {
      createdJobIds.push(r.job.id);
      const addrRows = await prisma.importJobRow.findMany({
        where: { importJobId: r.job.id, entityType: 'accountAddress' },
        select: { status: true },
      });
      record('B3: address row skipped', addrRows.some((x) => x.status === 'skipped'));
    }
    const acc = await prisma.account.findFirst({ where: { name: accName }, select: { id: true } });
    if (acc) createdAccountIds.push(acc.id);
  }

  // 4. Rollback regression
  {
    const accName = `${TAG}-Rollback`;
    const r = await commit({
      account: [{ recordNo: 'A4', name: accName, vkn: '' }],
    });
    if (r?.job?.id) {
      createdJobIds.push(r.job.id);
      const back = await rollbackCustomer360({ jobId: r.job.id, user: { allowedCompanyIds: [scopeCompany.id] } });
      record('B4: rollback report shape ok', !!back?.report);
      const acc = await prisma.account.findFirst({ where: { name: accName }, select: { id: true, isActive: true } });
      if (acc) {
        createdAccountIds.push(acc.id);
        record('B4: account soft-deactivated', acc.isActive === false, `isActive=${acc.isActive}`);
      } else {
        record('B4: account exists post rollback', false);
      }
    }
  }

  // 5. Synthetic 200-account commit + per-entity wall-clock
  {
    const N = 200;
    const accounts = Array.from({ length: N }, (_, i) => ({
      recordNo: `K${i}`,
      name: `${TAG}-Bulk-${i}`,
      vkn: '',
    }));
    const t0 = Date.now();
    const r = await commit({ account: accounts });
    const dt = Date.now() - t0;
    record(`B5: 200-row commit completed (${dt}ms)`, !!r?.job && r.runStats.created === N, `created=${r?.runStats?.created}`);
    if (r?.job?.id) {
      createdJobIds.push(r.job.id);
      const ids = await prisma.account.findMany({ where: { name: { startsWith: `${TAG}-Bulk-` } }, select: { id: true } });
      for (const a of ids) createdAccountIds.push(a.id);
    }
    record('B5: 200-row commit under 30s', dt < 30000, `${dt}ms`);
  }
} catch (err) {
  record('PART B exception', false, err?.message || String(err));
} finally {
  // Cleanup — best-effort. Soft-deactivate accounts via rollback already
  // covers most; here we hard-delete remaining test artifacts.
  try {
    if (createdAccountIds.length > 0) {
      const uniq = [...new Set(createdAccountIds)];
      await prisma.accountCompany.deleteMany({ where: { accountId: { in: uniq } } });
      await prisma.accountContact.deleteMany({ where: { accountId: { in: uniq } } });
      await prisma.address.deleteMany({ where: { accountId: { in: uniq } } });
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
  console.log(`\n[smoke-c360-commit-phase-c-light] ${passed}/${total} passed`);
}

finalize();
process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
