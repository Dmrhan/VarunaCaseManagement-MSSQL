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
 *   visibility='Customer' notu + actionType IN (StatusChange/Transfer/
 *   CaseCreated) history filtresi) — bkz. connectResolver.js::CASE_DETAIL_SELECT
 *   yorumu. CaseActivity.note (devir/bekletme notu) BİLİNÇLİ olarak history'de
 *   döner (kullanıcı isteği, 2026-07-29) — CaseNote visibility filtresinden
 *   AYRI bir karar. İSTİSNA: iç ekip/tier jargonu (L1/L2 — gerçek Varuna takım
 *   adları ve Smart Ticket "L1 Notu:" işaretleyicisi) BURADA (mapper'da)
 *   desensitizeTeamJargon ile müşteri-dostu etikete çevrilir — Security veto
 *   (2026-07-29, HIGH). Kişi adları (kimden kime) bu çeviriden ETKİLENMEZ.
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
// TR sözlüğü BURADA DUPLICATE edilmez. Export edilir — POST /tickets create
// yanıtı da caseRepository.create()'in TR-label döndüren shape()'inden
// (fromDb) aynı çeviriye ihtiyaç duyar (bkz. connectApi.js).
export function trStatusLabelToAscii(trLabel) {
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

// Security veto (2026-07-29, HIGH) — devir action/note metinleri gerçek
// Varuna takım adları üzerinden iç destek-tier topolojisini ("L1"/"L2")
// müşteriye sızdırıyordu (bkz. server/db/caseRepository.js Team seed'i —
// "Univera L1"/"Univera L2"/"Univera L2 Uzman Destek"/"Univera L2 Yurtdışı" —
// VE Smart Ticket devir notundaki "L1 Notu:" literal işaretleyicisi, aynı
// dosya ~satır 5145). KARAR (Delivery Lead + kullanıcı, aynı gün): KİMDEN
// KİME (person X → Y) ve serbest-metin gerekçe AYNEN kalır — yalnız iç
// EKİP KODLARI müşteri-dostu etikete çevrilir.
//
// Sıra ÖNEMLİ: en uzun/özgül desen ÖNCE denenir ("Univera L2 Uzman Destek"/
// "Univera L2 Yurtdışı" — "Univera L2" bare desenden ÖNCE gelmeli), aksi
// halde kısa desen daha uzun bir diziyi yarım/yanlış değiştirir (ör.
// "Univera L2 Uzman Destek" önce "Univera L2"yle eşleşirse sonuç "Yazılım
// Destek Uzman Destek" gibi bozuk bir karışığa döner).
const TEAM_JARGON_LABELS = [
  ['Univera L2 Uzman Destek', 'Yazılım Destek (Uzman)'],
  ['Univera L2 Yurtdışı', 'Yazılım Destek (Yurtdışı)'],
  ['Univera L1', 'Çağrı Merkezi'],
  ['Univera L2', 'Yazılım Destek'],
  // Smart Ticket devir notunda ÜRETİLEN literal işaretleyici (takım adı
  // DEĞİL, ama aynı "L1" jargonunu taşıyor — bkz. caseRepository.js
  // transferCase() noteParts.push('L1 Notu:')).
  ['L1 Notu:', 'Çağrı Merkezi Notu:'],
];

// İkinci geçiş — bilinen tam-dize tablosu (yukarıda) tükendikten SONRA,
// geride kalan STANDALONE "L1"/"L2" token'ları için genel word-boundary
// yakalayıcı (ör. AI'nin ürettiği serbest-metin özetlerde geçen "L1 çözüm
// adımı kaydı yok." gibi Smart Ticket composedSummary cümleleri — bkz.
// caseRepository.js buildSmartTicketTransferMerge/transferCase stTransfer
// akışı; bu metin sabit bir literal DEĞİL, AI ürettiği için tam-dize
// tablosuna eklenemez). \b (kelime sınırı) sayesinde "L1"/"L2" başka bir
// kelimenin İÇİNDE geçerse (ör. "URL2") YAKALANMAZ — yalnız bağımsız bir
// kelime olarak geçtiğinde eşleşir. Bu geçiş ÖNCE çalışırsa "Univera L2
// Uzman Destek" gibi çok-kelimeli literal'leri YARIM çevirip tabloyu
// bozardı — bu yüzden SIRA'da tam-dize tablosundan SONRA gelir (bkz.
// desensitizeTeamJargon).
const TEAM_JARGON_TOKEN_PATTERNS = [
  [/\bL1\b/g, 'Çağrı Merkezi'],
  [/\bL2\b/g, 'Yazılım Destek'],
];

/**
 * İç ekip-kodu/tier jargonunu (L1/L2) müşteri-dostu etikete çevirir — saf
 * string transform, DB'ye/Case'e DOKUNMAZ (yalnız Connect'e giden okuma
 * şeklini değiştirir; CaseActivity'nin kendisi/CaseNote visibility/IDOR
 * ETKİLENMEZ). "Kişi: X → Y" bölümündeki KİŞİ ADLARI bu tabloda YOK —
 * bilinçli olarak dokunulmaz (kullanıcı onayı: kimden kime GÖRÜNSÜN).
 *
 * İki geçişli: (1) bilinen tam-dize takım adları/literal işaretleyiciler
 * (TEAM_JARGON_LABELS, en özgülden en genele sıralı), (2) geride kalan
 * standalone "L1"/"L2" token'ları için word-boundary regex yakalayıcı
 * (TEAM_JARGON_TOKEN_PATTERNS) — AI'nin ürettiği serbest-metin özetlerde
 * (Smart Ticket composedSummary) geçen jargonu da yakalar.
 *
 * @param {unknown} text
 * @returns {unknown} string ise çevrilmiş hali, değilse (null/undefined) olduğu gibi.
 */
export function desensitizeTeamJargon(text) {
  if (typeof text !== 'string' || !text) return text;
  let result = text;
  for (const [from, to] of TEAM_JARGON_LABELS) {
    result = result.split(from).join(to);
  }
  for (const [pattern, to] of TEAM_JARGON_TOKEN_PATTERNS) {
    result = result.replace(pattern, to);
  }
  return result;
}

// history artık 3 actionType karışık geliyor (StatusChange/Transfer/
// CaseCreated — bkz. connectResolver.js::CASE_DETAIL_SELECT). fromStatus/
// toStatus crosswalk çevirisi YALNIZ actionType='StatusChange' için anlamlı
// (fromValue/toValue orada bir CaseStatus TR label'ı); Transfer'da bu alanlar
// takım/kişi ADI taşır (ör. gerçek Varuna takım adı "Univera L2") — TR status
// crosswalk'a sokulursa STATUS_CROSSWALK'ta hiç eşleşmez, her devir kaydında
// gereksiz bir "bilinmeyen status" console.warn'u tetiklerdi (bkz.
// toConnectStatus). Bu yüzden çeviri actionType'a göre GATE'lenir; ham
// from/to (fromValue/toValue) her actionType için (jargon-arındırılmış
// olarak, bkz. desensitizeTeamJargon) ayrıca döner.
function mapActivityToConnectHistoryEntry(activity) {
  const isStatusChange = activity.actionType === 'StatusChange';
  return {
    // actionType ham ASCII değeri — Connect UI kalem tipini (durum değişikliği/
    // devir/açılış) ayırt edebilsin diye.
    type: activity.actionType ?? null,
    // CaseActivity.action — insan-okur Türkçe özet (ör. "↔ Vaka aktarıldı: X → Y")
    // — iç ekip kodları (L1/L2) jargon-arındırılmış (bkz. desensitizeTeamJargon).
    action: desensitizeTeamJargon(activity.action) ?? null,
    fromStatus: isStatusChange && activity.fromValue ? toConnectStatus(trStatusLabelToAscii(activity.fromValue)) : null,
    toStatus: isStatusChange && activity.toValue ? toConnectStatus(trStatusLabelToAscii(activity.toValue)) : null,
    // Ham (çevrilmemiş DURUM anlamında) from/to — StatusChange için TR status
    // label'ı, Transfer için takım/kişi adı (jargon-arındırılmış), CaseCreated
    // için genelde null.
    from: desensitizeTeamJargon(activity.fromValue) ?? null,
    to: desensitizeTeamJargon(activity.toValue) ?? null,
    at: toIsoOrNull(activity.at),
    // CaseActivity.actor zaten anlık-damgalı bir görüntü ismi (User FK değil,
    // free-text) — actorUserId burada hiç seçilmedi/sızdırılmaz.
    by: activity.actor ?? null,
    // Devir/bekletme notu (kullanıcı isteği, 2026-07-29) — CaseNote
    // visibility='Customer' filtresinden AYRI bir karar (bkz. connectResolver.js
    // CASE_DETAIL_SELECT yorumu): bu CaseActivity.note, iç not DEĞİL, devir
    // anındaki açıklama (ör. "3. parti X'e yönlendirildi, Y nedeniyle").
    // Kişi adları (Kişi: X → Y) AYNEN kalır — yalnız ekip kodu jargonu
    // (ör. "L1 Notu:") arındırılır (bkz. desensitizeTeamJargon, Security veto).
    note: desensitizeTeamJargon(activity.note) ?? null,
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
 *   — liste alanları + resolutionNote + notes[]/history[]/attachments[] +
 *   creator/waitReason/thirdPartyName (resolver'ın kendisi çözdüğü türetilmiş
 *   alanlar — bkz. server/db/connectResolver.js::resolveCreatorDisplayName/
 *   resolveWaitReason), bkz. server/db/connectResolver.js).
 * @returns {object|null} Connect zengin ticket detayı.
 */
export function mapCaseToConnectDetail(caseRow) {
  if (!caseRow) return null;
  const base = mapCaseToConnectTicket(caseRow);
  return {
    ...base,
    resolutionNote: caseRow.resolutionNote ?? null,
    // Oluşturan — resolver'da zaten çözülmüş görüntü adı (User.fullName ya
    // da CaseCreated aktivitesinin actor'ı), burada yalnız geçirilir.
    creator: caseRow.creator ?? null,
    // Bekleme durumu/nedeni — yalnız status='ThirdPartyWaiting' iken dolu
    // (resolver'da gate'lenir, bkz. resolveWaitReason).
    waitReason: caseRow.waitReason ?? null,
    thirdPartyName: caseRow.thirdPartyName ?? null,
    comments: capChronological(caseRow.notes, DETAIL_CHILD_CAP).map(mapNoteToConnectComment),
    history: capChronological(caseRow.history, DETAIL_CHILD_CAP).map(mapActivityToConnectHistoryEntry),
    attachments: capChronological(caseRow.attachments, DETAIL_CHILD_CAP).map((a) => mapAttachmentToConnect(a, caseRow.id)),
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /tickets (create) — Connect type → Varuna CaseRequestType.
// ─────────────────────────────────────────────────────────────────

// Connect'in 5 sabit talep tipi → Varuna CaseRequestType ASCII identifier
// (server/db/enumMap.js::M_REQUEST tek kaynak referans — buradaki değerler
// M_REQUEST'in ÜRETTİĞİ ASCII değerlerle birebir aynı olmalı). Export
// edilir — smoke testi bu tablonun değerlerinin Object.values(M_REQUEST)'in
// bir ALT-KÜMESİ olduğunu doğrular (STATUS_CROSSWALK-tamlık testinin
// muadili — yeni bir CaseRequestType eklenip burası unutulursa YAKALANMAZ
// ama en azından burada YANLIŞ/var-olmayan bir ASCII değer kullanılırsa
// yakalanır).
// 'Soru' Varuna'da YOK — en yakın karşılık 'Bilgi' (bilgi talebi); KARAR
// (görev tanımı). Diğer 4'ü birebir.
export const CONNECT_TYPE_TO_REQUEST_TYPE = {
  Soru: 'Bilgi',
  Talep: 'Talep',
  'Öneri': 'Oneri',
  'Şikayet': 'Sikayet',
  Hata: 'Hata',
};

/**
 * Connect 'type' alanı (Soru/Talep/Öneri/Şikayet/Hata) → Varuna
 * CaseRequestType ASCII. Eşleşmeyen/bilinmeyen tip için `null` döner —
 * çağıran (route) bunu 400'e çevirir; sessiz varsayılan/en-yakın-tahmin YOK.
 *
 * @param {string} connectType
 * @returns {string|null}
 */
export function mapConnectTypeToRequestType(connectType) {
  if (typeof connectType !== 'string') return null;
  return CONNECT_TYPE_TO_REQUEST_TYPE[connectType.trim()] ?? null;
}
