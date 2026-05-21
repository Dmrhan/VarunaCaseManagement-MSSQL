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

/**
 * Parse multi-sheet XLSX file. Returns a bundle with one EntityBlock per
 * mapped sheet. Unmapped sheets are ignored (UI surfaces this in warning).
 */
export async function parseCustomer360Xlsx(
  file: File,
  caps: Record<Customer360EntityKey, number>,
): Promise<{
  bundle: Customer360Bundle;
  unmappedSheets: string[];
  perEntityOverflow: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
}> {
  const { read, utils } = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: 'array' });
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
