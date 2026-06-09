/**
 * WR-Smart-Ticket Phase 2b — açılış sınıflandırma adapter'ı.
 *
 * Pure modül. Hem route handler hem smoke import eder; DB veya HTTP
 * yan etkisi yok.
 *
 * Sözleşme:
 *   1. extractClassificationFromKb(response) — KB analyze cevabından
 *      yalnız 5 sınıflandırma alanının ham değerini çıkarır:
 *        platform / businessProcess / operationType / affectedObject /
 *        impact
 *      Diğer alanlar (suggestedSteps, rootCauseHypotheses,
 *      customerReplyDraft, engineeringHandoff, similar, panorama,
 *      citations, kbChunks, hits, answer) **göz ardı edilir**.
 *
 *   2. mapClassificationToTaxonomy(rawValues, taxonomies) — ham değerleri
 *      TaxonomyDef satırlarına eşler. Match sırası (önce eşleşen kazanır):
 *        a) exact code match           → matchedBy='code'    conf=1.0
 *        b) metadata.kbAliases match   → matchedBy='kbAlias' conf=0.9
 *        c) normalized label match     → matchedBy='label'   conf=0.7
 *      Hiçbiri eşleşmezse `unmatched` listesine eklenir; vaka açılışı
 *      bloke olmaz.
 *
 * KB cevap formatı hala oturmuyor (upstream sözleşmesi taşmakta) — bu
 * yüzden adapter MULTI-PATH'tır: alan birden fazla yerde aranır.
 */

const FIELDS = /** @type {const} */ ([
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
]);

/**
 * KB cevabında bir field için aranan path'ler. Sıra önemli — soldaki
 * yüksek öncelik. İlk dolu eşleşme kullanılır.
 *
 * Notlar:
 *  - `analysis.classification.<field>` — Smart Ticket için tercih edilen
 *    şema (upstream KB geliştirmesi bunu beslerse ideal).
 *  - `classification.<field>` — top-level fallback.
 *  - `analysis.<field>` — geçmiş upstream taslakları.
 *  - Türkçe / snake_case eş anlamlılar — KB upstream'inin geçmişte verdiği
 *    field isimleriyle (KnowledgeBasePage ClassificationCard kanıtları)
 *    tutarlı.
 */
const FIELD_PATHS = {
  platform: [
    ['analysis', 'classification', 'platform'],
    ['classification', 'platform'],
    ['analysis', 'platform'],
    ['platform'],
  ],
  businessProcess: [
    ['analysis', 'classification', 'businessProcess'],
    ['analysis', 'classification', 'business_process'],
    ['classification', 'businessProcess'],
    ['classification', 'business_process'],
    ['analysis', 'businessProcess'],
    ['analysis', 'business_process'],
    ['analysis', 'isSureci'],
    ['businessProcess'],
    ['is_sureci'],
  ],
  operationType: [
    ['analysis', 'classification', 'operationType'],
    ['analysis', 'classification', 'operation_type'],
    ['classification', 'operationType'],
    ['classification', 'operation_type'],
    ['analysis', 'operationType'],
    ['analysis', 'islemTipi'],
    ['operation_type'],
  ],
  affectedObject: [
    ['analysis', 'classification', 'affectedObject'],
    ['analysis', 'classification', 'affected_object'],
    ['classification', 'affectedObject'],
    ['classification', 'affected_object'],
    ['analysis', 'affectedObject'],
    ['analysis', 'etkilenenNesne'],
    ['affected_object'],
  ],
  impact: [
    ['analysis', 'classification', 'impact'],
    ['classification', 'impact'],
    ['analysis', 'impact'],
    ['analysis', 'etki'],
    ['impact'],
  ],
};

function getByPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Ham değeri normalize string'e indirir. Bir item şu şekillerde gelebilir:
 *   - string                        → trimmed
 *   - { code, label }               → label (string ise) veya code
 *   - { value, label } / { name }   → label / name fallback
 *   - array (KB bazen 1-element)    → ilk eleman
 */
function normalizeRawValue(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return normalizeRawValue(raw[0]);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t === '' ? null : { label: t, code: null };
  }
  if (typeof raw === 'object') {
    const code = typeof raw.code === 'string' && raw.code.trim() ? raw.code.trim() : null;
    const label =
      (typeof raw.label === 'string' && raw.label.trim()) ||
      (typeof raw.value === 'string' && raw.value.trim()) ||
      (typeof raw.name === 'string' && raw.name.trim()) ||
      null;
    if (!code && !label) return null;
    return { code, label };
  }
  return null;
}

export function extractClassificationFromKb(response) {
  if (!response || typeof response !== 'object') return {};
  // KB client zarfı: `{ ok, endpoint, data, ... }`. data yoksa kendisi
  // analyze response gibi davransın (smoke'ta inline kullanım için).
  const payload =
    response.data && typeof response.data === 'object' ? response.data : response;
  const out = {};
  for (const field of FIELDS) {
    for (const path of FIELD_PATHS[field]) {
      const raw = getByPath(payload, path);
      const norm = normalizeRawValue(raw);
      if (norm) {
        out[field] = norm;
        break;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Label normalization
// ─────────────────────────────────────────────────────────────────

function normalizeLabel(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function aliasesOf(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = metadata.kbAliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === 'string' && x.trim().length > 0);
}

// ─────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────

/**
 * @param {Record<string, {label:string, code:string|null} | null>} rawValues
 * @param {Record<string, Array<{code:string, label:string, metadata?: any, isActive?: boolean}>>} taxonomies
 * @returns {{suggestions: object, unmatched: Array}}
 */
export function mapClassificationToTaxonomy(rawValues, taxonomies) {
  const suggestions = {};
  const unmatched = [];

  for (const field of FIELDS) {
    const raw = rawValues[field];
    if (!raw) continue;
    const list = (taxonomies?.[field] ?? []).filter((t) => t.isActive !== false);

    let match = null;
    let matchedBy = null;
    let confidence = 0;

    // (a) exact code
    if (raw.code) {
      const byCode = list.find((t) => t.code === raw.code);
      if (byCode) {
        match = byCode; matchedBy = 'code'; confidence = 1.0;
      }
    }

    // (b) kbAliases
    if (!match && raw.label) {
      const targetN = normalizeLabel(raw.label);
      const targetCode = raw.code ? raw.code.toLowerCase() : null;
      for (const t of list) {
        const aliases = aliasesOf(t.metadata);
        if (
          aliases.some((a) => normalizeLabel(a) === targetN) ||
          (targetCode && aliases.some((a) => a.toLowerCase() === targetCode))
        ) {
          match = t; matchedBy = 'kbAlias'; confidence = 0.9;
          break;
        }
      }
    }

    // (c) normalized label
    if (!match && raw.label) {
      const targetN = normalizeLabel(raw.label);
      const byLabel = list.find((t) => normalizeLabel(t.label) === targetN);
      if (byLabel) {
        match = byLabel; matchedBy = 'label'; confidence = 0.7;
      }
    }

    if (match) {
      suggestions[field] = {
        code: match.code,
        label: match.label,
        confidence,
        matchedBy,
      };
    } else {
      unmatched.push({
        taxonomyType: field,
        rawValue: raw.label || raw.code || '',
        reason: 'no TaxonomyDef match',
      });
    }
  }

  return { suggestions, unmatched };
}

export const SMART_TICKET_CLASSIFICATION_FIELDS = FIELDS;
