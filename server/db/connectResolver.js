/**
 * Varuna↔Connect entegrasyonu — kod → Case çözümü (salt-okuma).
 *
 * İki giriş yolu, ikisi de fail-closed:
 *   1) resolveCodesForMerkez(merkezKod) — cross-DB (n4b) merkez müşteri
 *      koduyla Varuna Sifre (AccountProject.code) listesini bulur.
 *   2) findCasesByCodes(codes, ...) — Sifre/code listesiyle UNIVERA
 *      tenant'ı kapsamında Case'leri getirir.
 *
 * Cross-DB desen ve parametreli sorgu stili _n4bmigrate.mjs'den alındı
 * (aynı 3-part isim + Prisma tagged-template interpolasyonu ile otomatik
 * parametrizasyon — SQLi yüzeyi yok). Company lookup'ı da o script gibi
 * isimle SORGULANIR, hardcode edilmez (bkz. _n4bmigrate.mjs COMPANY_LOOKUP_NAME
 * yorumu) — caseRepository.js'de ayrı bir yerde 'COMP-UNIVERA' literal id
 * kullanan bir kısayol daha var, ama bu modül kasıtlı olarak ondan
 * BAĞIMSIZ ve isimle çözüyor (env'ler arası taşınabilirlik).
 */

import { Prisma } from '@prisma/client';
import { prisma } from './client.js';
import { caseRepository } from './caseRepository.js';

const UNIVERA_COMPANY_NAME = 'UNIVERA';
const CUSTOMER_PORTAL_VIEW_REF = '[UNIVERA_CUSTOMER_PORTAL].[dbo].[VIEW_N4B_CUSTOMERS]';

export class ConnectResolverError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConnectResolverError';
    this.code = code;
  }
}

// UNIVERA Company.id — process ömrü boyunca değişmez varsayımıyla bir kez
// çözülüp bellekte tutulur (isim → id lookup her istek için gereksiz round-trip
// olmasın diye). Company adı runtime'da değişirse yeni deploy/restart gerekir
// — TFS_*/EXTERNAL_KB_* env'lerle aynı "restart ile yeniden okunur" sözleşmesi.
let univeraCompanyIdCache = null;

async function resolveUniveraCompanyId() {
  if (univeraCompanyIdCache) return univeraCompanyIdCache;
  const company = await prisma.company.findFirst({
    where: { name: UNIVERA_COMPANY_NAME },
    select: { id: true },
  });
  if (!company) {
    throw new ConnectResolverError(
      'univera_company_not_found',
      `Company '${UNIVERA_COMPANY_NAME}' bulunamadı.`,
    );
  }
  univeraCompanyIdCache = company.id;
  return univeraCompanyIdCache;
}

/**
 * Merkez (n4b LNGORTAKPROJEKOD) kodundan Varuna Sifre (AccountProject.code)
 * listesine. Cross-DB, salt-okuma, parametreli.
 *
 * @param {number|string} merkezKodRaw - tamsayıya zorlanır; tamsayı değilse
 *   (SQLi/parametre karışıklığı riskine hiç girmeden) FAIL-CLOSED throw eder.
 * @returns {Promise<string[]>} distinct, boş-olmayan Sifre listesi. Hiç
 *   eşleşme yoksa boş array (hata DEĞİL — çağıran fail-closed boş sonuç
 *   olarak yorumlar).
 */
export async function resolveCodesForMerkez(merkezKodRaw) {
  const merkezKod = Number(merkezKodRaw);
  if (!Number.isInteger(merkezKod) || merkezKod <= 0) {
    throw new ConnectResolverError(
      'invalid_merkez_kod',
      `merkez kodu geçersiz (tamsayı bekleniyor): ${JSON.stringify(merkezKodRaw)}`,
    );
  }

  // ${merkezKod} Prisma tagged-template ile parametrize edilir (sp_executesql
  // parametresi) — string concat YOK. merkezKod zaten yukarıda Number +
  // Number.isInteger ile doğrulandı; bu ikinci bir savunma katmanıdır.
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT Sifre
    FROM ${Prisma.raw(CUSTOMER_PORTAL_VIEW_REF)}
    WHERE LNGORTAKPROJEKOD = ${merkezKod} AND Sifre IS NOT NULL
  `;

  const codes = [];
  const seen = new Set();
  for (const row of rows) {
    const code = String(row.Sifre ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

// Prisma alan seçimi — Connect mapper'ının ihtiyaç duyduğu alanlarla
// SENKRON tutulmalı (server/lib/connectMapper.js::mapCaseToConnectTicket).
// N+1 önleme: assignee denormalized assignedPersonName alanından okunur —
// Person/User relation include EDİLMEZ.
const CASE_SELECT = {
  id: true,
  caseNumber: true,
  title: true,
  description: true,
  status: true,
  category: true,
  subCategory: true,
  caseType: true,
  origin: true,
  assignedPersonName: true,
  createdAt: true,
  updatedAt: true,
  slaResponseDueAt: true,
  slaResolutionDueAt: true,
  slaViolation: true,
};

/**
 * Sifre/code listesiyle UNIVERA-scoped Case'leri getirir (tek sorgu +
 * count — N+1 yok). FAIL-CLOSED: codes boşsa (ya da array değilse) DB'ye
 * hiç gitmeden boş sonuç döner — "kodsuz = hepsi" davranışı YASAK.
 *
 * @param {string[]} codes - AccountProject.code (Sifre) listesi.
 * @param {object} [opts]
 * @param {string} [opts.status] - Case.status ASCII identifier (enumMap.js).
 * @param {string|Date} [opts.updatedSince] - ISO tarih; updatedAt >= bu değer.
 * @param {number} [opts.page=1]
 * @param {number} [opts.pageSize=50]
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function findCasesByCodes(codes, { status, updatedSince, page = 1, pageSize = 50 } = {}) {
  if (!Array.isArray(codes) || codes.length === 0) {
    return { items: [], total: 0 };
  }

  const companyId = await resolveUniveraCompanyId();

  const where = {
    companyId,
    isArchived: false,
    // AccountProject opsiyonel bir ilişki (Case.accountProjectId nullable);
    // `is:` ile to-one relation filter — code eşleşmeyen/ilişkisiz Case'ler
    // otomatik elenir.
    accountProject: { is: { code: { in: codes } } },
  };
  if (status) where.status = status;
  if (updatedSince) {
    const since = new Date(updatedSince);
    if (!Number.isNaN(since.getTime())) {
      where.updatedAt = { gte: since };
    }
  }

  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 50;
  const skip = (safePage - 1) * safePageSize;

  const [items, total] = await Promise.all([
    prisma.case.findMany({
      where,
      select: CASE_SELECT,
      orderBy: [{ updatedAt: 'desc' }],
      skip,
      take: safePageSize,
    }),
    prisma.case.count({ where }),
  ]);

  return { items, total };
}

// GET-detay dilimi — yorumlar/durum-geçmişi/ekler için makul üst sınır.
// Bir vakanın doğal büyüklüğü bunun çok altında kalır; bu yalnız dejenere
// bir case'in (ör. yıllarca açık kalmış, yüzlerce not) tek istekte aşırı
// payload/DoS üretmesine karşı savunma tavanı. Export edilir — connectMapper.js
// AYNI değeri savunma-derinliği ikinci bir cap olarak reuse eder (bkz.
// mapCaseToConnectDetail); tek kaynak, iki yerde ayrı sabit YOK.
export const DETAIL_CHILD_CAP = 200;

// Detay select — CASE_SELECT'in üstüne resolutionNote + accountProject.code
// (yetki kontrolü İÇİN, route'a dönmez — bkz. findCaseDetailByNumber) +
// filtrelenmiş child ilişkiler eklenir. N+1 yok: tek prisma.case.findFirst,
// her child ilişki DB tarafında filtrelenip cap'lenir.
const CASE_DETAIL_SELECT = {
  ...CASE_SELECT,
  resolutionNote: true,
  accountProject: { select: { code: true } },
  // Oluşturan (creator) — User FK varsa canlı fullName (bkz. findCaseDetailByNumber
  // creator çözümü); FK yoksa (eski satır/User silinmiş) history'deki
  // CaseCreated aktivitesinin actor'ına düşülür.
  createdBy: { select: { fullName: true } },
  // 3. parti bekleme durumu/nedeni — yalnız status='ThirdPartyWaiting' iken
  // ANLAMLI (bkz. findCaseDetailByNumber waitReason çözümü): thirdPartyNote
  // statüden çıkılınca TEMİZLENMEZ (kalıcı/raporlanabilir alan, schema
  // yorumu), bu yüzden gösterim status'a göre GATE'lenir — stale bir "bekleme
  // nedeni" başka bir statüde sızdırılmaz.
  thirdPartyName: true,
  thirdPartyNote: true,
  // Yalnız MÜŞTERİYE-GÖRÜNÜR notlar (visibility='Customer') — iç/agent-only
  // notlar (default 'Internal') Connect'e ASLA gitmez. DB seviyesinde
  // filtrelenir (app-layer'a hiç yüklenmez — savunma derinliği).
  notes: {
    where: { visibility: 'Customer' },
    orderBy: { createdAt: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { id: true, authorName: true, content: true, createdAt: true },
  },
  // Durum geçişleri + devir/atama + açılış (actionType IN StatusChange/
  // Transfer/CaseCreated) — kullanıcı isteği (2026-07-29): devir notları
  // müşteriye "talep geçmişi"nde görünsün. Diğer CaseActivity türleri
  // (checklist/iç saha FieldUpdate'leri vb.) hâlâ iç operasyonel detaydır,
  // Connect'e sızdırılmaz. `note` BİLİNÇLİ olarak seçilir — devir/bekletme
  // notları müşteriye gösterilecek (CaseNote visibility='Customer' filtresi
  // bu karardan AYRI, aynen kalır — bkz. dosya başı yorumu).
  history: {
    where: { actionType: { in: ['StatusChange', 'Transfer', 'CaseCreated'] } },
    orderBy: { at: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { actionType: true, action: true, fromValue: true, toValue: true, note: true, at: true, actor: true },
  },
  attachments: {
    orderBy: { uploadedAt: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { id: true, fileName: true, fileSize: true, mimeType: true, fileUrl: true, uploadedBy: true, uploadedAt: true },
  },
};

// Case.status ASCII — yalnız bu statüdeyken thirdPartyName/thirdPartyNote
// "güncel bekleme nedeni" olarak gösterilir (bkz. CASE_DETAIL_SELECT yorumu).
const THIRD_PARTY_WAIT_STATUS = 'ThirdPartyWaiting';

/**
 * Case detay satırından "oluşturan" görüntü adını çözer — saf fonksiyon,
 * DB'siz test edilebilir. Öncelik: canlı User.fullName (createdBy FK) →
 * yoksa history'deki CaseCreated aktivitesinin actor'ı (free-text, eski
 * kayıtlarda FK boş olabilir) → hiçbiri yoksa null.
 *
 * @param {{createdBy?: {fullName?: string|null}|null, history?: Array<{actionType?: string|null, actor?: string|null}>}} caseRow
 * @returns {string|null}
 */
export function resolveCreatorDisplayName(caseRow) {
  const fromUser = caseRow?.createdBy?.fullName?.trim();
  if (fromUser) return fromUser;
  const createdActivity = Array.isArray(caseRow?.history)
    ? caseRow.history.find((h) => h.actionType === 'CaseCreated')
    : null;
  const fromActivity = createdActivity?.actor?.trim();
  return fromActivity || null;
}

/**
 * Case detay satırından bekleme durumu/nedenini çözer — saf fonksiyon.
 * Yalnız status='ThirdPartyWaiting' iken dolu döner (bkz. CASE_DETAIL_SELECT
 * yorumu — thirdPartyNote statüden çıkılınca temizlenmediği için stale bir
 * neden başka bir statüde sızmasın diye gate'lenir).
 *
 * @param {{status?: string|null, thirdPartyName?: string|null, thirdPartyNote?: string|null}} caseRow
 * @returns {{waitReason: string|null, thirdPartyName: string|null}}
 */
export function resolveWaitReason(caseRow) {
  if (caseRow?.status !== THIRD_PARTY_WAIT_STATUS) {
    return { waitReason: null, thirdPartyName: null };
  }
  const thirdPartyName = caseRow.thirdPartyName?.trim() || null;
  const note = caseRow.thirdPartyNote?.trim() || null;
  // Prominent gösterim metni — not varsa not, yoksa yalnız 3. parti adı
  // (henüz açıklama girilmemiş olabilir, requiresNote=false tanımlarda).
  const waitReason = note || thirdPartyName || null;
  return { waitReason, thirdPartyName };
}

/**
 * IDOR guard — saf fonksiyon, DB'siz test edilebilir (bkz.
 * scripts/smoke-connect-tickets.mjs). Case'in accountProject.code'u
 * çağıranın yetkili kod setinde mi?
 *
 * Normalize edilmiş (trim + case-insensitive) TAM eşleşme — substring/prefix
 * DEĞİL. Bu, findCasesByCodes'un DB tarafındaki `code: { in: codes }`
 * filtresiyle TUTARLI olsun diye: AccountProject.code kolonu MSSQL default
 * collation'da (case-insensitive + trailing-space-insensitive karşılaştırma)
 * saklanıyor — liste tarafı bu yüzden zaten case/boşluk varyantlarını
 * eşleştiriyor. Normalize edilmemiş `.includes()` (eski hal) bu yüzden bir
 * false-negative üretebiliyordu: liste'de görünen bir case, detayda (tam
 * string eşitliği farklı case/boşlukla) 404 dönebiliyordu. Normalize
 * SADECE false-negative'i giderir — over-authorization ÜRETMEZ (hâlâ tam
 * eşleşme, substring/regex yok).
 *
 * @param {string|null|undefined} projectCode
 * @param {string[]|null|undefined} authorizedCodes
 * @returns {boolean}
 */
export function isCodeAuthorized(projectCode, authorizedCodes) {
  if (typeof projectCode !== 'string') return false;
  const normalizedProjectCode = projectCode.trim().toLowerCase();
  if (!normalizedProjectCode) return false;
  if (!Array.isArray(authorizedCodes)) return false;
  return authorizedCodes.some(
    (c) => typeof c === 'string' && c.trim().toLowerCase() === normalizedProjectCode,
  );
}

/**
 * caseNumber ile tek Case'in zengin detayını getirir — IDOR kapalı: Case'in
 * accountProject.code'u `authorizedCodes` içinde DEĞİLSE (ya da Case hiç
 * bulunamazsa) `null` döner. Çağıran (route) bunu 404'e çevirir — 403 DEĞİL,
 * yetkisiz bir çağıran için "var ama erişemiyorsun" sinyali (varlık
 * sızdırma) vermemek üzere kasıtlı.
 *
 * FAIL-CLOSED: authorizedCodes boş/array-değilse DB'ye hiç gitmeden null
 * döner (route zaten scope'u zorunlu kılıyor, bu ikinci savunma katmanı).
 *
 * @param {string} caseNumber - Case.caseNumber (globally @unique).
 * @param {string[]} authorizedCodes - resolveCodesForMerkez/scope=codes'tan
 *   gelen, çağıranın yetkili olduğu AccountProject.code listesi.
 * @returns {Promise<object|null>}
 */
export async function findCaseDetailByNumber(caseNumber, authorizedCodes) {
  if (typeof caseNumber !== 'string' || !caseNumber.trim()) return null;
  if (!Array.isArray(authorizedCodes) || authorizedCodes.length === 0) return null;

  const companyId = await resolveUniveraCompanyId();

  const caseRow = await prisma.case.findFirst({
    where: { caseNumber, companyId, isArchived: false },
    select: CASE_DETAIL_SELECT,
  });
  if (!caseRow) return null;

  if (!isCodeAuthorized(caseRow.accountProject?.code ?? null, authorizedCodes)) {
    // IDOR kapatma — Case var ama bu çağıranın yetkili kod setinde değil.
    return null;
  }

  // history/notes/attachments DB'de `orderBy: 'desc'` + cap ile çekildi
  // (cap tetiklenirse "en yeni N" korunsun diye); doğal okuma sırası için
  // (eski→yeni) burada ters çevrilir.
  //
  // creator/waitReason — caseRow.history (henüz reverse edilmeden, ham
  // desc sırada) üzerinden çözülür; sıra creator/waitReason'ın kendi
  // mantığı için önemsiz (yalnız CaseCreated araması / status kontrolü).
  const creator = resolveCreatorDisplayName(caseRow);
  const { waitReason, thirdPartyName } = resolveWaitReason(caseRow);

  return {
    ...caseRow,
    creator,
    waitReason,
    thirdPartyName,
    notes: [...caseRow.notes].reverse(),
    history: [...caseRow.history].reverse(),
    attachments: [...caseRow.attachments].reverse(),
  };
}

/**
 * caseNumber + yetkili kod seti ile Case'in internal id'sini çözer — IDOR
 * kapalı, findCaseDetailByNumber ile AYNI desen (aynı isCodeAuthorized
 * guard'ı). Attachment ingest gibi "zengin detay gerekmez, sadece id +
 * yetki lazım" senaryolar için LEAN bir alternatif — DETAIL_CHILD_CAP'li
 * notes/history/attachments join'lerini GEREKSİZ YERE tekrar çekmez.
 *
 * FAIL-CLOSED: findCaseDetailByNumber ile aynı — authorizedCodes boş/
 * caseNumber geçersizse DB'ye gitmeden null.
 *
 * @param {string} caseNumber
 * @param {string[]} authorizedCodes
 * @returns {Promise<{id: string}|null>}
 */
export async function resolveAuthorizedCaseId(caseNumber, authorizedCodes) {
  if (typeof caseNumber !== 'string' || !caseNumber.trim()) return null;
  if (!Array.isArray(authorizedCodes) || authorizedCodes.length === 0) return null;

  const companyId = await resolveUniveraCompanyId();

  const caseRow = await prisma.case.findFirst({
    where: { caseNumber, companyId, isArchived: false },
    select: { id: true, accountProject: { select: { code: true } } },
  });
  if (!caseRow) return null;

  if (!isCodeAuthorized(caseRow.accountProject?.code ?? null, authorizedCodes)) {
    return null;
  }
  return { id: caseRow.id };
}

// ─────────────────────────────────────────────────────────────────
// POST /tickets (create) — kod → TEKİL proje çözümü + Case yaratma.
// ─────────────────────────────────────────────────────────────────

/**
 * Saf karar fonksiyonu — resolveSingleProjectByCode'un DB sorgusu SONRASI
 * "0/1/>1 eşleşme" kararını izole eder. isCodeAuthorized ile aynı desen:
 * DB'siz, doğrudan test edilebilir (bkz. scripts/smoke-connect-tickets.mjs).
 *
 * @param {Array<object>} matches - DB'den dönen aday satırlar (herhangi bir şekil).
 * @param {string} code - hata mesajında görüntü için (orijinal, trim'lenmiş kod).
 * @returns {object} TEK eşleşen aday (matches[0]).
 * @throws {ConnectResolverError} code_not_found (0 eşleşme) / code_ambiguous (>1).
 */
export function pickSingleProjectMatch(matches, code) {
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new ConnectResolverError('code_not_found', `'${code}' koduna ait aktif proje bulunamadı.`);
  }
  if (matches.length > 1) {
    throw new ConnectResolverError(
      'code_ambiguous',
      `'${code}' kodu birden fazla projeye eşleşiyor (${matches.length}) — belirsiz, işlem reddedildi.`,
    );
  }
  return matches[0];
}

/**
 * code (Sifre) ile TAM 1 aktif AccountProject bul — UNIVERA company scope.
 *
 * KARAR (Delivery Lead): code ZORUNLU + TEKİL eşleşme. 0 eşleşme →
 * `code_not_found`, >1 eşleşme → `code_ambiguous` — ikisi de fail-closed
 * (route 422'ye çevirir). Sessizce "ilkini seç" YOK: hangi projeye
 * bağlandığı BELİRSİZKEN bir Case yaratmak yanlış müşteriye/projeye
 * bağlama riski taşır — bu, findCasesByCodes/isCodeAuthorized'daki
 * "yetkisiz → sessizce dışla" fail-closed'ından FARKLI bir karar: orada
 * çok-adaylı bir KÜME zaten güvenli (hepsi zaten yetkili), burada TEK bir
 * hedefe YAZMA işlemi var — belirsizlik asla örtük çözülmez.
 *
 * Karşılaştırma DB'nin kendi (varsayılan, case-insensitive + trailing-
 * space-insensitive) collation'ına bırakılır — findCasesByCodes'taki
 * `code: { in: codes }` ile AYNI güven modeli. isCodeAuthorized'daki
 * manuel JS-tarafı normalize FARKLI bir senaryo içindi (cross-DB'den gelen
 * bir JS string'i yerel bir JS string'iyle karşılaştırmak — DB collation'ın
 * hiç devreye giremediği, salt bellek-içi bir kıyas); burada TEK bir DB'ye
 * karşı doğrudan Prisma `where` filtresi var, collation zaten devrede.
 *
 * @param {string} codeRaw
 * @returns {Promise<{accountProjectId: string, accountProjectName: string, accountId: string, accountName: string|null, companyId: string}>}
 */
export async function resolveSingleProjectByCode(codeRaw) {
  if (typeof codeRaw !== 'string' || !codeRaw.trim()) {
    throw new ConnectResolverError('code_not_found', "'code' boş/geçersiz.");
  }
  const code = codeRaw.trim();
  const companyId = await resolveUniveraCompanyId();

  const matches = await prisma.accountProject.findMany({
    where: { code, isActive: true, accountCompany: { companyId } },
    select: {
      id: true,
      name: true,
      accountCompany: { select: { accountId: true, account: { select: { name: true } } } },
    },
  });

  const project = pickSingleProjectMatch(matches, code);
  return {
    accountProjectId: project.id,
    accountProjectName: project.name,
    accountId: project.accountCompany.accountId,
    accountName: project.accountCompany.account?.name ?? null,
    companyId,
  };
}

// Connect service-actor/uploader görüntü adı — TEK KAYNAK. Case create
// (CONNECT_ACTOR.displayName, createdByName) VE attachment ingest
// (caseRepository.js::ingestExternalAttachment'a uploadedByLabel olarak
// server/routes/connectApi.js'ten geçirilir, uploadedBy alanı) AYNI
// string'i paylaşır — iki ayrı yerde "Connect Entegrasyonu" literal'i
// tekrarlanmaz. Export edilir.
export const CONNECT_ACTOR_DISPLAY_NAME = 'Connect Entegrasyonu';

// Connect service-actor — gerçek bir User değil (userId=null → createdByUserId
// NULL kalır, User FK ihlali YOK); audit iz'i yalnız createdByName üzerinden
// (free-text). SystemAdmin/gerçek kullanıcı rolü KULLANILMAZ — assertActor
// (caseRepository.js) object actor için yalnız displayName ister, bu yeterli.
const CONNECT_ACTOR = Object.freeze({
  userId: null,
  personId: null,
  fullName: null,
  email: null,
  role: null,
  displayName: CONNECT_ACTOR_DISPLAY_NAME,
});

// Case.category/subCategory NOT NULL (schema) — Connect body'sinde bu
// alanlar YOK. n4b migrasyonunun/Smart Ticket'ın kendi "sınıflandırılamayan"
// sabitinden ('Akıllı Ticket' — bkz. _n4bmigrate.mjs) KASITLI olarak AYRI:
// o etiket Smart Ticket/AI intake'e özel, Connect farklı bir kaynak.
// origin='Connect' zaten kaynağı ayırt ediyor; category/subCategory yalnız
// NOT NULL kısıtını dolduran nötr bir değer. Export edilir — smoke testi
// (createConnectCase wiring) elle kopyalanmış literal yerine GERÇEK
// sabitlere karşı doğrular (STATUS_CROSSWALK-tamlık testiyle aynı prensip).
export const CONNECT_CASE_CATEGORY = 'Connect Talebi';
export const CONNECT_CASE_SUBCATEGORY = 'Genel';
const CONNECT_CASE_TYPE = 'GeneralSupport';
const CONNECT_CASE_PRIORITY = 'Medium';

/**
 * Connect'ten gelen bir POST /tickets isteğinden Varuna Case yaratır.
 *
 * MEVCUT caseRepository.create() akışı KULLANILIR (iş kuralları/SLA
 * politikası çözümü/vaka numarası üretimi/proje-hesap tutarlılık guard'ları
 * BYPASS EDİLMEZ) — burada yalnız Connect'e özgü sabit alanlar (origin,
 * category/subCategory fallback, servis-actor) + resolveSingleProjectByCode
 * çıktısı birleştirilir. status='Acik' (create()'in varsayılanı —
 * assignedPersonId hiç verilmediği için Smart Ticket self-assign dalı
 * devreye girmez; SystemAdmin/onay kapısı bu yüzden hiç tetiklenmez).
 *
 * @param {object} params
 * @param {{accountProjectId: string, accountId: string, accountName: string|null, companyId: string}} params.project - resolveSingleProjectByCode sonucu.
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.requestType - Varuna CaseRequestType ASCII (bkz. connectMapper.js::mapConnectTypeToRequestType).
 * @param {string} [params.createdByEmail] - Case.customerContactEmail'e yazılır (reporter/contact — create() içindeki sanitizeRequesterContext zaten trim+format doğrular, burada tekrarlanmaz).
 * @returns {Promise<object>} caseRepository.create() dönüşü (shape() edilmiş — TR label'lı, caseNumber/status dahil).
 */
export async function createConnectCase({ project, title, description, requestType, createdByEmail }) {
  const input = {
    title,
    description,
    caseType: CONNECT_CASE_TYPE,
    priority: CONNECT_CASE_PRIORITY,
    origin: 'Connect',
    companyId: project.companyId,
    companyName: UNIVERA_COMPANY_NAME,
    accountId: project.accountId,
    accountName: project.accountName,
    accountProjectId: project.accountProjectId,
    category: CONNECT_CASE_CATEGORY,
    subCategory: CONNECT_CASE_SUBCATEGORY,
    requestType,
    customerContactEmail: createdByEmail || undefined,
  };
  return caseRepository.create(input, CONNECT_ACTOR);
}

// Test-only escape hatch — company id cache'ini sıfırlar (unit test izolasyonu).
export function _resetUniveraCompanyIdCacheForTests() {
  univeraCompanyIdCache = null;
}
