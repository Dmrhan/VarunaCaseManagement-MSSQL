/**
 * smoke-case-report-account-context-static.js
 *
 * Phase 2D.2 — Şehir + Segment composite_join kolonları için DB-bağımsız
 * static smoke. AccountAddress (1:N) ve AccountCompany (1:N) collection
 * picker mantığı (defaultThenFirst, matchCaseCompanyId) doğrulanır.
 *
 * Senaryolar:
 *   1. Registry: 7 yeni kolon mevcut + kategori (account_context)
 *   2. buildPrismaSelect: composite_join nested select bloğu
 *      + picker meta alanları (isDefault / companyId)
 *   3. extractRawValue: defaultThenFirst picker
 *   4. extractRawValue: matchCaseCompanyId picker
 *   5. Defansif: null relation, boş array, picker uyumsuz
 *   6. buildReportRows end-to-end: composite kolon değerleri row'a yazılır
 *   7. isPivotableDimension: composite_join → true (Phase 2D.2)
 *   8. Registry regression: önceki tüm kolonlar hâlâ var
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-account-context-static.js
 */

import {
  REPORT_COLUMN_CATEGORIES,
  REPORT_COLUMNS,
  resolveColumns,
  buildPrismaSelect,
} from '../server/lib/caseReport/columnRegistry.js';
import { extractRawValue, buildReportRows } from '../server/lib/caseReport/buildRows.js';
import { isPivotableDimension } from '../server/lib/caseReport/pivot.js';

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ── 1) Registry: 7 yeni kolon ────────────────────────────────
console.log('── 1) Registry: account_context kolonları ──────────────');
{
  expect('1.1 kategori "account_context"', REPORT_COLUMN_CATEGORIES.account_context, 'Müşteri Bağlamı');
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  const expected = [
    'address.city', 'address.district', 'address.country',
    'accountCompany.segment', 'accountCompany.status',
    'accountCompany.packageName', 'accountCompany.externalCustomerCode',
  ];
  const missing = expected.filter((id) => !ids.has(id));
  if (missing.length === 0) ok(`1.2 7 yeni kolon mevcut`);
  else bad('1.2 Eksik kolon', missing.join(','));

  const city = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  expect('1.3 address.city source', city.source, 'composite_join');
  expect('1.4 address.city joinTable', city.joinTable, 'account');
  expect('1.5 address.city joinPath', city.joinPath, 'addresses');
  expect('1.6 address.city picker', city.picker, 'defaultThenFirst');
  expect('1.7 address.city type', city.type, 'string');
  expect('1.8 address.city PII tag yok', city.privacyTag, undefined);
  expect('1.9 address.city role gate yok', city.roles, undefined);

  const seg = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');
  expect('1.10 segment picker', seg.picker, 'matchCaseCompanyId');
  expect('1.11 segment joinPath', seg.joinPath, 'companies');
  expect('1.12 segment joinField', seg.joinField, 'segment');
}

// ── 2) buildPrismaSelect: composite include ──────────────────
console.log('\n── 2) buildPrismaSelect: nested addresses/companies ─────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const districtCol = REPORT_COLUMNS.find((c) => c.id === 'address.district');
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');
  const statusCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.status');
  const select = buildPrismaSelect([cityCol, districtCol, segCol, statusCol]);

  // account: { select: { addresses: { select: {...} }, companies: { select: {...} } } }
  expect('2.1 account relation var', typeof select.account, 'object');
  expect('2.2 account.select var', typeof select.account.select, 'object');

  const addrSel = select.account.select.addresses;
  expect('2.3 addresses block var', typeof addrSel, 'object');
  expect('2.4 addresses.select.city', addrSel.select.city, true);
  expect('2.5 addresses.select.district', addrSel.select.district, true);
  // Picker meta — defaultThenFirst için isDefault gerekli
  expect('2.6 addresses.select.isDefault (picker meta)', addrSel.select.isDefault, true);

  const compSel = select.account.select.companies;
  expect('2.7 companies block var', typeof compSel, 'object');
  expect('2.8 companies.select.segment', compSel.select.segment, true);
  expect('2.9 companies.select.status', compSel.select.status, true);
  // Picker meta — matchCaseCompanyId için companyId gerekli
  expect('2.10 companies.select.companyId (picker meta)', compSel.select.companyId, true);

  // Case tablo zorunlu key'leri
  expect('2.11 case.id always selected', select.id, true);
  expect('2.12 case.companyId always selected', select.companyId, true);
}

// ── 3) Mevcut account.* join + composite_join birlikte ───────
console.log('\n── 3) Mixed join + composite_join select ────────────────');
{
  const vknCol = REPORT_COLUMNS.find((c) => c.id === 'account.vkn');
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const select = buildPrismaSelect([vknCol, cityCol]);
  // Aynı account relation altında scalar vkn + nested addresses
  expect('3.1 account.select.vkn (scalar join)', select.account.select.vkn, true);
  expect('3.2 account.select.addresses.select.city (composite)',
    select.account.select.addresses.select.city, true);
}

// ── 4) extractRawValue: defaultThenFirst picker ──────────────
console.log('\n── 4) extractRawValue: defaultThenFirst (Address) ───────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');

  // isDefault=true olan address ilk seçilmeli
  const dbRow1 = {
    id: 'C1',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'Ankara', isDefault: false },
        { city: 'İstanbul', isDefault: true },
        { city: 'İzmir', isDefault: false },
      ],
    },
  };
  expect('4.1 isDefault=true seçildi (İstanbul)', extractRawValue(cityCol, dbRow1), 'İstanbul');

  // Hiçbiri isDefault değilse ilk satır
  const dbRow2 = {
    id: 'C2',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'Bursa', isDefault: false },
        { city: 'Antalya', isDefault: false },
      ],
    },
  };
  expect('4.2 hiç default yok → array[0]', extractRawValue(cityCol, dbRow2), 'Bursa');

  // Tek satır
  const dbRow3 = {
    id: 'C3',
    companyId: 'CO1',
    account: { addresses: [{ city: 'Adana', isDefault: false }] },
  };
  expect('4.3 tek address', extractRawValue(cityCol, dbRow3), 'Adana');
}

// ── 5) extractRawValue: matchCaseCompanyId picker ────────────
console.log('\n── 5) extractRawValue: matchCaseCompanyId (AccountCompany) ──');
{
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');

  // Case companyId = 'CO_UNIVERA'; eşleşen company seçilmeli
  const dbRow1 = {
    id: 'C1',
    companyId: 'CO_UNIVERA',
    account: {
      companies: [
        { companyId: 'CO_PARAM',    segment: 'Standard' },
        { companyId: 'CO_UNIVERA',  segment: 'Premium' },
        { companyId: 'CO_FINROTA',  segment: 'Trial' },
      ],
    },
  };
  expect('5.1 match CO_UNIVERA → Premium', extractRawValue(segCol, dbRow1), 'Premium');

  // Match olmazsa array[0] (defansif fallback)
  const dbRow2 = {
    id: 'C2',
    companyId: 'CO_UNKNOWN',
    account: {
      companies: [
        { companyId: 'CO_PARAM',   segment: 'Standard' },
        { companyId: 'CO_UNIVERA', segment: 'Premium' },
      ],
    },
  };
  expect('5.2 match yok → array[0] (Standard)', extractRawValue(segCol, dbRow2), 'Standard');

  // Aynı extractor multi-field: status + packageName
  const statusCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.status');
  const pkgCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.packageName');
  const dbRow3 = {
    id: 'C3',
    companyId: 'CO_UNIVERA',
    account: {
      companies: [
        { companyId: 'CO_UNIVERA', status: 'active', packageName: 'Gold' },
      ],
    },
  };
  expect('5.3 status = active', extractRawValue(statusCol, dbRow3), 'active');
  expect('5.4 packageName = Gold', extractRawValue(pkgCol, dbRow3), 'Gold');
}

// ── 6) Defansif: null relation, boş array ────────────────────
console.log('\n── 6) Defansif: null relation, boş array ────────────────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');

  // Account yok (accountId=null vaka)
  expect('6.1 account null → undefined', extractRawValue(cityCol, { id: 'C1', companyId: 'CO1', account: null }), undefined);
  expect('6.2 account missing → undefined', extractRawValue(cityCol, { id: 'C2', companyId: 'CO1' }), undefined);

  // Boş array
  const dbEmpty = { id: 'C3', companyId: 'CO1', account: { addresses: [] } };
  expect('6.3 boş array → undefined', extractRawValue(cityCol, dbEmpty), undefined);

  // joinPath null
  const dbNoPath = { id: 'C4', companyId: 'CO1', account: { /* addresses yok */ } };
  expect('6.4 joinPath array yok → undefined', extractRawValue(cityCol, dbNoPath), undefined);

  // Match için companyId Case'te yok
  const dbNoCompanyId = {
    id: 'C5',
    // companyId yok (defansif: undefined)
    account: { companies: [{ companyId: 'CO1', segment: 'X' }] },
  };
  // companyId undefined ile compare → match yok → array[0] (X)
  expect('6.5 Case.companyId yok → array[0] fallback', extractRawValue(segCol, dbNoCompanyId), 'X');
}

// ── 7) buildReportRows end-to-end ────────────────────────────
console.log('\n── 7) buildReportRows: composite kolon row\'a yazılıyor ──');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');
  const caseNoCol = REPORT_COLUMNS.find((c) => c.id === 'caseNumber');

  const dbRows = [
    {
      id: 'C1',
      companyId: 'CO_UNIVERA',
      caseNumber: 'CN-001',
      account: {
        addresses: [
          { city: 'Ankara', isDefault: false },
          { city: 'İstanbul', isDefault: true },
        ],
        companies: [
          { companyId: 'CO_UNIVERA', segment: 'Premium' },
          { companyId: 'CO_PARAM', segment: 'Standard' },
        ],
      },
    },
    {
      id: 'C2',
      companyId: 'CO_PARAM',
      caseNumber: 'CN-002',
      account: {
        addresses: [{ city: 'İzmir', isDefault: false }],
        companies: [{ companyId: 'CO_PARAM', segment: 'Standard' }],
      },
    },
    {
      id: 'C3',
      companyId: 'CO_UNIVERA',
      caseNumber: 'CN-003',
      account: null, // Müşterisiz vaka
    },
  ];
  const rows = buildReportRows(dbRows, [caseNoCol, cityCol, segCol]);
  expect('7.1 3 satır', rows.length, 3);
  expect('7.2 C1 caseNumber', rows[0].caseNumber, 'CN-001');
  expect('7.3 C1 city (default İstanbul)', rows[0]['address.city'], 'İstanbul');
  expect('7.4 C1 segment (match UNIVERA)', rows[0]['accountCompany.segment'], 'Premium');
  expect('7.5 C2 city (tek satır)', rows[1]['address.city'], 'İzmir');
  expect('7.6 C2 segment', rows[1]['accountCompany.segment'], 'Standard');
  // Account null → format '' döner
  expect('7.7 C3 city (account null)', rows[2]['address.city'], '');
  expect('7.8 C3 segment (account null)', rows[2]['accountCompany.segment'], '');
}

// ── 8) isPivotableDimension: composite_join → true ───────────
console.log('\n── 8) isPivotableDimension: composite_join ──────────────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');
  expect('8.1 address.city pivotable', isPivotableDimension(cityCol), true);
  expect('8.2 accountCompany.segment pivotable', isPivotableDimension(segCol), true);
}

// ── 9) Registry regression ───────────────────────────────────
console.log('\n── 9) Registry regression: önceki kolonlar mevcut ───────');
{
  const ids = new Set(REPORT_COLUMNS.map((c) => c.id));
  const required = [
    'caseNumber', 'status', 'priority',
    'solutionSteps.total', 'solutionSteps.outcomeSummary',
    'activity.firstActor', 'note.noteCount',
    'file.fileCount', 'call.lastCallResult', 'transfer.transferCount',
    'account.vkn', 'account.email',
  ];
  const missing = required.filter((id) => !ids.has(id));
  if (missing.length === 0) ok(`9.1 Tüm önceki kolonlar (${required.length}) mevcut`);
  else bad('9.1 Kolon kaybı', missing.join(','));

  // Toplam kolon sayısı: önceki + 7 yeni
  const contextCount = REPORT_COLUMNS.filter((c) => c.category === 'account_context').length;
  expect('9.2 account_context kategorisinde 7 kolon', contextCount, 7);

  // resolveColumns regression
  const { columns, invalidIds } = resolveColumns(['address.city', '__bogus__']);
  expect('9.3 resolveColumns yeni kolonu tanır', columns.length, 1);
  expect('9.4 resolveColumns invalidIds', invalidIds, ['__bogus__']);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
