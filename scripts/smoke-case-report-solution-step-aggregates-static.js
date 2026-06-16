/**
 * smoke-case-report-solution-step-aggregates-static.js
 *
 * Phase 2A pure aggregate logic için DB-bağımsız smoke. Uzak MSSQL pool
 * blocker'ı sürerken bile aggregate iş mantığını doğrular.
 *
 * Kapsam:
 *   1. Empty case payload
 *   2. Status grouping (suggested/tried/worked/not_worked/skipped)
 *   3. firstWorkedTitle sıralama (outcomeAt ASC → stepIndex ASC fallback)
 *   4. lastTriedTitle sıralama (max(outcomeAt, triedAt, updatedAt) DESC)
 *   5. workedSource formatter (ai_suggested_step → 'AI Önerisi' vs)
 *   6. buildReportRows aggregate column routing — fake case + Map +
 *      missing-map blank davranışı
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-solution-step-aggregates-static.js
 *
 * Hiçbir env / DB / network bağımlılığı yok. CI veya dev makine fark etmez.
 */

import { __internal as aggInternal } from '../server/lib/caseReport/aggregates.js';
import { applyFormat } from '../server/lib/caseReport/formatters.js';
import { buildReportRows } from '../server/lib/caseReport/buildRows.js';
import { resolveColumns } from '../server/lib/caseReport/columnRegistry.js';

const { summarize } = aggInternal;

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) {
    ok(name);
  } else {
    bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

// ── 1) Empty case ──────────────────────────────────────────────
console.log('── 1) Empty case payload ──────────────────────────────');
{
  const p = summarize([]);
  expect('1.1 total = 0', p.total, 0);
  expect('1.2 suggestedCount = 0', p.suggestedCount, 0);
  expect('1.3 triedCount = 0', p.triedCount, 0);
  expect('1.4 workedCount = 0', p.workedCount, 0);
  expect('1.5 notWorkedCount = 0', p.notWorkedCount, 0);
  expect('1.6 skippedCount = 0', p.skippedCount, 0);
  expect('1.7 firstWorkedTitle = ""', p.firstWorkedTitle, '');
  expect('1.8 lastTriedTitle = ""', p.lastTriedTitle, '');
  expect('1.9 workedSource = ""', p.workedSource, '');
  expect(
    '1.10 outcomeSummary = "Toplam 0 · Denenen 0 · Başarılı 0 · Başarısız 0"',
    p.outcomeSummary,
    'Toplam 0 · Denenen 0 · Başarılı 0 · Başarısız 0',
  );
}

// ── 2) Status grouping ────────────────────────────────────────
console.log('\n── 2) Status grouping: 5 farklı status ─────────────────');
{
  const steps = [
    { status: 'suggested',  stepIndex: 1, title: 's-suggested', source: 'manual' },
    { status: 'tried',      stepIndex: 2, title: 's-tried',     source: 'manual' },
    { status: 'worked',     stepIndex: 3, title: 's-worked',    source: 'external_kb',     outcomeAt: '2026-01-15T10:00:00Z' },
    { status: 'not_worked', stepIndex: 4, title: 's-notworked', source: 'manual',          outcomeAt: '2026-01-16T10:00:00Z' },
    { status: 'skipped',    stepIndex: 5, title: 's-skipped',   source: 'ai_suggested_step', outcomeAt: '2026-01-17T10:00:00Z' },
  ];
  const p = summarize(steps);
  expect('2.1 total = 5', p.total, 5);
  expect('2.2 suggestedCount = 1', p.suggestedCount, 1);
  expect('2.3 triedCount = 3 (tried + worked + not_worked)', p.triedCount, 3);
  expect('2.4 workedCount = 1', p.workedCount, 1);
  expect('2.5 notWorkedCount = 1', p.notWorkedCount, 1);
  expect('2.6 skippedCount = 1', p.skippedCount, 1);
  expect('2.7 firstWorkedTitle = "s-worked"', p.firstWorkedTitle, 's-worked');
  expect(
    '2.8 outcomeSummary = "Toplam 5 · Denenen 3 · Başarılı 1 · Başarısız 1"',
    p.outcomeSummary,
    'Toplam 5 · Denenen 3 · Başarılı 1 · Başarısız 1',
  );
}

// ── 3) firstWorkedTitle ordering ──────────────────────────────
console.log('\n── 3) firstWorkedTitle: outcomeAt ASC → stepIndex ASC ───');
{
  // (a) iki worked, outcomeAt farklı → erken outcomeAt kazanır
  const p1 = summarize([
    { status: 'worked', stepIndex: 1, title: 'late',  source: 'external_kb', outcomeAt: '2026-03-01T00:00:00Z' },
    { status: 'worked', stepIndex: 2, title: 'early', source: 'external_kb', outcomeAt: '2026-01-01T00:00:00Z' },
  ]);
  expect('3.1 outcomeAt erken kazanır (stepIndex farkı ignore)', p1.firstWorkedTitle, 'early');

  // (b) aynı outcomeAt → düşük stepIndex kazanır
  const p2 = summarize([
    { status: 'worked', stepIndex: 5, title: 'idx-5', source: 'manual', outcomeAt: '2026-01-01T00:00:00Z' },
    { status: 'worked', stepIndex: 2, title: 'idx-2', source: 'manual', outcomeAt: '2026-01-01T00:00:00Z' },
  ]);
  expect('3.2 aynı outcomeAt → stepIndex ASC', p2.firstWorkedTitle, 'idx-2');

  // (c) outcomeAt null değer: timeOrZero 0'a düşer → stepIndex ASC ile sırala
  const p3 = summarize([
    { status: 'worked', stepIndex: 3, title: 'idx-3-null', source: 'manual', outcomeAt: null },
    { status: 'worked', stepIndex: 1, title: 'idx-1-null', source: 'manual', outcomeAt: null },
  ]);
  expect('3.3 outcomeAt null → stepIndex fallback', p3.firstWorkedTitle, 'idx-1-null');

  // (d) workedSource — ilk başarılı adımın source'unu döner (ham, format değil)
  const p4 = summarize([
    { status: 'worked', stepIndex: 1, title: 'a', source: 'external_kb',   outcomeAt: '2026-01-10T00:00:00Z' },
    { status: 'worked', stepIndex: 2, title: 'b', source: 'ai_suggested_step', outcomeAt: '2026-01-05T00:00:00Z' },
  ]);
  expect('3.4 workedSource = first-worked.source ham', p4.workedSource, 'ai_suggested_step');
  expect('3.4b firstWorkedTitle = "b" (erken outcomeAt)', p4.firstWorkedTitle, 'b');
}

// ── 4) lastTriedTitle ordering ────────────────────────────────
console.log('\n── 4) lastTriedTitle: max(outcomeAt, triedAt, updatedAt) DESC ──');
{
  // En son outcome veren step son denenen sayılır
  const p = summarize([
    { status: 'tried',      stepIndex: 1, title: 'a-tried',     source: 'manual', triedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { status: 'worked',     stepIndex: 2, title: 'b-worked',    source: 'manual', outcomeAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    { status: 'not_worked', stepIndex: 3, title: 'c-notworked', source: 'manual', outcomeAt: '2026-01-15T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z' },
  ]);
  expect('4.1 lastTriedTitle en yüksek COALESCE → "b-worked"', p.lastTriedTitle, 'b-worked');

  // skipped da COMPLETED_STATUSES kapsamında — outcomeAt'ı en sondaysa kazanır
  const p2 = summarize([
    { status: 'tried',   stepIndex: 1, title: 'old-tried',  source: 'manual', triedAt:  '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { status: 'skipped', stepIndex: 2, title: 'late-skipped', source: 'manual', outcomeAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
  ]);
  expect('4.2 skipped COMPLETED_STATUSES içinde → en geç olan kazanır', p2.lastTriedTitle, 'late-skipped');

  // suggested asla lastTried olmaz (COMPLETED_STATUSES dışı)
  const p3 = summarize([
    { status: 'suggested', stepIndex: 1, title: 'sug', source: 'manual', updatedAt: '2026-09-01T00:00:00Z' },
    { status: 'tried',     stepIndex: 2, title: 'tri', source: 'manual', triedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  expect('4.3 suggested COMPLETED_STATUSES dışı → lastTried "tri"', p3.lastTriedTitle, 'tri');
}

// ── 5) workedSource formatter (TR labels) ─────────────────────
console.log('\n── 5) workedSource formatter — solutionStepSource TR labels ──');
{
  const col = { type: 'string', format: 'solutionStepSource' };
  expect('5.1 external_kb → Bilgi Bankası',       applyFormat(col, 'external_kb'),       'Bilgi Bankası');
  expect('5.2 ai_suggested_step → AI Önerisi',    applyFormat(col, 'ai_suggested_step'), 'AI Önerisi');
  expect('5.3 manual → Manuel',                   applyFormat(col, 'manual'),            'Manuel');
  expect('5.4 similar_case → Benzer Vaka',        applyFormat(col, 'similar_case'),      'Benzer Vaka');
  expect('5.5 unknown → raw fallback',            applyFormat(col, 'future_source'),     'future_source');
  expect('5.6 null → ""',                         applyFormat(col, null),                '');
  expect('5.7 undefined → ""',                    applyFormat(col, undefined),           '');
}

// ── 6) buildReportRows aggregate routing ──────────────────────
console.log('\n── 6) buildReportRows — aggregate column routing ─────');
{
  const { columns, invalidIds } = resolveColumns([
    'caseNumber',
    'solutionSteps.total',
    'solutionSteps.workedCount',
    'solutionSteps.firstWorkedTitle',
    'solutionSteps.workedSource',
    'solutionSteps.outcomeSummary',
  ]);
  expect('6.0 resolveColumns invalidIds = []', invalidIds, []);
  expect('6.0b 6 kolon resolve etti', columns.length, 6);

  const fakeCase = { id: 'C1', caseNumber: 'CASE-001' };
  const stepAggs = new Map();
  stepAggs.set('C1', {
    total: 3,
    suggestedCount: 0,
    triedCount: 2,
    workedCount: 1,
    notWorkedCount: 1,
    skippedCount: 0,
    firstWorkedTitle: 'AI suggested step #1',
    lastTriedTitle: 'manual step #2',
    workedSource: 'external_kb',
    outcomeSummary: 'Toplam 3 · Denenen 2 · Başarılı 1 · Başarısız 1',
  });

  const rows = buildReportRows([fakeCase], columns, { solutionSteps: stepAggs });
  expect('6.1 rows.length = 1', rows.length, 1);
  expect('6.2 caseNumber scalar pass-through', rows[0]['caseNumber'], 'CASE-001');
  // applyFormat number type → numeric string
  expect('6.3 total → "3"', rows[0]['solutionSteps.total'], '3');
  expect('6.4 workedCount → "1"', rows[0]['solutionSteps.workedCount'], '1');
  expect('6.5 firstWorkedTitle pass-through', rows[0]['solutionSteps.firstWorkedTitle'], 'AI suggested step #1');
  // workedSource formatter → TR label
  expect('6.6 workedSource formatted TR', rows[0]['solutionSteps.workedSource'], 'Bilgi Bankası');
  expect('6.7 outcomeSummary pass-through', rows[0]['solutionSteps.outcomeSummary'], 'Toplam 3 · Denenen 2 · Başarılı 1 · Başarısız 1');

  // Missing aggregates map: backend perspektifinden bu durum yalnız
  // aggregate kolon SEÇİLMEDİYSE oluşur — ama defansif sözleşme:
  // aggregates undefined → aggregate cells '' / '' / '' (crash YOK).
  const rowsNoAgg = buildReportRows([fakeCase], columns, undefined);
  expect('6.8 missing aggregates: caseNumber yine pass-through', rowsNoAgg[0]['caseNumber'], 'CASE-001');
  expect('6.9 missing aggregates: total blank ""', rowsNoAgg[0]['solutionSteps.total'], '');
  expect('6.10 missing aggregates: workedSource blank ""', rowsNoAgg[0]['solutionSteps.workedSource'], '');

  // Empty Map entry (case-id'si aggregate Map'te YOK ama solutionSteps key'i var):
  const rowsEmptyMap = buildReportRows([fakeCase], columns, { solutionSteps: new Map() });
  expect('6.11 boş Map: total blank ""', rowsEmptyMap[0]['solutionSteps.total'], '');
  expect('6.12 boş Map: outcomeSummary blank ""', rowsEmptyMap[0]['solutionSteps.outcomeSummary'], '');
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
