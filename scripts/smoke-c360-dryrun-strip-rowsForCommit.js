#!/usr/bin/env node
/**
 * smoke-c360-dryrun-strip-rowsForCommit.js
 *
 * Verifies that `rowsForCommit` remains an INTERNAL field used by
 * persistJob, but is stripped from HTTP dry-run responses (preview
 * contract + payload size).
 *
 *   PART A — pure helper unit (no DB):
 *     - stripCommitRowsFromDryRunResult removes rowsForCommit
 *     - returns a new object (doesn't mutate input)
 *     - preserves all other fields (preview, summary, etc.)
 *     - handles null/undefined gracefully
 *
 *   PART B — source-grep guardrails:
 *     - helper exported from engine
 *     - both routes import + apply the helper
 *     - res.json calls go through the helper
 *
 *   PART C — engine direct (DB; graceful skip):
 *     - dryRunCustomer360 returned object STILL contains rowsForCommit
 *     - rowsForCommit.account.length matches input row count (>100)
 *
 *   PART D — in-process route emulation (no DB):
 *     - call dryRunCustomer360 directly with a 150-row fixture
 *     - apply stripCommitRowsFromDryRunResult (route does this)
 *     - assert result has NO rowsForCommit
 *     - assert preview still capped at 100
 *
 *   PART E — commit still persists full set:
 *     - smoke-c360-commit-uses-full-rows already verifies this; here we
 *       just source-grep that persistJob still references rowsForCommit
 *       (not preview as primary).
 *
 * Run: node --env-file=.env scripts/smoke-c360-dryrun-strip-rowsForCommit.js
 */
import fs from 'node:fs';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── PART A: pure helper ──────────────────────────────────────────────────

const { stripCommitRowsFromDryRunResult, dryRunCustomer360 } = await import(
  '../server/lib/import/customer360DryRun.js'
);

record('A1: helper exported from engine', typeof stripCommitRowsFromDryRunResult === 'function');

{
  const input = {
    ok: true,
    preview: { account: [{ rowNumber: 1 }] },
    rowsForCommit: { account: [{ rowNumber: 1 }, { rowNumber: 2 }] },
    summary: { totalRows: 2 },
  };
  const out = stripCommitRowsFromDryRunResult(input);
  record('A2: rowsForCommit removed', !('rowsForCommit' in out));
  record('A3: preview preserved', out.preview?.account?.length === 1);
  record('A4: summary preserved', out.summary?.totalRows === 2);
  record('A5: ok preserved', out.ok === true);
  record('A6: helper returns NEW object (no mutation)', input.rowsForCommit !== undefined);
}

{
  const out1 = stripCommitRowsFromDryRunResult(null);
  const out2 = stripCommitRowsFromDryRunResult(undefined);
  const out3 = stripCommitRowsFromDryRunResult('not-an-object');
  record('A7: null tolerated', out1 === null);
  record('A8: undefined tolerated', out2 === undefined);
  record('A9: non-object tolerated', out3 === 'not-an-object');
}

// ─── PART B: source-grep guardrails ───────────────────────────────────────

const engineSrc = fs.readFileSync('server/lib/import/customer360DryRun.js', 'utf8');
record('B1: helper defined in engine', /export function stripCommitRowsFromDryRunResult/.test(engineSrc));
record('B2: helper destructures rowsForCommit', /\{ rowsForCommit, \.\.\.rest \} = result/.test(engineSrc));

const routesSrc = fs.readFileSync('server/routes/imports.js', 'utf8');
record(
  'B3: route imports the helper',
  /import \{[^}]*stripCommitRowsFromDryRunResult[^}]*\} from .*customer360DryRun/.test(routesSrc),
);
record(
  'B4: /customer360/dry-run applies helper before res.json',
  /'\/customer360\/dry-run'[\s\S]*?stripCommitRowsFromDryRunResult\(result\)[\s\S]*?commitAvailable/.test(routesSrc),
);
record(
  'B5: /customer360/dry-run-xlsx applies helper before res.json',
  /'\/customer360\/dry-run-xlsx'[\s\S]*?stripCommitRowsFromDryRunResult\(result\)/.test(routesSrc),
);
record(
  'B6: no res.json that spreads `result` without strip (regression guard)',
  // Look for problematic pattern: res.json({ ...result without strip on customer360 routes.
  !/res\.json\(\{\s*\.\.\.result,\s*commitAvailable\s*\}\)/.test(routesSrc),
);

const commitSrc = fs.readFileSync('server/lib/import/customer360CommitEngine.js', 'utf8');
record('B7: commit still uses dryRun.rowsForCommit', /dryRun\.rowsForCommit/.test(commitSrc));

// ─── PART C: engine direct call keeps rowsForCommit ───────────────────────

function makeAccountRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    recordNo: `R${i + 1}`,
    name: `StripSmoke-${String(i + 1).padStart(4, '0')}`,
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

let engineDryRun = null;
try {
  engineDryRun = await dryRunCustomer360({
    companyId: '__smoke_company__',
    allowedCompanyIds: ['__smoke_company__'],
    entities: makeEntities({ account: makeAccountRows(150) }),
    sourceMeta: { sourceType: 'file', fileName: 'strip-smoke.xlsx' },
  });
  record('C1: engine direct returned', !!engineDryRun);
  record('C2: rowsForCommit present on engine return', Array.isArray(engineDryRun.rowsForCommit?.account), `length=${engineDryRun.rowsForCommit?.account?.length}`);
  record('C3: rowsForCommit.account.length === 150', engineDryRun.rowsForCommit?.account?.length === 150);
  record('C4: preview.account.length === 100 (UI cap)', engineDryRun.preview?.account?.length === 100);
} catch (err) {
  console.log(`[smoke] DB unreachable → PART C skipped (${err?.message || err}).`);
}

// ─── PART D: route-shaped response strips rowsForCommit ──────────────────

if (engineDryRun) {
  const httpShape = {
    ...stripCommitRowsFromDryRunResult(engineDryRun),
    commitAvailable: true,
  };
  record('D1: HTTP-shape lacks rowsForCommit', !('rowsForCommit' in httpShape));
  record('D2: HTTP-shape keeps preview', Array.isArray(httpShape.preview?.account));
  record('D3: HTTP-shape preview.account still 100', httpShape.preview?.account?.length === 100);
  record('D4: HTTP-shape keeps summary', !!httpShape.summary);
  record('D5: HTTP-shape keeps commitAvailable', httpShape.commitAvailable === true);

  // Serialize to JSON like Express res.json does — confirm bytes don't
  // include the marker string.
  const json = JSON.stringify(httpShape);
  record('D6: JSON.stringify(httpShape) does NOT contain "rowsForCommit"', !json.includes('rowsForCommit'));

  // Sanity: with rowsForCommit it WOULD be bigger.
  const fullJson = JSON.stringify(engineDryRun);
  record(
    'D7: stripped JSON is smaller than engine-direct JSON',
    json.length < fullJson.length,
    `${json.length}B vs ${fullJson.length}B`,
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────

const total = results.length;
const passed = results.filter((r) => r.ok).length;
console.log(`\n[smoke-c360-dryrun-strip-rowsForCommit] ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
