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

// ── 5) min / max — Codex P2 #2 fix: totals fn aware ──────────
console.log('\n── 5) min / max — totals fn aware (Codex P2 #2) ─────────');
{
  // Single-cell
  const pMin = computePivot({
    rowValues: ['A', 'A', 'A'], colValues: ['X', 'X', 'X'],
    measureValues: [5, 2, 9], measureFn: 'min',
  });
  const pMax = computePivot({
    rowValues: ['A', 'A', 'A'], colValues: ['X', 'X', 'X'],
    measureValues: [5, 2, 9], measureFn: 'max',
  });
  expect('5.1 min A×X cell = 2', pMin.matrix['A']['X'], 2);
  expect('5.2 max A×X cell = 9', pMax.matrix['A']['X'], 9);
  // 1×1 grid → totals = same cell
  expect('5.3 min rowTotals.A = 2 (same single cell)', pMin.rowTotals['A'], 2);
  expect('5.4 max rowTotals.A = 9 (same single cell)', pMax.rowTotals['A'], 9);

  // Multi-cell — Codex P2 #2 ana senaryo: 2 kolon, max = max(10, 20) = 20, NOT 30
  const pMax2 = computePivot({
    rowValues: ['A', 'A'], colValues: ['X', 'Y'],
    measureValues: [10, 20], measureFn: 'max',
  });
  expect('5.5 max A×X = 10', pMax2.matrix['A']['X'], 10);
  expect('5.6 max A×Y = 20', pMax2.matrix['A']['Y'], 20);
  // Codex bug: 10+20=30 totals göstereyordu. Fix sonrası max(10,20)=20.
  expect('5.7 max rowTotals.A = 20 (max of cells, NOT 30)', pMax2.rowTotals['A'], 20);
  expect('5.8 max colTotals.X = 10', pMax2.colTotals['X'], 10);
  expect('5.9 max colTotals.Y = 20', pMax2.colTotals['Y'], 20);
  expect('5.10 max grandTotal = 20 (max of all cells, NOT 30)', pMax2.grandTotal, 20);

  // min benzeri
  const pMin2 = computePivot({
    rowValues: ['A', 'A', 'B', 'B'], colValues: ['X', 'Y', 'X', 'Y'],
    measureValues: [10, 5, 3, 8], measureFn: 'min',
  });
  expect('5.11 min A×X = 10', pMin2.matrix['A']['X'], 10);
  expect('5.12 min A×Y = 5', pMin2.matrix['A']['Y'], 5);
  expect('5.13 min B×X = 3', pMin2.matrix['B']['X'], 3);
  expect('5.14 min rowTotals.A = 5 (min of 10, 5)', pMin2.rowTotals['A'], 5);
  expect('5.15 min rowTotals.B = 3 (min of 3, 8)', pMin2.rowTotals['B'], 3);
  expect('5.16 min colTotals.X = 3 (min of 10, 3)', pMin2.colTotals['X'], 3);
  expect('5.17 min grandTotal = 3 (min of all)', pMin2.grandTotal, 3);

  // count + sum hâlâ additive — regression
  const pSum = computePivot({
    rowValues: ['A', 'A'], colValues: ['X', 'Y'],
    measureValues: [10, 20], measureFn: 'sum',
  });
  expect('5.18 sum rowTotals.A = 30 (additive, regression)', pSum.rowTotals['A'], 30);
  expect('5.19 sum grandTotal = 30', pSum.grandTotal, 30);
}

// ── 5c) Codex P2 #3 — Sparse min/max + empty bucket null ─────
console.log('\n── 5c) Sparse min/max — empty bucket null (Codex P2 #3) ──');
{
  // Codex'in spesifik örneği: Row A, Col X=10 (1 case), Col Y boş.
  // Eski impl: matrix.A.Y = aggregate('min', []) = 0 →
  //            rowTotals.A = min(10, 0) = 0 (YANLIŞ)
  // Fix: matrix.A.Y = null → totals null'ı skip → rowTotals.A = 10
  const pMin = computePivot({
    rowValues: ['A'],       // sadece 1 case: A × X
    colValues: ['X'],
    measureValues: [10],
    measureFn: 'min',
  });
  // 1×1 grid — A,Y bucket'ı zaten yok; colLabels yalnız [X]. Test güvenli.
  expect('5c.1 dense 1×1 min cell = 10', pMin.matrix['A']['X'], 10);
  expect('5c.2 dense 1×1 min rowTotal = 10', pMin.rowTotals['A'], 10);

  // Gerçek sparse: 2 row × 2 col, bazı bucket'lar boş.
  // Layout: A×X=10, A×Y=BOŞ, B×X=BOŞ, B×Y=20
  const pMin2 = computePivot({
    rowValues: ['A', 'B'],
    colValues: ['X', 'Y'],
    measureValues: [10, 20],
    measureFn: 'min',
  });
  expect('5c.3 sparse A×X cell = 10',  pMin2.matrix['A']['X'], 10);
  expect('5c.4 sparse A×Y empty cell = null', pMin2.matrix['A']['Y'], null);
  expect('5c.5 sparse B×X empty cell = null', pMin2.matrix['B']['X'], null);
  expect('5c.6 sparse B×Y cell = 20',  pMin2.matrix['B']['Y'], 20);
  // Codex bug: rowTotals.A eski impl'de min(10, 0) = 0 olurdu. Fix: 10.
  expect('5c.7 sparse rowTotals.A = 10 (NOT 0)', pMin2.rowTotals['A'], 10);
  expect('5c.8 sparse rowTotals.B = 20 (NOT 0)', pMin2.rowTotals['B'], 20);
  expect('5c.9 sparse colTotals.X = 10', pMin2.colTotals['X'], 10);
  expect('5c.10 sparse colTotals.Y = 20', pMin2.colTotals['Y'], 20);
  expect('5c.11 sparse grandTotal = min(10, 20) = 10', pMin2.grandTotal, 10);

  // Negative max — Codex'in ikinci endişesi: tümü negatif iken 0 inflation.
  // Row A: X=-5 (1 case), Y empty. Eski impl max(-5, 0) = 0. Fix: -5.
  const pMaxNeg = computePivot({
    rowValues: ['A', 'A'],
    colValues: ['X', 'X'],
    measureValues: [-5, -10],
    measureFn: 'max',
  });
  expect('5c.12 negative max A×X = -5 (NOT 0)', pMaxNeg.matrix['A']['X'], -5);
  expect('5c.13 negative max rowTotal.A = -5 (NOT 0)', pMaxNeg.rowTotals['A'], -5);

  // Sparse + negative kombine:
  // A×X=-5, A×Y empty, B×X=-100, B×Y=-2
  const pMixNeg = computePivot({
    rowValues: ['A', 'B', 'B'],
    colValues: ['X', 'X', 'Y'],
    measureValues: [-5, -100, -2],
    measureFn: 'max',
  });
  expect('5c.14 mixed neg A×Y null', pMixNeg.matrix['A']['Y'], null);
  expect('5c.15 mixed neg rowTotal.A = -5', pMixNeg.rowTotals['A'], -5);
  expect('5c.16 mixed neg rowTotal.B = max(-100, -2) = -2', pMixNeg.rowTotals['B'], -2);
  expect('5c.17 mixed neg grandTotal = max(-5, -100, -2) = -2', pMixNeg.grandTotal, -2);

  // Tamamen boş row/col (hiç bucket yok) — bu durum normalde oluşmaz çünkü
  // rowLabel sadece veri varsa Set'e eklenir. Defansif kontrol: tek case ile
  // 1 row × 1 col, sonra empty cell senaryosu yukarıda zaten.

  // count + sum + avg regression: empty bucket cell hâlâ 0 (semantik)
  const pCount = computePivot({
    rowValues: ['A', 'B'], colValues: ['X', 'Y'],
    measureValues: [10, 20], measureFn: 'count',
  });
  expect('5c.18 count A×Y empty = 0 (semantik regression)', pCount.matrix['A']['Y'], 0);
  expect('5c.19 count rowTotal.A = 1 (only A×X)', pCount.rowTotals['A'], 1);
  expect('5c.20 count grandTotal = 2', pCount.grandTotal, 2);

  const pSum = computePivot({
    rowValues: ['A', 'B'], colValues: ['X', 'Y'],
    measureValues: [10, 20], measureFn: 'sum',
  });
  expect('5c.21 sum A×Y empty = 0 (semantik regression)', pSum.matrix['A']['Y'], 0);
  expect('5c.22 sum rowTotal.A = 10 (sum of 10 + 0)', pSum.rowTotals['A'], 10);
}

// ── 5b) Codex P2 #1 — extractRawValue helper ───────────────
console.log('\n── 5b) extractRawValue — formatted display bypass (Codex P2 #1) ──');
{
  const { extractRawValue, parseCustomFields } = await import('../server/lib/caseReport/buildRows.js');

  // Scalar source
  const scalarCol = { source: 'scalar', prismaField: 'transferCount' };
  expect('5b.1 scalar raw int', extractRawValue(scalarCol, { transferCount: 5 }, null, undefined), 5);

  // JSON path — confidence float 0-1 (formatlanmış '%85' DEĞİL raw 0.85)
  const cfRaw = JSON.stringify({ smartTicket: { closure: { closureSuggestion: { confidence: 0.85 } } } });
  const cf = parseCustomFields(cfRaw);
  const jsonCol = {
    source: 'json_path',
    jsonPath: ['smartTicket', 'closure', 'closureSuggestion', 'confidence'],
  };
  expect('5b.2 json_path raw 0.85 (formatter bypass)', extractRawValue(jsonCol, { id: 'C1' }, cf, undefined), 0.85);

  // Join source
  const joinCol = { source: 'join', joinTable: 'account', joinField: 'vkn' };
  expect('5b.3 join raw "1234567890"', extractRawValue(joinCol, { account: { vkn: '1234567890' } }, null, undefined), '1234567890');

  // Aggregate source
  const aggCol = { source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'workedCount' };
  const aggs = { solutionSteps: new Map([['C1', { workedCount: 3 }]]) };
  expect('5b.4 aggregate raw 3', extractRawValue(aggCol, { id: 'C1' }, null, aggs), 3);

  // Missing relation/null safety
  expect('5b.5 join null account → undefined', extractRawValue(joinCol, { account: null }, null, undefined), undefined);
  expect('5b.6 aggregate map missing → undefined', extractRawValue(aggCol, { id: 'CX' }, null, aggs), undefined);
  expect('5b.7 json_path no cf → undefined', extractRawValue(jsonCol, { id: 'C1' }, null, undefined), undefined);
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
  // Phase 3.2: aggregate dim AÇILDI — gate gevşetildi
  expect('8.4 solutionSteps.total aggregate → dim (Phase 3.2 ACIK)', isPivotableDimension(totalCol), true);
  // Aggregate string kolonu (workedSource) da artık dim olarak izinli
  const workedSourceCol = REPORT_COLUMNS.find((c) => c.id === 'solutionSteps.workedSource');
  expect('8.4b solutionSteps.workedSource aggregate string → dim (Phase 3.2)',
    isPivotableDimension(workedSourceCol), true);

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

// ── 10) Phase 3.2 — Aggregate dim end-to-end ─────────────────
console.log('\n── 10) Phase 3.2: aggregate dim end-to-end ──────────────');
{
  // Aggregate string dim (workedSource) × scalar dim (assignedTeamName)
  // simülasyonu: rowValues = aggregate'tan TR labeled, colValues = scalar TR
  const rowValues = ['Bilgi Bankası', 'Bilgi Bankası', 'AI Önerisi', 'Manuel', 'Bilgi Bankası'];
  const colValues = ['L1 Destek', 'L2 Mühendislik', 'L1 Destek', 'L2 Mühendislik', 'L1 Destek'];
  const p = computePivot({ rowValues, colValues, measureValues: [], measureFn: 'count' });
  expect('10.1 rowLabels Bilgi Bankası + AI Önerisi + Manuel',
    p.rowLabels.sort(), ['AI Önerisi', 'Bilgi Bankası', 'Manuel']);
  expect('10.2 Bilgi Bankası × L1 Destek = 2', p.matrix['Bilgi Bankası']['L1 Destek'], 2);
  expect('10.3 Bilgi Bankası × L2 Mühendislik = 1', p.matrix['Bilgi Bankası']['L2 Mühendislik'], 1);
  expect('10.4 grandTotal = 5', p.grandTotal, 5);
}

// ── 11) Phase 3.2 — BLANK_LABEL filter mantığı (drill için) ──
console.log('\n── 11) Drill: BLANK_LABEL "(boş)" filter eşleşmesi ──────');
{
  // Drill filter mantığı route handler'da; burada kontrat olarak doğrulayalım:
  // value 'X' ile karşılaştırma direct; '(boş)' ile karşılaştırma boş/whitespace
  // değerleri eşleştirmeli.
  const isBlank = (v) => !v || String(v).trim() === '';
  expect('11.1 BLANK eşleşir: "" ', isBlank(''), true);
  expect('11.2 BLANK eşleşir: null', isBlank(null), true);
  expect('11.3 BLANK eşleşir: undefined', isBlank(undefined), true);
  expect('11.4 BLANK eşleşir: "   "', isBlank('   '), true);
  expect('11.5 BLANK eşleşmez: "Açık"', isBlank('Açık'), false);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
