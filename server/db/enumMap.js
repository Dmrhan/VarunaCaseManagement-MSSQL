/**
 * Enum value mapping — Prisma identifier (ASCII) ↔ App string (TR).
 *
 * Prisma DSL'de enum identifier'larında TR karakter kullanılamaz.
 * Schema'da @map ile DB'ye TR string yazıyoruz; ama Prisma client API'sı
 * ASCII identifier (örn. "Acik") döner. Frontend'in beklediği TR string
 * ("Açık") arasındaki dönüşümü burada yapıyoruz.
 *
 * Forward (TR → ASCII): create/update sırasında frontend payload'ı DB'ye yazılırken.
 * Reverse (ASCII → TR): list/get sırasında DB'den okuyup frontend'e dönerken.
 */

// Forward maps (TR → Prisma identifier)
export const M_STATUS = {
  'Açık': 'Acik',
  'İncelemede': 'Incelemede',
  '3rdPartyBekleniyor': 'ThirdPartyWaiting',
  'Eskalasyon': 'Eskalasyon',
  'Çözüldü': 'Cozuldu',
  'YenidenAcildi': 'YenidenAcildi',
  'İptalEdildi': 'IptalEdildi',
};
export const M_ORIGIN = {
  'Telefon': 'Telefon', 'E-posta': 'Eposta', 'Web': 'Web', 'Chatbot': 'Chatbot', 'Diğer': 'Diger',
};
export const M_REQUEST = {
  'Bilgi': 'Bilgi', 'Öneri': 'Oneri', 'Talep': 'Talep', 'Şikayet': 'Sikayet', 'Hata': 'Hata',
};
export const M_ESCALATION = {
  'Yok': 'Yok', 'TakımLideri': 'TakimLideri', 'Direktör': 'Direktor', 'ÜstYönetim': 'UstYonetim',
};
// WR-A1 / PM-01 — Müşteri tipi. Account API'da ASCII identifier (Individual/Corporate/Government/NonProfit)
// kullanılır; UI tarafta TR label'a map'lenir (src/services/accountService.ts CUSTOMER_TYPE_LABELS).
// Bu sözlük future symmetric use için tutulur (Case pipeline'ı gibi toDb/fromDb yoluna girmez).
export const M_CUSTOMER_TYPE = {
  'Bireysel': 'Individual',
  'Kurumsal': 'Corporate',
  'Kamu': 'Government',
  'Vakıf-STK': 'NonProfit',
};
/** Geçerli Account customerType identifier'ları — validation için tek doğru kaynak. */
export const CUSTOMER_TYPE_VALUES = ['Individual', 'Corporate', 'Government', 'NonProfit'];

// Faz B-temel (2026-06-30) — Müşteri Türü (rol). customerType ile FARKLI alan.
// 6 değer (n4b parite); ASCII normalize Prisma identifier'ları.
export const M_CUSTOMER_ROLE = {
  'Merkez Müşteri':     'Central',
  'Distribütör/Bayi':   'Distributor',
  'Bölge Müdürlüğü':    'RegionalOffice',
  'Kanal/Çözüm Ortağı': 'ChannelPartner',
  'Yurt Dışı':          'International',
  'Stokbar':            'Stockbar',
};
/** Geçerli Account customerRole identifier'ları — validation için tek doğru kaynak. */
export const CUSTOMER_ROLE_VALUES = [
  'Central',
  'Distributor',
  'RegionalOffice',
  'ChannelPartner',
  'International',
  'Stockbar',
];

export const M_FINANCIAL = {
  'Düşük': 'Dusuk', 'Orta': 'Orta', 'Yüksek': 'Yuksek', 'Kritik': 'Kritik',
};
export const M_USAGE = {
  'Yüksek': 'Yuksek', 'Orta': 'Orta', 'Düşük': 'Dusuk', 'Yok': 'Yok',
};
export const M_USAGE_CHANGE = {
  'Artış': 'Artis', 'Azalma': 'Azalma', 'Sabit': 'Sabit',
};
export const M_RESPONSE_LEVEL = {
  'Yüksek Öncelik': 'YuksekOncelik', 'Orta Öncelik': 'OrtaOncelik', 'Düşük Öncelik': 'DusukOncelik',
};
export const M_CALL_DISP = {
  'Cevapladı': 'Cevapladi', 'Cevaplamadı': 'Cevaplamadi', 'NumaraHatalı': 'NumaraHatali',
  'GörüşmekIstemedi': 'GorusmekIstemedi', 'TekrarAranacak': 'TekrarAranacak',
};
export const M_CALL_OUT = {
  'Memnun': 'Memnun', 'MemnunDeğil': 'MemnunDegil', 'Tarafsız': 'Tarafsiz', 'Ulaşılamadı': 'Ulasilamadi',
};
export const M_CHURN = {
  'İptalEdildi': 'IptalEdildi', 'DevamEdiyor': 'DevamEdiyor', 'TeklifKabulEdildi': 'TeklifKabulEdildi',
};
export const M_RETENTION = {
  'Başarılı': 'Basarili', 'Başarısız': 'Basarisiz', 'DevamEdiyor': 'DevamEdiyor',
};

// Reverse maps (Prisma identifier → TR) — otomatik üretilir
function reverse(m) {
  const out = {};
  for (const [k, v] of Object.entries(m)) out[v] = k;
  return out;
}

const R_STATUS = reverse(M_STATUS);
const R_ORIGIN = reverse(M_ORIGIN);
const R_REQUEST = reverse(M_REQUEST);
const R_ESCALATION = reverse(M_ESCALATION);
const R_FINANCIAL = reverse(M_FINANCIAL);
const R_USAGE = reverse(M_USAGE);
const R_USAGE_CHANGE = reverse(M_USAGE_CHANGE);
const R_RESPONSE_LEVEL = reverse(M_RESPONSE_LEVEL);
const R_CALL_DISP = reverse(M_CALL_DISP);
const R_CALL_OUT = reverse(M_CALL_OUT);
const R_CHURN = reverse(M_CHURN);
const R_RETENTION = reverse(M_RETENTION);

// İki yönlü dönüşüm helper'ı — value yoksa olduğu gibi geç (safety)
const conv = (m, v) => (v == null ? v : m[v] ?? v);

// ─────────────────────────────────────────────────────────────────
// Inbound: frontend payload (TR) → Prisma create/update (ASCII)
// ─────────────────────────────────────────────────────────────────
export function toDb(c) {
  if (!c) return c;
  const out = { ...c };
  if ('status' in out)            out.status            = conv(M_STATUS, out.status);
  if ('origin' in out)            out.origin            = conv(M_ORIGIN, out.origin);
  if ('requestType' in out)       out.requestType       = conv(M_REQUEST, out.requestType);
  if ('escalationLevel' in out)   out.escalationLevel   = conv(M_ESCALATION, out.escalationLevel);
  if ('financialStatus' in out)   out.financialStatus   = conv(M_FINANCIAL, out.financialStatus);
  if ('productUsage' in out)      out.productUsage      = conv(M_USAGE, out.productUsage);
  if ('usageChangeAlert' in out)  out.usageChangeAlert  = conv(M_USAGE_CHANGE, out.usageChangeAlert);
  if ('responseLevel' in out)     out.responseLevel     = conv(M_RESPONSE_LEVEL, out.responseLevel);
  if ('churnResult' in out)       out.churnResult       = conv(M_CHURN, out.churnResult);
  if ('retentionStatus' in out)   out.retentionStatus   = conv(M_RETENTION, out.retentionStatus);
  if ('callDisposition' in out)   out.callDisposition   = conv(M_CALL_DISP, out.callDisposition);
  if ('callOutcome' in out)       out.callOutcome       = conv(M_CALL_OUT, out.callOutcome);
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Outbound: Prisma row (ASCII) → frontend response (TR)
// ─────────────────────────────────────────────────────────────────
export function fromDb(c) {
  if (!c) return c;
  const out = { ...c };
  if ('status' in out)            out.status            = conv(R_STATUS, out.status);
  if ('origin' in out)            out.origin            = conv(R_ORIGIN, out.origin);
  if ('requestType' in out)       out.requestType       = conv(R_REQUEST, out.requestType);
  if ('escalationLevel' in out)   out.escalationLevel   = conv(R_ESCALATION, out.escalationLevel);
  if ('financialStatus' in out)   out.financialStatus   = conv(R_FINANCIAL, out.financialStatus);
  if ('productUsage' in out)      out.productUsage      = conv(R_USAGE, out.productUsage);
  if ('usageChangeAlert' in out)  out.usageChangeAlert  = conv(R_USAGE_CHANGE, out.usageChangeAlert);
  if ('responseLevel' in out)     out.responseLevel     = conv(R_RESPONSE_LEVEL, out.responseLevel);
  if ('churnResult' in out)       out.churnResult       = conv(R_CHURN, out.churnResult);
  if ('retentionStatus' in out)   out.retentionStatus   = conv(R_RETENTION, out.retentionStatus);
  if ('callDisposition' in out)   out.callDisposition   = conv(R_CALL_DISP, out.callDisposition);
  if ('callOutcome' in out)       out.callOutcome       = conv(R_CALL_OUT, out.callOutcome);
  return out;
}

// Filtre değerlerini de dönüştür (caseFilters.statuses, priorities, vb.)
export function toDbFilters(f) {
  if (!f) return f;
  const out = { ...f };
  if (out.statuses) out.statuses = out.statuses.map((s) => conv(M_STATUS, s));
  return out;
}
