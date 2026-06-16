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
  // Picker meta — defaultThenFirst (Codex P1+P2 fix):
  expect('2.6 addresses.select.isDefault (picker)',  addrSel.select.isDefault, true);
  expect('2.7 addresses.select.companyId (tenant scope)', addrSel.select.companyId, true);
  expect('2.8 addresses.select.isActive (sort)',     addrSel.select.isActive, true);
  expect('2.9 addresses.select.type (sort)',         addrSel.select.type, true);
  expect('2.10 addresses.select.createdAt (sort)',   addrSel.select.createdAt, true);
  // Codex P2 follow-up — final stable tie-breaker
  expect('2.10b addresses.select.id (final tie-break)', addrSel.select.id, true);

  const compSel = select.account.select.companies;
  expect('2.11 companies block var', typeof compSel, 'object');
  expect('2.12 companies.select.segment', compSel.select.segment, true);
  expect('2.13 companies.select.status', compSel.select.status, true);
  // Picker meta — matchCaseCompanyId için companyId gerekli
  expect('2.14 companies.select.companyId (picker meta)', compSel.select.companyId, true);

  // Case tablo zorunlu key'leri
  expect('2.15 case.id always selected', select.id, true);
  expect('2.16 case.companyId always selected', select.companyId, true);
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
// Codex P1 + P2 fix (2026-06-17): tenant scope + deterministik sort.
console.log('\n── 4) extractRawValue: defaultThenFirst (Address) ───────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');

  // 4.1 — Tek tenant, isDefault=true address ilk seçilmeli
  const dbRow1 = {
    id: 'C1',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'Ankara',   isDefault: false, isActive: true, type: 'billing',  createdAt: '2026-01-01', companyId: 'CO1' },
        { city: 'İstanbul', isDefault: true,  isActive: true, type: 'shipping', createdAt: '2026-02-01', companyId: 'CO1' },
        { city: 'İzmir',    isDefault: false, isActive: true, type: 'home',     createdAt: '2026-03-01', companyId: 'CO1' },
      ],
    },
  };
  expect('4.1 isDefault=true seçildi (İstanbul)', extractRawValue(cityCol, dbRow1), 'İstanbul');

  // 4.2 — Hiç default yok: deterministik sort kicks in
  //   Active hepsi, hiç default yok → type alfabetik: billing < home
  //   Sıra: Ankara(billing,2026-01) < Bursa(home,2025-12) — type önce, sonra createdAt
  const dbRow2 = {
    id: 'C2',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'Bursa',   isDefault: false, isActive: true, type: 'home',    createdAt: '2025-12-01', companyId: 'CO1' },
        { city: 'Antalya', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-05-01', companyId: 'CO1' },
      ],
    },
  };
  // Antalya billing < Bursa home (type asc, b < h)
  expect('4.2 deterministik: type asc → Antalya (billing)', extractRawValue(cityCol, dbRow2), 'Antalya');

  // 4.3 — Aynı type, sıra createdAt asc'a düşmeli
  const dbRow3 = {
    id: 'C3',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'X', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-05-01', companyId: 'CO1' },
        { city: 'Y', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO1' },
      ],
    },
  };
  expect('4.3 type aynı: createdAt eski önce → Y', extractRawValue(cityCol, dbRow3), 'Y');

  // 4.4 — Inactive vs active: active önce
  const dbRow4 = {
    id: 'C4',
    companyId: 'CO1',
    account: {
      addresses: [
        { city: 'PasifIst', isDefault: true,  isActive: false, type: 'billing', createdAt: '2025-01-01', companyId: 'CO1' },
        { city: 'AktifAnk', isDefault: false, isActive: true,  type: 'home',    createdAt: '2026-01-01', companyId: 'CO1' },
      ],
    },
  };
  // Active ön planda, isDefault false olsa bile
  expect('4.4 active önce → AktifAnk (isDefault false bile olsa)',
    extractRawValue(cityCol, dbRow4), 'AktifAnk');

  // 4.5 — Tek address (her zaman seçilen tek aday)
  const dbRow5 = {
    id: 'C5',
    companyId: 'CO1',
    account: { addresses: [{ city: 'Adana', isDefault: false, isActive: true, type: 'home', createdAt: '2026-01-01', companyId: 'CO1' }] },
  };
  expect('4.5 tek address', extractRawValue(cityCol, dbRow5), 'Adana');

  // 4.6 — Codex P2 follow-up: aynı isActive/isDefault/type/createdAt → id asc
  // Bulk import senaryosu: 3 address aynı tick'te oluşturulmuş, tüm sort
  // anahtarları eşit. id alfabetik olarak en küçük olan seçilmeli.
  const dbRow6 = {
    id: 'C6',
    companyId: 'CO1',
    account: {
      addresses: [
        { id: 'addr_c', city: 'CCC', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO1' },
        { id: 'addr_a', city: 'AAA', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO1' },
        { id: 'addr_b', city: 'BBB', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO1' },
      ],
    },
  };
  expect('4.6 identical sort keys → id asc (addr_a → AAA)',
    extractRawValue(cityCol, dbRow6), 'AAA');

  // 4.7 — Sort key eşit DEĞİL (createdAt farklı) → id kullanılmamalı
  const dbRow7 = {
    id: 'C7',
    companyId: 'CO1',
    account: {
      addresses: [
        { id: 'addr_a', city: 'YeniA', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-05-01', companyId: 'CO1' },
        { id: 'addr_z', city: 'EskiZ', isDefault: false, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO1' },
      ],
    },
  };
  expect('4.7 createdAt belirleyici, id bypass → EskiZ',
    extractRawValue(cityCol, dbRow7), 'EskiZ');
}

// ── 4b) Codex P1: cross-tenant leak engellendi ───────────────
console.log('\n── 4b) Codex P1: Address tenant scope (cross-tenant leak fix) ──');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');
  const districtCol = REPORT_COLUMNS.find((c) => c.id === 'address.district');

  // Müşterinin Şirket B'de default address'i var. Vaka Şirket A'dan.
  // Eski impl: 'İstanbul (B)' sızardı. Fix: sadece A'nın address'i.
  const dbRow1 = {
    id: 'C1',
    companyId: 'CO_A',
    account: {
      addresses: [
        { city: 'İstanbul', district: 'Kadıköy',  isDefault: true,  isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO_B' },
        { city: 'Ankara',   district: 'Çankaya',  isDefault: false, isActive: true, type: 'billing', createdAt: '2026-02-01', companyId: 'CO_A' },
      ],
    },
  };
  expect('4b.1 vaka CO_A: B tenant adres SIZMAZ → Ankara',
    extractRawValue(cityCol, dbRow1), 'Ankara');
  expect('4b.2 multi-field aynı tenant: Çankaya',
    extractRawValue(districtCol, dbRow1), 'Çankaya');

  // Vaka tenant'ında HİÇBİR adres yok → undefined (fallback fields'ten leak yok)
  const dbRow2 = {
    id: 'C2',
    companyId: 'CO_A',
    account: {
      addresses: [
        { city: 'İstanbul', isDefault: true, isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO_B' },
        { city: 'İzmir',    isDefault: false, isActive: true, type: 'home',    createdAt: '2026-02-01', companyId: 'CO_C' },
      ],
    },
  };
  expect('4b.3 vaka tenant\'ında adres yok → undefined (no leak)',
    extractRawValue(cityCol, dbRow2), undefined);
}

// ── 5) extractRawValue: matchCaseCompanyId picker ────────────
// Codex P1 fix: cross-tenant fallback KALDIRILDI. AccountCompany
// @@unique([accountId, companyId]) — max 1 match, hiç fallback yok.
console.log('\n── 5) extractRawValue: matchCaseCompanyId (AccountCompany) ──');
{
  const segCol = REPORT_COLUMNS.find((c) => c.id === 'accountCompany.segment');

  // 5.1 — Case companyId = CO_UNIVERA; eşleşen company seçilmeli
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

  // 5.2 — Match yoksa undefined (cross-tenant fallback KALDIRILDI — Codex P1)
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
  expect('5.2 match yok → undefined (no cross-tenant leak)',
    extractRawValue(segCol, dbRow2), undefined);

  // 5.3 — Multi-field tek tenant match
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

  // 5.5 — Case.companyId yok (defansif undefined) → match olamaz → undefined
  const dbRow4 = {
    id: 'C4',
    /* companyId yok */
    account: { companies: [{ companyId: 'CO_X', segment: 'S' }] },
  };
  expect('5.5 case.companyId yok → undefined', extractRawValue(segCol, dbRow4), undefined);
}

// ── 6) Defansif: null relation, boş array ────────────────────
console.log('\n── 6) Defansif: null relation, boş array ────────────────');
{
  const cityCol = REPORT_COLUMNS.find((c) => c.id === 'address.city');

  // Account yok (accountId=null vaka)
  expect('6.1 account null → undefined', extractRawValue(cityCol, { id: 'C1', companyId: 'CO1', account: null }), undefined);
  expect('6.2 account missing → undefined', extractRawValue(cityCol, { id: 'C2', companyId: 'CO1' }), undefined);

  // Boş array
  const dbEmpty = { id: 'C3', companyId: 'CO1', account: { addresses: [] } };
  expect('6.3 boş array → undefined', extractRawValue(cityCol, dbEmpty), undefined);

  // joinPath null
  const dbNoPath = { id: 'C4', companyId: 'CO1', account: { /* addresses yok */ } };
  expect('6.4 joinPath array yok → undefined', extractRawValue(cityCol, dbNoPath), undefined);
}

// ── 7) buildReportRows end-to-end ────────────────────────────
// Codex P1+P2 fix uygulanmış semantik: tenant scope + deterministik sort.
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
          // CO_UNIVERA'da 2 address, biri default
          { city: 'Ankara',   isDefault: false, isActive: true, type: 'home',    createdAt: '2026-01-01', companyId: 'CO_UNIVERA' },
          { city: 'İstanbul', isDefault: true,  isActive: true, type: 'billing', createdAt: '2026-02-01', companyId: 'CO_UNIVERA' },
          // CO_PARAM tenant'ından adres → sızmamalı
          { city: 'İzmir',    isDefault: true,  isActive: true, type: 'billing', createdAt: '2026-01-01', companyId: 'CO_PARAM' },
        ],
        companies: [
          { companyId: 'CO_UNIVERA', segment: 'Premium' },
          { companyId: 'CO_PARAM',   segment: 'Standard' },
        ],
      },
    },
    {
      id: 'C2',
      companyId: 'CO_PARAM',
      caseNumber: 'CN-002',
      account: {
        addresses: [{ city: 'İzmir', isDefault: false, isActive: true, type: 'home', createdAt: '2026-01-01', companyId: 'CO_PARAM' }],
        companies: [{ companyId: 'CO_PARAM', segment: 'Standard' }],
      },
    },
    {
      id: 'C3',
      companyId: 'CO_UNIVERA',
      caseNumber: 'CN-003',
      account: null, // Müşterisiz vaka
    },
    {
      id: 'C4',
      companyId: 'CO_ORPHAN', // Account'ta hiç bu tenant'ta kayıt yok
      caseNumber: 'CN-004',
      account: {
        addresses: [{ city: 'İzmir', isDefault: true, isActive: true, type: 'home', createdAt: '2026-01-01', companyId: 'CO_OTHER' }],
        companies: [{ companyId: 'CO_OTHER', segment: 'Premium' }],
      },
    },
  ];
  const rows = buildReportRows(dbRows, [caseNoCol, cityCol, segCol]);
  expect('7.1 4 satır', rows.length, 4);
  expect('7.2 C1 caseNumber', rows[0].caseNumber, 'CN-001');
  // C1: CO_UNIVERA tenant'ında 2 aday var, isDefault=İstanbul seçilir.
  // CO_PARAM'daki İzmir SIZMAMALI.
  expect('7.3 C1 city (CO_UNIVERA default İstanbul)', rows[0]['address.city'], 'İstanbul');
  expect('7.4 C1 segment (match UNIVERA)', rows[0]['accountCompany.segment'], 'Premium');
  expect('7.5 C2 city (tek satır CO_PARAM)', rows[1]['address.city'], 'İzmir');
  expect('7.6 C2 segment', rows[1]['accountCompany.segment'], 'Standard');
  // C3: Account null → boş
  expect('7.7 C3 city (account null)', rows[2]['address.city'], '');
  expect('7.8 C3 segment (account null)', rows[2]['accountCompany.segment'], '');
  // C4: vaka tenant'ında müşteri kaydı yok → boş (cross-tenant SIZMA)
  expect('7.9 C4 city (no tenant match → boş)', rows[3]['address.city'], '');
  expect('7.10 C4 segment (no tenant match → boş)', rows[3]['accountCompany.segment'], '');
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
