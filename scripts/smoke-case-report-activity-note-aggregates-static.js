/**
 * smoke-case-report-activity-note-aggregates-static.js
 *
 * Phase 2B.1 — CaseActivity + CaseNote aggregate pure logic için DB-bağımsız
 * smoke. Phase 2A regression'unu da içerir.
 *
 * Senaryolar:
 *   1. Registry kontrat: 10 yeni kolon + Performans/Akış kategori
 *      + Phase 2A solutionSteps kolonları korundu
 *   2. CaseActivity summarize (empty + dolu fixture)
 *   3. CaseActivity StatusChange tespiti + compact string formatı
 *   4. CaseNote summarize (empty + Internal/Customer split)
 *   5. buildReportRows tüm 3 aggregate map'i (solutionSteps + caseActivity
 *      + caseNote) eş zamanlı routing — Phase 2A regression
 *   6. Empty aggregate map → blank/zero-safe (rapor kırılmaz)
 *   7. Loader API contract — loadCaseActivity / loadCaseNote fonksiyon
 *      sözleşmesi (boş caseIds → boş Map; fake prisma mock ile batch path)
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-activity-note-aggregates-static.js
 *
 * Env/DB/network bağımlılığı yok.
 */

import {
  REPORT_COLUMNS,
  REPORT_COLUMN_CATEGORIES,
  resolveColumns,
  needsCaseActivityAggregates,
  needsCaseNoteAggregates,
  needsSolutionStepAggregates,
} from '../server/lib/caseReport/columnRegistry.js';
import { buildReportRows } from '../server/lib/caseReport/buildRows.js';
import {
  loadCaseActivityAggregates,
  loadCaseNoteAggregates,
  __internal,
} from '../server/lib/caseReport/aggregates.js';

const {
  summarizeActivities,
  buildEmptyActivityPayload,
  summarizeNotes,
  buildEmptyNotePayload,
} = __internal;

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ── 1) Registry kontrat ────────────────────────────────────────
console.log('── 1) Registry kontrat ─────────────────────────────────');
{
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  expect('1.1 performans_flow kategori mevcut', REPORT_COLUMN_CATEGORIES.performance_flow, 'Performans / Akış');
  // 10 yeni kolon
  const expected = [
    'activity.firstActor',
    'activity.lastActor',
    'activity.lastActivityAt',
    'activity.activityCount',
    'activity.lastStatusChange',
    'note.noteCount',
    'note.lastNoteAt',
    'note.lastNoteAuthor',
    'note.internalNoteCount',
    'note.externalNoteCount',
  ];
  let missing = [];
  for (const id of expected) if (!ids.has(id)) missing.push(id);
  if (missing.length === 0) ok('1.2 10 yeni Performans/Akış kolonu registry\'de var');
  else bad('1.2 Eksik id', `missing=${missing.join(',')}`);
  // Phase 2A solutionSteps korundu
  const phase2aIds = [
    'solutionSteps.total',
    'solutionSteps.workedCount',
    'solutionSteps.firstWorkedTitle',
    'solutionSteps.outcomeSummary',
  ];
  let missing2a = [];
  for (const id of phase2aIds) if (!ids.has(id)) missing2a.push(id);
  if (missing2a.length === 0) ok('1.3 Phase 2A solutionSteps kolonları korundu');
  else bad('1.3 Phase 2A regression', `missing=${missing2a.join(',')}`);
  // Helper functions
  const { columns: cols1 } = resolveColumns(['activity.firstActor']);
  expect('1.4 needsCaseActivityAggregates(activity.firstActor) = true', needsCaseActivityAggregates(cols1), true);
  const { columns: cols2 } = resolveColumns(['note.noteCount']);
  expect('1.5 needsCaseNoteAggregates(note.noteCount) = true', needsCaseNoteAggregates(cols2), true);
  const { columns: cols3 } = resolveColumns(['caseNumber']);
  expect('1.6 caseNumber için needsCaseActivity = false', needsCaseActivityAggregates(cols3), false);
  expect('1.7 caseNumber için needsCaseNote = false', needsCaseNoteAggregates(cols3), false);
  expect('1.8 caseNumber için needsSolutionStep = false', needsSolutionStepAggregates(cols3), false);
}

// ── 2) CaseActivity summarize — empty + dolu ─────────────────
console.log('\n── 2) summarizeActivities ───────────────────────────────');
{
  const empty = summarizeActivities([]);
  expect('2.1 empty.activityCount = 0', empty.activityCount, 0);
  expect('2.2 empty.firstActor = ""', empty.firstActor, '');
  expect('2.3 empty.lastActor = ""', empty.lastActor, '');
  expect('2.4 empty.lastActivityAt = null', empty.lastActivityAt, null);
  expect('2.5 empty.lastStatusChange = ""', empty.lastStatusChange, '');

  const rows = [
    { at: '2026-01-01T08:00:00Z', actor: 'Agent A', actionType: 'NoteAdded',     toValue: null },
    { at: '2026-01-15T10:00:00Z', actor: 'Agent B', actionType: 'StatusChange',  toValue: 'İncelemede' },
    { at: '2026-02-10T12:00:00Z', actor: 'Agent C', actionType: 'FieldUpdate',   toValue: null },
    { at: '2026-03-05T14:00:00Z', actor: 'Agent D', actionType: 'StatusChange',  toValue: 'Çözüldü' },
  ];
  const p = summarizeActivities(rows);
  expect('2.6 activityCount = 4', p.activityCount, 4);
  expect('2.7 firstActor = "Agent A"', p.firstActor, 'Agent A');
  expect('2.8 lastActor = "Agent D"', p.lastActor, 'Agent D');
  expect('2.9 lastActivityAt instanceof Date', p.lastActivityAt instanceof Date, true);
  // Son StatusChange = Agent D'nin commit'i, "Çözüldü"
  if (p.lastStatusChange.startsWith('Çözüldü ·')) ok('2.10 lastStatusChange = "Çözüldü · <tarih>"', p.lastStatusChange);
  else bad('2.10 lastStatusChange beklenen prefix yok', p.lastStatusChange);
}

// ── 3) StatusChange compact string ────────────────────────────
console.log('\n── 3) lastStatusChange — tek StatusChange + sıralı seçim ──');
{
  // tek StatusChange
  const p1 = summarizeActivities([
    { at: '2026-04-01T09:00:00Z', actor: 'Sup A', actionType: 'StatusChange', toValue: 'Eskalasyon' },
  ]);
  if (p1.lastStatusChange.startsWith('Eskalasyon ·')) ok('3.1 Tek StatusChange compact OK');
  else bad('3.1', p1.lastStatusChange);

  // Hiç StatusChange yok → ''
  const p2 = summarizeActivities([
    { at: '2026-04-01T09:00:00Z', actor: 'X', actionType: 'NoteAdded', toValue: null },
  ]);
  expect('3.2 StatusChange yoksa = ""', p2.lastStatusChange, '');

  // Birden çok StatusChange → en geç olan kazanır
  const p3 = summarizeActivities([
    { at: '2026-04-01T09:00:00Z', actor: 'A', actionType: 'StatusChange', toValue: 'İncelemede' },
    { at: '2026-04-05T09:00:00Z', actor: 'B', actionType: 'StatusChange', toValue: 'Çözüldü' },
    { at: '2026-04-03T09:00:00Z', actor: 'C', actionType: 'StatusChange', toValue: 'Eskalasyon' },
  ]);
  if (p3.lastStatusChange.startsWith('Çözüldü ·')) ok('3.3 En son StatusChange = Çözüldü', p3.lastStatusChange);
  else bad('3.3 En son StatusChange yanlış', p3.lastStatusChange);
}

// ── 4) CaseNote summarize — Internal/Customer split + lastBy ──
console.log('\n── 4) summarizeNotes ────────────────────────────────────');
{
  const empty = summarizeNotes([]);
  expect('4.1 empty.noteCount = 0', empty.noteCount, 0);
  expect('4.2 empty.lastNoteAt = null', empty.lastNoteAt, null);
  expect('4.3 empty.lastNoteAuthor = ""', empty.lastNoteAuthor, '');
  expect('4.4 empty.internalNoteCount = 0', empty.internalNoteCount, 0);
  expect('4.5 empty.externalNoteCount = 0', empty.externalNoteCount, 0);

  const rows = [
    { createdAt: '2026-01-10T08:00:00Z', authorName: 'A', visibility: 'Internal' },
    { createdAt: '2026-02-15T10:00:00Z', authorName: 'B', visibility: 'Customer' },
    { createdAt: '2026-03-20T12:00:00Z', authorName: 'C', visibility: 'Internal' },
    { createdAt: '2026-05-01T14:00:00Z', authorName: 'D', visibility: 'Customer' },
    { createdAt: '2026-04-05T16:00:00Z', authorName: 'E', visibility: 'unknown_value' },
  ];
  const p = summarizeNotes(rows);
  expect('4.6 noteCount = 5', p.noteCount, 5);
  expect('4.7 internalNoteCount = 2', p.internalNoteCount, 2);
  expect('4.8 externalNoteCount = 2 (Customer)', p.externalNoteCount, 2);
  // unknown_value bilinmeyen → iki sayaca dahil değil
  expect('4.9 unknown visibility iki sayaca dahil değil', p.internalNoteCount + p.externalNoteCount, 4);
  expect('4.10 lastNoteAuthor = "D" (en geç createdAt)', p.lastNoteAuthor, 'D');
  expect('4.11 lastNoteAt instanceof Date', p.lastNoteAt instanceof Date, true);
}

// ── 5) buildReportRows — 3 aggregate eş zamanlı routing ───────
console.log('\n── 5) buildReportRows: solutionSteps + caseActivity + caseNote ──');
{
  const { columns, invalidIds } = resolveColumns([
    'caseNumber',
    'solutionSteps.workedCount',
    'activity.activityCount',
    'activity.lastStatusChange',
    'note.noteCount',
    'note.externalNoteCount',
  ]);
  expect('5.1 invalidIds = []', invalidIds, []);
  expect('5.2 6 kolon resolve', columns.length, 6);

  const fakeCase = { id: 'C1', caseNumber: 'CASE-001' };
  const stepAggs = new Map([['C1', { workedCount: 2, total: 5, suggestedCount: 0, triedCount: 3, notWorkedCount: 1, skippedCount: 1, firstWorkedTitle: '', lastTriedTitle: '', workedSource: '', outcomeSummary: '' }]]);
  const actAggs = new Map([['C1', { activityCount: 8, firstActor: 'X', lastActor: 'Y', lastActivityAt: null, lastStatusChange: 'Çözüldü · 16.06.2026 12:00' }]]);
  const noteAggs = new Map([['C1', { noteCount: 4, internalNoteCount: 3, externalNoteCount: 1, lastNoteAt: null, lastNoteAuthor: 'Z' }]]);

  const rows = buildReportRows([fakeCase], columns, {
    solutionSteps: stepAggs,
    caseActivity: actAggs,
    caseNote: noteAggs,
  });
  expect('5.3 caseNumber pass-through', rows[0]['caseNumber'], 'CASE-001');
  expect('5.4 solutionSteps.workedCount → "2"', rows[0]['solutionSteps.workedCount'], '2');
  expect('5.5 activity.activityCount → "8"', rows[0]['activity.activityCount'], '8');
  expect('5.6 activity.lastStatusChange pass-through', rows[0]['activity.lastStatusChange'], 'Çözüldü · 16.06.2026 12:00');
  expect('5.7 note.noteCount → "4"', rows[0]['note.noteCount'], '4');
  expect('5.8 note.externalNoteCount → "1"', rows[0]['note.externalNoteCount'], '1');
}

// ── 6) Empty aggregate map / missing case → blank/zero-safe ───
console.log('\n── 6) Boş aggregate map — rapor kırılmıyor ─────────────');
{
  const { columns } = resolveColumns([
    'activity.firstActor',
    'activity.activityCount',
    'note.noteCount',
    'note.lastNoteAuthor',
  ]);
  const fakeCase = { id: 'CX', caseNumber: 'CASE-X' };
  // Tüm Map'ler undefined (aggregate hiç fetch edilmedi)
  const rows = buildReportRows([fakeCase], columns, undefined);
  expect('6.1 missing aggregates: firstActor = ""', rows[0]['activity.firstActor'], '');
  expect('6.2 missing aggregates: activityCount = ""', rows[0]['activity.activityCount'], '');
  expect('6.3 missing aggregates: noteCount = ""', rows[0]['note.noteCount'], '');
  expect('6.4 missing aggregates: lastNoteAuthor = ""', rows[0]['note.lastNoteAuthor'], '');

  // Aggregate map var ama bu caseId yok
  const rows2 = buildReportRows([fakeCase], columns, {
    caseActivity: new Map(),
    caseNote: new Map(),
  });
  expect('6.5 empty map: firstActor = ""', rows2[0]['activity.firstActor'], '');
  expect('6.6 empty map: noteCount = ""', rows2[0]['note.noteCount'], '');
}

// ── 7) Loader API contract — boş caseIds + fake prisma ────────
console.log('\n── 7) Loader sözleşmesi ─────────────────────────────────');
{
  const emptyMap = await loadCaseActivityAggregates({}, []);
  expect('7.1 loadCaseActivity([]) = boş Map', emptyMap.size, 0);
  const emptyMap2 = await loadCaseNoteAggregates({}, []);
  expect('7.2 loadCaseNote([]) = boş Map', emptyMap2.size, 0);

  // Fake prisma — caseActivity.findMany invocation paterni
  const fakePrisma = {
    caseActivity: {
      findMany: async ({ where, select }) => {
        // Argument shape teyit
        if (!where?.caseId?.in || !select?.caseId) throw new Error('beklenen şekil değil');
        return [
          { caseId: 'C1', actor: 'A', at: new Date('2026-01-01'), actionType: 'NoteAdded', toValue: null },
          { caseId: 'C1', actor: 'B', at: new Date('2026-02-01'), actionType: 'StatusChange', toValue: 'Çözüldü' },
          { caseId: 'C2', actor: 'X', at: new Date('2026-03-01'), actionType: 'FieldUpdate', toValue: null },
        ];
      },
    },
    caseNote: {
      findMany: async ({ where, select }) => {
        if (!where?.caseId?.in || !select?.caseId) throw new Error('beklenen şekil değil');
        return [
          { caseId: 'C1', authorName: 'A', visibility: 'Internal', createdAt: new Date('2026-01-10') },
          { caseId: 'C1', authorName: 'B', visibility: 'Customer', createdAt: new Date('2026-02-10') },
        ];
      },
    },
  };

  const actMap = await loadCaseActivityAggregates(fakePrisma, ['C1', 'C2', 'C3']);
  expect('7.3 actMap.size = 3 (her caseId için entry — C3 boş bile)', actMap.size, 3);
  expect('7.4 C1.activityCount = 2', actMap.get('C1').activityCount, 2);
  expect('7.5 C2.activityCount = 1', actMap.get('C2').activityCount, 1);
  expect('7.6 C3 (boş) = activityCount 0', actMap.get('C3').activityCount, 0);
  expect('7.7 C3 (boş) = lastStatusChange ""', actMap.get('C3').lastStatusChange, '');
  if (actMap.get('C1').lastStatusChange.startsWith('Çözüldü ·')) ok('7.8 C1 lastStatusChange başlığı doğru');
  else bad('7.8 C1 lastStatusChange', actMap.get('C1').lastStatusChange);

  const noteMap = await loadCaseNoteAggregates(fakePrisma, ['C1', 'C2']);
  expect('7.9 noteMap.size = 2', noteMap.size, 2);
  expect('7.10 C1.noteCount = 2', noteMap.get('C1').noteCount, 2);
  expect('7.11 C1.internalNoteCount = 1', noteMap.get('C1').internalNoteCount, 1);
  expect('7.12 C1.externalNoteCount = 1', noteMap.get('C1').externalNoteCount, 1);
  expect('7.13 C2 (boş) = noteCount 0', noteMap.get('C2').noteCount, 0);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
