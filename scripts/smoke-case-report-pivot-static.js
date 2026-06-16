/**
 * smoke-case-report-pivot-static.js
 *
 * Phase 3.1 — Pivot compute core için DB-bağımsız static smoke. Phase 2A +
 * 2B.1 + 2B.2 + 2D regression dahil (registry'de yeni kategori veya
 * davranış değişikliği var mı kontrol).
 *
 * Senaryolar:
 *   1. computePivot empty input → boş matrix
 *   2. count fn (basit fixture: 6 case, 2 row × 2 col)
 *   3. sum fn — measure values
 *   4. avg fn — totals null (semantik)
 *   5. min / max fn
 *   6. BLANK_LABEL: null/undefined/'' row/col değerleri (boş)
 *   7. Etiket sıralaması TR locale + BLANK_LABEL en sonda
 *   8. isPivotableDimension + isPivotableMeasure kontrol
 *   9. Registry regression: tüm önceki kolonlar mevcut
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-pivot-static.js
 */

import {
  computePivot,
  isPivotableDimension,
  isPivotableMeasure,
  PIVOT_MEASURE_FNS,
  BLANK_LABEL,
} from '../server/lib/caseReport/pivot.js';
import {
  REPORT_COLUMNS,
  resolveColumns,
} from '../server/lib/caseReport/columnRegistry.js';

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ── 1) Empty input ───────────────────────────────────────────
console.log('── 1) computePivot empty input ─────────────────────────');
{
  const p = computePivot({ rowValues: [], colValues: [], measureValues: [], measureFn: 'count' });
  expect('1.1 rowLabels = []', p.rowLabels, []);
  expect('1.2 colLabels = []', p.colLabels, []);
  expect('1.3 matrix = {}', p.matrix, {});
  expect('1.4 grandTotal = 0', p.grandTotal, 0);
}

// ── 2) count fn (basit) ──────────────────────────────────────
console.log('\n── 2) count fn — 6 case fixture ─────────────────────────');
{
  // 6 case: status × caseType
  const rowValues = ['Açık', 'Çözüldü', 'Açık',     'Açık',     'Çözüldü', 'Çözüldü'];
  const colValues = ['GenelDestek', 'GenelDestek', 'Churn', 'Churn', 'GenelDestek', 'Churn'];
  const p = computePivot({ rowValues, colValues, measureValues: [], measureFn: 'count' });
  expect('2.1 rowLabels',  p.rowLabels, ['Açık', 'Çözüldü']);
  expect('2.2 colLabels',  p.colLabels, ['Churn', 'GenelDestek']);
  expect('2.3 Açık × Churn = 2',       p.matrix['Açık']['Churn'],        2);
  expect('2.4 Açık × GenelDestek = 1', p.matrix['Açık']['GenelDestek'],  1);
  expect('2.5 Çözüldü × Churn = 1',    p.matrix['Çözüldü']['Churn'],     1);
  expect('2.6 Çözüldü × GenelDestek = 2', p.matrix['Çözüldü']['GenelDestek'], 2);
  expect('2.7 rowTotals.Açık = 3',     p.rowTotals['Açık'],     3);
  expect('2.8 rowTotals.Çözüldü = 3',  p.rowTotals['Çözüldü'],  3);
  expect('2.9 colTotals.Churn = 3',    p.colTotals['Churn'],    3);
  expect('2.10 colTotals.GenelDestek = 3', p.colTotals['GenelDestek'], 3);
  expect('2.11 grandTotal = 6',         p.grandTotal,            6);
}

// ── 3) sum fn ────────────────────────────────────────────────
console.log('\n── 3) sum fn — measureValues toplama ─────────────────────');
{
  const rowValues = ['A', 'A', 'B', 'B'];
  const colValues = ['X', 'Y', 'X', 'Y'];
  const measureValues = [10, 20, 30, 40];
  const p = computePivot({ rowValues, colValues, measureValues, measureFn: 'sum' });
  expect('3.1 A×X = 10', p.matrix['A']['X'], 10);
  expect('3.2 A×Y = 20', p.matrix['A']['Y'], 20);
  expect('3.3 B×X = 30', p.matrix['B']['X'], 30);
  expect('3.4 B×Y = 40', p.matrix['B']['Y'], 40);
  expect('3.5 rowTotals.A = 30', p.rowTotals['A'], 30);
  expect('3.6 colTotals.X = 40', p.colTotals['X'], 40);
  expect('3.7 grandTotal = 100', p.grandTotal, 100);
}

// ── 4) avg fn — totals null ──────────────────────────────────
console.log('\n── 4) avg fn — totals null (semantik) ────────────────────');
{
  const rowValues = ['A', 'A', 'A'];
  const colValues = ['X', 'X', 'Y'];
  const measureValues = [4, 8, 6];
  const p = computePivot({ rowValues, colValues, measureValues, measureFn: 'avg' });
  expect('4.1 A×X avg = 6', p.matrix['A']['X'], 6);
  expect('4.2 A×Y avg = 6', p.matrix['A']['Y'], 6);
  expect('4.3 rowTotals.A = null (avg)', p.rowTotals['A'], null);
  expect('4.4 colTotals.X = null', p.colTotals['X'], null);
  expect('4.5 grandTotal = null', p.grandTotal, null);
}

// ── 5) min / max ─────────────────────────────────────────────
console.log('\n── 5) min / max ─────────────────────────────────────────');
{
  const rowValues = ['A', 'A', 'A'];
  const colValues = ['X', 'X', 'X'];
  const measureValues = [5, 2, 9];
  const pMin = computePivot({ rowValues, colValues, measureValues, measureFn: 'min' });
  const pMax = computePivot({ rowValues, colValues, measureValues, measureFn: 'max' });
  expect('5.1 min A×X = 2', pMin.matrix['A']['X'], 2);
  expect('5.2 max A×X = 9', pMax.matrix['A']['X'], 9);
}

// ── 6) BLANK_LABEL ───────────────────────────────────────────
console.log('\n── 6) Null/empty row/col → BLANK_LABEL ─────────────────');
{
  const rowValues = ['Açık', '', null, 'Açık'];
  const colValues = ['X', 'X', undefined, '   '];
  const p = computePivot({ rowValues, colValues, measureValues: [], measureFn: 'count' });
  expect('6.1 BLANK_LABEL = "(boş)"', BLANK_LABEL, '(boş)');
  // row labels: 'Açık' + '(boş)' — '(boş)' en sonda
  expect('6.2 rowLabels: Açık + (boş)', p.rowLabels, ['Açık', '(boş)']);
  // col labels: 'X' + '(boş)' (undefined ve trim('   ') → BLANK)
  expect('6.3 colLabels: X + (boş)',    p.colLabels, ['X', '(boş)']);
  expect('6.4 (boş) × X count = 1',    p.matrix['(boş)']['X'], 1);
  expect('6.5 Açık × (boş) count = 1', p.matrix['Açık']['(boş)'], 1);
}

// ── 7) Etiket sıralaması TR locale ───────────────────────────
console.log('\n── 7) Sort: alfabetik TR + BLANK_LABEL en sonda ────────');
{
  const rowValues = ['Çözüldü', 'Açık', 'İncelemede', null];
  const colValues = ['B', 'A', 'C', ''];
  const p = computePivot({ rowValues, colValues, measureValues: [], measureFn: 'count' });
  // Sıra: Türkçe alfabetik — 'A', 'Ç', 'İ' (localeCompare 'tr'). BLANK en sonda.
  expect('7.1 rowLabels sıralı + (boş) sonda', p.rowLabels, ['Açık', 'Çözüldü', 'İncelemede', '(boş)']);
  expect('7.2 colLabels sıralı + (boş) sonda', p.colLabels, ['A', 'B', 'C', '(boş)']);
}

// ── 8) isPivotableDimension + isPivotableMeasure ─────────────
console.log('\n── 8) Pivotable kolon helper\'ları ──────────────────────');
{
  const statusCol = REPORT_COLUMNS.find((c) => c.id === 'status');
  const totalCol  = REPORT_COLUMNS.find((c) => c.id === 'solutionSteps.total');
  const titleCol  = REPORT_COLUMNS.find((c) => c.id === 'title');
  const stPlatform = REPORT_COLUMNS.find((c) => c.id === 'st.platformLabel');
  const accVkn    = REPORT_COLUMNS.find((c) => c.id === 'account.vkn');

  expect('8.1 status scalar → pivotable dim',     isPivotableDimension(statusCol), true);
  expect('8.2 st.platformLabel json_path → dim',  isPivotableDimension(stPlatform), true);
  expect('8.3 account.vkn join → dim',            isPivotableDimension(accVkn), true);
  expect('8.4 solutionSteps.total aggregate → NOT dim (Phase 3.2)', isPivotableDimension(totalCol), false);

  // Measure helpers
  expect('8.5 count: status (string) OK',  isPivotableMeasure(statusCol, 'count'), true);
  expect('8.6 sum: title (string) NOT OK', isPivotableMeasure(titleCol, 'sum'), false);
  // transferCount scalar number — sum işe yarar
  const transferCountCol = REPORT_COLUMNS.find((c) => c.id === 'transferCount');
  expect('8.7 sum: transferCount (number) OK', isPivotableMeasure(transferCountCol, 'sum'), true);
  expect('8.8 avg: solutionSteps.total (number aggregate) OK',
    isPivotableMeasure(totalCol, 'avg'), true);
  // Bilinmeyen fn
  expect('8.9 unknown fn → false', isPivotableMeasure(statusCol, 'median'), false);

  // PIVOT_MEASURE_FNS sabitleri
  expect('8.10 PIVOT_MEASURE_FNS = 5', PIVOT_MEASURE_FNS.length, 5);
}

// ── 9) Registry regression ───────────────────────────────────
console.log('\n── 9) Registry: önceki tüm kolonlar mevcut ──────────────');
{
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  const required = [
    'caseNumber', 'status', 'priority',                       // Phase 1
    'solutionSteps.total', 'solutionSteps.outcomeSummary',    // 2A
    'activity.firstActor', 'note.noteCount',                  // 2B.1
    'file.fileCount', 'call.lastCallResult', 'transfer.transferCount', // 2B.2
    'account.vkn', 'account.email',                           // 2D
  ];
  const missing = required.filter((id) => !ids.has(id));
  if (missing.length === 0) ok(`9.1 Tüm Phase 1+2A+2B+2D kolonları (${required.length}) mevcut`);
  else bad('9.1 Kolon eksik', missing.join(','));

  // resolveColumns hâlâ invalidIds döndürüyor
  const { invalidIds } = resolveColumns(['caseNumber', '__bogus__']);
  expect('9.2 resolveColumns invalidIds çalışıyor', invalidIds, ['__bogus__']);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
