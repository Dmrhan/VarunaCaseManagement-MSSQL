/**
 * WR-A8 Phase 2a — Customer 360 client-side parsers.
 *
 * Multi-sheet XLSX → raw sheets → user-confirmed sheet mapping → per-entity
 *   rows + columns (Customer360Bundle).
 * Nested API JSON → flattened per-entity rows with parent-key injection.
 *
 * The XLSX flow is split into two stages so an explicit Sheet Mapping
 * Wizard can sit between upload and field mapping:
 *
 *   1. readCustomer360Workbook(file)
 *        → { sheets: RawSheet[], suggested: AutoSuggestResult }
 *        Reads every sheet, captures columns + sample + rows; auto-suggests
 *        a per-sheet entity mapping using sheet-name aliases, the legacy
 *        Genel/Genel Tekil/Detaylar preset, and header heuristics.
 *
 *   2. buildCustomer360BundleFromMappings(sheets, mappings, caps)
 *        → { bundle, perEntityOverflow, legacyInfo? }
 *        Concatenates rows across sheets per entity. When a sheet/entity
 *        pair matches the legacy preset (Genel/Genel Tekil/Detaylar →
 *        account/accountCompany/accountContact/accountProject) a dedicated
 *        legacy transformer renames + normalizes columns. Otherwise rows
 *        pass through with cell-level normalization (NULL/-/whitespace →
 *        empty, trim, "33652.0" → "33652" on id-shaped columns).
 *
 * BFF receives the final flattened { entity → {columns, rows} } map and
 * runs dry-run; no server-side change is needed for the wizard.
 */

import { CUSTOMER_360_ENTITY_KEYS, type Customer360EntityKey } from '@/services/importService';

export interface EntityBlock {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** First 5 rows for UI preview only. */
  sample: Array<Record<string, unknown>>;
  /** Total rows in source — sample is a subset of this. */
  totalRows: number;
}

export type Customer360Bundle = Record<Customer360EntityKey, EntityBlock>;

const EMPTY_BLOCK: EntityBlock = { columns: [], rows: [], sample: [], totalRows: 0 };

function emptyBundle(): Customer360Bundle {
  const out = {} as Customer360Bundle;
  for (const k of CUSTOMER_360_ENTITY_KEYS) {
    out[k] = { columns: [], rows: [], sample: [], totalRows: 0 };
  }
  return out;
}

/** Sheet name → entity key mapping (case-insensitive aliases). */
const SHEET_ALIASES: Record<string, Customer360EntityKey> = {
  accounts: 'account',
  account: 'account',
  'müşteri ana kartı': 'account',
  'musteri ana karti': 'account',
  müşteriler: 'account',
  musteriler: 'account',

  companies: 'accountCompany',
  accountcompanies: 'accountCompany',
  'accountcompany': 'accountCompany',
  'ilişkili şirket': 'accountCompany',
  'iliskili sirket': 'accountCompany',
  şirketler: 'accountCompany',
  sirketler: 'accountCompany',

  contacts: 'accountContact',
  accountcontacts: 'accountContact',
  'iletişim kişileri': 'accountContact',
  'iletisim kisileri': 'accountContact',
  iletişimler: 'accountContact',
  iletisimler: 'accountContact',

  addresses: 'accountAddress',
  accountaddresses: 'accountAddress',
  adresler: 'accountAddress',

  projects: 'accountProject',
  accountprojects: 'accountProject',
  projeler: 'accountProject',
};

export function mapSheetNameToEntity(sheetName: string): Customer360EntityKey | null {
  const k = sheetName.trim().toLowerCase();
  return SHEET_ALIASES[k] ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Shared cell / header normalization helpers
// ─────────────────────────────────────────────────────────────────────

/** Lowercase, trim, collapse internal whitespace to single space. */
function normalizeHeaderName(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Find the actual key in a source row that matches any of the given header
 * candidates, comparing case-insensitively with collapsed whitespace.
 */
function pickHeader(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const norm = new Map<string, string>();
  for (const k of Object.keys(row)) norm.set(normalizeHeaderName(k), k);
  for (const c of candidates) {
    const hit = norm.get(normalizeHeaderName(c));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Trim + drop sentinel "NULL"/"-"/whitespace-only values. */
function cleanCellString(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^(null|-)$/i.test(s)) return '';
  return s;
}

/** "33652.0" → "33652" for ID-shaped values; otherwise unchanged. */
function normalizeNumericId(v: unknown): string {
  const s = cleanCellString(v);
  if (!s) return '';
  const m = /^(-?\d+)\.0+$/.exec(s);
  return m ? m[1] : s;
}

/** "2017-12-31 21:00:00.000" → "2017-12-31"; other shapes pass through. */
function normalizeDateString(v: unknown): string {
  const s = cleanCellString(v);
  if (!s) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

/** id-shaped column heuristic: name contains key / id / code / vkn. */
function isIdLikeColumnName(name: string): boolean {
  const n = name.toLowerCase();
  return /(?:^|[^a-z])(key|id|code|vkn|kod|sifre|şifresi)(?:[^a-z]|$)/.test(n);
}

// ─────────────────────────────────────────────────────────────────────
// Legacy customer workbook detection (Genel / Genel Tekil / Detaylar)
// ─────────────────────────────────────────────────────────────────────

const LEGACY_SHEET_GENEL = 'genel';
const LEGACY_SHEET_GENEL_TEKIL = 'genel tekil';
const LEGACY_SHEET_DETAYLAR = 'detaylar';

export interface LegacyInfo {
  /** Which sheet was used as the Accounts source. */
  accountsSource: 'Genel Tekil' | 'Genel';
  /** Sheet name we skipped because a preferred alternative was used. */
  ignoredFallback: string | null;
  /** Row counts produced per entity (post-filter). */
  generatedCounts: Record<Customer360EntityKey, number>;
}

/**
 * Workbook-shape-only detector — does NOT inspect tenant or column content.
 * The workbook is "legacy" when it contains a Detaylar sheet AND either
 * Genel Tekil or Genel.
 */
export function detectLegacyCustomerWorkbook(sheetNames: string[]): boolean {
  const set = new Set(sheetNames.map((s) => normalizeHeaderName(s)));
  if (!set.has(LEGACY_SHEET_DETAYLAR)) return false;
  return set.has(LEGACY_SHEET_GENEL_TEKIL) || set.has(LEGACY_SHEET_GENEL);
}

// ─────────────────────────────────────────────────────────────────────
// Sheet Mapping Wizard — raw sheets + auto-suggestion + bundle builder.
// ─────────────────────────────────────────────────────────────────────

export interface RawSheet {
  sheetName: string;
  rowCount: number;
  columns: string[];
  sampleRows: Array<Record<string, unknown>>; // first 3 rows for the wizard preview
  rows: Array<Record<string, unknown>>;       // full row set (used at bundle build time)
}

export interface SheetMappingChoice {
  /** Target entities this sheet contributes rows to. Multiple allowed. */
  entities: Customer360EntityKey[];
  /** Skip this sheet entirely (no warning, no rows). */
  skip: boolean;
}

export interface AutoSuggestResult {
  /** Suggested mapping per sheet (by sheetName). */
  perSheet: Record<string, SheetMappingChoice>;
  /** True when the Genel/Genel Tekil/Detaylar preset contributed any mapping. */
  legacyPresetApplied: boolean;
  /** Source sheet for Accounts when the legacy preset hit (e.g. "Genel Tekil"). */
  legacyAccountsSource: string | null;
  /** "Genel" name when we preferred Genel Tekil and skipped Genel as a duplicate. */
  ignoredFallbackSheet: string | null;
}

/**
 * Read every sheet of an uploaded XLSX into RawSheet[] + auto-suggested
 * mappings. No bundle is produced here; that's the wizard's confirm step.
 */
export async function readCustomer360Workbook(file: File): Promise<{
  sheets: RawSheet[];
  suggested: AutoSuggestResult;
}> {
  const { read, utils } = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: 'array' });

  const sheets: RawSheet[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
    const colSet = new Set<string>();
    for (const r of rows) Object.keys(r).forEach((k) => colSet.add(k));
    sheets.push({
      sheetName,
      rowCount: rows.length,
      columns: [...colSet],
      sampleRows: rows.slice(0, 3),
      rows,
    });
  }

  const suggested = suggestSheetMappings(sheets);
  return { sheets, suggested };
}

/**
 * Auto-suggest per-sheet entity mappings. Sources, in priority order:
 *   A. Sheet-name alias (`Accounts`, `Şirketler`, ...).
 *   B. Legacy preset: Genel Tekil → account+accountCompany; Detaylar →
 *      accountContact+accountProject; Genel → account+accountCompany if
 *      Genel Tekil is absent, otherwise skipped as a duplicate.
 *   C. Header heuristics on column names.
 *
 * Multiple entities per sheet are allowed (and used for legacy preset).
 */
export function suggestSheetMappings(sheets: RawSheet[]): AutoSuggestResult {
  const perSheet: Record<string, SheetMappingChoice> = {};
  const normalized = sheets.map((s) => ({ s, norm: normalizeHeaderName(s.sheetName) }));
  const hasTekil = normalized.some((x) => x.norm === LEGACY_SHEET_GENEL_TEKIL);
  let legacyPresetApplied = false;
  let legacyAccountsSource: string | null = null;
  let ignoredFallbackSheet: string | null = null;

  for (const { s, norm } of normalized) {
    const entities = new Set<Customer360EntityKey>();
    let skip = false;

    // A. Standard / Turkish alias.
    const aliasHit = mapSheetNameToEntity(s.sheetName);
    if (aliasHit) entities.add(aliasHit);

    // B. Legacy preset.
    if (norm === LEGACY_SHEET_GENEL_TEKIL) {
      entities.add('account');
      entities.add('accountCompany');
      legacyPresetApplied = true;
      legacyAccountsSource = s.sheetName;
    } else if (norm === LEGACY_SHEET_GENEL) {
      if (hasTekil) {
        skip = true;
        ignoredFallbackSheet = s.sheetName;
      } else {
        entities.add('account');
        entities.add('accountCompany');
        legacyPresetApplied = true;
        legacyAccountsSource = s.sheetName;
      }
    } else if (norm === LEGACY_SHEET_DETAYLAR) {
      entities.add('accountContact');
      entities.add('accountProject');
      legacyPresetApplied = true;
    }

    // C. Header heuristics — only if no name-based mapping produced anything
    //    AND the sheet isn't being skipped.
    if (entities.size === 0 && !skip) {
      const headers = s.columns.map((c) => normalizeHeaderName(c));
      const hasAny = (needles: string[]) =>
        needles.some((n) => headers.some((h) => h.includes(n)));
      if (hasAny(['müşteri ünvan', 'musteri unvan', 'unvan', 'vergi numarası', 'vergi numarasi', 'vkn']))
        entities.add('account');
      if (hasAny(['müşteri şifresi', 'musteri sifresi', 'externalcustomercode', 'cari kod', 'companycode']))
        entities.add('accountCompany');
      if (hasAny(['ilgili kişi', 'ilgili kisi', 'e posta', 'e-posta', 'cep telefonu', 'fullname']))
        entities.add('accountContact');
      if (hasAny(['adres', 'şehir', 'sehir', 'ilçe', 'ilce', 'ülke', 'ulke', 'posta kodu']))
        entities.add('accountAddress');
      if (hasAny(['proje adı', 'proje adi', 'destek başlangıç', 'destek baslangic', 'destek bitiş', 'destek bitis']))
        entities.add('accountProject');
    }

    perSheet[s.sheetName] = { entities: [...entities], skip };
  }

  return { perSheet, legacyPresetApplied, legacyAccountsSource, ignoredFallbackSheet };
}

// ─────────────────────────────────────────────────────────────────────
// Per-entity legacy transformers (extracted so the wizard can reuse them
// whenever the user pairs a legacy sheet name with a legacy target).
// ─────────────────────────────────────────────────────────────────────

function legacyAccountRowsFrom(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  columns: string[];
} {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const k = {
      parent: pickHeader(r, ['Parent record no', 'PARENT RECORD NO']),
      sifre: pickHeader(r, ['Müşteri Şifresi']),
      unvan: pickHeader(r, ['Müşteri Ünvan']),
      vkn: pickHeader(r, ['Vergi Numarası']),
      tel1: pickHeader(r, ['Telefon No 1']),
      cep: pickHeader(r, ['Yeni Cep Telefonu', 'Cep Telefonu']),
    };
    const accountKey = k.parent ? normalizeNumericId(r[k.parent]) : '';
    const name = k.unvan ? cleanCellString(r[k.unvan]) : '';
    if (!accountKey && !name) continue; // skip wholly empty tail rows
    out.push({
      accountKey,
      name,
      vkn: k.vkn ? normalizeNumericId(r[k.vkn]) : '',
      phone: k.tel1 ? cleanCellString(r[k.tel1]) : '',
      // Surface mobile as a separate column so the field-mapping step can
      // route it if Telefon No 1 is empty. No dedicated schema field, so it
      // stays unmapped by default.
      mobilePhone: k.cep ? cleanCellString(r[k.cep]) : '',
      // Carry externalCustomerCode for reference even though it lives on
      // AccountCompany — the field-mapping step ignores unmapped extras.
      externalCustomerCode: k.sifre ? normalizeNumericId(r[k.sifre]) : '',
    });
  }
  return { rows: out, columns: ['accountKey', 'name', 'vkn', 'phone', 'mobilePhone', 'externalCustomerCode'] };
}

function legacyCompanyRowsFrom(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  columns: string[];
} {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const k = {
      parent: pickHeader(r, ['Parent record no', 'PARENT RECORD NO']),
      sifre: pickHeader(r, ['Müşteri Şifresi']),
      unvan: pickHeader(r, ['Müşteri Ünvan']),
    };
    const accountKey = k.parent ? normalizeNumericId(r[k.parent]) : '';
    const name = k.unvan ? cleanCellString(r[k.unvan]) : '';
    if (!accountKey && !name) continue;
    out.push({
      accountKey,
      companyCode: '',
      externalCustomerCode: k.sifre ? normalizeNumericId(r[k.sifre]) : '',
      status: 'Aktif',
    });
  }
  return { rows: out, columns: ['accountKey', 'companyCode', 'externalCustomerCode', 'status'] };
}

function legacyContactRowsFrom(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  columns: string[];
} {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const k = {
      parent: pickHeader(r, ['PARENT RECORD NO', 'Parent record no']),
      fullName: pickHeader(r, ['İlgili Kişi Ad']),
      email: pickHeader(r, ['E posta', 'E-posta']),
      cep: pickHeader(r, ['Cep Telefonu']),
      tel1: pickHeader(r, ['Telefon No 1']),
      tel2: pickHeader(r, ['Telefon No 2']),
    };
    const accountKey = k.parent ? normalizeNumericId(r[k.parent]) : '';
    const fullName = k.fullName ? cleanCellString(r[k.fullName]) : '';
    const email = k.email ? cleanCellString(r[k.email]) : '';
    const phone =
      (k.cep && cleanCellString(r[k.cep])) ||
      (k.tel1 && cleanCellString(r[k.tel1])) ||
      (k.tel2 && cleanCellString(r[k.tel2])) ||
      '';
    if (!accountKey) continue;
    if (!fullName && !email && !phone) continue; // skip empty contact rows
    out.push({ accountKey, fullName, email, phone, title: '' });
  }
  return { rows: out, columns: ['accountKey', 'fullName', 'email', 'phone', 'title'] };
}

function legacyProjectRowsFrom(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>;
  columns: string[];
} {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const k = {
      parent: pickHeader(r, ['PARENT RECORD NO', 'Parent record no']),
      projectName: pickHeader(r, ['Proje Adı', 'Proje']),
      status: pickHeader(r, ['Destek Durumu']),
      start: pickHeader(r, ['Destek Başlangıç Tarih']),
      end: pickHeader(r, ['Destek Bitiş Tarih']),
    };
    const accountKey = k.parent ? normalizeNumericId(r[k.parent]) : '';
    const projectName = k.projectName ? cleanCellString(r[k.projectName]) : '';
    if (!accountKey || !projectName) continue; // skip empty project rows
    out.push({
      accountKey,
      accountCompanyKey: '',
      projectName,
      status: k.status ? cleanCellString(r[k.status]) : '',
      startDate: k.start ? normalizeDateString(r[k.start]) : '',
      endDate: k.end ? normalizeDateString(r[k.end]) : '',
    });
  }
  return {
    rows: out,
    columns: ['accountKey', 'accountCompanyKey', 'projectName', 'status', 'startDate', 'endDate'],
  };
}

/**
 * Decide whether a (sheet name, target entity) pair is a known legacy
 * combination that should run through a dedicated transformer.
 */
function legacyTransformer(
  sheetName: string,
  entity: Customer360EntityKey,
): ((rows: Array<Record<string, unknown>>) => { rows: Array<Record<string, unknown>>; columns: string[] }) | null {
  const norm = normalizeHeaderName(sheetName);
  if (norm === LEGACY_SHEET_GENEL_TEKIL || norm === LEGACY_SHEET_GENEL) {
    if (entity === 'account') return legacyAccountRowsFrom;
    if (entity === 'accountCompany') return legacyCompanyRowsFrom;
  }
  if (norm === LEGACY_SHEET_DETAYLAR) {
    if (entity === 'accountContact') return legacyContactRowsFrom;
    if (entity === 'accountProject') return legacyProjectRowsFrom;
  }
  return null;
}

/**
 * Passthrough row builder for arbitrary sheets. Cell-level normalization
 * only: trim, drop NULL/-/whitespace, strip ".0" suffix on id-shaped
 * columns. Dates are NOT normalized here because the target field is not
 * known at this stage — field mapping + dry-run handle date parsing.
 */
function passthroughRows(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): { rows: Array<Record<string, unknown>>; columns: string[] } {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const next: Record<string, unknown> = {};
    let nonEmpty = false;
    for (const c of columns) {
      const raw = r[c];
      let v: unknown;
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        v = raw;
        nonEmpty = true;
      } else if (raw === undefined || raw === null) {
        v = '';
      } else {
        const cleaned = cleanCellString(raw);
        v = isIdLikeColumnName(c) ? normalizeNumericId(cleaned) : cleaned;
        if (v !== '') nonEmpty = true;
      }
      next[c] = v;
    }
    if (nonEmpty) out.push(next);
  }
  return { rows: out, columns };
}

/**
 * Build a Customer360Bundle from raw sheets + per-sheet entity mappings.
 *
 * Mapping semantics:
 *  - mappings[sheetName].skip=true → ignored, never surfaces as unmapped.
 *  - mappings[sheetName].entities=[] (and not skipped) → sheet stays
 *    "unmapped" for UI purposes (caller can warn).
 *  - mappings[sheetName].entities=[e1, e2] → each entity collects rows
 *    from that sheet; if the (sheet, entity) pair matches the legacy
 *    preset, the dedicated legacy transformer runs; otherwise rows
 *    pass through with cell-level normalization.
 *
 * Multiple sheets per entity → row sets are concatenated, column lists
 * unioned.
 */
export function buildCustomer360BundleFromMappings(
  sheets: RawSheet[],
  mappings: Record<string, SheetMappingChoice>,
  caps: Record<Customer360EntityKey, number>,
): {
  bundle: Customer360Bundle;
  perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
  legacyInfo: LegacyInfo | null;
} {
  const bundle = emptyBundle();
  const perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }> = [];

  // entity → concatenated row set + union of column names
  const acc: Record<Customer360EntityKey, { rows: Array<Record<string, unknown>>; columnSet: Set<string> }> = {
    account: { rows: [], columnSet: new Set() },
    accountCompany: { rows: [], columnSet: new Set() },
    accountContact: { rows: [], columnSet: new Set() },
    accountAddress: { rows: [], columnSet: new Set() },
    accountProject: { rows: [], columnSet: new Set() },
  };

  let legacyConverted = false;
  let legacyAccountsSourceName: string | null = null;
  let legacyIgnoredFallback: string | null = null;

  // Detect whether Genel was skipped because Genel Tekil mapped to account.
  const sheetByNorm = new Map<string, RawSheet>();
  for (const s of sheets) sheetByNorm.set(normalizeHeaderName(s.sheetName), s);
  const tekilSheet = sheetByNorm.get(LEGACY_SHEET_GENEL_TEKIL);
  const genelSheet = sheetByNorm.get(LEGACY_SHEET_GENEL);
  if (tekilSheet && genelSheet) {
    const tekilMap = mappings[tekilSheet.sheetName];
    const genelMap = mappings[genelSheet.sheetName];
    if (tekilMap?.entities.includes('account') && (genelMap?.skip || !genelMap?.entities.includes('account'))) {
      legacyIgnoredFallback = genelSheet.sheetName;
    }
  }

  for (const sheet of sheets) {
    const choice = mappings[sheet.sheetName];
    if (!choice || choice.skip || choice.entities.length === 0) continue;

    for (const entity of choice.entities) {
      const transform = legacyTransformer(sheet.sheetName, entity);
      const { rows, columns } = transform
        ? transform(sheet.rows)
        : passthroughRows(sheet.rows, sheet.columns);
      if (transform) {
        legacyConverted = true;
        if (entity === 'account' && !legacyAccountsSourceName) legacyAccountsSourceName = sheet.sheetName;
      }
      for (const r of rows) acc[entity].rows.push(r);
      for (const c of columns) acc[entity].columnSet.add(c);
    }
  }

  for (const entity of CUSTOMER_360_ENTITY_KEYS) {
    const a = acc[entity];
    const max = caps[entity] ?? 5000;
    if (a.rows.length > max) perEntityOverflow.push({ entity, count: a.rows.length, max });
    if (a.rows.length === 0) {
      bundle[entity] = EMPTY_BLOCK;
    } else {
      bundle[entity] = {
        columns: [...a.columnSet],
        rows: a.rows,
        sample: a.rows.slice(0, 5),
        totalRows: a.rows.length,
      };
    }
  }

  const legacyInfo: LegacyInfo | null = legacyConverted
    ? {
        accountsSource:
          legacyAccountsSourceName && normalizeHeaderName(legacyAccountsSourceName) === LEGACY_SHEET_GENEL_TEKIL
            ? 'Genel Tekil'
            : 'Genel',
        ignoredFallback: legacyIgnoredFallback,
        generatedCounts: {
          account: acc.account.rows.length,
          accountCompany: acc.accountCompany.rows.length,
          accountContact: acc.accountContact.rows.length,
          accountAddress: acc.accountAddress.rows.length,
          accountProject: acc.accountProject.rows.length,
        },
      }
    : null;

  return { bundle, perEntityOverflow, legacyInfo };
}

// ─────────────────────────────────────────────────────────────────────
// Nested API JSON flatten — unchanged.
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse nested API JSON into bundle. Shape:
 *   { accounts: [ { ...account, companies: [], contacts: [], addresses: [], projects: [] } ] }
 *
 * Children get `accountKey` (parent's vkn || externalCustomerCode || name)
 * injected if not already present, so the BFF mapping/auto-map works
 * uniformly across XLSX and API sources.
 */
export function flattenCustomer360Json(
  payload: unknown,
  caps: Record<Customer360EntityKey, number>,
): {
  bundle: Customer360Bundle;
  perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
} {
  const bundle = emptyBundle();
  const perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }> = [];

  const accountsArr = extractAccountsArray(payload);
  if (!accountsArr) return { bundle, perEntityOverflow };

  const accountRows: Array<Record<string, unknown>> = [];
  const companyRows: Array<Record<string, unknown>> = [];
  const contactRows: Array<Record<string, unknown>> = [];
  const addressRows: Array<Record<string, unknown>> = [];
  const projectRows: Array<Record<string, unknown>> = [];

  for (const a of accountsArr) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    const acc = a as Record<string, unknown>;
    const accountKey =
      (acc.vkn as string | undefined) ??
      (acc.externalCustomerCode as string | undefined) ??
      (acc.name as string | undefined) ??
      '';
    const { companies, contacts, addresses, projects, ...accountFlat } = acc;
    accountRows.push(accountFlat);

    if (Array.isArray(companies)) {
      for (const c of companies) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const row = { ...(c as Record<string, unknown>) };
        if (row.accountKey == null && accountKey) row.accountKey = accountKey;
        companyRows.push(row);
      }
    }
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const row = { ...(c as Record<string, unknown>) };
        if (row.accountKey == null && accountKey) row.accountKey = accountKey;
        contactRows.push(row);
      }
    }
    if (Array.isArray(addresses)) {
      for (const c of addresses) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const row = { ...(c as Record<string, unknown>) };
        if (row.accountKey == null && accountKey) row.accountKey = accountKey;
        addressRows.push(row);
      }
    }
    if (Array.isArray(projects)) {
      for (const c of projects) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const row = { ...(c as Record<string, unknown>) };
        if (row.accountKey == null && accountKey) row.accountKey = accountKey;
        if (row.accountCompanyKey == null && row.companyCode != null) {
          row.accountCompanyKey = row.companyCode;
        }
        projectRows.push(row);
      }
    }
  }

  bundle.account = pack(accountRows, caps.account, 'account', perEntityOverflow);
  bundle.accountCompany = pack(companyRows, caps.accountCompany, 'accountCompany', perEntityOverflow);
  bundle.accountContact = pack(contactRows, caps.accountContact, 'accountContact', perEntityOverflow);
  bundle.accountAddress = pack(addressRows, caps.accountAddress, 'accountAddress', perEntityOverflow);
  bundle.accountProject = pack(projectRows, caps.accountProject, 'accountProject', perEntityOverflow);

  return { bundle, perEntityOverflow };
}

function pack(
  rows: Array<Record<string, unknown>>,
  max: number,
  entity: Customer360EntityKey,
  overflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>,
): EntityBlock {
  if (rows.length === 0) return EMPTY_BLOCK;
  if (rows.length > max) overflow.push({ entity, count: rows.length, max });
  const colSet = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => colSet.add(k));
  return {
    columns: [...colSet],
    rows,
    sample: rows.slice(0, 5),
    totalRows: rows.length,
  };
}

function extractAccountsArray(payload: unknown): Array<Record<string, unknown>> | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const cand = obj.accounts ?? obj.data ?? obj.items ?? obj.records;
  if (Array.isArray(cand)) return cand as Array<Record<string, unknown>>;
  return null;
}
