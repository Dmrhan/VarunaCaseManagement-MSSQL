/**
 * Operations Intelligence — Metric Formulas smoke tests (Phase 1)
 *
 * Calistir: `node server/analytics/__tests__/metricFormulas.test.js`
 *
 * Bu repo'da Jest/Vitest yok; saf Node + assert ile yetiniyoruz. Her metric
 * icin min 3 case: happy, null-divide, edge (under-sample veya zero-input).
 *
 * docs/OPERATIONS_DASHBOARD_DESIGN.md §2.6.9 A — Formula unit tests.
 */

import assert from 'node:assert/strict';
import {
  computeAvgResolutionWallClockHours,
  computeDelta,
  computeEscalationRatePct,
  computeOpenCases,
  computeReopenRatePct,
  computeRetentionSuccessPct,
  computeSlaViolationRatePct,
  computeTotalCases,
  computeTransferRatePct,
  isInsufficientSample,
  MIN_SAMPLE,
  roundHours,
  roundPct,
  safePct,
} from '../metricFormulas.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------- rounding ----------

test('safePct: 162/1860 ≈ 8.7%', () => {
  assert.equal(safePct(162, 1860), 8.7);
});
test('safePct: 0 payda -> null', () => {
  assert.equal(safePct(0, 0), null);
});
test('safePct: numerator null -> null', () => {
  assert.equal(safePct(null, 100), null);
});
test('roundPct: 1 ondalik (8.74 -> 8.7)', () => {
  assert.equal(roundPct(8.74), 8.7);
});
test('roundHours: 5.43 -> 5.4', () => {
  assert.equal(roundHours(5.43), 5.4);
});

// ---------- isInsufficientSample ----------

test('isInsufficientSample: n=3 default(5) -> true', () => {
  assert.equal(isInsufficientSample(3, 'default'), true);
});
test('isInsufficientSample: n=21 agentPerformance(20) -> false', () => {
  assert.equal(isInsufficientSample(21, 'agentPerformance'), false);
});
test('isInsufficientSample: n=10 qaScore(10) -> false (boundary)', () => {
  assert.equal(isInsufficientSample(10, 'qaScore'), false);
});
test('MIN_SAMPLE shape', () => {
  assert.equal(MIN_SAMPLE.agentPerformance, 20);
  assert.equal(MIN_SAMPLE.qaScore, 10);
  assert.equal(MIN_SAMPLE.teamAggregate, 30);
  assert.equal(MIN_SAMPLE.default, 5);
});

// ---------- totalCases / openCases ----------

test('totalCases: input 4823 -> 4823', () => {
  assert.equal(computeTotalCases({ totalCount: 4823 }), 4823);
});
test('totalCases: input 0 -> 0', () => {
  assert.equal(computeTotalCases({ totalCount: 0 }), 0);
});
test('openCases: input 49 -> 49', () => {
  assert.equal(computeOpenCases({ openCount: 49 }), 49);
});

// ---------- slaViolationRatePct ----------

test('slaViolationRatePct: 12/100 (sample yeterli) -> 12.0', () => {
  assert.equal(
    computeSlaViolationRatePct({ slaResolvedCount: 12, totalResolvedCount: 100 }),
    12.0,
  );
});
test('slaViolationRatePct: 0/0 -> null (yetersiz sample)', () => {
  assert.equal(
    computeSlaViolationRatePct({ slaResolvedCount: 0, totalResolvedCount: 0 }),
    null,
  );
});
test('slaViolationRatePct: 2/4 (n<5) -> null (yetersiz sample)', () => {
  assert.equal(
    computeSlaViolationRatePct({ slaResolvedCount: 2, totalResolvedCount: 4 }),
    null,
  );
});

// ---------- avgResolutionWallClockHours ----------

test('avgResolutionWallClockHours: 5 vaka × 6h ortalama -> 6.0', () => {
  // 5 vaka × 6h = 108000 sec total
  const result = computeAvgResolutionWallClockHours({
    totalResolutionSeconds: 108000,
    resolvedSampleSize: 5,
  });
  assert.equal(result, 6.0);
});
test('avgResolutionWallClockHours: 0 sample -> null', () => {
  assert.equal(
    computeAvgResolutionWallClockHours({
      totalResolutionSeconds: 0,
      resolvedSampleSize: 0,
    }),
    null,
  );
});
test('avgResolutionWallClockHours: 3 vaka (n<5) -> null (yetersiz)', () => {
  assert.equal(
    computeAvgResolutionWallClockHours({
      totalResolutionSeconds: 32400,
      resolvedSampleSize: 3,
    }),
    null,
  );
});

// ---------- reopenRatePct ----------

test('reopenRatePct: 3 reopened / 100 resolved (resolved-based) -> 3.0', () => {
  assert.equal(
    computeReopenRatePct({ reopenedAfterResolutionCount: 3, totalResolvedCount: 100 }),
    3.0,
  );
});
test('reopenRatePct: 0 resolved -> null (yetersiz)', () => {
  assert.equal(
    computeReopenRatePct({ reopenedAfterResolutionCount: 0, totalResolvedCount: 0 }),
    null,
  );
});

// ---------- escalation / transfer ----------

test('escalationRatePct: 18 / 412 created -> 4.4%', () => {
  assert.equal(
    computeEscalationRatePct({ escalatedCount: 18, totalCreatedCount: 412 }),
    4.4,
  );
});
test('transferRatePct: 25 / 412 -> 6.1%', () => {
  assert.equal(
    computeTransferRatePct({ transferredCount: 25, totalCreatedCount: 412 }),
    6.1,
  );
});
test('escalationRatePct: n<5 -> null', () => {
  assert.equal(
    computeEscalationRatePct({ escalatedCount: 1, totalCreatedCount: 3 }),
    null,
  );
});

// ---------- retentionSuccessPct ----------

test('retentionSuccessPct: 6/10 -> 60.0%', () => {
  assert.equal(
    computeRetentionSuccessPct({ successCount: 6, decidedChurnCount: 10 }),
    60.0,
  );
});
test('retentionSuccessPct: 0 decided -> null', () => {
  assert.equal(
    computeRetentionSuccessPct({ successCount: 0, decidedChurnCount: 0 }),
    null,
  );
});

// ---------- delta ----------

test('computeDelta: current=110 prev=100 -> up 10.0%', () => {
  const d = computeDelta(110, 100);
  assert.equal(d.value, 10.0);
  assert.equal(d.direction, 'up');
  assert.equal(d.sourceMissing, false);
});
test('computeDelta: current=8.7 prev=7.5 -> up 16.0%', () => {
  const d = computeDelta(8.7, 7.5);
  assert.equal(d.value, 16.0);
  assert.equal(d.direction, 'up');
});
test('computeDelta: prev=0 -> mutlak fark', () => {
  const d = computeDelta(5, 0);
  assert.equal(d.value, 5);
  assert.equal(d.direction, 'up');
});
test('computeDelta: prev=null -> sourceMissing', () => {
  const d = computeDelta(100, null);
  assert.equal(d.sourceMissing, true);
  assert.equal(d.value, null);
});
test('computeDelta: current=null -> null value', () => {
  const d = computeDelta(null, 100);
  assert.equal(d.value, null);
  assert.equal(d.direction, null);
});
test('computeDelta: 100->100 flat', () => {
  const d = computeDelta(100, 100);
  assert.equal(d.value, 0);
  assert.equal(d.direction, 'flat');
});

// ---------- runner ----------

let passed = 0;
let failed = 0;
const errors = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
  } catch (err) {
    failed++;
    errors.push({ name: t.name, err });
  }
}

console.log(`\n${passed}/${tests.length} passed`);
if (failed > 0) {
  for (const e of errors) {
    console.error(`✗ ${e.name}`);
    console.error(`  ${e.err.message}`);
  }
  process.exit(1);
}
