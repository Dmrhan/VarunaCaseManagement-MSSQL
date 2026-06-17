/**
 * smoke-case-report-views-static.js
 *
 * Phase 4 — Saved Views için DB-bağımsız static smoke.
 *
 * Senaryolar:
 *   1) validateReportViewPayload — happy path (list mode)
 *   2) validation — required field eksikleri
 *   3) validation — bilinmeyen column id
 *   4) validation — pivot mode için pivotConfig zorunluluğu
 *   5) validation — pivot measure fn + count fn columnId opsiyonel
 *   6) validation — mode=list iken pivotConfig ignore
 *   7) Serialize/Parse round-trip (list mode)
 *   8) Serialize/Parse round-trip (pivot mode)
 *   9) parseFromDb defansif — bozuk JSON
 *  10) Limit kontrolleri (name, columns)
 *
 * Çalıştır:
 *   node scripts/smoke-case-report-views-static.js
 */

import {
  validateReportViewPayload,
  serializeForDb,
  parseFromDb,
  filterViewForRole,
  __internal,
} from '../server/lib/caseReport/reportViewSchema.js';

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function expect(name, actual, expected) {
  if (deepEqual(actual, expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const VALID_LIST = {
  name: 'GM Haftalık Özet',
  description: 'Genel müdür haftalık dashboard görünümü',
  mode: 'list',
  companyId: 'CO_UNIVERA',
  columns: ['caseNumber', 'status', 'priority', 'accountName'],
  filters: { statuses: 'Acik' },
};

const VALID_PIVOT = {
  name: 'Status × Type Pivot',
  description: null,
  mode: 'pivot',
  companyId: 'CO_UNIVERA',
  columns: ['status', 'caseType', 'transferCount'],
  filters: {},
  pivotConfig: {
    rowColumnId: 'status',
    colColumnId: 'caseType',
    measure: { fn: 'sum', columnId: 'transferCount' },
  },
};

// ── 1) Happy path — list mode ────────────────────────────────
console.log('── 1) Validation happy path (list mode) ────────────────');
{
  const v = validateReportViewPayload(VALID_LIST);
  expect('1.1 ok=true', v.ok, true);
  expect('1.2 errors empty', v.errors, []);
  expect('1.3 view.name', v.view.name, 'GM Haftalık Özet');
  expect('1.4 view.mode', v.view.mode, 'list');
  expect('1.5 view.columns', v.view.columns, ['caseNumber', 'status', 'priority', 'accountName']);
  expect('1.6 view.pivotConfig null', v.view.pivotConfig, null);
  expect('1.7 view.isShared default false', v.view.isShared, false);
}

// ── 2) Required field eksikleri ──────────────────────────────
console.log('\n── 2) Validation required field eksikleri ───────────────');
{
  const r1 = validateReportViewPayload({});
  expect('2.1 boş body ok=false', r1.ok, false);
  if (!r1.errors.some((e) => e.includes('name'))) bad('2.2 name error msg');
  else ok('2.2 name error msg');

  const r2 = validateReportViewPayload({ ...VALID_LIST, name: '' });
  expect('2.3 boş name reddedilir', r2.ok, false);

  const r3 = validateReportViewPayload({ ...VALID_LIST, name: '   ' });
  expect('2.4 whitespace-only name reddedilir', r3.ok, false);

  const r4 = validateReportViewPayload({ ...VALID_LIST, companyId: '' });
  expect('2.5 boş companyId reddedilir', r4.ok, false);

  const r5 = validateReportViewPayload({ ...VALID_LIST, mode: 'bogus' });
  expect('2.6 bilinmeyen mode reddedilir', r5.ok, false);

  const r6 = validateReportViewPayload({ ...VALID_LIST, columns: [] });
  expect('2.7 boş columns reddedilir', r6.ok, false);

  const r7 = validateReportViewPayload({ ...VALID_LIST, filters: null });
  expect('2.8 null filters reddedilir', r7.ok, false);

  const r8 = validateReportViewPayload({ ...VALID_LIST, filters: 'not-object' });
  expect('2.9 string filters reddedilir', r8.ok, false);
}

// ── 3) Bilinmeyen column id ──────────────────────────────────
console.log('\n── 3) Validation: bilinmeyen column id ──────────────────');
{
  const r1 = validateReportViewPayload({ ...VALID_LIST, columns: ['caseNumber', '__bogus__'] });
  expect('3.1 bilinmeyen kolon reddedilir', r1.ok, false);
  expect('3.2 error içeriği belirler', r1.errors.some((e) => e.includes('__bogus__')), true);

  const r2 = validateReportViewPayload({ ...VALID_LIST, columns: [123, 'caseNumber'] });
  expect('3.3 non-string column id reddedilir', r2.ok, false);
}

// ── 4) Pivot mode pivotConfig zorunlu ────────────────────────
console.log('\n── 4) Validation pivot mode: pivotConfig zorunlu ────────');
{
  const r1 = validateReportViewPayload({ ...VALID_PIVOT, pivotConfig: undefined });
  expect('4.1 pivot mode + pivotConfig yok → reddedilir', r1.ok, false);

  const r2 = validateReportViewPayload({
    ...VALID_PIVOT,
    pivotConfig: { rowColumnId: '__bogus__', colColumnId: 'caseType', measure: { fn: 'count' } },
  });
  expect('4.2 bilinmeyen rowColumnId reddedilir', r2.ok, false);

  const r3 = validateReportViewPayload({
    ...VALID_PIVOT,
    pivotConfig: { rowColumnId: 'status', colColumnId: 'caseType', measure: { fn: 'median' } },
  });
  expect('4.3 bilinmeyen measure fn reddedilir', r3.ok, false);
}

// ── 5) Pivot measure fn + count fn columnId opsiyonel ────────
console.log('\n── 5) Validation pivot measure fn semantiği ─────────────');
{
  const countNoColumn = validateReportViewPayload({
    ...VALID_PIVOT,
    pivotConfig: {
      rowColumnId: 'status', colColumnId: 'caseType',
      measure: { fn: 'count' }, // count fn → columnId opsiyonel
    },
  });
  expect('5.1 count fn columnId\'siz OK', countNoColumn.ok, true);
  expect('5.2 view.pivotConfig.measure.fn', countNoColumn.view.pivotConfig.measure.fn, 'count');
  // columnId yoksa serialize'da da olmaz
  expect('5.3 columnId yoksa view\'da da yok', 'columnId' in countNoColumn.view.pivotConfig.measure, false);

  const sumNoColumn = validateReportViewPayload({
    ...VALID_PIVOT,
    pivotConfig: {
      rowColumnId: 'status', colColumnId: 'caseType',
      measure: { fn: 'sum' }, // sum fn → columnId zorunlu
    },
  });
  expect('5.4 sum fn columnId\'siz reddedilir', sumNoColumn.ok, false);

  const sumBogusColumn = validateReportViewPayload({
    ...VALID_PIVOT,
    pivotConfig: {
      rowColumnId: 'status', colColumnId: 'caseType',
      measure: { fn: 'sum', columnId: '__bogus__' },
    },
  });
  expect('5.5 sum fn bilinmeyen columnId reddedilir', sumBogusColumn.ok, false);
}

// ── 6) mode=list iken pivotConfig ignore ─────────────────────
console.log('\n── 6) mode=list iken pivotConfig ignore ─────────────────');
{
  const r = validateReportViewPayload({
    ...VALID_LIST,
    pivotConfig: { rowColumnId: 'status', colColumnId: 'caseType', measure: { fn: 'count' } },
  });
  expect('6.1 list mode + pivotConfig hâlâ OK', r.ok, true);
  expect('6.2 view.pivotConfig null\'a normalize', r.view.pivotConfig, null);
}

// ── 7) Serialize/Parse round-trip (list mode) ────────────────
console.log('\n── 7) Serialize/Parse round-trip (list mode) ────────────');
{
  const v = validateReportViewPayload(VALID_LIST).view;
  const dbShape = serializeForDb(v);
  // DB shape: columns/filters JSON string, pivotConfig null
  expect('7.1 columns JSON string', typeof dbShape.columns, 'string');
  expect('7.2 filters JSON string', typeof dbShape.filters, 'string');
  expect('7.3 pivotConfig null', dbShape.pivotConfig, null);
  expect('7.4 isShared bool', dbShape.isShared, false);

  // Round-trip parse
  const row = {
    id: 'view_1',
    ownerId: 'user_1',
    createdAt: '2026-06-17T10:00:00Z',
    updatedAt: '2026-06-17T10:00:00Z',
    ...dbShape,
  };
  const parsed = parseFromDb(row);
  expect('7.5 round-trip name', parsed.name, v.name);
  expect('7.6 round-trip columns', parsed.columns, v.columns);
  expect('7.7 round-trip filters', parsed.filters, v.filters);
  expect('7.8 round-trip pivotConfig null', parsed.pivotConfig, null);
  expect('7.9 round-trip mode', parsed.mode, 'list');
}

// ── 8) Serialize/Parse round-trip (pivot mode) ───────────────
console.log('\n── 8) Serialize/Parse round-trip (pivot mode) ───────────');
{
  const v = validateReportViewPayload(VALID_PIVOT).view;
  const dbShape = serializeForDb(v);
  expect('8.1 pivotConfig string', typeof dbShape.pivotConfig, 'string');

  const row = {
    id: 'view_2',
    ownerId: 'user_1',
    createdAt: '2026-06-17T10:00:00Z',
    updatedAt: '2026-06-17T10:00:00Z',
    ...dbShape,
  };
  const parsed = parseFromDb(row);
  expect('8.2 pivotConfig round-trip rowColumnId', parsed.pivotConfig.rowColumnId, 'status');
  expect('8.3 pivotConfig round-trip measure', parsed.pivotConfig.measure, { fn: 'sum', columnId: 'transferCount' });
  expect('8.4 mode', parsed.mode, 'pivot');
}

// ── 9) parseFromDb defansif: bozuk JSON ──────────────────────
console.log('\n── 9) parseFromDb defansif: bozuk JSON ──────────────────');
{
  const badRow = {
    id: 'view_3',
    companyId: 'CO1',
    ownerId: 'user_1',
    name: 'Bozuk',
    description: null,
    mode: 'list',
    columns: '{not-json',
    filters: 'also-not-json',
    pivotConfig: null,
    isShared: false,
    createdAt: '2026-06-17',
    updatedAt: '2026-06-17',
  };
  const parsed = parseFromDb(badRow);
  expect('9.1 bozuk columns → []', parsed.columns, []);
  expect('9.2 bozuk filters → {}', parsed.filters, {});
  expect('9.3 null row → null', parseFromDb(null), null);
  expect('9.4 non-object row → null', parseFromDb('string'), null);
}

// ── 10) Limit kontrolleri ────────────────────────────────────
console.log('\n── 10) Limit kontrolleri ────────────────────────────────');
{
  const longName = 'A'.repeat(__internal.NAME_MAX + 1);
  const r1 = validateReportViewPayload({ ...VALID_LIST, name: longName });
  expect('10.1 name > NAME_MAX reddedilir', r1.ok, false);

  const tooManyColumns = Array.from({ length: __internal.COLUMNS_MAX + 1 }, () => 'caseNumber');
  const r2 = validateReportViewPayload({ ...VALID_LIST, columns: tooManyColumns });
  expect('10.2 columns > COLUMNS_MAX reddedilir', r2.ok, false);

  expect('10.3 NAME_MAX = 200', __internal.NAME_MAX, 200);
  expect('10.4 MODES', __internal.MODES, ['list', 'pivot']);
}

// ── 11) Codex P2 — Role gate bypass fix ──────────────────────
console.log('\n── 11) filterViewForRole: role gate bypass fix ───────────');
{
  // Admin paylaşımlı view'a PII kolon koymuş; Supervisor okurken
  // bu kolonlar düşmeli.
  const sharedView = {
    id: 'view_shared',
    companyId: 'CO1',
    ownerId: 'admin_1',
    name: 'PII Dashboard',
    description: null,
    mode: 'list',
    columns: ['caseNumber', 'account.email', 'account.vkn', 'status'],
    filters: {},
    pivotConfig: null,
    isShared: true,
    createdAt: '2026-06-17',
    updatedAt: '2026-06-17',
  };

  // 11.1 — Supervisor: PII kolonlar düşer
  const forSup = filterViewForRole(sharedView, 'Supervisor', 'supervisor_99');
  expect('11.1 Supervisor: PII kolonlar düşer',
    forSup.columns, ['caseNumber', 'status']);

  // 11.2 — Admin (başkası): PII kolonlar görünür
  const forAdmin = filterViewForRole(sharedView, 'Admin', 'admin_other');
  expect('11.2 Admin (başkası): PII kolonlar görünür',
    forAdmin.columns, ['caseNumber', 'account.email', 'account.vkn', 'status']);

  // 11.3 — Owner kendi view'unu DAİMA tam görür (rol Supervisor olsa bile,
  // örn. kayıt sonrası rol kısıtlanmış senaryosu)
  const forOwner = filterViewForRole({ ...sharedView, ownerId: 'admin_1' }, 'Supervisor', 'admin_1');
  expect('11.3 Owner: filter bypass, tam columns',
    forOwner.columns, ['caseNumber', 'account.email', 'account.vkn', 'status']);

  // 11.4 — Pivot config: dim'lerden biri PII ise pivotConfig null'a düşer
  const pivotView = {
    ...sharedView,
    mode: 'pivot',
    columns: ['caseNumber', 'account.email', 'status'],
    pivotConfig: {
      rowColumnId: 'account.email',
      colColumnId: 'status',
      measure: { fn: 'count' },
    },
  };
  const forSupPivot = filterViewForRole(pivotView, 'Supervisor', 'supervisor_99');
  expect('11.4 Supervisor: pivot row kısıtlıysa pivotConfig null',
    forSupPivot.pivotConfig, null);
  expect('11.5 columns filter pivot ile birlikte',
    forSupPivot.columns, ['caseNumber', 'status']);

  // 11.6 — Pivot measure columnId kısıtlı: pivotConfig null'a düşer
  const pivotMeasureRestricted = {
    ...sharedView,
    mode: 'pivot',
    columns: ['status', 'account.vkn'],
    pivotConfig: {
      rowColumnId: 'status',
      colColumnId: 'status',
      measure: { fn: 'sum', columnId: 'account.vkn' },
    },
  };
  const forSupMR = filterViewForRole(pivotMeasureRestricted, 'Supervisor', 'sup_x');
  expect('11.6 Supervisor: measure columnId kısıtlı → pivotConfig null',
    forSupMR.pivotConfig, null);

  // 11.7 — Owner pivot config'i da tam görür
  const forOwnerPivot = filterViewForRole({ ...pivotView, ownerId: 'admin_1' }, 'Supervisor', 'admin_1');
  expect('11.7 Owner: pivot config korunur',
    forOwnerPivot.pivotConfig?.rowColumnId, 'account.email');

  // 11.8 — Pivot tamamen normal kolonlar: korunur
  const pivotNormal = {
    ...sharedView,
    mode: 'pivot',
    columns: ['status', 'caseType', 'transferCount'],
    pivotConfig: {
      rowColumnId: 'status',
      colColumnId: 'caseType',
      measure: { fn: 'sum', columnId: 'transferCount' },
    },
  };
  const forSupNormal = filterViewForRole(pivotNormal, 'Supervisor', 'sup_y');
  expect('11.8 Supervisor: PII\'siz pivot tam korunur',
    forSupNormal.pivotConfig.measure.columnId, 'transferCount');

  // 11.9 — null/undefined defensive
  expect('11.9 null view → null', filterViewForRole(null, 'Admin', 'u1'), null);

  // 11.10 — Bilinmeyen kolon ID (yeniden adlandırılmış registry) → drop
  const staleView = { ...sharedView, columns: ['__deleted__', 'status'] };
  const cleaned = filterViewForRole(staleView, 'Supervisor', 'sup_x');
  expect('11.10 unknown column id → drop', cleaned.columns, ['status']);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
