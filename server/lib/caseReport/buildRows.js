/**
 * Case Report Studio — DB row → report row shaping.
 *
 * Sözleşme (Phase 1.5):
 *   - Her case satırı kullanıcı tarafından seçilen kolon sırasında bir
 *     { [columnId]: value } objesi olarak döner.
 *   - **Aynı shaping path hem preview JSON cevabı hem Excel export için
 *     kullanılır** — display formatlama backend'de tek noktada (formatters.js).
 *     Frontend ham veri yerine TR-okunabilir string'leri direkt gösterir.
 *   - JSON path kolonları için Case.customFields her satırda TEK kez parse
 *     edilir; çoklu json_path için aynı parsed obje yeniden kullanılır.
 *   - Stored data MUTASYON YAPILMAZ; sadece okunup formatlanır.
 *
 * Format dispatcher: server/lib/caseReport/formatters.js applyFormat().
 *   ColumnDef.format alanı belirleyici (caseStatus / casePriority / caseType /
 *   escalationLevel / datetimeTr / boolean / confidencePercent). Format yoksa
 *   ColumnDef.type'a göre geri-uyumlu default.
 */

import { applyFormat } from './formatters.js';

function parseCustomFields(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw; // Prisma JSON column geri obj döndüyse
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readJsonPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

// Phase 1.5: tüm tip/format logic'i formatters.applyFormat'a taşındı.

/**
 * @param {object[]} dbRows Prisma findMany sonucu (select edilmiş; her satır
 *   `id` içerir — aggregate lookup için key)
 * @param {object[]} columns ColumnDef[] (resolveColumns'tan sonuçlu sıra)
 * @param {object} [aggregates] Opsiyonel — Phase 2A aggregate batch sonucu.
 *   `aggregates.solutionSteps` → `Map<caseId, SolutionStepPayload>`. Hiç
 *   aggregate kolon seçilmediyse caller bunu vermez; aggregate kolon var
 *   ama Map satıra ait giriş yoksa boş payload (0/'') gibi davranır.
 * @returns {object[]} her case için { [columnId]: value } sıralı obje
 */
export function buildReportRows(dbRows, columns, aggregates) {
  if (!Array.isArray(dbRows) || !Array.isArray(columns)) return [];
  const stepAggs = aggregates?.solutionSteps;
  const activityAggs = aggregates?.caseActivity;
  const noteAggs = aggregates?.caseNote;
  const out = new Array(dbRows.length);
  for (let i = 0; i < dbRows.length; i++) {
    const db = dbRows[i];
    const row = {};
    let cf = undefined; // lazy parsing
    for (const col of columns) {
      let raw;
      if (col.source === 'scalar' && col.prismaField) {
        raw = db[col.prismaField];
      } else if (col.source === 'json_path' && Array.isArray(col.jsonPath)) {
        if (cf === undefined) cf = parseCustomFields(db.customFields);
        raw = cf ? readJsonPath(cf, col.jsonPath) : undefined;
      } else if (col.source === 'aggregate') {
        // Phase 2A: solutionSteps; Phase 2B.1: caseActivity + caseNote.
        // Aggregate map (Map<caseId, payload>) yoksa raw undefined → formatter
        // '' veya 0 üretir. Map var ama bu caseId yoksa aynı şekilde blank.
        const aggMap =
          col.aggregateKey === 'solutionSteps' ? stepAggs
          : col.aggregateKey === 'caseActivity' ? activityAggs
          : col.aggregateKey === 'caseNote'     ? noteAggs
          : null;
        if (aggMap) {
          const payload = aggMap.get(db.id);
          raw = payload ? payload[col.aggregateField] : undefined;
        }
      }
      row[col.id] = applyFormat(col, raw);
    }
    out[i] = row;
  }
  return out;
}
