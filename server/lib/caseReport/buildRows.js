/**
 * Case Report Studio — DB row → report row shaping.
 *
 * Sözleşme:
 *   - Her case satırı kullanıcı tarafından seçilen kolon sırasında bir
 *     { [columnId]: value } objesi olarak döner.
 *   - JSON path kolonları için Case.customFields her satırda TEK kez
 *     parse edilir; çoklu json_path için aynı parsed obje yeniden
 *     kullanılır. N x M parse maliyeti yok.
 *   - Tip dönüşümleri:
 *       'datetime' → ISO string ('' eğer null)
 *       'boolean'  → boolean (varsayılan false)
 *       'number'   → number | '' (null/undefined → '')
 *       'string' / 'text' → string ('' eğer null/undefined)
 *
 * Excel export sırasında aynı shaping kullanılır; Excel writer yalnız
 * `Object.values()` ile satır yazar.
 */

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

function formatValue(col, raw) {
  if (raw == null) {
    return col.type === 'boolean' ? false : '';
  }
  switch (col.type) {
    case 'datetime': {
      if (raw instanceof Date) return raw.toISOString();
      if (typeof raw === 'string') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? raw : d.toISOString();
      }
      return '';
    }
    case 'boolean':
      return !!raw;
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : '';
    }
    case 'text':
    case 'string':
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

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
      row[col.id] = formatValue(col, raw);
    }
    out[i] = row;
  }
  return out;
}
