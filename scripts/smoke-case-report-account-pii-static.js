/**
 * smoke-case-report-account-pii-static.js
 *
 * Phase 2D — Account PII alanları + role gate + join source + VKN/TCKN
 * masking için DB-bağımsız static smoke. Phase 2A + 2B.1 + 2B.2 regression
 * dahil.
 *
 * Senaryolar:
 *   1. Registry kontrat: 7 yeni PII kolon + account_pii kategori +
 *      Phase 2A/2B.1/2B.2 kolonları korundu
 *   2. Format helpers (vknMasked + tcknLast4Masked + customerType TR map)
 *   3. Role gate: isColumnAllowedForRole + filterColumnsByRole
 *      - Admin/SystemAdmin görür
 *      - Agent/Supervisor/CSM/Backoffice yetkisiz → forbidden listesinde
 *   4. buildPrismaSelect 'join' source → include block
 *   5. buildRows 'join' source routing: db.account.vkn read
 *   6. Empty/null relation safety (accountId=null → blank)
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-account-pii-static.js
 */

import {
  REPORT_COLUMNS,
  REPORT_COLUMN_CATEGORIES,
  resolveColumns,
  buildPrismaSelect,
  isColumnAllowedForRole,
  filterColumnsByRole,
} from '../server/lib/caseReport/columnRegistry.js';
import { buildReportRows } from '../server/lib/caseReport/buildRows.js';
import { applyFormat, __formatInternal } from '../server/lib/caseReport/formatters.js';

const { formatVknMasked, formatTcknLast4Masked } = __formatInternal;

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ── 1) Registry kontrat + Phase 2A/2B regression ──────────────
console.log('── 1) Registry kontrat ─────────────────────────────────');
{
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  const piiIds = [
    'account.customerType',
    'account.legalName',
    'account.vkn',
    'account.tcknLast4',
    'account.taxOffice',
    'account.email',
    'account.phoneE164',
  ];
  for (const id of piiIds) if (!ids.has(id)) bad(`1.1 PII id eksik: ${id}`);
  if (piiIds.every((id) => ids.has(id))) ok('1.1 7 PII kolonu registry\'de var');

  expect('1.2 account_pii kategori adı', REPORT_COLUMN_CATEGORIES.account_pii, 'Müşteri (PII)');

  // Hepsi privacyTag='pii'
  const piiCols = REPORT_COLUMNS.filter((c) => piiIds.includes(c.id));
  const allPii = piiCols.every((c) => c.privacyTag === 'pii');
  if (allPii) ok('1.3 Tüm PII kolonlar privacyTag=pii');
  else bad('1.3 privacyTag eksik');

  // Hepsi Admin+SystemAdmin role gated
  const allRoleGated = piiCols.every((c) =>
    Array.isArray(c.roles) && c.roles.includes('Admin') && c.roles.includes('SystemAdmin'),
  );
  if (allRoleGated) ok('1.4 Tüm PII kolonlar roles=Admin+SystemAdmin');
  else bad('1.4 roles tanım eksik');

  // Source = 'join'
  const allJoin = piiCols.every((c) => c.source === 'join' && c.joinTable === 'account');
  if (allJoin) ok('1.5 Tüm PII kolonlar source=join joinTable=account');
  else bad('1.5 join source/table tanım eksik');

  // Phase 2A regression
  if (ids.has('solutionSteps.total') && ids.has('solutionSteps.outcomeSummary'))
    ok('1.6 Phase 2A solutionSteps korundu');
  else bad('1.6 Phase 2A regression');

  // Phase 2B.1 + 2B.2 regression
  if (ids.has('activity.firstActor') && ids.has('note.noteCount') && ids.has('file.fileCount') && ids.has('transfer.transferCount'))
    ok('1.7 Phase 2B.1+2B.2 performance_flow korundu');
  else bad('1.7 Phase 2B regression');
}

// ── 2) Format helpers ─────────────────────────────────────────
console.log('\n── 2) VKN/TCKN/customerType formatters ────────────────');
{
  expect('2.1 VKN 1234567890 → "12******90"',     formatVknMasked('1234567890'), '12******90');
  expect('2.2 VKN null → ""',                     formatVknMasked(null), '');
  expect('2.3 VKN "" → ""',                       formatVknMasked(''), '');
  expect('2.4 VKN "12" (kısa) → "**"',            formatVknMasked('12'), '**');
  // VKN 10 hane normaldir; "1234" defansif edge — Math.max(0,1)=1 yıldız
  // garantili (hiçbir zaman tamamen plain dönmez).
  expect('2.5 VKN "1234" (kısa edge) → "12*34" (en az 1 yıldız)', formatVknMasked('1234'), '12*34');

  expect('2.6 TCKN last4 "1234" → "*******1234"', formatTcknLast4Masked('1234'), '*******1234');
  expect('2.7 TCKN null → ""',                    formatTcknLast4Masked(null), '');
  expect('2.8 TCKN "12" → "*******12"',           formatTcknLast4Masked('12'), '*******12');

  // customerType TR map via applyFormat dispatcher (Codex P2 fix sonrası
  // 4 değer: Corporate/Individual/Government/NonProfit)
  const ctCol = { type: 'string', format: 'customerType' };
  expect('2.9 Corporate → "Kurumsal"',     applyFormat(ctCol, 'Corporate'),  'Kurumsal');
  expect('2.10 Individual → "Bireysel"',    applyFormat(ctCol, 'Individual'), 'Bireysel');
  expect('2.11a Government → "Kamu"',       applyFormat(ctCol, 'Government'), 'Kamu');
  expect('2.11b NonProfit → "Vakıf-STK"',   applyFormat(ctCol, 'NonProfit'),  'Vakıf-STK');
  expect('2.11 unknown → raw fallback',     applyFormat(ctCol, 'Other'),      'Other');
  expect('2.12 null → ""',                  applyFormat(ctCol, null),         '');

  // Codex P2 fix — caseRequestType DB ASCII → TR
  const rtCol = { type: 'string', format: 'caseRequestType' };
  expect('2.15a Bilgi → "Bilgi"',           applyFormat(rtCol, 'Bilgi'),    'Bilgi');
  expect('2.15b DB "Oneri" → "Öneri"',      applyFormat(rtCol, 'Oneri'),    'Öneri');
  expect('2.15c TR "Öneri" → "Öneri"',      applyFormat(rtCol, 'Öneri'),    'Öneri');
  expect('2.15d DB "Sikayet" → "Şikayet"',  applyFormat(rtCol, 'Sikayet'),  'Şikayet');
  expect('2.15e Talep / Hata pass-through', applyFormat(rtCol, 'Hata'),     'Hata');

  // VKN format via dispatcher
  const vknCol = { type: 'string', format: 'vknMasked' };
  expect('2.13 dispatcher vknMasked',   applyFormat(vknCol, '1234567890'), '12******90');
  // TCKN format via dispatcher
  const tcknCol = { type: 'string', format: 'tcknLast4Masked' };
  expect('2.14 dispatcher tcknLast4Masked', applyFormat(tcknCol, '5678'), '*******5678');
}

// ── 3) Role gate — isColumnAllowedForRole + filterColumnsByRole ──
console.log('\n── 3) Role gate ─────────────────────────────────────────');
{
  const vknCol = REPORT_COLUMNS.find((c) => c.id === 'account.vkn');
  const caseNumberCol = REPORT_COLUMNS.find((c) => c.id === 'caseNumber');

  // isColumnAllowedForRole — PII column
  expect('3.1 Admin → vkn allowed',         isColumnAllowedForRole(vknCol, 'Admin'),       true);
  expect('3.2 SystemAdmin → vkn allowed',   isColumnAllowedForRole(vknCol, 'SystemAdmin'), true);
  expect('3.3 Agent → vkn forbidden',       isColumnAllowedForRole(vknCol, 'Agent'),       false);
  expect('3.4 Supervisor → vkn forbidden',  isColumnAllowedForRole(vknCol, 'Supervisor'),  false);
  expect('3.5 CSM → vkn forbidden',         isColumnAllowedForRole(vknCol, 'CSM'),         false);
  expect('3.6 Backoffice → vkn forbidden',  isColumnAllowedForRole(vknCol, 'Backoffice'),  false);
  expect('3.7 null role → vkn forbidden',   isColumnAllowedForRole(vknCol, null),          false);

  // isColumnAllowedForRole — non-PII column (no roles)
  expect('3.8 Agent → caseNumber allowed (PII değil)',   isColumnAllowedForRole(caseNumberCol, 'Agent'), true);
  expect('3.9 null role → caseNumber yine allowed',      isColumnAllowedForRole(caseNumberCol, null),    true);

  // filterColumnsByRole — Admin görür her şeyi
  const { columns: adminCols } = resolveColumns(['caseNumber', 'account.vkn', 'account.email', 'solutionSteps.total']);
  const adminCheck = filterColumnsByRole(adminCols, 'Admin');
  expect('3.10 Admin filter → 4 allowed', adminCheck.allowed.length, 4);
  expect('3.11 Admin filter → 0 forbidden', adminCheck.forbidden, []);

  // filterColumnsByRole — Agent yetkisiz PII kolonları
  const agentCheck = filterColumnsByRole(adminCols, 'Agent');
  expect('3.12 Agent → 2 allowed (caseNumber + solutionSteps.total)', agentCheck.allowed.length, 2);
  expect('3.13 Agent → 2 forbidden (vkn + email)', agentCheck.forbidden.sort(), ['account.email', 'account.vkn']);

  // filterColumnsByRole — null role
  const nullCheck = filterColumnsByRole(adminCols, null);
  expect('3.14 null role → 2 forbidden (PII\'lar)', nullCheck.forbidden.sort(), ['account.email', 'account.vkn']);
}

// ── 4) buildPrismaSelect — 'join' source → include block ──────
console.log('\n── 4) buildPrismaSelect join source ────────────────────');
{
  const { columns } = resolveColumns(['caseNumber', 'account.vkn', 'account.email']);
  const sel = buildPrismaSelect(columns);
  expect('4.1 Case scalar caseNumber select edildi', sel.caseNumber, true);
  if (sel.account && sel.account.select && sel.account.select.vkn === true && sel.account.select.email === true) {
    ok('4.2 account.select.vkn + email include block doğru');
  } else {
    bad('4.2 account select shape bozuk', JSON.stringify(sel.account));
  }
  // Aggregate-only seçimde join EK ALAN EKLEMEZ
  const { columns: cols2 } = resolveColumns(['caseNumber', 'solutionSteps.total']);
  const sel2 = buildPrismaSelect(cols2);
  expect('4.3 aggregate-only → sel.account undefined', sel2.account, undefined);
  // JSON path-only seçim — customFields select edilir, account etkilenmez
  const { columns: cols3 } = resolveColumns(['caseNumber', 'st.platformLabel']);
  const sel3 = buildPrismaSelect(cols3);
  expect('4.4 json_path → customFields true', sel3.customFields, true);
  expect('4.5 json_path-only → sel.account undefined', sel3.account, undefined);
}

// ── 5) buildRows join routing ─────────────────────────────────
console.log('\n── 5) buildReportRows join source ──────────────────────');
{
  const { columns } = resolveColumns([
    'caseNumber',
    'account.customerType',
    'account.vkn',
    'account.tcknLast4',
    'account.email',
  ]);
  const fakeCase = {
    id: 'C1',
    caseNumber: 'CASE-001',
    account: {
      customerType: 'Corporate',
      vkn: '1234567890',
      tcknLast4: '5678',
      email: 'test@example.com',
    },
  };
  const rows = buildReportRows([fakeCase], columns, undefined);
  expect('5.1 caseNumber',          rows[0]['caseNumber'],            'CASE-001');
  expect('5.2 customerType TR',     rows[0]['account.customerType'], 'Kurumsal');
  expect('5.3 vkn masked',          rows[0]['account.vkn'],          '12******90');
  expect('5.4 tcknLast4 masked',    rows[0]['account.tcknLast4'],    '*******5678');
  expect('5.5 email raw (PII ama mask format yok)', rows[0]['account.email'], 'test@example.com');
}

// ── 6) Null relation safety ──────────────────────────────────
console.log('\n── 6) Null relation (Phase D müşterisiz vaka) ──────────');
{
  const { columns } = resolveColumns([
    'caseNumber',
    'account.customerType',
    'account.vkn',
    'account.tcknLast4',
    'account.email',
    'account.phoneE164',
  ]);
  // account: null → vaka müşterisiz açıldı
  const fakeCase = { id: 'C2', caseNumber: 'CASE-002', account: null };
  const rows = buildReportRows([fakeCase], columns, undefined);
  expect('6.1 null relation: caseNumber yine OK', rows[0]['caseNumber'], 'CASE-002');
  expect('6.2 null relation: customerType ""',   rows[0]['account.customerType'], '');
  expect('6.3 null relation: vkn ""',            rows[0]['account.vkn'],          '');
  expect('6.4 null relation: tcknLast4 ""',      rows[0]['account.tcknLast4'],    '');
  expect('6.5 null relation: email ""',          rows[0]['account.email'],        '');
  expect('6.6 null relation: phoneE164 ""',      rows[0]['account.phoneE164'],    '');

  // account undefined (alan select edilmedi senaryosu) — yine crash YOK
  const fakeCase2 = { id: 'C3', caseNumber: 'CASE-003' };
  const rows2 = buildReportRows([fakeCase2], columns, undefined);
  expect('6.7 account undefined: vkn ""', rows2[0]['account.vkn'], '');
  expect('6.8 account undefined: email ""', rows2[0]['account.email'], '');
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
