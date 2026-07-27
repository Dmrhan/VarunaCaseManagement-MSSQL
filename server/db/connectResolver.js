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
  // Yalnız MÜŞTERİYE-GÖRÜNÜR notlar (visibility='Customer') — iç/agent-only
  // notlar (default 'Internal') Connect'e ASLA gitmez. DB seviyesinde
  // filtrelenir (app-layer'a hiç yüklenmez — savunma derinliği).
  notes: {
    where: { visibility: 'Customer' },
    orderBy: { createdAt: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { id: true, authorName: true, content: true, createdAt: true },
  },
  // Yalnız durum geçişleri (actionType='StatusChange') — diğer CaseActivity
  // türleri (atama/checklist/iç saha güncellemeleri vb.) iç operasyonel
  // detaydır, Connect'e sızdırılmaz.
  history: {
    where: { actionType: 'StatusChange' },
    orderBy: { at: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { fromValue: true, toValue: true, at: true, actor: true },
  },
  attachments: {
    orderBy: { uploadedAt: 'desc' },
    take: DETAIL_CHILD_CAP,
    select: { id: true, fileName: true, fileSize: true, mimeType: true, fileUrl: true, uploadedBy: true, uploadedAt: true },
  },
};

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
  return {
    ...caseRow,
    notes: [...caseRow.notes].reverse(),
    history: [...caseRow.history].reverse(),
    attachments: [...caseRow.attachments].reverse(),
  };
}

// Test-only escape hatch — company id cache'ini sıfırlar (unit test izolasyonu).
export function _resetUniveraCompanyIdCacheForTests() {
  univeraCompanyIdCache = null;
}
