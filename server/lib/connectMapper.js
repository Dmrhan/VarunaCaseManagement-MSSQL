/**
 * Case → Connect ticket (okuma) dönüşümü.
 *
 * Varuna↔Connect entegrasyonu — Connect kendi UI'ında Varuna vakalarını
 * "ticket" olarak gösterir; bu modül Case satırını Connect'in beklediği
 * düz JSON şekline çevirir. YALNIZ OKUMA — bu dilimde yazma/patch yok.
 *
 * Girdi (`caseRow`) server/db/connectResolver.js'in select ettiği alanlarla
 * sınırlı ham Prisma satırıdır (ASCII enum identifier'lar — örn.
 * status='Acik' — server/db/enumMap.js ile aynı sözleşme, TR string'e
 * BURADA çevrilmez; yalnız status Connect'in kendi görünüm sözlüğüne
 * crosswalk'lanır, bkz. STATUS_CROSSWALK).
 *
 * mapCaseToConnectTicket  — liste satırı (findCasesByCodes şekli).
 * mapCaseToConnectDetail  — tek ticket zengin detay (findCaseDetailByNumber
 *   şekli) — liste alanlarının hepsi + comments/history/attachments.
 *   Hassas alan sızıntısı guard'ı BURADA değil, resolver'da (DB seviyesinde
 *   visibility='Customer' notu + actionType='StatusChange' history filtresi)
 *   — bkz. connectResolver.js::CASE_DETAIL_SELECT yorumu.
 */

import { M_STATUS } from '../db/enumMap.js';
import { createDownloadUrl } from '../db/storage.js';
import { DETAIL_CHILD_CAP } from '../db/connectResolver.js';

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

// CaseActivity.fromValue/toValue history'de TR label olarak saklanır (bkz.
// caseRepository.js::transitionStatus — `prevStatusTr`/`nextStatus`), ASCII
// DEĞİL. toConnectStatus'un beklediği ASCII identifier'a çevirmek için
// enumMap.js::M_STATUS (TR → ASCII) forward map'i reuse edilir — ikinci bir
// TR sözlüğü BURADA DUPLICATE edilmez.
function trStatusLabelToAscii(trLabel) {
  return M_STATUS[trLabel] ?? trLabel;
}

function mapNoteToConnectComment(note) {
  return {
    id: note.id,
    // "Kim yazdı" — denormalized authorName; authorId sızdırılmaz (assignee
    // ile aynı prensip).
    author: note.authorName ?? null,
    text: note.content,
    createdAt: toIsoOrNull(note.createdAt),
  };
}

function mapActivityToConnectHistoryEntry(activity) {
  return {
    fromStatus: activity.fromValue ? toConnectStatus(trStatusLabelToAscii(activity.fromValue)) : null,
    toStatus: activity.toValue ? toConnectStatus(trStatusLabelToAscii(activity.toValue)) : null,
    at: toIsoOrNull(activity.at),
    // CaseActivity.actor zaten anlık-damgalı bir görüntü ismi (User FK değil,
    // free-text) — actorUserId burada hiç seçilmedi/sızdırılmaz.
    by: activity.actor ?? null,
  };
}

// Connect harici bir tüketici — normal frontend akışının 5dk'lık
// (DOWNLOAD_TOKEN_TTL_SEC) capability URL'i, ticket detayını görüp biraz
// sonra tıklayan bir Connect kullanıcısı için çok kısa kalabilir. 1 saat
// (mevcut storage token altyapısının aynısı; yeni bir secret/mekanizma YOK).
const ATTACHMENT_DOWNLOAD_TTL_SEC = 3600;

function mapAttachmentToConnect(attachment, caseId) {
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    // İçerik gömme YOK — yalnız kısa ömürlü capability URL (mevcut HMAC
    // storage token altyapısı, server/db/storage.js::createDownloadUrl).
    // Connect bu göreli path'i kendi bildiği app origin'iyle birleştirip GET
    // eder; attachment.fileUrl yoksa (beklenmeyen eski/bozuk kayıt) null.
    downloadUrl: attachment.fileUrl
      ? createDownloadUrl(caseId, attachment.id, attachment.fileUrl, attachment.fileName, ATTACHMENT_DOWNLOAD_TTL_SEC, attachment.mimeType)
      : null,
    uploadedBy: attachment.uploadedBy ?? null,
    uploadedAt: toIsoOrNull(attachment.uploadedAt),
  };
}

// Savunma-derinliği ikinci cap — asıl sınırlama connectResolver.js'in DB
// sorgusunda (`take: DETAIL_CHILD_CAP`); burası caseRow'un (ör. ileride
// resolver değişip cap'i unutursa, ya da mapper başka bir caller'dan
// beklenenden büyük bir dizi alırsa) hâlâ sınırlı kalmasını garanti eder.
// Girdi eski→yeni (ascending) sırada VARSAYILIR (resolver sözleşmesi); cap
// aşılırsa EN YENİ `cap` kadarı tutulur (resolver'ın DB tarafında zaten
// `orderBy desc + take` ile yaptığı seçimle TUTARLI), ascending sıra korunur.
function capChronological(items, cap) {
  if (!Array.isArray(items)) return [];
  if (items.length <= cap) return items;
  return items.slice(-cap);
}

/**
 * @param {object} caseRow - findCaseDetailByNumber şekli (CASE_DETAIL_SELECT
 *   — liste alanları + resolutionNote + notes[]/history[]/attachments[],
 *   bkz. server/db/connectResolver.js).
 * @returns {object|null} Connect zengin ticket detayı.
 */
export function mapCaseToConnectDetail(caseRow) {
  if (!caseRow) return null;
  const base = mapCaseToConnectTicket(caseRow);
  return {
    ...base,
    resolutionNote: caseRow.resolutionNote ?? null,
    comments: capChronological(caseRow.notes, DETAIL_CHILD_CAP).map(mapNoteToConnectComment),
    history: capChronological(caseRow.history, DETAIL_CHILD_CAP).map(mapActivityToConnectHistoryEntry),
    attachments: capChronological(caseRow.attachments, DETAIL_CHILD_CAP).map((a) => mapAttachmentToConnect(a, caseRow.id)),
  };
}
