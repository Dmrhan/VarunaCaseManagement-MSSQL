/**
 * Case Report Studio Phase 3.1 — Pivot compute core.
 *
 * Pure JS, fixture-testable. Backend route fetched rows + ColumnDef'ler
 * üzerinden çağırır; DB-bağımsız.
 *
 * Sözleşme:
 *   input.rows  : extracted (row-dim) string array (her case için)
 *   input.cols  : extracted (col-dim) string array
 *   input.measureValues : numeric value array (count fn için ignore)
 *   input.measureFn : 'count' | 'sum' | 'avg' | 'min' | 'max'
 *
 * Output:
 *   {
 *     rowLabels: string[]   // unique, alfabetik sıralı (boş '' "—" olarak gösterilir)
 *     colLabels: string[]
 *     matrix: { [rowLabel]: { [colLabel]: number } }
 *     rowTotals: { [rowLabel]: number }
 *     colTotals: { [colLabel]: number }
 *     grandTotal: number
 *   }
 *
 * Boş dimension değerleri (null/undefined/'') 'BLANK_LABEL' ile etiketlenir.
 * Frontend bunu "(boş)" diye render edebilir veya filter'layabilir.
 */

export const BLANK_LABEL = '(boş)';

export const PIVOT_MEASURE_FNS = ['count', 'sum', 'avg', 'min', 'max'];

function normalizeLabel(v) {
  if (v == null) return BLANK_LABEL;
  const s = typeof v === 'string' ? v : String(v);
  return s.trim().length === 0 ? BLANK_LABEL : s;
}

function aggregate(fn, values) {
  if (fn === 'count') return values.length;
  if (values.length === 0) return 0;
  if (fn === 'sum') {
    let s = 0;
    for (const v of values) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) s += n;
    }
    return s;
  }
  if (fn === 'avg') {
    let s = 0, c = 0;
    for (const v of values) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) { s += n; c += 1; }
    }
    return c === 0 ? 0 : s / c;
  }
  if (fn === 'min') {
    let m = null;
    for (const v of values) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (m == null || n < m) m = n;
    }
    return m ?? 0;
  }
  if (fn === 'max') {
    let m = null;
    for (const v of values) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (m == null || n > m) m = n;
    }
    return m ?? 0;
  }
  return 0;
}

/**
 * @param {object} input
 * @param {string[]} input.rowValues  — case başına bir row-dim değeri
 * @param {string[]} input.colValues  — case başına bir col-dim değeri
 * @param {Array<number|string|null>} input.measureValues — count için ignore
 * @param {'count'|'sum'|'avg'|'min'|'max'} input.measureFn
 * @returns {{ rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal }}
 */
export function computePivot(input) {
  const rowValues = Array.isArray(input?.rowValues) ? input.rowValues : [];
  const colValues = Array.isArray(input?.colValues) ? input.colValues : [];
  const measureValues = Array.isArray(input?.measureValues) ? input.measureValues : [];
  const measureFn = PIVOT_MEASURE_FNS.includes(input?.measureFn) ? input.measureFn : 'count';

  const n = rowValues.length;
  // Cell buckets: rowLabel → colLabel → values[]
  const buckets = new Map();
  const rowLabelSet = new Set();
  const colLabelSet = new Set();

  for (let i = 0; i < n; i++) {
    const r = normalizeLabel(rowValues[i]);
    const c = normalizeLabel(colValues[i]);
    rowLabelSet.add(r);
    colLabelSet.add(c);
    let rb = buckets.get(r);
    if (!rb) { rb = new Map(); buckets.set(r, rb); }
    let arr = rb.get(c);
    if (!arr) { arr = []; rb.set(c, arr); }
    arr.push(measureValues[i]);
  }

  // Etiketleri alfabetik sırala; BLANK_LABEL en sonda
  const sortLabels = (arr) =>
    arr.sort((a, b) => {
      if (a === BLANK_LABEL && b !== BLANK_LABEL) return 1;
      if (b === BLANK_LABEL && a !== BLANK_LABEL) return -1;
      return a.localeCompare(b, 'tr');
    });
  const rowLabels = sortLabels(Array.from(rowLabelSet));
  const colLabels = sortLabels(Array.from(colLabelSet));

  // Matrix + totals
  const matrix = {};
  const rowTotals = {};
  const colTotals = {};
  for (const c of colLabels) colTotals[c] = 0;
  let grandTotal = 0;

  for (const r of rowLabels) {
    matrix[r] = {};
    rowTotals[r] = 0;
    const rb = buckets.get(r);
    for (const c of colLabels) {
      const vals = (rb && rb.get(c)) ?? [];
      const cellValue = aggregate(measureFn, vals);
      matrix[r][c] = cellValue;
      rowTotals[r] += cellValue;
      colTotals[c] += cellValue;
      grandTotal += cellValue;
    }
  }

  // avg measure için row/col/grand totals "ortalamaların ortalaması" olur
  // → semantically yanlış. avg modunda total'ları SKIP et ('' marker yerine
  // null döner; frontend bu durumda "—" render eder).
  if (measureFn === 'avg') {
    for (const k of Object.keys(rowTotals)) rowTotals[k] = null;
    for (const k of Object.keys(colTotals)) colTotals[k] = null;
    grandTotal = null;
  }

  return { rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal };
}

/**
 * @param {object} col ColumnDef
 * @returns {boolean} bu kolon row/col dimension olarak kullanılabilir mi?
 *   Phase 3.1: scalar + json_path (string/text/number/datetime kategorisinde).
 *   Aggregate kolonlar nested aggregate'le Phase 3.2.
 */
export function isPivotableDimension(col) {
  if (!col) return false;
  if (col.source === 'aggregate') return false;
  return col.source === 'scalar' || col.source === 'json_path' || col.source === 'join';
}

/**
 * @param {object} col ColumnDef
 * @param {string} fn measure fonksiyonu
 * @returns {boolean} measure olarak kullanılabilir mi?
 *   - count: her kolon (sayım her zaman çalışır)
 *   - sum/avg/min/max: type='number' olan kolonlar
 *   - aggregate kolonlar: number tipindeyse OK (already pre-computed)
 */
export function isPivotableMeasure(col, fn) {
  if (!col || !PIVOT_MEASURE_FNS.includes(fn)) return false;
  if (fn === 'count') return true;
  return col.type === 'number';
}
