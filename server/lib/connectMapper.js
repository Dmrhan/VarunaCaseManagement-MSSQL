/**
 * Case → Connect ticket (okuma) dönüşümü.
 *
 * Varuna↔Connect entegrasyonu — Connect kendi UI'ında Varuna vakalarını
 * "ticket" olarak gösterir; bu modül Case satırını Connect'in beklediği
 * düz JSON şekline çevirir. YALNIZ OKUMA — bu dilimde yazma/patch yok.
 *
 * Girdi (`caseRow`) server/db/connectResolver.js::findCasesByCodes'un
 * select ettiği alanlarla sınırlı ham Prisma satırıdır (ASCII enum
 * identifier'lar — örn. status='Acik' — server/db/enumMap.js ile aynı
 * sözleşme, TR string'e BURADA çevrilmez; yalnız status Connect'in kendi
 * görünüm sözlüğüne crosswalk'lanır, bkz. STATUS_CROSSWALK).
 */

// Onaylı durum crosswalk tablosu (Connect görünüm metni). Kaynak: görev
// tanımı — Case.status (ASCII, enumMap.js) → Connect'in gösterdiği TR metin.
// Bilinmeyen bir değer gelirse (yeni bir status eklenip burası unutulursa)
// statusRaw ham değer olarak zaten ayrıca döner; burada sessizce "hepsi
// aynı" davranmak yerine LOGLANIR (bkz. toConnectStatus). Export edilir ki
// scripts/smoke-connect-tickets.mjs bu tabloyu enumMap.js::M_STATUS'un
// TAMAMINI kapsadığını doğrulayabilsin (elle kopyalanmış ikinci bir liste
// değil, gerçek export'a karşı test).
export const STATUS_CROSSWALK = {
  Acik: 'Yeni Kayıt',
  Incelemede: 'Üzerinde Çalışılıyor',
  ThirdPartyWaiting: 'Müşteriden Bilgi Bekleniyor',
  Eskalasyon: 'Eskale',
  Cozuldu: 'Kapatıldı',
  YenidenAcildi: 'Yeniden Açıldı',
  IptalEdildi: 'İptal Edildi',
};

// toConnectStatus çağrı başına değil, DEĞER başına bir kez uyarır (aynı
// bilinmeyen status ile art arda gelen yüzlerce ticket log'u boğmasın diye).
// Process ömrü boyunca sınırlı bir küme (gerçek enum sayısı kadar) olduğu
// için sınırsız büyüme riski yok.
const warnedUnknownStatuses = new Set();

/**
 * Case.status (ASCII) → Connect görünüm metni.
 * Crosswalk'ta olmayan bir değer için (bilinmeyen/yeni status) ham değeri
 * geri döner ve DEĞER başına bir kerelik uyarı loglar — sessiz varsayılan YOK.
 */
export function toConnectStatus(statusRaw) {
  const mapped = STATUS_CROSSWALK[statusRaw];
  if (mapped) return mapped;
  if (!warnedUnknownStatuses.has(statusRaw)) {
    warnedUnknownStatuses.add(statusRaw);
    console.warn(`[connectMapper] Case.status crosswalk'ta yok, ham değer geçiliyor: ${statusRaw}`);
  }
  return statusRaw;
}

function toIsoOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * @param {object} caseRow - findCasesByCodes CASE_SELECT şekli (bkz.
 *   server/db/connectResolver.js). Beklenen alanlar: id, caseNumber, title,
 *   description, status, category, subCategory, caseType, origin,
 *   assignedPersonName, createdAt, updatedAt, slaResponseDueAt,
 *   slaResolutionDueAt, slaViolation.
 * @returns {object|null} Connect okuma ticket şekli.
 */
export function mapCaseToConnectTicket(caseRow) {
  if (!caseRow) return null;
  return {
    id: caseRow.caseNumber,
    title: caseRow.title,
    description: caseRow.description,
    status: toConnectStatus(caseRow.status),
    statusRaw: caseRow.status,
    category: caseRow.category ?? null,
    subCategory: caseRow.subCategory ?? null,
    type: caseRow.caseType,
    // "Kim inceliyor" — Case'in atanan kişisi (denormalized isim; Case
    // modelinde ayrıca assignedPersonId var ama Connect okuma tarafı
    // yalnız görüntü metni istiyor, bu dilimde id sızdırılmıyor).
    assignee: caseRow.assignedPersonName ?? null,
    origin: caseRow.origin,
    createdAt: toIsoOrNull(caseRow.createdAt),
    updatedAt: toIsoOrNull(caseRow.updatedAt),
    sla: {
      responseDueAt: toIsoOrNull(caseRow.slaResponseDueAt),
      resolutionDueAt: toIsoOrNull(caseRow.slaResolutionDueAt),
      violated: caseRow.slaViolation === true,
    },
  };
}
