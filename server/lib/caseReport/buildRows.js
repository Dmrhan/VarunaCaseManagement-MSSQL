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
 * @param {object[]} dbRows Prisma findMany sonucu (select edilmiş)
 * @param {object[]} columns ColumnDef[] (resolveColumns'tan sonuçlu sıra)
 * @returns {object[]} her case için { [columnId]: value } sıralı obje
 */
export function buildReportRows(dbRows, columns) {
  if (!Array.isArray(dbRows) || !Array.isArray(columns)) return [];
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
      }
      row[col.id] = applyFormat(col, raw);
    }
    out[i] = row;
  }
  return out;
}
