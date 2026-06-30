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

/**
 * Backend tarafı Türkçe label tablosu. Şu an iki tüketici var:
 *   - caseReport applyFormat (Excel/PDF output)
 *   - notificationRepository buildTemplateVars (M4.1 müşteri-yüzlü mail render)
 *
 * Frontend tarafındaki CASE_STATUS_LABELS / CASE_PRIORITY_LABELS
 * (src/features/cases/types.ts) ile değer eşittir; kontrat tek doğruluk
 * kaynağı olarak burada (server-side enum çevirisi reporting + notification
 * paylaşımı için).
 */
export const STATUS_LABELS = {
  Acik: 'Açık',
  Incelemede: 'İncelemede',
  ThirdPartyWaiting: '3. Parti Bekleniyor',
  Eskalasyon: 'Eskalasyon',
  Cozuldu: 'Çözüldü',
  YenidenAcildi: 'Yeniden Açıldı',
  IptalEdildi: 'İptal Edildi',
};

export const PRIORITY_LABELS = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};

export const CASE_TYPE_LABELS = {
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

// Phase 2D — Account/PII labels. Codex P2 (PR #27) sonrası genişletildi:
// DB ASCII identifier'lar (Individual/Corporate/Government/NonProfit) +
// TR varyantlar (Bireysel/Kurumsal/Kamu/Vakıf-STK) — defansif.
const CUSTOMER_TYPE_LABELS = {
  Corporate:    'Kurumsal',
  Individual:   'Bireysel',
  Government:   'Kamu',
  NonProfit:    'Vakıf-STK',
};

// CaseRequestType: DB'de toDb ile ASCII normalize edilmiş (Oneri/Sikayet)
// — frontend'in TR'sine geri çevir. Hem ASCII hem TR varyantı map'liyoruz
// (defansif: ileride farklı yoldan gelirse de doğru çalışır).
//
// Aylık Bülten Faz A — A1 — EXPORT'a çevrildi (önceden module-local idi).
// Bülten "Tip" panosunda (Soru/Talep/Hata/Şikayet) frontend bu map'ten
// TR label çeker; aynı kaynak hem report studio hem bülten için.
export const REQUEST_TYPE_LABELS = {
  Bilgi:    'Bilgi',
  Oneri:    'Öneri',  Öneri:   'Öneri',
  Talep:    'Talep',
  Sikayet:  'Şikayet', Şikayet: 'Şikayet',
  Hata:     'Hata',
};

// CaseOrigin: enumMap M_ORIGIN (Telefon/Eposta/Web/Chatbot/Diger) →
// frontend TR. ASCII ve TR varyantı (Eposta/E-posta) ikisi de map'li.
//
// Aylık Bülten Faz A — A1 yeni map. Bülten "Kanal" panosu için.
export const ORIGIN_LABELS = {
  Telefon:  'Telefon',
  Eposta:   'E-posta',  'E-posta': 'E-posta',
  Web:      'Web',
  Chatbot:  'Chatbot',
  Diger:    'Diğer',    Diğer:    'Diğer',
};

// CallOutcome: DB'de toDb ile ASCII normalize (MemnunDegil/Tarafsiz/
// Ulasilamadi) — Codex P2 fix. Phase 2B.2 call.lastCallResult kolonu
// raw değer döndürüyordu; bu map ile preview/export TR label gösterir.
const CALL_OUTCOME_LABELS = {
  Memnun:        'Memnun',
  MemnunDegil:   'Memnun Değil',   MemnunDeğil:  'Memnun Değil',
  Tarafsiz:      'Tarafsız',        Tarafsız:    'Tarafsız',
  Ulasilamadi:   'Ulaşılamadı',     Ulaşılamadı: 'Ulaşılamadı',
};

const ENUM_MAPS = {
  caseStatus: STATUS_LABELS,
  casePriority: PRIORITY_LABELS,
  caseType: CASE_TYPE_LABELS,
  escalationLevel: ESCALATION_LABELS,
  solutionStepSource: SOLUTION_STEP_SOURCE_LABELS,
  customerType: CUSTOMER_TYPE_LABELS,
  caseRequestType: REQUEST_TYPE_LABELS,
  caseOrigin: ORIGIN_LABELS,
  callOutcome: CALL_OUTCOME_LABELS,
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

/**
 * Phase 2D — VKN masking. 10 hane vergi numarası: ilk 2 + son 2 görünür,
 * ortası 6 yıldız. Hatalı uzunluk → raw string yine maskelenir (defansif):
 *   - len < 4 → tamamı yıldız
 *   - len >= 4 → ilk 2 + (uzunluk-4 yıldız) + son 2
 *   - boş / null → ''
 */
function formatVknMasked(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (s.length === 0) return '';
  if (s.length < 4) return '*'.repeat(s.length);
  const stars = '*'.repeat(Math.max(s.length - 4, 1));
  return `${s.slice(0, 2)}${stars}${s.slice(-2)}`;
}

/**
 * Phase 2D — TCKN last4 masking. DB'de zaten yalnız son 4 hane saklanır
 * (`tcknLast4`); biz "*******1234" olarak göstereyim. Plain TCKN ASLA
 * görünmez (zaten elimizde yok).
 */
function formatTcknLast4Masked(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (s.length === 0) return '';
  // 4 haneden farklı gelse de yine "*******<last4>" yap; defansif.
  const last4 = s.length >= 4 ? s.slice(-4) : s;
  return `*******${last4}`;
}

function formatConfidencePercent(value) {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  // 0-1 float → yüzde. 1+ olursa zaten yüzde gelmiştir, yine de çarp.
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return `%${pct}`;
}

/** Phase 2D — test/__internal export'u için saf format helper'ları. */
export const __formatInternal = {
  formatVknMasked,
  formatTcknLast4Masked,
  formatEnum,
};

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
      case 'customerType':
      case 'caseRequestType':
      case 'callOutcome':
        return formatEnum(raw, fmt);
      case 'datetimeTr':
        return formatDateTr(raw);
      case 'boolean':
        return formatBoolean(raw);
      case 'confidencePercent':
        return formatConfidencePercent(raw);
      case 'vknMasked':
        return formatVknMasked(raw);
      case 'tcknLast4Masked':
        return formatTcknLast4Masked(raw);
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
