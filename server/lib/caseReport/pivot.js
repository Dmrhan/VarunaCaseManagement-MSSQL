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

  // Matrix
  //
  // Codex P2 #3 fix — Sparse pivot empty bucket için min/max cell'i NULL
  // olarak işaretle. aggregate('min', []) = 0 dönüyordu; sparse veride
  // "case yok" sinyali "min = 0" gibi yanlış sayıya çevriliyordu. Negatif
  // measure değerlerde de inflate edici (gerçek max=-5 iken total=0).
  //
  // Diğer fn'ler (count/sum/avg) için empty bucket cell hâlâ 0 — bu
  // semantik doğru: 0 case → 0 count, 0 sum, 0 avg (avg totals zaten null).
  const matrix = {};
  for (const r of rowLabels) {
    matrix[r] = {};
    const rb = buckets.get(r);
    for (const c of colLabels) {
      const vals = (rb && rb.get(c)) ?? [];
      if (vals.length === 0 && (measureFn === 'min' || measureFn === 'max')) {
        matrix[r][c] = null;
      } else {
        matrix[r][c] = aggregate(measureFn, vals);
      }
    }
  }

  // Codex P2 #2 fix — Total semantics measure fn'e bağlı:
  //   count, sum: additive (row total = sum of cells, vs.)
  //   avg:        null (ortalamaların ortalaması yanlış olur — frontend "—")
  //   min, max:   non-additive (row total = min/max of row cells).
  //               Toplama yapılsa 10+20=30 gibi "imkansız" totals çıkar.
  //
  // Strateji: avg/min/max için aynı aggregate fn'i row/col toplamlarına
  // tekrar uygula (cell değerlerini bucket olarak). avg için ek olarak null
  // garantisi — UI "—" çizer.
  let rowTotals = {};
  let colTotals = {};
  let grandTotal = 0;

  if (measureFn === 'avg') {
    for (const r of rowLabels) rowTotals[r] = null;
    for (const c of colLabels) colTotals[c] = null;
    grandTotal = null;
  } else if (measureFn === 'min' || measureFn === 'max') {
    // Cell değerlerini measureFn ile yeniden agrege et — null cell'leri
    // (boş bucket) skip et. Tamamen boş row/col → totals null. Frontend
    // formatPivotCell null'a "—" çizer.
    const filterReal = (arr) => arr.filter((v) => v != null);
    for (const r of rowLabels) {
      const cells = filterReal(colLabels.map((c) => matrix[r][c]));
      rowTotals[r] = cells.length === 0 ? null : aggregate(measureFn, cells);
    }
    for (const c of colLabels) {
      const cells = filterReal(rowLabels.map((r) => matrix[r][c]));
      colTotals[c] = cells.length === 0 ? null : aggregate(measureFn, cells);
    }
    // grandTotal: tüm dolu cell'lerin min veya max'i
    const allCells = [];
    for (const r of rowLabels) for (const c of colLabels) {
      const v = matrix[r][c];
      if (v != null) allCells.push(v);
    }
    grandTotal = allCells.length === 0 ? null : aggregate(measureFn, allCells);
  } else {
    // count, sum: additive
    for (const c of colLabels) colTotals[c] = 0;
    for (const r of rowLabels) {
      rowTotals[r] = 0;
      for (const c of colLabels) {
        const v = matrix[r][c];
        rowTotals[r] += v;
        colTotals[c] += v;
        grandTotal += v;
      }
    }
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
