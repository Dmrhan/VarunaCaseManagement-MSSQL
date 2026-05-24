/**
 * WR-A8 Phase 2a — Customer 360 client-side parsers.
 *
 * Multi-sheet XLSX → per-entity rows + columns.
 * Nested API JSON → flattened per-entity rows with parent-key injection.
 *
 * No server-side body needed for these; BFF receives already-flattened
 * { entity → {columns, rows} } map and runs dry-run.
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
 * Returns undefined when no candidate matches.
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

/**
 * Convert any cell value to a trimmed string. Treats sentinel "NULL", "-",
 * and whitespace-only as empty.
 */
function cleanCellString(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^(null|-)$/i.test(s)) return '';
  return s;
}

/**
 * Strip a trailing ".0" / ".0000" from numeric-id strings produced by Excel
 * when ID-shaped values are stored as numbers (e.g. "33652.0" → "33652").
 * Non-numeric strings pass through unchanged.
 */
function normalizeNumericId(v: unknown): string {
  const s = cleanCellString(v);
  if (!s) return '';
  const m = /^(-?\d+)\.0+$/.exec(s);
  return m ? m[1] : s;
}

/**
 * Pull the leading "yyyy-mm-dd" out of a value like "2017-12-31 21:00:00.000".
 * Pass through other shapes; dry-run already normalizes safely.
 */
function normalizeDateString(v: unknown): string {
  const s = cleanCellString(v);
  if (!s) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

// ─────────────────────────────────────────────────────────────────────
// Legacy customer workbook (Genel / Genel Tekil / Detaylar) support.
// Independent of selected company — detection is based on sheet shape only.
// ─────────────────────────────────────────────────────────────────────

const LEGACY_SHEET_GENEL = 'genel';
const LEGACY_SHEET_GENEL_TEKIL = 'genel tekil';
const LEGACY_SHEET_DETAYLAR = 'detaylar';

interface LegacyInfo {
  /** Which sheet was used as the Accounts source. */
  accountsSource: 'Genel Tekil' | 'Genel';
  /** Sheet name we skipped because a preferred alternative was used. */
  ignoredFallback: string | null;
  /** Row counts produced per entity (post-filter). */
  generatedCounts: Record<Customer360EntityKey, number>;
}

/**
 * Detect the legacy customer Excel layout from sheet shape only — no
 * companyId / tenant lookup, no header content. The workbook is "legacy"
 * when it contains a Detaylar sheet plus either Genel Tekil or Genel.
 */
export function detectLegacyCustomerWorkbook(sheetNames: string[]): boolean {
  const set = new Set(sheetNames.map((s) => normalizeHeaderName(s)));
  if (!set.has(LEGACY_SHEET_DETAYLAR)) return false;
  return set.has(LEGACY_SHEET_GENEL_TEKIL) || set.has(LEGACY_SHEET_GENEL);
}

function findSheetByName(
  wb: { SheetNames: string[]; Sheets: Record<string, unknown> },
  norm: string,
): { name: string; sheet: unknown } | null {
  for (const sn of wb.SheetNames) {
    if (normalizeHeaderName(sn) === norm) return { name: sn, sheet: wb.Sheets[sn] };
  }
  return null;
}

/**
 * Convert a legacy customer workbook into a standard Customer360Bundle.
 * Behavior:
 *  - Accounts ← Genel Tekil (preferred) or Genel (fallback)
 *  - Companies ← one AccountCompany per Account row, companyCode left blank
 *    so the wizard's selected-company guard auto-binds.
 *  - Contacts ← Detaylar rows where any of fullName/email/phone is present.
 *  - Projects ← Detaylar rows where projectName is present.
 *  - Addresses ← empty (legacy layout has no address sheet).
 *
 * The parser is company-agnostic and never injects a companyCode. The
 * selected company in the wizard remains authoritative at dry-run time.
 */
export function parseLegacyCustomerWorkbook(
  wb: { SheetNames: string[]; Sheets: Record<string, unknown> },
  caps: Record<Customer360EntityKey, number>,
  utils: typeof import('xlsx')['utils'],
): {
  bundle: Customer360Bundle;
  unmappedSheets: string[];
  perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
  legacyInfo: LegacyInfo;
} {
  const bundle = emptyBundle();
  const perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }> = [];

  const tekil = findSheetByName(wb, LEGACY_SHEET_GENEL_TEKIL);
  const genel = findSheetByName(wb, LEGACY_SHEET_GENEL);
  const detay = findSheetByName(wb, LEGACY_SHEET_DETAYLAR);
  const accountsSourceObj = tekil ?? genel;
  if (!accountsSourceObj || !detay) {
    // Shouldn't reach here if detect ran first, but fail safe.
    return {
      bundle,
      unmappedSheets: wb.SheetNames,
      perEntityOverflow,
      legacyInfo: {
        accountsSource: 'Genel Tekil',
        ignoredFallback: null,
        generatedCounts: { account: 0, accountCompany: 0, accountContact: 0, accountAddress: 0, accountProject: 0 },
      },
    };
  }
  const accountsSourceLabel: LegacyInfo['accountsSource'] =
    accountsSourceObj === tekil ? 'Genel Tekil' : 'Genel';
  const ignoredFallback = tekil && genel ? genel.name : null;

  // ── Accounts + Companies (from Genel Tekil / Genel) ──
  const accountsJson = utils.sheet_to_json<Record<string, unknown>>(accountsSourceObj.sheet as never, {
    defval: '',
    raw: false,
  });

  const accountRows: Array<Record<string, unknown>> = [];
  const companyRows: Array<Record<string, unknown>> = [];
  for (const r of accountsJson) {
    const keys = {
      parent: pickHeader(r, ['Parent record no', 'PARENT RECORD NO']),
      sifre: pickHeader(r, ['Müşteri Şifresi']),
      unvan: pickHeader(r, ['Müşteri Ünvan']),
      vkn: pickHeader(r, ['Vergi Numarası']),
      tel1: pickHeader(r, ['Telefon No 1']),
      cep: pickHeader(r, ['Yeni Cep Telefonu', 'Cep Telefonu']),
    };
    const accountKey = keys.parent ? normalizeNumericId(r[keys.parent]) : '';
    const name = keys.unvan ? cleanCellString(r[keys.unvan]) : '';
    // Skip wholly empty rows — happens at the tail of legacy exports.
    if (!accountKey && !name) continue;
    const externalCustomerCode = keys.sifre ? normalizeNumericId(r[keys.sifre]) : '';
    const vkn = keys.vkn ? normalizeNumericId(r[keys.vkn]) : '';
    const phone = keys.tel1 ? cleanCellString(r[keys.tel1]) : '';
    const mobilePhone = keys.cep ? cleanCellString(r[keys.cep]) : '';

    accountRows.push({
      accountKey,
      name,
      vkn,
      phone,
      // Surface the mobile number as a separate column so the mapping UI
      // can route it (e.g. to phone if Telefon No 1 is empty). The target
      // schema doesn't have a dedicated mobilePhone field, so we leave it
      // unmapped by default.
      mobilePhone,
    });
    companyRows.push({
      accountKey,
      companyCode: '',
      externalCustomerCode,
      status: 'Aktif',
    });
  }

  // ── Contacts + Projects (from Detaylar) ──
  const detayJson = utils.sheet_to_json<Record<string, unknown>>(detay.sheet as never, {
    defval: '',
    raw: false,
  });
  const contactRows: Array<Record<string, unknown>> = [];
  const projectRows: Array<Record<string, unknown>> = [];
  for (const r of detayJson) {
    const keys = {
      parent: pickHeader(r, ['PARENT RECORD NO', 'Parent record no']),
      fullName: pickHeader(r, ['İlgili Kişi Ad']),
      email: pickHeader(r, ['E posta', 'E-posta']),
      cep: pickHeader(r, ['Cep Telefonu']),
      tel1: pickHeader(r, ['Telefon No 1']),
      tel2: pickHeader(r, ['Telefon No 2']),
      projectName: pickHeader(r, ['Proje Adı', 'Proje']),
      status: pickHeader(r, ['Destek Durumu']),
      start: pickHeader(r, ['Destek Başlangıç Tarih']),
      end: pickHeader(r, ['Destek Bitiş Tarih']),
    };
    const accountKey = keys.parent ? normalizeNumericId(r[keys.parent]) : '';

    const fullName = keys.fullName ? cleanCellString(r[keys.fullName]) : '';
    const email = keys.email ? cleanCellString(r[keys.email]) : '';
    const cep = keys.cep ? cleanCellString(r[keys.cep]) : '';
    const tel1 = keys.tel1 ? cleanCellString(r[keys.tel1]) : '';
    const tel2 = keys.tel2 ? cleanCellString(r[keys.tel2]) : '';
    const contactPhone = cep || tel1 || tel2 || '';
    // Skip contact when nothing identifying is present.
    if (accountKey && (fullName || email || contactPhone)) {
      contactRows.push({
        accountKey,
        fullName,
        email,
        phone: contactPhone,
        title: '',
      });
    }

    const projectName = keys.projectName ? cleanCellString(r[keys.projectName]) : '';
    if (accountKey && projectName) {
      projectRows.push({
        accountKey,
        accountCompanyKey: '',
        projectName,
        status: keys.status ? cleanCellString(r[keys.status]) : '',
        startDate: keys.start ? normalizeDateString(r[keys.start]) : '',
        endDate: keys.end ? normalizeDateString(r[keys.end]) : '',
      });
    }
  }

  // Pack into bundle using the standard EntityBlock shape.
  const packs: Array<{ entity: Customer360EntityKey; rows: Array<Record<string, unknown>>; columns: string[] }> = [
    { entity: 'account',         rows: accountRows, columns: ['accountKey', 'name', 'vkn', 'phone', 'mobilePhone'] },
    { entity: 'accountCompany',  rows: companyRows, columns: ['accountKey', 'companyCode', 'externalCustomerCode', 'status'] },
    { entity: 'accountContact',  rows: contactRows, columns: ['accountKey', 'fullName', 'email', 'phone', 'title'] },
    { entity: 'accountProject',  rows: projectRows, columns: ['accountKey', 'accountCompanyKey', 'projectName', 'status', 'startDate', 'endDate'] },
    // accountAddress: legacy layout has no source — leave empty block.
  ];
  for (const p of packs) {
    const max = caps[p.entity] ?? 5000;
    if (p.rows.length > max) perEntityOverflow.push({ entity: p.entity, count: p.rows.length, max });
    bundle[p.entity] = {
      columns: p.columns,
      rows: p.rows,
      sample: p.rows.slice(0, 5),
      totalRows: p.rows.length,
    };
  }

  // unmappedSheets: any source sheet NOT consumed by legacy conversion.
  const consumed = new Set<string>();
  consumed.add(accountsSourceObj.name);
  consumed.add(detay.name);
  const unmappedSheets = wb.SheetNames.filter((s) => !consumed.has(s));

  return {
    bundle,
    unmappedSheets,
    perEntityOverflow,
    legacyInfo: {
      accountsSource: accountsSourceLabel,
      ignoredFallback,
      generatedCounts: {
        account: accountRows.length,
        accountCompany: companyRows.length,
        accountContact: contactRows.length,
        accountAddress: 0,
        accountProject: projectRows.length,
      },
    },
  };
}

/**
 * Parse multi-sheet XLSX file. Returns a bundle with one EntityBlock per
 * mapped sheet. Unmapped sheets are ignored (UI surfaces this in warning).
 *
 * If the workbook contains NO standard Customer 360 sheet names but matches
 * the legacy "Genel / Genel Tekil / Detaylar" shape, the legacy converter
 * runs instead and the result includes a `legacyInfo` block. When both
 * standard and legacy sheets appear together, the standard branch wins and
 * the legacy sheets show up as unmapped — matches the principle that the
 * canonical template is the source of truth.
 */
export async function parseCustomer360Xlsx(
  file: File,
  caps: Record<Customer360EntityKey, number>,
): Promise<{
  bundle: Customer360Bundle;
  unmappedSheets: string[];
  perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
  legacyInfo?: LegacyInfo;
}> {
  const { read, utils } = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: 'array' });

  const hasStandard = wb.SheetNames.some((s) => mapSheetNameToEntity(s) !== null);
  if (!hasStandard && detectLegacyCustomerWorkbook(wb.SheetNames)) {
    return parseLegacyCustomerWorkbook(wb, caps, utils);
  }

  const bundle = emptyBundle();
  const unmappedSheets: string[] = [];
  const perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }> = [];

  for (const sheetName of wb.SheetNames) {
    const entity = mapSheetNameToEntity(sheetName);
    if (!entity) {
      unmappedSheets.push(sheetName);
      continue;
    }
    const ws = wb.Sheets[sheetName];
    const json = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
    if (json.length === 0) continue;
    const colSet = new Set<string>();
    for (const r of json) Object.keys(r).forEach((k) => colSet.add(k));
    const columns = [...colSet];
    const max = caps[entity] ?? 5000;
    if (json.length > max) {
      perEntityOverflow.push({ entity, count: json.length, max });
      // Cap at limit; UI will show overflow warning. dry-run also catches it.
    }
    bundle[entity] = {
      columns,
      rows: json,
      sample: json.slice(0, 5),
      totalRows: json.length,
    };
  }
  return { bundle, unmappedSheets, perEntityOverflow };
}

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
        // Project also needs accountCompanyKey — fall back to companyCode if present.
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
