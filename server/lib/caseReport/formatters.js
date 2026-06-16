/**
 * Case Report Studio — display formatters.
 *
 * Phase 1.5 polish: backend tek truth source. buildReportRows hem preview
 * JSON cevabı hem Excel export için aynı formatlanmış string'leri üretir;
 * frontend ham veri yerine TR-okunabilir değerleri direkt gösterir.
 *
 * Format kuralları:
 *   - 'caseStatus' / 'casePriority' / 'caseType' / 'escalationLevel':
 *     DB'de saklanan ASCII identifier'lardan ([Acik/Cozuldu/Yok/...]) TR
 *     etikete map. Bilinmeyen değer raw geçer (fail-safe).
 *   - 'datetimeTr': Europe/Istanbul lokal "DD.MM.YYYY HH:mm" formatı.
 *   - 'boolean': true → 'Evet', false → 'Hayır'.
 *   - 'confidencePercent': KB güven skoru (float 0-1) → "%85" string.
 *     Düşük güven (0) "%0" olur; null/undefined boş.
 *
 * `null` / `undefined` daima '' (boş string) döner — Excel'de boş hücre.
 */

const STATUS_LABELS = {
  Acik: 'Açık',
  Incelemede: 'İncelemede',
  ThirdPartyWaiting: '3. Parti Bekleniyor',
  Eskalasyon: 'Eskalasyon',
  Cozuldu: 'Çözüldü',
  YenidenAcildi: 'Yeniden Açıldı',
  IptalEdildi: 'İptal Edildi',
};

const PRIORITY_LABELS = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};

const CASE_TYPE_LABELS = {
  GeneralSupport: 'Genel Destek',
  ProactiveTracking: 'Proaktif Takip',
  Churn: 'Churn (İptal)',
};

const ESCALATION_LABELS = {
  Yok: 'Yok',
  TakimLideri: 'Takım Lideri',
  TakımLideri: 'Takım Lideri',
  Direktor: 'Direktör',
  Direktör: 'Direktör',
  UstYonetim: 'Üst Yönetim',
  ÜstYönetim: 'Üst Yönetim',
};

const SOLUTION_STEP_SOURCE_LABELS = {
  ai_suggested_step: 'AI Önerisi',
  external_kb: 'Bilgi Bankası',
  manual: 'Manuel',
  similar_case: 'Benzer Vaka',
};

const ENUM_MAPS = {
  caseStatus: STATUS_LABELS,
  casePriority: PRIORITY_LABELS,
  caseType: CASE_TYPE_LABELS,
  escalationLevel: ESCALATION_LABELS,
  solutionStepSource: SOLUTION_STEP_SOURCE_LABELS,
};

// Intl.DateTimeFormat instance reuse — her satırda yeni instance oluşturmak
// 5k satırda ölçülebilir maliyet. Tek instance + format() per row.
const TR_DATETIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatEnum(value, mapKey) {
  if (value == null) return '';
  const k = String(value);
  const map = ENUM_MAPS[mapKey];
  if (!map) return k;
  return map[k] ?? k;
}

function formatDateTr(value) {
  if (value == null) return '';
  let d;
  if (value instanceof Date) d = value;
  else if (typeof value === 'string' && value.length > 0) d = new Date(value);
  else return '';
  if (Number.isNaN(d.getTime())) return '';
  return TR_DATETIME.format(d);
}

function formatBoolean(value) {
  if (value == null) return '';
  return value ? 'Evet' : 'Hayır';
}

function formatConfidencePercent(value) {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  // 0-1 float → yüzde. 1+ olursa zaten yüzde gelmiştir, yine de çarp.
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return `%${pct}`;
}

/**
 * Formatter dispatcher. ColumnDef.format alanına göre uygun helper'ı çağırır.
 * format yoksa type fallback (datetime → datetimeTr, boolean → boolean).
 * @param {{ type: string, format?: string }} col
 * @param {any} raw
 * @returns {string}
 */
export function applyFormat(col, raw) {
  if (raw == null) return '';
  const fmt = col.format ?? null;
  if (fmt) {
    switch (fmt) {
      case 'caseStatus':
      case 'casePriority':
      case 'caseType':
      case 'escalationLevel':
      case 'solutionStepSource':
        return formatEnum(raw, fmt);
      case 'datetimeTr':
        return formatDateTr(raw);
      case 'boolean':
        return formatBoolean(raw);
      case 'confidencePercent':
        return formatConfidencePercent(raw);
      default:
        // bilinmeyen format string → raw string
        return String(raw);
    }
  }
  // Geriye dönük: type'a göre default
  switch (col.type) {
    case 'datetime':
      return formatDateTr(raw);
    case 'boolean':
      return formatBoolean(raw);
    case 'number':
      return typeof raw === 'number' ? String(raw) : String(raw);
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}
