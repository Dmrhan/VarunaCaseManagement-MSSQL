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

/**
 * Phase 2D.2 — Composite join picker.
 *
 * Case.account.<joinPath>[] içinden col.picker mantığına göre tek satır seçer
 * ve col.joinField değerini döner. Boş/null collection → undefined.
 *
 * Pickers (Codex P1 + P2 fix — tenant scope + deterministic order):
 *   - 'defaultThenFirst' : Address picker.
 *       1) companyId === dbRow.companyId filter (TENANT SCOPE — Account
 *          multi-tenant olduğunda farklı şirketin adresini sızdırma).
 *       2) Kalan adayları deterministik sırala: isActive desc, isDefault
 *          desc, type asc, createdAt asc (bağ kırıcı sıra).
 *       3) İlk satırı seç. Aday yok → undefined.
 *   - 'matchCaseCompanyId': AccountCompany picker.
 *       companyId === dbRow.companyId olan tek kayıt (schema'da
 *       @@unique([accountId, companyId]) — multiple match olamaz).
 *       Match yok → undefined (CROSS-TENANT FALLBACK YOK).
 *
 * Defansif: relation null (örn. accountId yok), array boş, picker uyumsuz,
 * tenant match yok → undefined → applyFormat boş string.
 */
function pickCompositeJoinValue(col, dbRow) {
  const related = dbRow[col.joinTable];
  if (!related) return undefined;
  const arr = related[col.joinPath];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const caseCompanyId = dbRow.companyId;
  let pick = null;
  if (col.picker === 'defaultThenFirst') {
    // 1) Tenant filter — yabancı tenant adresini ele
    const candidates = arr.filter((x) => x && x.companyId === caseCompanyId);
    if (candidates.length === 0) return undefined;
    // 2) Deterministik sıralama (in-place mutasyon yok — copy)
    const sorted = [...candidates].sort(compareAddressForPicker);
    pick = sorted[0];
  } else if (col.picker === 'matchCaseCompanyId') {
    // Unique constraint → max 1 match. Cross-tenant fallback yok.
    pick = arr.find((x) => x && x.companyId === caseCompanyId) || null;
  } else {
    // Picker tanımsız → ilk satır (defansif, eski davranış)
    pick = arr[0];
  }
  return pick ? pick[col.joinField] : undefined;
}

/**
 * Address picker tie-break comparator. Önce daha aktif/işaretli olanı, sonra
 * tip kararlı sırası, en son yaratılma anı — kayıt order'ı SQL/Prisma'dan
 * gelmediği için JS-side stable order garantisi.
 *
 * Sıralama anahtarları:
 *   1. isActive: true önce  (pasifleştirilmişler dipte)
 *   2. isDefault: true önce (kullanıcının "birincil" işareti)
 *   3. type: alfabetik asc  (Address tipi kayıt eşitliği için stable)
 *   4. createdAt: eski önce (en eski/bilinen adres tercih)
 *   5. id: alfabetik asc    (FINAL tie-breaker — bulk/import aynı timestamp
 *                            tick'inde olabilir; id cuid scalar, unique).
 *                            Bu olmadan Prisma row order kalanı belirlerdi.
 */
function compareAddressForPicker(a, b) {
  const aActive = a.isActive === true ? 1 : 0;
  const bActive = b.isActive === true ? 1 : 0;
  if (aActive !== bActive) return bActive - aActive;
  const aDefault = a.isDefault === true ? 1 : 0;
  const bDefault = b.isDefault === true ? 1 : 0;
  if (aDefault !== bDefault) return bDefault - aDefault;
  const aType = typeof a.type === 'string' ? a.type : '';
  const bType = typeof b.type === 'string' ? b.type : '';
  if (aType !== bType) return aType.localeCompare(bType);
  const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (aCreated !== bCreated) return aCreated - bCreated;
  // Codex P2 — final stable tie-breaker. Address.id unique olduğu için
  // bu adım eşitlik dönmez; her iki satır identik olsa bile sıra kararlı.
  const aId = typeof a.id === 'string' ? a.id : '';
  const bId = typeof b.id === 'string' ? b.id : '';
  return aId.localeCompare(bId);
}

// Phase 1.5: tüm tip/format logic'i formatters.applyFormat'a taşındı.

/**
 * Phase 3.1 Codex P2 #1 fix — Bir kolon için DB row + parsed customFields +
 * aggregates Map'lerinden RAW değeri çıkar (formatter UYGULANMAZ).
 *
 * Pivot measure'lar formatlanmış string'leri parse edemez (örn.
 * confidencePercent '%85' → Number('%85')=NaN). Bu helper raw numeric/
 * string değeri verir; caller (pivot endpoint) Number() parse + isFinite
 * filter yapar.
 *
 * buildReportRows içinde de bu helper kullanılabilir ama mevcut akış zaten
 * inline okuyor — değiştirmiyoruz (regression riski).
 */
export function extractRawValue(col, dbRow, parsedCf, aggregates) {
  if (!col || !dbRow) return undefined;
  if (col.source === 'scalar' && col.prismaField) {
    return dbRow[col.prismaField];
  }
  if (col.source === 'json_path' && Array.isArray(col.jsonPath)) {
    if (!parsedCf) return undefined;
    let cur = parsedCf;
    for (const seg of col.jsonPath) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[seg];
    }
    return cur;
  }
  if (col.source === 'join' && col.joinTable && col.joinField) {
    const related = dbRow[col.joinTable];
    return related ? related[col.joinField] : undefined;
  }
  if (col.source === 'composite_join' && col.joinTable && col.joinPath && col.joinField) {
    return pickCompositeJoinValue(col, dbRow);
  }
  if (col.source === 'aggregate' && col.aggregateKey && col.aggregateField && aggregates) {
    const map = aggregates[col.aggregateKey];
    if (!map) return undefined;
    const payload = map.get(dbRow.id);
    return payload ? payload[col.aggregateField] : undefined;
  }
  return undefined;
}

// parseCustomFields'i de export et — pivot endpoint per-row tek kez parse etmek için.
export { parseCustomFields };

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
  const fileAggs = aggregates?.caseFile;
  const callAggs = aggregates?.caseCall;
  const transferAggs = aggregates?.caseTransfer;
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
      } else if (col.source === 'join' && col.joinTable && col.joinField) {
        // Phase 2D — Case'in include edilmiş related kayıtlarından okuma.
        // findMany select'i buildPrismaSelect tarafından oluşturuldu:
        //   { account: { select: { vkn: true, ... } } }
        // null relation (örn. accountId=null, Phase D müşterisiz vaka) →
        // raw undefined → formatter '' döner.
        const related = db[col.joinTable];
        raw = related ? related[col.joinField] : undefined;
      } else if (col.source === 'composite_join' && col.joinTable && col.joinPath && col.joinField) {
        // Phase 2D.2 — 1:N collection'dan picker mantığıyla tek satır seç.
        raw = pickCompositeJoinValue(col, db);
      } else if (col.source === 'aggregate') {
        // Phase 2A: solutionSteps; Phase 2B.1: caseActivity + caseNote.
        // Aggregate map (Map<caseId, payload>) yoksa raw undefined → formatter
        // '' veya 0 üretir. Map var ama bu caseId yoksa aynı şekilde blank.
        const aggMap =
          col.aggregateKey === 'solutionSteps' ? stepAggs
          : col.aggregateKey === 'caseActivity' ? activityAggs
          : col.aggregateKey === 'caseNote'     ? noteAggs
          : col.aggregateKey === 'caseFile'     ? fileAggs
          : col.aggregateKey === 'caseCall'     ? callAggs
          : col.aggregateKey === 'caseTransfer' ? transferAggs
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
