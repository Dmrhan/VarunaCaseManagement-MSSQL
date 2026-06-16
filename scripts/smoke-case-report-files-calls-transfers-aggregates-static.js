/**
 * smoke-case-report-files-calls-transfers-aggregates-static.js
 *
 * Phase 2B.2 — CaseAttachment + CaseCallLog + CaseTransfer aggregate
 * DB-bağımsız static smoke. Phase 2A + 2B.1 regression'unu da içerir.
 *
 * Senaryolar:
 *   1. Registry kontrat: 8 yeni kolon (file/call/transfer × 2-3) +
 *      Phase 2A + 2B.1 kolonları korundu
 *   2. bytesToMb helper edge case'leri
 *   3. summarizeFiles (empty + dolu, size hesabı)
 *   4. summarizeCalls (empty + dolu, lastCallResult sıralı seçim)
 *   5. summarizeTransfers (empty + dolu, team isim eşleme + fallback)
 *   6. buildReportRows 6 aggregate eş zamanlı routing
 *   7. Empty aggregate map → blank/zero-safe
 *   8. Loader API contract — fake prisma ile batch path + N+1 yokluğu
 *      (file/call/transfer × bir findMany; transfer için ek tek team findMany)
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-files-calls-transfers-aggregates-static.js
 *
 * Env/DB/network bağımlılığı yok.
 */

import {
  REPORT_COLUMNS,
  REPORT_COLUMN_CATEGORIES,
  resolveColumns,
  needsCaseFileAggregates,
  needsCaseCallAggregates,
  needsCaseTransferAggregates,
  needsCaseActivityAggregates,
  needsCaseNoteAggregates,
  needsSolutionStepAggregates,
} from '../server/lib/caseReport/columnRegistry.js';
import { buildReportRows } from '../server/lib/caseReport/buildRows.js';
import {
  loadCaseFileAggregates,
  loadCaseCallAggregates,
  loadCaseTransferAggregates,
  __internal,
} from '../server/lib/caseReport/aggregates.js';

const {
  bytesToMb,
  summarizeFiles,
  buildEmptyFilePayload,
  summarizeCalls,
  buildEmptyCallPayload,
  summarizeTransfers,
  buildEmptyTransferPayload,
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

// ── 1) Registry kontrat ───────────────────────────────────────
console.log('── 1) Registry kontrat ─────────────────────────────────');
{
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  const expected = [
    'file.fileCount',
    'file.totalSizeMb',
    'call.callCount',
    'call.lastCallResult',
    'call.lastCallAt',
    'transfer.transferCount',
    'transfer.lastTransferTargetTeam',
    'transfer.lastTransferAt',
  ];
  let missing = [];
  for (const id of expected) if (!ids.has(id)) missing.push(id);
  if (missing.length === 0) ok('1.1 8 yeni File/Call/Transfer kolonu registry\'de var');
  else bad('1.1 Eksik id', `missing=${missing.join(',')}`);

  // Phase 2A regression
  const phase2a = ['solutionSteps.total', 'solutionSteps.outcomeSummary'];
  for (const id of phase2a) {
    if (!ids.has(id)) bad(`1.2 Phase 2A regression: ${id} eksik`);
  }
  if (phase2a.every((id) => ids.has(id))) ok('1.2 Phase 2A solutionSteps korundu');

  // Phase 2B.1 regression
  const phase2b1 = ['activity.firstActor', 'activity.lastStatusChange', 'note.noteCount', 'note.externalNoteCount'];
  for (const id of phase2b1) {
    if (!ids.has(id)) bad(`1.3 Phase 2B.1 regression: ${id} eksik`);
  }
  if (phase2b1.every((id) => ids.has(id))) ok('1.3 Phase 2B.1 activity/note korundu');

  expect('1.4 Performans/Akış kategori adı', REPORT_COLUMN_CATEGORIES.performance_flow, 'Performans / Akış');

  // needs helpers
  const { columns: cf } = resolveColumns(['file.fileCount']);
  expect('1.5 needsCaseFile(file.fileCount) = true', needsCaseFileAggregates(cf), true);
  const { columns: cc } = resolveColumns(['call.callCount']);
  expect('1.6 needsCaseCall(call.callCount) = true', needsCaseCallAggregates(cc), true);
  const { columns: ct } = resolveColumns(['transfer.transferCount']);
  expect('1.7 needsCaseTransfer(transfer.transferCount) = true', needsCaseTransferAggregates(ct), true);

  // Cross-isolation: file kolon seçildiyse call/transfer helper'ları false
  expect('1.8 file kolon seçimi → needsCall = false', needsCaseCallAggregates(cf), false);
  expect('1.9 file kolon seçimi → needsTransfer = false', needsCaseTransferAggregates(cf), false);
  // Aynı pattern Phase 2B.1 helper'ları için de korunuyor
  expect('1.10 file kolon → needsActivity = false', needsCaseActivityAggregates(cf), false);
  expect('1.11 file kolon → needsSolutionStep = false', needsSolutionStepAggregates(cf), false);

  // Toplam registry'de Phase 2B.2 sonrası beklenen yeni toplam (kategori ile orantılı)
  const performanceFlowCount = REPORT_COLUMNS.filter((c) => c.category === 'performance_flow').length;
  if (performanceFlowCount === 18) ok(`1.12 performance_flow kategorisi 18 kolon (2B.1 10 + 2B.2 8)`);
  else bad('1.12 performance_flow kolon sayısı', `got=${performanceFlowCount} expected=18`);
}

// ── 2) bytesToMb helper ──────────────────────────────────────
console.log('\n── 2) bytesToMb edge case ──────────────────────────────');
{
  expect('2.1 0 → ""', bytesToMb(0), '');
  expect('2.2 -50 → ""', bytesToMb(-50), '');
  expect('2.3 NaN → ""', bytesToMb(NaN), '');
  // 1 MB → 1.0
  expect('2.4 1 MB → "1.0"', bytesToMb(1024 * 1024), '1.0');
  // 0.05 MB → 2 ondalık 0.05
  expect('2.5 0.05 MB → "0.05"', bytesToMb(1024 * 1024 * 0.05), '0.05');
  // 0.1 MB sınır → 1 ondalık (0.1)
  expect('2.6 ~0.1 MB → "0.1"', bytesToMb(1024 * 1024 * 0.1), '0.1');
  // Büyük (15 MB) → 1 ondalık
  expect('2.7 15.5 MB → "15.5"', bytesToMb(1024 * 1024 * 15.5), '15.5');
}

// ── 3) summarizeFiles ─────────────────────────────────────────
console.log('\n── 3) summarizeFiles ────────────────────────────────────');
{
  expect('3.1 empty → fileCount 0, totalSizeMb ""', summarizeFiles([]), buildEmptyFilePayload());
  // Dolu fixture (3 dosya, toplam 5 MB)
  const rows = [
    { fileSize: 1024 * 1024 * 2 }, // 2 MB
    { fileSize: 1024 * 1024 * 2.5 }, // 2.5 MB
    { fileSize: 1024 * 1024 * 0.5 }, // 0.5 MB
  ];
  const p = summarizeFiles(rows);
  expect('3.2 fileCount = 3', p.fileCount, 3);
  expect('3.3 totalSizeMb = "5.0"', p.totalSizeMb, '5.0');

  // Dosya var ama hepsi 0 byte → "0.0"
  const p0 = summarizeFiles([{ fileSize: 0 }, { fileSize: 0 }]);
  expect('3.4 zero-byte dosyalar fileCount=2 totalSizeMb="0.0"', p0, { fileCount: 2, totalSizeMb: '0.0' });
}

// ── 4) summarizeCalls — lastCallResult sıralı seçim ──────────
console.log('\n── 4) summarizeCalls ────────────────────────────────────');
{
  expect('4.1 empty → callCount 0, lastCallResult ""', summarizeCalls([]), buildEmptyCallPayload());

  const rows = [
    { callDate: '2026-01-10T08:00:00Z', callOutcome: 'Memnun' },
    { callDate: '2026-03-15T12:00:00Z', callOutcome: 'MemnunDeğil' },
    { callDate: '2026-02-20T10:00:00Z', callOutcome: 'Tarafsız' },
  ];
  const p = summarizeCalls(rows);
  expect('4.2 callCount = 3', p.callCount, 3);
  expect('4.3 lastCallResult = "MemnunDeğil" (en geç callDate)', p.lastCallResult, 'MemnunDeğil');
  expect('4.4 lastCallAt instanceof Date', p.lastCallAt instanceof Date, true);
}

// ── 5) summarizeTransfers — team name + fallback ─────────────
console.log('\n── 5) summarizeTransfers ────────────────────────────────');
{
  expect('5.1 empty → blank payload', summarizeTransfers([]), buildEmptyTransferPayload());

  const rows = [
    { toTeamId: 'TEAM-A', transferredAt: '2026-01-05T08:00:00Z' },
    { toTeamId: 'TEAM-B', transferredAt: '2026-03-10T12:00:00Z' },
    { toTeamId: 'TEAM-C', transferredAt: '2026-02-15T10:00:00Z' },
  ];
  const teamNamesById = new Map([
    ['TEAM-A', 'L1 Destek'],
    ['TEAM-B', 'L2 Mühendislik'],
    // TEAM-C yok → fallback ham id
  ]);
  const p = summarizeTransfers(rows, teamNamesById);
  expect('5.2 transferCount = 3', p.transferCount, 3);
  expect('5.3 lastTransferTargetTeam = "L2 Mühendislik" (en geç + name eşleşti)', p.lastTransferTargetTeam, 'L2 Mühendislik');
  expect('5.4 lastTransferAt Date', p.lastTransferAt instanceof Date, true);

  // teamNamesById verilmediyse → ham toTeamId döner
  const p2 = summarizeTransfers([{ toTeamId: 'X', transferredAt: '2026-01-01T00:00:00Z' }], null);
  expect('5.5 teamNamesById null → raw id', p2.lastTransferTargetTeam, 'X');
}

// ── 4b) Codex P2 fix — call.lastCallResult callOutcome formatter ──
console.log('\n── 4b) call.lastCallResult — DB ASCII → TR (Codex P2) ──');
{
  const { applyFormat } = await import('../server/lib/caseReport/formatters.js');
  const col = { type: 'string', format: 'callOutcome' };
  expect('4b.1 DB "MemnunDegil" → "Memnun Değil"', applyFormat(col, 'MemnunDegil'), 'Memnun Değil');
  expect('4b.2 DB "Tarafsiz" → "Tarafsız"',         applyFormat(col, 'Tarafsiz'),    'Tarafsız');
  expect('4b.3 DB "Ulasilamadi" → "Ulaşılamadı"',   applyFormat(col, 'Ulasilamadi'), 'Ulaşılamadı');
  expect('4b.4 DB "Memnun" → "Memnun" (no change)', applyFormat(col, 'Memnun'),      'Memnun');
  expect('4b.5 TR varyant "MemnunDeğil" → "Memnun Değil" (defansif)', applyFormat(col, 'MemnunDeğil'), 'Memnun Değil');
  expect('4b.6 null → ""',                          applyFormat(col, null),          '');
  // buildReportRows ile: callOutcome formatter aggregate kolonunda devreye girer
  const { columns } = resolveColumns(['caseNumber', 'call.lastCallResult']);
  const fakeCase = { id: 'C9', caseNumber: 'CASE-009' };
  const callMap = new Map([['C9', { callCount: 3, lastCallResult: 'MemnunDegil', lastCallAt: null }]]);
  const rows = buildReportRows([fakeCase], columns, { caseCall: callMap });
  expect('4b.7 aggregate routing + formatter zinciri = "Memnun Değil"', rows[0]['call.lastCallResult'], 'Memnun Değil');
}

// ── 6) buildReportRows — 6 aggregate eş zamanlı routing ──────
console.log('\n── 6) buildReportRows tüm aggregate türleri ────────────');
{
  const { columns } = resolveColumns([
    'caseNumber',
    'solutionSteps.workedCount',
    'activity.activityCount',
    'note.noteCount',
    'file.fileCount',
    'file.totalSizeMb',
    'call.callCount',
    'call.lastCallResult',
    'transfer.transferCount',
    'transfer.lastTransferTargetTeam',
  ]);
  expect('6.1 10 kolon resolve', columns.length, 10);

  const fakeCase = { id: 'C1', caseNumber: 'CASE-001' };
  const aggs = {
    solutionSteps: new Map([['C1', { workedCount: 1, total: 2, suggestedCount: 0, triedCount: 1, notWorkedCount: 0, skippedCount: 1, firstWorkedTitle: '', lastTriedTitle: '', workedSource: '', outcomeSummary: '' }]]),
    caseActivity:  new Map([['C1', { activityCount: 5, firstActor: 'X', lastActor: 'Y', lastActivityAt: null, lastStatusChange: '' }]]),
    caseNote:      new Map([['C1', { noteCount: 2, internalNoteCount: 1, externalNoteCount: 1, lastNoteAt: null, lastNoteAuthor: '' }]]),
    caseFile:      new Map([['C1', { fileCount: 3, totalSizeMb: '5.0' }]]),
    caseCall:      new Map([['C1', { callCount: 4, lastCallResult: 'Memnun', lastCallAt: null }]]),
    caseTransfer:  new Map([['C1', { transferCount: 2, lastTransferTargetTeam: 'L2 Mühendislik', lastTransferAt: null }]]),
  };
  const rows = buildReportRows([fakeCase], columns, aggs);
  expect('6.2 caseNumber',                rows[0]['caseNumber'],                       'CASE-001');
  expect('6.3 solutionSteps.workedCount', rows[0]['solutionSteps.workedCount'],        '1');
  expect('6.4 activity.activityCount',    rows[0]['activity.activityCount'],           '5');
  expect('6.5 note.noteCount',            rows[0]['note.noteCount'],                   '2');
  expect('6.6 file.fileCount',            rows[0]['file.fileCount'],                   '3');
  expect('6.7 file.totalSizeMb',          rows[0]['file.totalSizeMb'],                 '5.0');
  expect('6.8 call.callCount',            rows[0]['call.callCount'],                   '4');
  expect('6.9 call.lastCallResult',       rows[0]['call.lastCallResult'],              'Memnun');
  expect('6.10 transfer.transferCount',   rows[0]['transfer.transferCount'],           '2');
  expect('6.11 transfer.lastTransferTargetTeam', rows[0]['transfer.lastTransferTargetTeam'], 'L2 Mühendislik');
}

// ── 7) Empty aggregate map → blank/zero-safe ──────────────────
console.log('\n── 7) Boş aggregate map — rapor kırılmıyor ─────────────');
{
  const { columns } = resolveColumns([
    'file.fileCount', 'file.totalSizeMb',
    'call.callCount', 'call.lastCallResult',
    'transfer.transferCount', 'transfer.lastTransferTargetTeam',
  ]);
  const fakeCase = { id: 'CX', caseNumber: 'CASE-X' };
  const rows = buildReportRows([fakeCase], columns, undefined);
  expect('7.1 missing aggregates: file.fileCount = ""', rows[0]['file.fileCount'], '');
  expect('7.2 missing aggregates: file.totalSizeMb = ""', rows[0]['file.totalSizeMb'], '');
  expect('7.3 missing aggregates: call.callCount = ""', rows[0]['call.callCount'], '');
  expect('7.4 missing aggregates: call.lastCallResult = ""', rows[0]['call.lastCallResult'], '');
  expect('7.5 missing aggregates: transfer.transferCount = ""', rows[0]['transfer.transferCount'], '');
  expect('7.6 missing aggregates: transfer.lastTransferTargetTeam = ""', rows[0]['transfer.lastTransferTargetTeam'], '');
}

// ── 8) Loader API contract + N+1 yokluğu ──────────────────────
console.log('\n── 8) Loader sözleşmesi + batch query sayısı ─────────');
{
  // Boş caseIds → boş Map
  expect('8.1 loadCaseFile([]) = boş Map',     (await loadCaseFileAggregates({}, [])).size, 0);
  expect('8.2 loadCaseCall([]) = boş Map',     (await loadCaseCallAggregates({}, [])).size, 0);
  expect('8.3 loadCaseTransfer([]) = boş Map', (await loadCaseTransferAggregates({}, [])).size, 0);

  // File loader — TEK findMany çağrısı
  let fileFindManyCount = 0;
  const fakePrismaFile = {
    caseAttachment: {
      findMany: async ({ where, select }) => {
        fileFindManyCount += 1;
        if (!where?.caseId?.in || !select?.caseId || !select?.fileSize) throw new Error('shape');
        return [
          { caseId: 'C1', fileSize: 1024 * 1024 * 2 },
          { caseId: 'C1', fileSize: 1024 * 1024 * 3 },
          { caseId: 'C2', fileSize: 1024 * 1024 * 1 },
        ];
      },
    },
  };
  const fileMap = await loadCaseFileAggregates(fakePrismaFile, ['C1', 'C2', 'C3']);
  expect('8.4 file loader fakePrisma.findMany TEK kez çağrıldı (N+1 yok)', fileFindManyCount, 1);
  expect('8.5 fileMap.size = 3 (her caseId entry)', fileMap.size, 3);
  expect('8.6 C1.fileCount = 2', fileMap.get('C1').fileCount, 2);
  expect('8.7 C1.totalSizeMb = "5.0"', fileMap.get('C1').totalSizeMb, '5.0');
  expect('8.8 C3 (boş) fileCount = 0', fileMap.get('C3').fileCount, 0);

  // Call loader — TEK findMany
  let callFindManyCount = 0;
  const fakePrismaCall = {
    caseCallLog: {
      findMany: async ({ where, select }) => {
        callFindManyCount += 1;
        if (!where?.caseId?.in || !select?.callDate || !select?.callOutcome) throw new Error('shape');
        return [
          { caseId: 'C1', callDate: new Date('2026-01-01'), callOutcome: 'Memnun' },
          { caseId: 'C1', callDate: new Date('2026-02-01'), callOutcome: 'Ulaşılamadı' },
        ];
      },
    },
  };
  const callMap = await loadCaseCallAggregates(fakePrismaCall, ['C1', 'C2']);
  expect('8.9 call loader TEK findMany (N+1 yok)', callFindManyCount, 1);
  expect('8.10 callMap.size = 2', callMap.size, 2);
  expect('8.11 C1.callCount = 2', callMap.get('C1').callCount, 2);
  expect('8.12 C1.lastCallResult = "Ulaşılamadı"', callMap.get('C1').lastCallResult, 'Ulaşılamadı');
  expect('8.13 C2 (boş) callCount = 0', callMap.get('C2').callCount, 0);

  // Transfer loader — 2 query (caseTransfer + team), N'den bağımsız
  let transferFindManyCount = 0;
  let teamFindManyCount = 0;
  const fakePrismaTransfer = {
    caseTransfer: {
      findMany: async ({ where, select }) => {
        transferFindManyCount += 1;
        if (!where?.caseId?.in || !select?.toTeamId || !select?.transferredAt) throw new Error('shape');
        return [
          { caseId: 'C1', toTeamId: 'TEAM-A', transferredAt: new Date('2026-01-01') },
          { caseId: 'C1', toTeamId: 'TEAM-B', transferredAt: new Date('2026-02-01') },
          { caseId: 'C2', toTeamId: 'TEAM-A', transferredAt: new Date('2026-03-01') },
        ];
      },
    },
    team: {
      findMany: async ({ where, select }) => {
        teamFindManyCount += 1;
        if (!where?.id?.in || !select?.id || !select?.name) throw new Error('shape');
        const map = { 'TEAM-A': 'L1 Destek', 'TEAM-B': 'L2 Mühendislik' };
        return where.id.in.map((id) => ({ id, name: map[id] ?? null })).filter((t) => t.name);
      },
    },
  };
  const transferMap = await loadCaseTransferAggregates(fakePrismaTransfer, ['C1', 'C2', 'C3']);
  expect('8.14 transfer loader caseTransfer.findMany TEK kez', transferFindManyCount, 1);
  expect('8.15 transfer loader team.findMany TEK kez (N+1 yok)', teamFindManyCount, 1);
  expect('8.16 transferMap.size = 3 (her caseId)', transferMap.size, 3);
  expect('8.17 C1.lastTransferTargetTeam = "L2 Mühendislik" (en son + name resolve)', transferMap.get('C1').lastTransferTargetTeam, 'L2 Mühendislik');
  expect('8.18 C2.lastTransferTargetTeam = "L1 Destek"', transferMap.get('C2').lastTransferTargetTeam, 'L1 Destek');
  expect('8.19 C3 (boş) transferCount = 0', transferMap.get('C3').transferCount, 0);
  expect('8.20 C3 (boş) lastTransferTargetTeam = ""', transferMap.get('C3').lastTransferTargetTeam, '');

  // Transfer: hiç transfer yoksa team.findMany'e gitmemeli
  let teamFindManyCount2 = 0;
  const fakePrismaEmpty = {
    caseTransfer: { findMany: async () => [] },
    team: { findMany: async () => { teamFindManyCount2 += 1; return []; } },
  };
  const emptyMap = await loadCaseTransferAggregates(fakePrismaEmpty, ['C1']);
  expect('8.21 hiç transfer yoksa team.findMany çağrılmaz', teamFindManyCount2, 0);
  expect('8.22 C1 transferCount = 0', emptyMap.get('C1').transferCount, 0);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
