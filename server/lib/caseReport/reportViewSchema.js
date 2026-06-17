/**
 * Phase 4 — Saved Views validation + serialization helpers.
 *
 * Pure JS, no Prisma — backend route ve static smoke aynı doğrulayıcıyı
 * paylaşır (DB-bağımsız test edilebilir).
 *
 * Kayıt sırası (request body → DB row):
 *   1. validateReportViewPayload(body) → { ok, errors, view }
 *   2. serializeForDb(view) → { ..., columns: JSON.stringify(view.columns), ... }
 *
 * Okuma sırası (DB row → response body):
 *   parseFromDb(row) → { ..., columns: JSON.parse(row.columns), ... }
 *
 * Serialize edilen alanlar (NVARCHAR(MAX) JSON):
 *   - columns     : string[]
 *   - filters     : ReportFilters object
 *   - pivotConfig : { rowColumnId, colColumnId, measure: {fn, columnId?} } | null
 */

import { REPORT_COLUMNS } from './columnRegistry.js';
import { PIVOT_MEASURE_FNS } from './pivot.js';

const NAME_MAX = 200;
const DESC_MAX = 4000; // UI tarafında ~3000 cap; defensive
const COLUMNS_MAX = 100; // tek view'da bir kullanıcı ne kadar kolon seçer? 100 fazlasıyla yeter
const MODES = ['list', 'pivot'];

const COLUMN_ID_SET = new Set(REPORT_COLUMNS.map((c) => c.id));

/**
 * Body validation. Tenant scope (companyId allowedCompanyIds içinde mi)
 * route handler'da kontrol edilir — bu fonksiyon yalnız payload şekli ve
 * referans bütünlüğü için.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors: string[], view?: object }}
 */
export function validateReportViewPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0) errors.push('name is required');
  else if (name.length > NAME_MAX) errors.push(`name must be ≤ ${NAME_MAX} chars`);

  const description = body.description == null
    ? null
    : (typeof body.description === 'string' ? body.description : '');
  if (description != null && description.length > DESC_MAX) {
    errors.push(`description must be ≤ ${DESC_MAX} chars`);
  }

  const mode = typeof body.mode === 'string' ? body.mode : '';
  if (!MODES.includes(mode)) errors.push(`mode must be one of ${MODES.join('|')}`);

  // companyId: tenant scope guard — burada sadece tip kontrol; allowedCompanyIds
  // intersect'i route handler'a bırak.
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
  if (companyId.length === 0) errors.push('companyId is required');

  // columns: string[] of valid column IDs
  if (!Array.isArray(body.columns)) {
    errors.push('columns must be an array');
  } else if (body.columns.length === 0) {
    errors.push('columns must include at least one column');
  } else if (body.columns.length > COLUMNS_MAX) {
    errors.push(`columns must be ≤ ${COLUMNS_MAX}`);
  } else {
    for (const id of body.columns) {
      if (typeof id !== 'string' || !COLUMN_ID_SET.has(id)) {
        errors.push(`unknown column id: ${typeof id === 'string' ? id : '(non-string)'}`);
      }
    }
  }

  // filters: object (passthrough; ReportFilters şeması preview endpoint
  // tarafından validate ediliyor — burada sadece tip)
  if (body.filters == null) {
    errors.push('filters is required (use {} for empty)');
  } else if (typeof body.filters !== 'object' || Array.isArray(body.filters)) {
    errors.push('filters must be a JSON object');
  }

  // pivotConfig: null'sa list mode; obje ise pivot mode validation
  let pivotConfig = null;
  if (mode === 'pivot') {
    if (!body.pivotConfig || typeof body.pivotConfig !== 'object') {
      errors.push('pivotConfig is required for mode=pivot');
    } else {
      const p = body.pivotConfig;
      if (typeof p.rowColumnId !== 'string' || !COLUMN_ID_SET.has(p.rowColumnId)) {
        errors.push('pivotConfig.rowColumnId must be a valid column id');
      }
      if (typeof p.colColumnId !== 'string' || !COLUMN_ID_SET.has(p.colColumnId)) {
        errors.push('pivotConfig.colColumnId must be a valid column id');
      }
      if (!p.measure || typeof p.measure !== 'object') {
        errors.push('pivotConfig.measure is required');
      } else {
        if (!PIVOT_MEASURE_FNS.includes(p.measure.fn)) {
          errors.push(`pivotConfig.measure.fn must be one of ${PIVOT_MEASURE_FNS.join('|')}`);
        }
        if (p.measure.fn !== 'count') {
          if (typeof p.measure.columnId !== 'string' || !COLUMN_ID_SET.has(p.measure.columnId)) {
            errors.push('pivotConfig.measure.columnId is required for non-count fn');
          }
        }
      }
      pivotConfig = {
        rowColumnId: p.rowColumnId,
        colColumnId: p.colColumnId,
        measure: {
          fn: p?.measure?.fn,
          ...(p?.measure?.columnId ? { columnId: p.measure.columnId } : {}),
        },
      };
    }
  } else if (body.pivotConfig != null) {
    // mode=list ama pivotConfig gönderilmiş — sessiz ignore (defansif)
    pivotConfig = null;
  }

  const isShared = body.isShared === true;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    view: {
      name,
      description,
      mode,
      companyId,
      columns: body.columns.slice(),
      filters: body.filters,
      pivotConfig,
      isShared,
    },
  };
}

/**
 * Validated view objesini DB row formatına çevir (JSON serialize).
 * Caller ownerId ve generated id'i ekleyip prisma.create() çağırır.
 */
export function serializeForDb(view) {
  return {
    name: view.name,
    description: view.description,
    mode: view.mode,
    companyId: view.companyId,
    columns: JSON.stringify(view.columns),
    filters: JSON.stringify(view.filters),
    pivotConfig: view.pivotConfig == null ? null : JSON.stringify(view.pivotConfig),
    isShared: view.isShared,
  };
}

/**
 * Prisma row'unu API response shape'ine çevir (JSON parse + defensive).
 * Bozuk JSON satırı varsa null/[] döner — UI hata vermesin, kullanıcı
 * yeni view kaydedebilsin.
 */
export function parseFromDb(row) {
  if (!row || typeof row !== 'object') return null;
  let columns = [];
  let filters = {};
  let pivotConfig = null;
  try { const v = JSON.parse(row.columns); if (Array.isArray(v)) columns = v; } catch { /* skip */ }
  try { const v = JSON.parse(row.filters); if (v && typeof v === 'object') filters = v; } catch { /* skip */ }
  if (row.pivotConfig != null) {
    try { const v = JSON.parse(row.pivotConfig); if (v && typeof v === 'object') pivotConfig = v; } catch { /* skip */ }
  }
  return {
    id: row.id,
    companyId: row.companyId,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? null,
    mode: row.mode,
    columns,
    filters,
    pivotConfig,
    isShared: row.isShared === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const __internal = {
  NAME_MAX, DESC_MAX, COLUMNS_MAX, MODES,
};
