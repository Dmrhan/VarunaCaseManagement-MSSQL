import { prisma } from './client.js';
import { CUSTOMER_TYPE_VALUES, CUSTOMER_ROLE_VALUES } from './enumMap.js';
// WR-A2 — Validation + privacy helpers.
import {
  validateVkn,
  validateTckn,
  hashTckn,
  maskTcknLast4,
  normalizePhoneE164,
  tcknPepperAvailable,
} from '../utils/accountValidation.js';
import { generateUniqueAccountId } from '../utils/accountId.js';
import { generateTurkishSearchVariants } from '../utils/turkishSearch.js';
import { uniqueTargetHas } from './uniqueViolation.js';

/**
 * Phase A — Account 360 repository.
 *
 * Tasarım kararları:
 *  - Account global kimlik; per-tenant alanlar (Univera kodu, paket, kontrat)
 *    AccountCompany tablosunda.
 *  - Account.companyId legacy: yeni veriler yazılmaz fakat geriye uyumluluk
 *    için Case scope sorgularında okunmaya devam eder.
 *  - Scope kuralı:
 *      izinli  = AccountCompany.companyId in allowedCompanyIds
 *             OR Account.companyId in allowedCompanyIds (legacy)
 *             OR Account.companyId IS NULL (shared)
 *  - VKN response'larda MASKELI döner ({first3}***{last3}).
 *  - Hassas alan (VKN) logger'a hiçbir koşulda gitmez.
 */

export class AccountAccessError extends Error {
  constructor(message = 'Müşteriye erişim yetkiniz yok.') {
    super(message);
    this.name = 'AccountAccessError';
  }
}

export class AccountValidationError extends Error {
  constructor(message, { status = 400, code = 'validation_error' } = {}) {
    super(message);
    this.name = 'AccountValidationError';
    this.status = status;
    this.code = code;
  }
}

/**
 * WR-A7b / DI.1 — AccountCompany.packageId set/update edilirken paket aynı
 * şirkete ait olmalı. Cross-tenant package ataması 400 ile reddedilir.
 * Null geçerse no-op; caller patch.packageId = null'a karar verir.
 */
async function assertPackageInCompany({ packageId, companyId }) {
  if (!packageId) return null;
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: { id: true, companyId: true, name: true, isActive: true },
  });
  if (!pkg || pkg.companyId !== companyId) {
    throw new AccountValidationError(
      'Paket başka bir şirkete ait; bu müşteri-şirket ilişkisine bağlanamaz.',
      { status: 400, code: 'package_company_mismatch' },
    );
  }
  return pkg;
}

/**
 * WR-A1 — Müşteri tipi validation. Geçersiz identifier 400 fırlatır.
 * Boş/undefined kabul edilir (caller default'a düşer).
 *
 * TCKN bu fazın DIŞINDA — A2'de privacy design sonrası. Bu fonksiyona
 * tckn benzeri bir alan eklenmez.
 */
function normalizeCustomerType(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !CUSTOMER_TYPE_VALUES.includes(value)) {
    throw new AccountValidationError('Geçersiz müşteri tipi.', { code: 'invalid_customer_type' });
  }
  return value;
}

/**
 * Faz B-temel — customerRole (Müşteri Türü) normalize.
 *
 * customerType ile FARKLI alan. ASCII identifier doğrudan kabul edilir
 * (UI dropdown'da TR→ASCII map'i frontend tarafında yapılır; n4b parite).
 *
 * Davranış:
 *   - undefined/null/'' → undefined (caller dokunmaz, mevcut değer korunur)
 *   - 'CLEAR' → null (UI explicit "rolü temizle")
 *   - 6 enum değer dışında → throw
 *
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
function normalizeCustomerRole(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'CLEAR') return null;
  if (typeof value !== 'string' || !CUSTOMER_ROLE_VALUES.includes(value)) {
    throw new AccountValidationError('Geçersiz müşteri türü (rol).', { code: 'invalid_customer_role' });
  }
  return value;
}

export function maskVkn(vkn) {
  if (!vkn) return null;
  if (vkn.length <= 6) return '*'.repeat(vkn.length);
  return `${vkn.slice(0, 3)}${'*'.repeat(Math.max(vkn.length - 6, 1))}${vkn.slice(-3)}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Bir account'a erişim hakkı var mı? Üç koşuldan biri yeterli:
 *  1. AccountCompany kaydı izinli şirkete bağlıysa
 *  2. Account.companyId izinli şirketse (legacy)
 *  3. Account.companyId NULL (shared/global müşteri)
 *
 * Sonuç: { account, allowedAccountCompanyIds } — caller yalnızca izinli
 * AccountCompany'leri response'a koyabilsin diye whitelist döner.
 */
export async function assertAccountInScope(accountId, allowedCompanyIds) {
  const allowed = ensureArray(allowedCompanyIds);
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      companyId: true,
      companies: {
        select: { id: true, companyId: true },
      },
    },
  });
  if (!account) return null;

  const accountCompanyIds = account.companies
    .filter((c) => allowed.includes(c.companyId))
    .map((c) => c.id);

  const legacyMatch =
    account.companyId === null || (account.companyId && allowed.includes(account.companyId));

  if (accountCompanyIds.length === 0 && !legacyMatch) {
    throw new AccountAccessError();
  }

  return { account, allowedAccountCompanyIds: accountCompanyIds };
}

/**
 * List filter clause: scope dahil. Aynı kural assertAccountInScope ile uyumlu.
 */
function buildScopeWhere(allowedCompanyIds) {
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) {
    // Kullanıcı hiçbir şirkete bağlı değilse yalnızca legacy NULL Account'ları görür.
    return { companyId: null };
  }
  return {
    OR: [
      { companies: { some: { companyId: { in: allowed } } } },
      { companyId: { in: allowed } },
      { companyId: null },
    ],
  };
}

function shapeAccountRow(account, { caseAggregates }) {
  return {
    id: account.id,
    name: account.name,
    vknMasked: maskVkn(account.vkn),
    phone: account.phone ?? null,
    // WR-A2 — phoneE164 search/dedup için iç UI'a geri döner; internal use only.
    phoneE164: account.phoneE164 ?? null,
    // Phase 2 phone metadata
    phoneType: account.phoneType ?? null,
    phoneExtension: account.phoneExtension ?? null,
    // Phase 3 — slot 2/3 + primaryPhoneSlot
    phone2: account.phone2 ?? null,
    phone2E164: account.phone2E164 ?? null,
    phone2Type: account.phone2Type ?? null,
    phone2Extension: account.phone2Extension ?? null,
    phone3: account.phone3 ?? null,
    phone3E164: account.phone3E164 ?? null,
    phone3Type: account.phone3Type ?? null,
    phone3Extension: account.phone3Extension ?? null,
    primaryPhoneSlot: account.primaryPhoneSlot ?? null,
    email: account.email ?? null,
    isActive: account.isActive,
    // WR-A1 / PM-01 — Müşteri tipi + opsiyonel ticari unvan/sicil no.
    customerType: account.customerType,
    customerRole: account.customerRole ?? null, // Faz B-temel
    legalName: account.legalName ?? null,
    registrationNo: account.registrationNo ?? null,
    taxOffice: account.taxOffice ?? null,
    // WR-A2 — TCKN: sadece maskeli display ("*******1234"). Plain TCKN ve tcknHash
    // ASLA response'ta yer almaz.
    tcknMasked: maskTcknLast4(account.tcknLast4),
    companies: account.companies
      .filter((c) => c.__inScope)
      .map((c) => ({
        accountCompanyId: c.id,
        companyId: c.companyId,
        companyName: c.company?.name ?? null,
        companyColor: c.company?.settings?.primaryColor ?? null,
        status: c.status,
        externalCustomerCode: c.externalCustomerCode ?? null,
        projects: (c.projects ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code ?? null,
        })),
      })),
    openCaseCount: caseAggregates?.openCaseCount ?? 0,
    totalCaseCount: caseAggregates?.totalCaseCount ?? 0,
  };
}

/**
 * GET /api/accounts — liste.
 *
 * search: min 2 char. Aşağıdaki alanlar OR'lanır — tenant scope (allowedCompanyIds)
 * her durumda dış WHERE'de korunur, OR sadece eşleştirme alanlarını genişletir:
 *   - name (contains, case-insensitive)
 *   - vkn (startsWith)
 *   - tcknHash (exact) — PR-4b: sadece query tam 11 hane + validateTckn.ok +
 *     TCKN_HASH_PEPPER mevcutsa eklenir. Pepper yoksa sessizce skip (read path
 *     UX'i bozmamak için throw etmez; write path 400 fail aksine). Plain TCKN
 *     ya da tcknHash response'a girmez; sadece tcknMasked görünür.
 *   - AccountCompany.externalCustomerCode (contains, case-insensitive) — C2,
 *     **scoped**: yalnız companyId filtresi (varsa) veya allowedCompanyIds
 *     içindeki AccountCompany ilişkilerinde aranır. Yetkisiz tenant'taki
 *     external kodla Account'a sızma engellenir.
 *   - contact phone/email (contains, case-insensitive)
 * companyId: filter (allowedCompanyIds içinde olmalı).
 * status: AccountCompany.status filter (active/churn/prospect/inactive).
 * ids: belirli account id'leri ile sınırlandır (C2 recents revalidation).
 *   buildScopeWhere ile birlikte uygulanır; out-of-scope id'ler doğal olarak
 *   sonuçtan düşer.
 */
export async function listAccounts({
  search,
  searchFields,
  companyId,
  status,
  ids,
  page = 1,
  limit = 25,
  allowedCompanyIds,
  // Vaka açma/eşleştirme picker'ları için — true ise pasif (isActive=false)
  // hesaplar sonuçtan düşer. Müşteri yönetim listesi bunu geçmez, pasif
  // kayıtları görmeye/yönetmeye devam eder.
  activeOnly = false,
}) {
  const allowed = ensureArray(allowedCompanyIds);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));

  if (companyId && !allowed.includes(companyId)) {
    // İzinli olmayan bir şirket ID gönderildi → boş döner (403 yerine empty).
    return { accounts: [], total: 0, page: safePage, limit: safeLimit };
  }

  const whereAnd = [buildScopeWhere(allowed)];

  if (activeOnly) {
    whereAnd.push({ isActive: true });
  }

  // C2 recents revalidation: restrict to explicit id set. Tenant scope
  // already enforced by buildScopeWhere → out-of-scope ids drop out.
  if (Array.isArray(ids)) {
    if (ids.length === 0) {
      return { accounts: [], total: 0, page: safePage, limit: safeLimit };
    }
    whereAnd.push({ id: { in: ids } });
  }

  if (search && search.trim().length >= 2) {
    const q = search.trim();
    // C2 review fix (P1): externalCustomerCode predicate is scoped INSIDE
    // the same `companies.some` clause. Without the inner `companyId`
    // constraint, an Account whose AC in a forbidden tenant carries the
    // searched code would still surface (the outer scope already let it
    // through via a separate allowed AC). Scoping the some-clause closes
    // that leak: code-match only counts when it lives on an AC that's
    // either the explicit companyId filter or in allowedCompanyIds.
    const externalCodeAcScope = companyId ? companyId : { in: allowed };

    // WR-A2 / PR-4b — TCKN-by-search. Sadece 11 haneli + valid + pepper
    // available iken hash branch eklenir. Aksi halde sessizce skip (write
    // path 400 firlatir; read path UX'i bozmamak icin asla throw etmez).
    // Plain TCKN log'a, response'a, hash'in disinda DB sorgusuna gitmez —
    // hashTckn icindeki validateTckn normalize ediyor, ayni HMAC = ayni
    // write-time hash. Audit log obligation (OD-022) hala pending.
    let tcknHashBranch = null;
    if (/^\d{11}$/.test(q) && validateTckn(q).ok && tcknPepperAvailable()) {
      const { hash } = hashTckn(q);
      tcknHashBranch = { tcknHash: hash };
    }

    // Turkish-aware: Postgres ILIKE "İ" (U+0130) → "i" + combining dot
    // çıkartıyor; plain ASCII "i" eşleşmiyor. Free-text alanlarda (name,
    // contact email) tüm TR varyantlarını OR ile dene. Telefon/VKN/
    // externalCustomerCode sayısal/kod olduğu için orijinal q ile gider.
    const nameVariants = generateTurkishSearchVariants(q);
    const nameOR = nameVariants.map((v) => ({ name: { contains: v } }));
    const contactEmailOR = nameVariants.map((v) => ({ email: { contains: v } }));
    // Codex P2 R1 fix (2026-07-03) — Contact chip için AccountContact.fullName
    // predicate'i eklendi. Önceden yalnız phone + email vardı; UI placeholder
    // "Kontak adı, telefon veya e-posta" derken kontak ADIYLA arama sonuçsuz
    // dönerdi. Turkish-aware nameVariants kullanılır (İ/i, Ş, Ç, Ğ, Ö, Ü, ı
    // varyantları).
    const contactNameOR = nameVariants.map((v) => ({ fullName: { contains: v } }));
    const projectNameOR = nameVariants.map((v) => ({ name: { contains: v } }));

    // searchFields: belirli alanları seç; boş/undefined → tüm alanlar (geriye uyum).
    const sf = Array.isArray(searchFields) && searchFields.length > 0 ? new Set(searchFields) : null;
    const orBranches = [];
    if (!sf || sf.has('name'))    orBranches.push(...nameOR);
    if (!sf || sf.has('vkn'))     orBranches.push({ vkn: { startsWith: q } }, ...(tcknHashBranch ? [tcknHashBranch] : []));
    // Phase 3 — 3 phone slot E.164 search predicate genişletildi.
    if (!sf || sf.has('phone'))   orBranches.push({ phoneE164: { contains: q } }, { phone2E164: { contains: q } }, { phone3E164: { contains: q } });
    if (!sf || sf.has('code'))    orBranches.push({ companies: { some: { companyId: externalCodeAcScope, externalCustomerCode: { contains: q } } } });
    if (!sf || sf.has('contact')) orBranches.push({ contacts: { some: { OR: [{ phone: { contains: q } }, ...contactEmailOR, ...contactNameOR] } } });
    // Proje adı veya kodu ile arama — diğer alanlarla aynı kurala tabi:
    // hiç chip seçili değilse (sf=null, "her yerde ara") dahil edilir;
    // belirli chip'ler seçiliyse (ör. yalnız Ünvan) proje araması devre dışı
    // kalır — aksi halde ör. "Nestle" ünvan aramasında, adı alakasız ama
    // "Nestle" markalı projesi olan yüzlerce bayi hesabı sonucu kirletiyordu.
    if (!sf) {
      orBranches.push({ companies: { some: { companyId: externalCodeAcScope, projects: { some: { isActive: true, OR: [...projectNameOR, { code: { contains: q } }] } } } } });
    }
    if (orBranches.length > 0) {
      whereAnd.push({ OR: orBranches });
    }
  }

  if (companyId) {
    // P0 hotfix: backfill öncesinde legacy Account.companyId set olan müşteriler
    // AccountCompany'siz olabilir. Filter'a legacy companyId fallback'ı ekle ki
    // arama/listeleme bu boşlukta körleşmesin.
    whereAnd.push({
      OR: [
        { companies: { some: { companyId } } },
        { companyId },
      ],
    });
  }

  if (status) {
    // P2 hotfix: status filter sadece görünür AccountCompany kayıtlarına
    // uygulanır — başka tenant'taki hidden status'lar match'lememeli.
    // companyId query verildiyse onu da kombinle; verilmediyse allowedCompanyIds
    // içinden herhangi biri. allowedCompanyIds boşsa zaten kullanıcı hiçbir şey
    // göremez (whereAnd[0] = buildScopeWhere ile filter edildi).
    const statusCompanyScope = companyId
      ? { companyId }
      : allowed.length
        ? { companyId: { in: allowed } }
        : {};
    whereAnd.push({ companies: { some: { status, ...statusCompanyScope } } });
  }

  const where = { AND: whereAnd };

  const [total, rows] = await prisma.$transaction([
    prisma.account.count({ where }),
    prisma.account.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      select: {
        id: true,
        name: true,
        vkn: true,
        phone: true,
        phoneE164: true, // WR-A2
        phoneType: true, // Phase 2
        phoneExtension: true, // Phase 2
        // Phase 3 — slot 2/3 + primary
        phone2: true,
        phone2E164: true,
        phone2Type: true,
        phone2Extension: true,
        phone3: true,
        phone3E164: true,
        phone3Type: true,
        phone3Extension: true,
        primaryPhoneSlot: true,
        email: true,
        isActive: true,
        // WR-A1
        customerType: true,
        customerRole: true, // Faz B-temel
        legalName: true,
        registrationNo: true,
        taxOffice: true,
        // WR-A2 — tcknHash select edilmez (privacy); sadece tcknLast4 (mask için).
        tcknLast4: true,
        companies: {
          select: {
            id: true,
            companyId: true,
            status: true,
            externalCustomerCode: true,
            company: {
              select: {
                name: true,
                // Phase C2 polish: Company chip renkleri CompanySettings.primaryColor'dan.
                settings: { select: { primaryColor: true } },
              },
            },
            // Picker inline proje listesi — yalnız aktif projeler.
            projects: {
              where: { isActive: true, status: 'Active' },
              select: { id: true, name: true, code: true },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    }),
  ]);

  const accountIds = rows.map((r) => r.id);

  // Open / total case sayısını batch al — N+1 önle.
  // P2 hotfix: shared/multi-company account'larda case count'u allowedCompanyIds
  // ile sınırla; aksi halde kullanıcı görmediği şirketin vaka sayısını sayar.
  // SystemAdmin allowed = tüm aktif şirketler (verifyJwt). allowed boşsa hiçbir
  // şey sayma (kullanıcı zaten hiçbir şey göremiyor).
  const caseScope = accountIds.length
    ? allowed.length
      ? { accountId: { in: accountIds }, companyId: { in: allowed } }
      : { accountId: { in: [] } }
    : null;
  const allCases = caseScope
    ? await prisma.case.groupBy({
        by: ['accountId', 'status'],
        where: caseScope,
        _count: { _all: true },
      })
    : [];

  // Acık vakalar: kapalı/iptal/çözüldü olmayanlar = aktif iş yükü.
  const openStatusSet = new Set(['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi']);

  const caseStatsByAccount = new Map();
  for (const row of allCases) {
    const stats = caseStatsByAccount.get(row.accountId) ?? { open: 0, total: 0 };
    stats.total += row._count._all;
    if (openStatusSet.has(row.status)) stats.open += row._count._all;
    caseStatsByAccount.set(row.accountId, stats);
  }

  const accounts = rows.map((row) => {
    // İzinli AccountCompany'leri marker'la — yalnızca scope içindekiler dışarı sızar.
    const taggedCompanies = row.companies.map((c) => ({
      ...c,
      __inScope: allowed.length === 0 ? false : allowed.includes(c.companyId),
    }));
    const stats = caseStatsByAccount.get(row.id) ?? { open: 0, total: 0 };
    return shapeAccountRow(
      { ...row, companies: taggedCompanies },
      { caseAggregates: { openCaseCount: stats.open, totalCaseCount: stats.total } },
    );
  });

  return { accounts, total, page: safePage, limit: safeLimit };
}

/**
 * GET /api/accounts/:id — detay.
 *
 * Sadece izinli AccountCompany'ler ve contact'lar response'a girer; cross-tenant
 * sızıntı yok.
 */
export async function getAccount(accountId, { allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const scope = await assertAccountInScope(accountId, allowed);
  if (!scope) return null;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      vkn: true,
      phone: true,
      phoneE164: true, // WR-A2
      phoneType: true, // Phase 2 — Codex P2 fix (PR #371)
      phoneExtension: true, // Phase 2
      // Phase 3 — 3 phone slots + primaryPhoneSlot
      phone2: true,
      phone2E164: true,
      phone2Type: true,
      phone2Extension: true,
      phone3: true,
      phone3E164: true,
      phone3Type: true,
      phone3Extension: true,
      primaryPhoneSlot: true,
      email: true,
      isActive: true,
      companyId: true,
      createdAt: true,
      // WR-A1
      customerType: true,
      legalName: true,
      registrationNo: true,
      taxOffice: true,
      // WR-A2 — tcknHash select edilmez; sadece tcknLast4 (mask için).
      tcknLast4: true,
      companies: {
        select: {
          id: true,
          companyId: true,
          status: true,
          externalCustomerCode: true,
          packageName: true,
          packageId: true,
          contractStartAt: true,
          contractEndAt: true,
          segment: true,
          notes: true,
          // WR-D4/D3 Phase 3 — customer response channel preferences.
          // Without these in the select the AccountCompanyEditor edit
          // form would load undefined values and round-trip them as
          // null/defaults on submit, silently resetting stored prefs.
          preferredResponseChannel: true,
          responseEmail: true,
          responsePhone: true,
          allowCustomerNotifications: true,
          company: {
            select: {
              name: true,
              settings: { select: { primaryColor: true } },
            },
          },
          // WR-A7b — Catalog Package reference (varsa).
          package: {
            select: {
              id: true,
              code: true,
              name: true,
              supportLevel: true,
              isActive: true,
            },
          },
          products: {
            select: {
              id: true,
              productId: true,
              productName: true,
              productCode: true,
              isActive: true,
              startedAt: true,
              endedAt: true,
              // WR-A8 — catalog snapshot for UI badges (supportLevel + group).
              product: {
                select: {
                  id: true,
                  isActive: true,
                  supportLevel: true,
                  productGroup: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: [{ isActive: 'desc' }, { productName: 'asc' }],
          },
          // WR-A4 — AccountCompany altındaki projeler.
          projects: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              isActive: true,
              startDate: true,
              endDate: true,
              description: true,
              // Faz B-temel — Ana firma referansı (nullable)
              anaFirmaAccountId: true,
              anaFirma: { select: { id: true, name: true } },
            },
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          },
        },
      },
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        select: {
          id: true,
          fullName: true,
          title: true,
          phone: true,
          phoneType: true,
          phoneExtension: true,
          email: true,
          isPrimary: true,
          isActive: true,
          preferredChannel: true,
        },
      },
      // WR-A3 / PM-02 — country-agnostic address book. Sadece izinli companyId
      // scope'undaki adresler dışarı sızar (filter aşağıda).
      addresses: {
        orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { type: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          companyId: true,
          type: true,
          label: true,
          line1: true,
          line2: true,
          district: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          isDefault: true,
          isActive: true,
        },
      },
    },
  });
  if (!account) return null;

  // Sadece izinli AccountCompany'ler dışarı sızar.
  const visibleCompanies = account.companies.filter((c) => allowed.includes(c.companyId));
  // WR-A3 — Aynı multi-tenant kuralı address'lere uygulanır.
  const visibleAddresses = (account.addresses ?? []).filter((a) => allowed.includes(a.companyId));

  // Case istatistikleri — yalnızca izinli şirketlerin vakaları + legacy null/scope.
  const caseScopeOr = [];
  if (allowed.length) caseScopeOr.push({ companyId: { in: allowed } });
  // Eğer kullanıcı legacy NULL account'a izinli (companyId NULL) ise vakaların da görünmesi gerekir;
  // ancak Case.companyId her zaman dolu, dolayısıyla NULL OR şartı eklenmez.
  const caseWhere =
    caseScopeOr.length === 0
      ? { accountId, id: { in: [] } } // zero-match
      : { accountId, AND: { OR: caseScopeOr } };

  const [caseStats, recentCases] = await prisma.$transaction([
    prisma.case.groupBy({
      by: ['status'],
      where: caseWhere,
      _count: { _all: true },
    }),
    prisma.case.findMany({
      where: caseWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        slaViolation: true,
      },
    }),
  ]);

  const openStatusSet = new Set(['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi']);
  const resolvedStatusSet = new Set(['Cozuldu', 'IptalEdildi']);
  let total = 0;
  let open = 0;
  let resolved = 0;
  for (const row of caseStats) {
    total += row._count._all;
    if (openStatusSet.has(row.status)) open += row._count._all;
    if (resolvedStatusSet.has(row.status)) resolved += row._count._all;
  }

  const slaBreachCount = await prisma.case.count({
    where: { ...caseWhere, slaViolation: true },
  });

  return {
    id: account.id,
    name: account.name,
    vknMasked: maskVkn(account.vkn),
    phone: account.phone ?? null,
    phoneE164: account.phoneE164 ?? null, // WR-A2
    phoneType: account.phoneType ?? null, // Phase 2
    phoneExtension: account.phoneExtension ?? null, // Phase 2
    // Phase 3 — slot 2/3 + primaryPhoneSlot
    phone2: account.phone2 ?? null,
    phone2E164: account.phone2E164 ?? null,
    phone2Type: account.phone2Type ?? null,
    phone2Extension: account.phone2Extension ?? null,
    phone3: account.phone3 ?? null,
    phone3E164: account.phone3E164 ?? null,
    phone3Type: account.phone3Type ?? null,
    phone3Extension: account.phone3Extension ?? null,
    primaryPhoneSlot: account.primaryPhoneSlot ?? null,
    email: account.email ?? null,
    isActive: account.isActive,
    createdAt: account.createdAt,
    // WR-A1 / PM-01 — Müşteri tipi + (opsiyonel) ticari unvan/sicil no.
    customerType: account.customerType,
    customerRole: account.customerRole ?? null, // Faz B-temel
    // WR-A2 — TCKN maskeli display only; tcknHash response'a girmez.
    tcknMasked: maskTcknLast4(account.tcknLast4),
    legalName: account.legalName ?? null,
    registrationNo: account.registrationNo ?? null,
    taxOffice: account.taxOffice ?? null,
    companies: visibleCompanies.map((c) => ({
      // Phase C1: PATCH/DELETE endpoint'leri için stable AccountCompany.id.
      accountCompanyId: c.id,
      companyId: c.companyId,
      companyName: c.company?.name ?? null,
      // Phase C2 polish: CompanySettings.primaryColor — SystemAdmin admin panelinden tanımlanır.
      companyColor: c.company?.settings?.primaryColor ?? null,
      status: c.status,
      externalCustomerCode: c.externalCustomerCode ?? null,
      packageName: c.packageName ?? null,
      packageId: c.packageId ?? null,
      // WR-A7b — Catalog package özet kartı (varsa). UI hem packageName (legacy free text)
      // hem package.name'i (catalog) gösterebilir.
      package: c.package
        ? {
            id: c.package.id,
            code: c.package.code,
            name: c.package.name,
            supportLevel: c.package.supportLevel,
            isActive: c.package.isActive,
          }
        : null,
      contractStartAt: c.contractStartAt,
      contractEndAt: c.contractEndAt,
      segment: c.segment ?? null,
      notes: c.notes ?? null,
      // WR-D4/D3 Phase 3 — surface customer response channel prefs to
      // AccountCompanyEditor so the form initializes with stored values
      // (and on save round-trips them rather than overwriting with
      // editor defaults).
      preferredResponseChannel: c.preferredResponseChannel ?? null,
      responseEmail: c.responseEmail ?? null,
      responsePhone: c.responsePhone ?? null,
      allowCustomerNotifications:
        typeof c.allowCustomerNotifications === 'boolean' ? c.allowCustomerNotifications : true,
      products: (c.products ?? []).map((p) => ({
        id: p.id,
        productId: p.productId ?? null,
        productCatalogActive: p.product ? p.product.isActive : null,
        productSupportLevel: p.product?.supportLevel ?? null,
        productGroupId: p.product?.productGroup?.id ?? null,
        productGroupName: p.product?.productGroup?.name ?? null,
        productName: p.productName,
        productCode: p.productCode ?? null,
        isActive: p.isActive,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
      })),
      // WR-A4 — AccountCompany altındaki projeler.
      projects: (c.projects ?? []).map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        isActive: p.isActive,
        startDate: p.startDate,
        endDate: p.endDate,
        description: p.description ?? null,
        // Faz B-temel — Ana firma (Merkez Müşteri) bağı
        anaFirmaAccountId: p.anaFirmaAccountId ?? null,
        anaFirmaName: p.anaFirma?.name ?? null,
      })),
    })),
    contacts: account.contacts,
    // WR-A3 / PM-02 — country-agnostic address list (scope-filtered).
    addresses: visibleAddresses.map((a) => ({
      id: a.id,
      companyId: a.companyId,
      type: a.type,
      label: a.label ?? null,
      line1: a.line1,
      line2: a.line2 ?? null,
      district: a.district ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      postalCode: a.postalCode ?? null,
      country: a.country,
      isDefault: a.isDefault,
      isActive: a.isActive,
    })),
    caseStats: { total, open, resolved, slaBreachCount },
    recentCases: recentCases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      title: c.title,
      status: c.status,
      priority: c.priority,
      createdAt: c.createdAt,
    })),
  };
}

const FIVE_DIGIT_RX = /^\d{5}$/;

/**
 * POST /api/accounts
 *
 * Body: { name, vkn?, phone?, email?, companies: [{ companyId, externalCustomerCode?, packageName?, contractStartAt? }] }
 *
 * Doğrulamalar:
 *  - name zorunlu
 *  - En az 1 company zorunlu
 *  - companyId allowedCompanyIds içinde olmalı (SystemAdmin dışında)
 *  - vkn benzersiz (409 — "Bu VKN ile kayıtlı müşteri var")
 *  - externalCustomerCode (varsa) tam 5 hane
 *  - (companyId, externalCustomerCode) benzersiz (409)
 *
 * Account.companyId legacy alanına ilk company yazılır (geri uyumluluk).
 */
export async function createAccount({ data, user }) {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (!name) throw new AccountValidationError('Müşteri adı zorunlu.');

  const companies = Array.isArray(data?.companies) ? data.companies : [];
  if (companies.length === 0) {
    throw new AccountValidationError('En az bir şirket ilişkisi zorunlu.');
  }

  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);

  for (const c of companies) {
    if (!c?.companyId || typeof c.companyId !== 'string') {
      throw new AccountValidationError('Her şirket için companyId zorunlu.');
    }
    if (!isSystemAdmin && !allowed.includes(c.companyId)) {
      throw new AccountValidationError(
        'Bu şirkete kullanıcı atayamazsınız.',
        { status: 403, code: 'forbidden' },
      );
    }
    if (c.externalCustomerCode != null && !FIVE_DIGIT_RX.test(c.externalCustomerCode)) {
      throw new AccountValidationError('Müşteri kodu tam 5 haneli rakam olmalı.');
    }
  }

  // WR-A2 — VKN format/checksum validation + duplicate check.
  let vkn = typeof data?.vkn === 'string' ? data.vkn.trim() || null : null;
  if (vkn) {
    const vknCheck = validateVkn(vkn);
    if (!vknCheck.ok) {
      throw new AccountValidationError(vknCheck.reason ?? 'VKN geçersiz.', {
        status: 400,
        code: 'invalid_vkn',
      });
    }
    vkn = vknCheck.normalized;
    const existing = await prisma.account.findUnique({ where: { vkn }, select: { id: true } });
    if (existing) {
      throw new AccountValidationError('Bu VKN ile kayıtlı müşteri var.', {
        status: 409,
        code: 'duplicate_vkn',
      });
    }
  }

  // (companyId, externalCustomerCode) çakışması — body içinde bile.
  const seenCodePerCompany = new Map();
  for (const c of companies) {
    if (!c.externalCustomerCode) continue;
    const key = `${c.companyId}:${c.externalCustomerCode}`;
    if (seenCodePerCompany.has(key)) {
      throw new AccountValidationError(
        'Aynı şirket için tekrarlanan müşteri kodu.',
        { status: 409, code: 'duplicate_external_code' },
      );
    }
    seenCodePerCompany.set(key, true);

    const dup = await prisma.accountCompany.findUnique({
      where: {
        companyId_externalCustomerCode: {
          companyId: c.companyId,
          externalCustomerCode: c.externalCustomerCode,
        },
      },
      select: { id: true },
    });
    if (dup) {
      throw new AccountValidationError(
        'Bu şirkette aynı müşteri kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_external_code' },
      );
    }
  }

  // WR-A1: customerType (default Corporate), legalName, registrationNo. TCKN burada YOK.
  const customerType = normalizeCustomerType(data?.customerType) ?? 'Corporate';
  // Faz B-temel — customerRole (Müşteri Türü, n4b parite). Nullable;
  // boş bırakılırsa default YOK (admin sonra doldurur). Throws if invalid.
  const customerRoleRaw = normalizeCustomerRole(data?.customerRole);
  const customerRole = customerRoleRaw === undefined ? null : customerRoleRaw;
  const legalName =
    typeof data?.legalName === 'string' && data.legalName.trim() ? data.legalName.trim() : null;
  const registrationNo =
    typeof data?.registrationNo === 'string' && data.registrationNo.trim()
      ? data.registrationNo.trim()
      : null;
  // Vergi Dairesi — descriptive metadata, opsiyonel.
  const taxOffice =
    typeof data?.taxOffice === 'string' && data.taxOffice.trim() ? data.taxOffice.trim() : null;

  // WR-A2 — Phone E.164 normalize (display + e164 ayrı saklanır).
  const phoneRaw = typeof data?.phone === 'string' && data.phone.trim() ? data.phone.trim() : null;
  const phoneE164 = phoneRaw ? normalizePhoneE164(phoneRaw) : null;
  const phoneType = normalizePhoneType(data?.phoneType) ?? null;
  const phoneExtension = normalizePhoneExtension(data?.phoneExtension) ?? null;

  // Phase 3 — slot 2 ve 3.
  const slot2 = normalizePhoneSlotInput(
    data?.phone2 !== undefined || data?.phone2Type !== undefined || data?.phone2Extension !== undefined
      ? { phone: data?.phone2, phoneType: data?.phone2Type, phoneExtension: data?.phone2Extension }
      : null,
  );
  const slot3 = normalizePhoneSlotInput(
    data?.phone3 !== undefined || data?.phone3Type !== undefined || data?.phone3Extension !== undefined
      ? { phone: data?.phone3, phoneType: data?.phone3Type, phoneExtension: data?.phone3Extension }
      : null,
  );

  // Birden fazla slotta aynı E.164 → soft duplicate; kabul edip warn
  // yerine error (data quality). UI tarafında submit öncesi check var.
  {
    const list = [phoneE164, slot2?.phoneE164 ?? null, slot3?.phoneE164 ?? null].filter(Boolean);
    if (new Set(list).size !== list.length) {
      throw new AccountValidationError('Aynı telefon numarası birden fazla slotta yer alıyor.');
    }
  }

  const slots = [
    { phoneE164 },
    { phoneE164: slot2?.phoneE164 ?? null },
    { phoneE164: slot3?.phoneE164 ?? null },
  ];
  let primaryPhoneSlot = normalizePrimaryPhoneSlot(data?.primaryPhoneSlot, slots);
  if (primaryPhoneSlot === undefined) {
    // Caller belirtmediyse ilk dolu slotu birincil yap.
    primaryPhoneSlot = firstNonEmptyPhoneSlot(slots);
  } else if (primaryPhoneSlot === null) {
    // Null kabul edildi; ilk dolu slotu birincil sayan UI'a güven.
    primaryPhoneSlot = firstNonEmptyPhoneSlot(slots);
  }

  // WR-A2 — TCKN: yalnızca Individual customerType için kabul edilir.
  // Plain TCKN ASLA DB'ye yazılmaz; HMAC hash + last4 hesaplanır, plain bellekte
  // bırakılıp atılır (variable scope sonrası GC).
  let tcknHash = null;
  let tcknLast4 = null;
  if (data?.tckn != null && data.tckn !== '') {
    if (customerType !== 'Individual') {
      throw new AccountValidationError(
        'TCKN yalnızca Bireysel müşteri tipi için verilebilir.',
        { status: 400, code: 'tckn_not_allowed_for_type' },
      );
    }
    try {
      const { hash, last4 } = hashTckn(data.tckn);
      tcknHash = hash;
      tcknLast4 = last4;
    } catch (err) {
      // pepper missing veya TCKN invalid → 400 ile yansıt
      throw new AccountValidationError(err.message ?? 'TCKN işlenemedi.', {
        status: err.status ?? 400,
        code: err.code ?? 'tckn_error',
      });
    }
  }

  // Atomik: Account + AccountCompany kayıtları aynı transaction.
  // Account.id yeni standart `cus_<22 char>` formatında üretilir;
  // legacy cuid'li mevcut kayıtlar dokunulmaz. Şema default'u cuid()
  // korunur — explicit `id` passed olduğundan default tetiklenmez.
  const newId = await generateUniqueAccountId();
  try {
    const created = await prisma.account.create({
      data: {
        id: newId,
        name,
        vkn,
        phone: phoneRaw,
        phoneE164,
        phoneType,
        phoneExtension,
        // Phase 3 — slot 2/3 + primary
        phone2: slot2?.phoneRaw ?? null,
        phone2E164: slot2?.phoneE164 ?? null,
        phone2Type: slot2?.phoneType ?? null,
        phone2Extension: slot2?.phoneExtension ?? null,
        phone3: slot3?.phoneRaw ?? null,
        phone3E164: slot3?.phoneE164 ?? null,
        phone3Type: slot3?.phoneType ?? null,
        phone3Extension: slot3?.phoneExtension ?? null,
        primaryPhoneSlot,
        email: data?.email ?? null,
        customerType,
        customerRole, // Faz B-temel — Müşteri Türü (rol); nullable
        legalName,
        registrationNo,
        taxOffice,
        tcknHash,
        tcknLast4,
        // Legacy: ilk company'i companyId'ye yaz — mevcut Case scope sorguları çalışsın.
        companyId: companies[0].companyId,
        companies: {
          create: companies.map((c) => ({
            companyId: c.companyId,
            externalCustomerCode: c.externalCustomerCode ?? null,
            packageName: c.packageName ?? null,
            contractStartAt: c.contractStartAt ? new Date(c.contractStartAt) : null,
            status: 'active',
          })),
        },
      },
      select: { id: true },
    });
    return getAccount(created.id, { allowedCompanyIds: allowed });
  } catch (err) {
    // Yarış koşulunda unique constraint Prisma error tarafından yakalanır.
    // MSSQL'de meta.target index adı / tablo adı döner — uniqueTargetHas üçünü de tanır.
    if (err?.code === 'P2002') {
      if (uniqueTargetHas(err, 'vkn')) {
        throw new AccountValidationError('Bu VKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_vkn',
        });
      }
      if (uniqueTargetHas(err, 'tcknHash')) {
        throw new AccountValidationError('Bu TCKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_tckn',
        });
      }
      if (uniqueTargetHas(err, 'externalCustomerCode', 'companyId', 'dbo.AccountCompany')) {
        throw new AccountValidationError(
          'Bu şirkette aynı müşteri kodu zaten kullanılıyor.',
          { status: 409, code: 'duplicate_external_code' },
        );
      }
    }
    throw err;
  }
}

/**
 * PATCH /api/accounts/:id — sadece Account fieldları (name, phone, email, isActive, vkn).
 * Company ilişkileri burada güncellenmez.
 */
export async function updateAccount({ accountId, data, user }) {
  const scope = await assertAccountInScope(accountId, user.allowedCompanyIds);
  if (!scope) return null;

  // Faz B-temel — CR karar #5: customerRole downgrade WARN guard.
  // Bir Account 'Central' (Merkez Müşteri) iken başka role indirilirse
  // bağlı AccountProject.anaFirmaAccountId kayıtları YETİM kalır
  // (Faz B bültenleri hatalı). Silent cascade-null YASAK; explicit onay
  // şart.
  //
  // Akış:
  //  1. Mevcut customerRole='Central' + patch farklı role çekiyor
  //  2. acknowledgedRoleDowngrade flag yoksa 409 atar +
  //     impact.boundProjectCount frontend'e döner
  //  3. Frontend modal: "Bu account 3 projenin ana firması; rol değişiyor →
  //     o projelerin ana firması NULL olur. Onaylıyor musun?"
  //  4. Onay → tekrar PATCH acknowledgedRoleDowngrade=true ile
  //     Repo TRANSACTION içinde:
  //       a. AccountProject.updateMany({anaFirmaAccountId:accountId} → null)
  //       b. Account.update(patch)
  //     Atomik; UI wording ("bağı kopar") garanti edilir.
  //
  // Codex P2 round 2 fix: önceden NULL'lama yapılmıyordu → mevcut bağlar
  // KALIYORDU + raporlar ana_firma_not_central rolündeki account'a referans
  // veriyordu. Şimdi transaction'da düzeltildi.
  let isCentralDowngrade = false;
  if (data?.customerRole !== undefined && data.customerRole !== 'CLEAR') {
    const cr = normalizeCustomerRole(data.customerRole);
    if (cr !== undefined && cr !== null) {
      const current = await prisma.account.findUnique({
        where: { id: accountId },
        select: { customerRole: true },
      });
      if (current?.customerRole === 'Central' && cr !== 'Central') {
        const boundProjectCount = await prisma.accountProject.count({
          where: { anaFirmaAccountId: accountId },
        });
        if (boundProjectCount > 0 && !data?.acknowledgedRoleDowngrade) {
          throw new AccountValidationError(
            `Bu müşteri ${boundProjectCount} projenin ana firmasıdır. Rolü değiştirirseniz o projelerin ana firma bağı kopar (NULL olur). Onaylıyor musunuz?`,
            {
              status: 409,
              code: 'customer_role_downgrade_requires_ack',
              impact: { boundProjectCount },
            },
          );
        }
        // Onay verildi VEYA bağlı proje yok — her halükarda transaction'da
        // bağlar NULL'lanır (idempotent — boş query no-op).
        isCentralDowngrade = true;
      }
    }
  }
  // Aynı kontrol explicit clear (CLEAR sentinel) için de geçerli — Central
  // → null da downgrade.
  if (data?.customerRole === 'CLEAR') {
    const current = await prisma.account.findUnique({
      where: { id: accountId },
      select: { customerRole: true },
    });
    if (current?.customerRole === 'Central') {
      const boundProjectCount = await prisma.accountProject.count({
        where: { anaFirmaAccountId: accountId },
      });
      if (boundProjectCount > 0 && !data?.acknowledgedRoleDowngrade) {
        throw new AccountValidationError(
          `Bu müşteri ${boundProjectCount} projenin ana firmasıdır. Rolü temizlerseniz o projelerin ana firma bağı kopar (NULL olur). Onaylıyor musunuz?`,
          {
            status: 409,
            code: 'customer_role_downgrade_requires_ack',
            impact: { boundProjectCount },
          },
        );
      }
      isCentralDowngrade = true;
    }
  }

  const patch = {};
  if (typeof data?.name === 'string') {
    const trimmed = data.name.trim();
    if (!trimmed) throw new AccountValidationError('Müşteri adı boş olamaz.');
    patch.name = trimmed;
  }
  // WR-A2 — Phone update: display + phoneE164 birlikte güncelle (atomic pair).
  if (data?.phone !== undefined) {
    const newPhone = data.phone || null;
    patch.phone = newPhone;
    patch.phoneE164 = newPhone ? normalizePhoneE164(newPhone) : null;
  }
  // Phase 2 phone metadata
  if (data?.phoneType !== undefined) patch.phoneType = normalizePhoneType(data.phoneType);
  if (data?.phoneExtension !== undefined) patch.phoneExtension = normalizePhoneExtension(data.phoneExtension);

  // Phase 3 — slot 2 ve 3 + primaryPhoneSlot.
  // Slot fields atomik pair olarak yazılır: phone+E164+type+extension. Yalnız
  // herhangi bir slot alanı body'de geliyorsa o slot'un atomic update'i
  // yapılır. Slot boş gönderilirse 4 alanı null'a düşer.
  function patchSlot(slotIdx, slotKeys) {
    const anyProvided = slotKeys.some((k) => data?.[k] !== undefined);
    if (!anyProvided) return null;
    const norm = normalizePhoneSlotInput({
      phone: data[slotKeys[0]],
      phoneType: data[slotKeys[2]],
      phoneExtension: data[slotKeys[3]],
    });
    patch[slotKeys[0]] = norm.phoneRaw;
    patch[slotKeys[1]] = norm.phoneE164;
    patch[slotKeys[2]] = norm.phoneType;
    patch[slotKeys[3]] = norm.phoneExtension;
    return norm.phoneE164;
  }
  const slot2NewE164 = patchSlot(2, ['phone2', 'phone2E164', 'phone2Type', 'phone2Extension']);
  const slot3NewE164 = patchSlot(3, ['phone3', 'phone3E164', 'phone3Type', 'phone3Extension']);

  // Cross-slot duplicate check (data quality).
  {
    // Effective post-patch values
    const effSlot1 = patch.phoneE164 !== undefined ? patch.phoneE164 : undefined;
    const effSlot2 = slot2NewE164;
    const effSlot3 = slot3NewE164;
    const sample = [effSlot1, effSlot2, effSlot3].filter((v) => typeof v === 'string' && v);
    if (sample.length > 0 && new Set(sample).size !== sample.length) {
      throw new AccountValidationError('Aynı telefon numarası birden fazla slotta yer alıyor.');
    }
  }

  // primaryPhoneSlot — geçerli iken assign; null/missing → ileride
  // post-update finalize'da default'lanır (DB read sonrası).
  if (data?.primaryPhoneSlot !== undefined) {
    if (data.primaryPhoneSlot === null) {
      patch.primaryPhoneSlot = null;
    } else {
      const n = typeof data.primaryPhoneSlot === 'string' ? Number.parseInt(data.primaryPhoneSlot, 10) : data.primaryPhoneSlot;
      if (n !== 1 && n !== 2 && n !== 3) {
        throw new AccountValidationError('Birincil telefon slot 1, 2 veya 3 olmalı.');
      }
      patch.primaryPhoneSlot = n;
    }
  }

  if (data?.email !== undefined) patch.email = data.email || null;
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive;

  if (data?.vkn !== undefined) {
    let newVkn = typeof data.vkn === 'string' ? data.vkn.trim() || null : null;
    if (newVkn) {
      // WR-A2 — VKN format/checksum validation.
      const vknCheck = validateVkn(newVkn);
      if (!vknCheck.ok) {
        throw new AccountValidationError(vknCheck.reason ?? 'VKN geçersiz.', {
          status: 400,
          code: 'invalid_vkn',
        });
      }
      newVkn = vknCheck.normalized;
      const conflict = await prisma.account.findFirst({
        where: { vkn: newVkn, NOT: { id: accountId } },
        select: { id: true },
      });
      if (conflict) {
        throw new AccountValidationError('Bu VKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_vkn',
        });
      }
    }
    patch.vkn = newVkn;
  }

  // WR-A1: customerType / legalName / registrationNo PATCH. TCKN ayrı (aşağıda).
  if (data?.customerType !== undefined) {
    const ct = normalizeCustomerType(data.customerType);
    if (ct) patch.customerType = ct;
  }
  // Faz B-temel — customerRole (Müşteri Türü) PATCH.
  // CR karar #5: Bir Central account başka role indirilirse → bağlı proje
  // sayısını göster + EXPLICIT ONAY iste. Silent cascade-null YASAK.
  //
  // Bu repo katmanında SADECE alanı patch'le. Onay/WARN kontrolü çağıran
  // route layer'da (PATCH /accounts/:id endpoint'i + frontend modal) +
  // ekstra helper `getCustomerRoleChangeImpact` (aşağıda) yapılır.
  //
  // Burada defansif kontrol: eğer patch'te customerRole'ü Central'dan
  // başka değere değiştiriyor + acknowledgedRoleDowngrade flag YOK ise
  // 409 atar. Frontend bilerek geçer.
  if (data?.customerRole !== undefined) {
    const cr = normalizeCustomerRole(data.customerRole);
    if (cr === null) {
      // Explicit clear (CLEAR sentinel)
      patch.customerRole = null;
    } else if (cr !== undefined) {
      patch.customerRole = cr;
    }
  }
  if (data?.legalName !== undefined) {
    patch.legalName =
      typeof data.legalName === 'string' && data.legalName.trim() ? data.legalName.trim() : null;
  }
  if (data?.registrationNo !== undefined) {
    patch.registrationNo =
      typeof data.registrationNo === 'string' && data.registrationNo.trim()
        ? data.registrationNo.trim()
        : null;
  }
  if (data?.taxOffice !== undefined) {
    patch.taxOffice =
      typeof data.taxOffice === 'string' && data.taxOffice.trim() ? data.taxOffice.trim() : null;
  }

  // Codex P2 defensive cleanup — Account Individual'a geçerken kurumsal-
  // only descriptive metadata (taxOffice) DB'de kalmasın. UI form bunu
  // body'de null gönderiyor; backend ek savunma katmanı: patch'te
  // customerType=Individual ise taxOffice null'a düşürülür (caller boş
  // bıraksa bile).
  if (patch.customerType === 'Individual' && !Object.prototype.hasOwnProperty.call(patch, 'taxOffice')) {
    patch.taxOffice = null;
  }

  // WR-A2 — TCKN update: yalnızca Individual customerType. Plain TCKN saklanmaz.
  // null/'' → clear; valid TCKN → re-hash; invalid → 400.
  if (data?.tckn !== undefined) {
    // customerType final değerini bilmemiz lazım (patch'te değişiyor olabilir).
    const targetCustomerType =
      patch.customerType ??
      (await prisma.account.findUnique({ where: { id: accountId }, select: { customerType: true } }))?.customerType;
    if (data.tckn === null || data.tckn === '') {
      patch.tcknHash = null;
      patch.tcknLast4 = null;
    } else {
      if (targetCustomerType !== 'Individual') {
        throw new AccountValidationError(
          'TCKN yalnızca Bireysel müşteri tipi için verilebilir.',
          { status: 400, code: 'tckn_not_allowed_for_type' },
        );
      }
      try {
        const { hash, last4 } = hashTckn(data.tckn);
        patch.tcknHash = hash;
        patch.tcknLast4 = last4;
      } catch (err) {
        throw new AccountValidationError(err.message ?? 'TCKN işlenemedi.', {
          status: err.status ?? 400,
          code: err.code ?? 'tckn_error',
        });
      }
    }
  }

  // Phase 3 — primaryPhoneSlot finalize. Phone slot'larından herhangi
  // biri değiştiyse veya primaryPhoneSlot explicit verildiyse: post-
  // patch effective state'i hesapla; primary kuralları:
  //   - explicit primary ve hedef slot boş → fallback to first non-empty
  //   - null primary ve dolu slot var → first non-empty
  //   - explicit primary geçerli → değiştirme
  const touchesPhones =
    Object.prototype.hasOwnProperty.call(patch, 'phoneE164') ||
    Object.prototype.hasOwnProperty.call(patch, 'phone2E164') ||
    Object.prototype.hasOwnProperty.call(patch, 'phone3E164') ||
    Object.prototype.hasOwnProperty.call(patch, 'primaryPhoneSlot');
  if (touchesPhones) {
    const current = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        phoneE164: true,
        phone2E164: true,
        phone3E164: true,
        primaryPhoneSlot: true,
      },
    });
    const eff1 = Object.prototype.hasOwnProperty.call(patch, 'phoneE164') ? patch.phoneE164 : current?.phoneE164 ?? null;
    const eff2 = Object.prototype.hasOwnProperty.call(patch, 'phone2E164') ? patch.phone2E164 : current?.phone2E164 ?? null;
    const eff3 = Object.prototype.hasOwnProperty.call(patch, 'phone3E164') ? patch.phone3E164 : current?.phone3E164 ?? null;
    // Codex P2 — effective cross-slot duplicate check. Tek slot PATCH'inde
    // diğer slot'lar body'de undefined olduğu için yukarıdaki erken check
    // bunları kaçırır; burada DB'den okunan mevcut değerlerle birleşik
    // sample yapılır.
    {
      const effSample = [eff1, eff2, eff3].filter((v) => typeof v === 'string' && v);
      if (effSample.length > 0 && new Set(effSample).size !== effSample.length) {
        throw new AccountValidationError('Aynı telefon numarası birden fazla slotta yer alıyor.');
      }
    }
    const slots = [{ phoneE164: eff1 }, { phoneE164: eff2 }, { phoneE164: eff3 }];
    const effPrimary = Object.prototype.hasOwnProperty.call(patch, 'primaryPhoneSlot')
      ? patch.primaryPhoneSlot
      : current?.primaryPhoneSlot ?? null;
    if (effPrimary !== null && effPrimary !== undefined) {
      const target = slots[effPrimary - 1];
      if (!target || !target.phoneE164) {
        // primary yapılan slot boşaldı → fallback
        patch.primaryPhoneSlot = firstNonEmptyPhoneSlot(slots);
      }
    } else {
      patch.primaryPhoneSlot = firstNonEmptyPhoneSlot(slots);
    }
  }

  if (Object.keys(patch).length === 0) {
    return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
  }

  try {
    if (isCentralDowngrade) {
      // Faz B-temel — Codex P2 round 2 fix: Central downgrade onaylanmış;
      // bağlı AccountProject.anaFirmaAccountId kayıtları NULL'la +
      // Account.update atomik. updateMany boş set ise no-op (idempotent).
      await prisma.$transaction([
        prisma.accountProject.updateMany({
          where: { anaFirmaAccountId: accountId },
          data: { anaFirmaAccountId: null },
        }),
        prisma.account.update({ where: { id: accountId }, data: patch }),
      ]);
    } else {
      await prisma.account.update({ where: { id: accountId }, data: patch });
    }
  } catch (err) {
    if (err?.code === 'P2002') {
      if (uniqueTargetHas(err, 'tcknHash')) {
        throw new AccountValidationError('Bu TCKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_tckn',
        });
      }
      throw new AccountValidationError('Bu VKN ile kayıtlı müşteri var.', {
        status: 409,
        code: 'duplicate_vkn',
      });
    }
    throw err;
  }

  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/* ---------- AccountCompany CRUD ---------- */

const VALID_STATUSES = new Set(['active', 'churn', 'prospect', 'inactive']);

/**
 * AccountCompany üzerinde mutasyon yapmadan önce çağrılır.
 * - Account izinli mi
 * - Hedef AccountCompany bu Account'a mı bağlı
 * - Hedef AccountCompany.companyId kullanıcının yazma kapsamında mı
 *   (SystemAdmin tüm şirketler, diğerleri yalnız allowedCompanyIds)
 */
async function loadEditableAccountCompany({ accountId, accountCompanyId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const row = await prisma.accountCompany.findUnique({
    where: { id: accountCompanyId },
    select: { id: true, accountId: true, companyId: true },
  });
  if (!row || row.accountId !== accountId) {
    return null; // 404
  }
  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(row.companyId)) {
    throw new AccountAccessError('Bu şirket ilişkisini düzenleme yetkin yok.');
  }
  return row;
}

/**
 * POST /api/accounts/:id/companies
 *
 * Body: { companyId, externalCustomerCode?, packageName?, packageId?,
 *         contractStartAt?, contractEndAt?, segment?, status?, notes? }
 *
 * Doğrulamalar:
 *  - companyId zorunlu, izinli (SystemAdmin hariç)
 *  - externalCustomerCode (varsa) tam 5 hane
 *  - status (varsa) VALID_STATUSES içinde
 *  - (accountId, companyId) ikilisi zaten varsa 409
 *  - (companyId, externalCustomerCode) çakışırsa 409
 *  - WR-A7b / DI.1: packageId (varsa) aynı şirkete ait olmalı
 */
/**
 * WR-D4/D3 Phase 3 — Shared normalizer for AccountCompany customer
 * response channel preferences. Used by both addCompanyRelation (create)
 * and updateCompanyRelation (update).
 *
 * Modes:
 *  - mode='create': returns the FULL prefs object suitable for prisma.create
 *    `data:`. Missing fields fall back to safe defaults so an admin who
 *    creates an AC relation without touching the prefs panel still gets
 *    explicit values (allowCustomerNotifications defaults to true via
 *    schema; here we leave it undefined so Prisma's @default(true) wins
 *    when not provided).
 *  - mode='update': returns ONLY the fields actually present in `data`
 *    (so absent fields stay untouched — critical for the "edit unrelated
 *    field shouldn't reset prefs" invariant).
 *
 * Whitelisting of the channel value (email/phone/manual/portal/...) is
 * deliberately deferred to the channel resolver in
 * notificationRepository so adding a future channel does not require
 * changing this function.
 */
function normalizeAccountCompanyCommPrefs(data, { mode }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(data ?? {}, k);

  if (has('preferredResponseChannel')) {
    const v = data.preferredResponseChannel;
    out.preferredResponseChannel = v == null || v === '' ? null : String(v).toLowerCase();
  } else if (mode === 'create') {
    out.preferredResponseChannel = null;
  }

  if (has('responseEmail')) {
    const v = data.responseEmail;
    out.responseEmail = v == null || v === '' ? null : String(v).trim();
  } else if (mode === 'create') {
    out.responseEmail = null;
  }

  if (has('responsePhone')) {
    const v = data.responsePhone;
    out.responsePhone = v == null || v === '' ? null : String(v).trim();
  } else if (mode === 'create') {
    out.responsePhone = null;
  }

  if (has('allowCustomerNotifications')) {
    out.allowCustomerNotifications = !!data.allowCustomerNotifications;
  }
  // create mode intentionally omits allowCustomerNotifications when absent
  // so the schema @default(true) applies.

  return out;
}

export async function addCompanyRelation({ accountId, data, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);

  const companyId = typeof data?.companyId === 'string' ? data.companyId : '';
  if (!companyId) throw new AccountValidationError('companyId zorunlu.');

  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(companyId)) {
    throw new AccountValidationError('Bu şirkete ilişki ekleyemezsin.', {
      status: 403,
      code: 'forbidden',
    });
  }

  const externalCustomerCode =
    data?.externalCustomerCode != null && data.externalCustomerCode !== ''
      ? String(data.externalCustomerCode)
      : null;
  if (externalCustomerCode && !FIVE_DIGIT_RX.test(externalCustomerCode)) {
    throw new AccountValidationError('Müşteri kodu tam 5 haneli rakam olmalı.');
  }

  const status = data?.status ?? 'active';
  if (!VALID_STATUSES.has(status)) {
    throw new AccountValidationError('Geçersiz status.');
  }

  const packageId =
    data?.packageId != null && data.packageId !== '' ? String(data.packageId) : null;
  if (packageId) {
    await assertPackageInCompany({ packageId, companyId });
  }

  // WR-D4/D3 Phase 3 — review fix P1#1: persist customer response channel
  // preferences at create time. AccountCompanyEditor sends these fields
  // in both create and update flows; previously create silently dropped
  // them and the freshly-created row always loaded with default prefs.
  const commPrefs = normalizeAccountCompanyCommPrefs(data ?? {}, { mode: 'create' });

  try {
    await prisma.accountCompany.create({
      data: {
        accountId,
        companyId,
        externalCustomerCode,
        packageName: data?.packageName ?? null,
        packageId,
        contractStartAt: data?.contractStartAt ? new Date(data.contractStartAt) : null,
        contractEndAt: data?.contractEndAt ? new Date(data.contractEndAt) : null,
        segment: data?.segment ?? null,
        notes: data?.notes ?? null,
        status,
        ...commPrefs,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      if (uniqueTargetHas(err, 'externalCustomerCode')) {
        throw new AccountValidationError(
          'Bu şirkette aynı müşteri kodu zaten kullanılıyor.',
          { status: 409, code: 'duplicate_external_code' },
        );
      }
      // MSSQL 2627: plain unique constraint için target='dbo.AccountCompany'
      // (kolon bilgisi yok) — bu tabloda kalan tek plain unique relation'dır.
      if (
        (uniqueTargetHas(err, 'accountId') && uniqueTargetHas(err, 'companyId')) ||
        uniqueTargetHas(err, 'dbo.AccountCompany')
      ) {
        throw new AccountValidationError('Bu müşteri zaten bu şirkete bağlı.', {
          status: 409,
          code: 'duplicate_relation',
        });
      }
    }
    throw err;
  }
  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/**
 * PATCH /api/accounts/:id/companies/:accountCompanyId
 *
 * Düzenlenebilir alanlar: externalCustomerCode, packageName, packageId,
 * contractStartAt, contractEndAt, segment, status, notes. companyId
 * DEĞIŞTIRILEMEZ (taşıma istenirse ayrı endpoint gerekir).
 *
 * WR-A7b — packageId set/update: package.companyId === AccountCompany.companyId.
 * packageId clear (null/''): packageName SILINMEZ (D-A7BI.1; snapshot olarak korunur).
 */
export async function updateCompanyRelation({ accountId, accountCompanyId, data, user }) {
  const row = await loadEditableAccountCompany({ accountId, accountCompanyId, user });
  if (!row) return null;

  const patch = {};

  if (data?.externalCustomerCode !== undefined) {
    const code =
      data.externalCustomerCode == null || data.externalCustomerCode === ''
        ? null
        : String(data.externalCustomerCode);
    if (code && !FIVE_DIGIT_RX.test(code)) {
      throw new AccountValidationError('Müşteri kodu tam 5 haneli rakam olmalı.');
    }
    patch.externalCustomerCode = code;
  }
  if (data?.packageName !== undefined) patch.packageName = data.packageName || null;
  if (data?.packageId !== undefined) {
    const nextPackageId =
      data.packageId == null || data.packageId === '' ? null : String(data.packageId);
    if (nextPackageId) {
      await assertPackageInCompany({ packageId: nextPackageId, companyId: row.companyId });
    }
    patch.packageId = nextPackageId;
    // D-A7BI.1 — packageId null'a düşürülse de packageName silinmez.
  }
  if (data?.contractStartAt !== undefined) {
    patch.contractStartAt = data.contractStartAt ? new Date(data.contractStartAt) : null;
  }
  if (data?.contractEndAt !== undefined) {
    patch.contractEndAt = data.contractEndAt ? new Date(data.contractEndAt) : null;
  }
  if (data?.segment !== undefined) patch.segment = data.segment || null;
  if (data?.notes !== undefined) patch.notes = data.notes || null;
  if (data?.status !== undefined) {
    if (!VALID_STATUSES.has(data.status)) {
      throw new AccountValidationError('Geçersiz status.');
    }
    patch.status = data.status;
  }

  // WR-D4/D3 Phase 3 — customer response channel preferences.
  // Shared normalizer (mode='update' = only-present-keys) preserves
  // unspecified fields. Editing an unrelated AccountCompany field MUST
  // NOT reset stored prefs.
  Object.assign(patch, normalizeAccountCompanyCommPrefs(data ?? {}, { mode: 'update' }));

  if (Object.keys(patch).length === 0) {
    return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
  }

  try {
    await prisma.accountCompany.update({ where: { id: accountCompanyId }, data: patch });
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AccountValidationError(
        'Bu şirkette aynı müşteri kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_external_code' },
      );
    }
    throw err;
  }
  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/**
 * DELETE /api/accounts/:id/companies/:accountCompanyId
 *
 * Hard delete — AccountCompany ile bağlantılı vaka VARSA bile kaldırılır;
 * Case.companyId/accountId Case'in kendi alanları, AccountCompany FK değil.
 * Vaka tarihçesi korunur. Sadece müşteri-şirket ilişkisi koparılır.
 *
 * Tek kalan ilişkiyse Account "shared" duruma düşer (Account.companyId hala
 * legacy olarak doluysa orada kalır). Account'u toptan silmek için ayrı
 * endpoint gerekir (Phase D).
 */
export async function removeCompanyRelation({ accountId, accountCompanyId, user }) {
  const row = await loadEditableAccountCompany({ accountId, accountCompanyId, user });
  if (!row) return null;
  await prisma.accountCompany.delete({ where: { id: accountCompanyId } });
  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/* ---------- AccountContact CRUD ---------- */

const VALID_CHANNELS = new Set(['email', 'phone', 'whatsapp']);

function normalizeContactChannel(channel) {
  if (channel === undefined) return undefined;
  if (channel === null || channel === '') return null;
  const lower = String(channel).toLowerCase();
  if (!VALID_CHANNELS.has(lower)) {
    throw new AccountValidationError('Geçersiz tercih kanalı.');
  }
  return lower;
}

// Phase 2 phone metadata — geçerli telefon tipi + dahili numara normalize.
const VALID_PHONE_TYPES = new Set(['mobile', 'work', 'switchboard', 'whatsapp', 'other']);

function normalizePhoneType(input) {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  const lower = String(input).trim().toLowerCase();
  if (!VALID_PHONE_TYPES.has(lower)) {
    throw new AccountValidationError('Geçersiz telefon tipi.');
  }
  return lower;
}

function normalizePhoneExtension(input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;
  // 1-10 karakter, alfa-numerik + dash.
  if (!/^[A-Za-z0-9-]{1,10}$/.test(trimmed)) {
    throw new AccountValidationError('Dahili numara 1-10 karakter alfa-numerik olmalı.');
  }
  return trimmed;
}

// Phase 3 — 3 slot için tek-yer normalize. Slot 1 (phone/phoneE164/...
// /phoneType/phoneExtension), 2 (phone2/...), 3 (phone3/...). Input
// slot fields'ı: { phone, phoneType, phoneExtension }. Çıktı: yazılacak
// kolonların map'i (boş ise null'a düşer; type/extension phone yoksa
// kullanıcı vermediyse null'a normalize).
function normalizePhoneSlotInput(slot) {
  if (slot === undefined) return undefined;
  if (slot === null) {
    return { phoneRaw: null, phoneE164: null, phoneType: null, phoneExtension: null };
  }
  const rawIn = slot.phone;
  const phoneRaw = typeof rawIn === 'string' && rawIn.trim() ? rawIn.trim() : null;
  const phoneE164 = phoneRaw ? normalizePhoneE164(phoneRaw) : null;
  // type & extension yalnız phone dolu iken anlamlı; phone null ise
  // metadata da sıfırlanır.
  let phoneType = null;
  let phoneExtension = null;
  if (phoneRaw) {
    phoneType = normalizePhoneType(slot.phoneType) ?? null;
    phoneExtension = normalizePhoneExtension(slot.phoneExtension) ?? null;
  }
  return { phoneRaw, phoneE164, phoneType, phoneExtension };
}

// Phase 3 — primaryPhoneSlot normalize.
//  - undefined  → caller defaultlamaz, iz bırakma
//  - null       → primaryPhoneSlot=null (UI ilk dolu slotu birincil kabul)
//  - 1/2/3      → o slotun dolu olduğunu doğrula; aksi halde fail
//  - başka      → fail
function normalizePrimaryPhoneSlot(input, slots) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const n = typeof input === 'string' ? Number.parseInt(input, 10) : input;
  if (n !== 1 && n !== 2 && n !== 3) {
    throw new AccountValidationError('Birincil telefon slot 1, 2 veya 3 olmalı.');
  }
  const target = slots[n - 1];
  if (!target || !target.phoneE164) {
    throw new AccountValidationError('Birincil olarak işaretlenen telefon slotu boş.');
  }
  return n;
}

// Boş olmayan ilk slotu döner (1/2/3). Hiçbiri yoksa null.
function firstNonEmptyPhoneSlot(slots) {
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]?.phoneE164) return i + 1;
  }
  return null;
}

async function loadEditableContact({ accountId, contactId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const row = await prisma.accountContact.findUnique({
    where: { id: contactId },
    select: { id: true, accountId: true, isPrimary: true, isActive: true },
  });
  if (!row || row.accountId !== accountId) return null;
  return row;
}

/**
 * POST /api/accounts/:id/contacts
 *
 * Body: { fullName, title?, email?, phone?, isPrimary?, preferredChannel? }
 *
 * isPrimary=true verilirse aynı account'taki diğer kontaklardaki primary
 * flag'i kapatır (transaction içinde).
 */
export async function addContact({ accountId, data, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);

  const fullName = typeof data?.fullName === 'string' ? data.fullName.trim() : '';
  if (!fullName) throw new AccountValidationError('Ad Soyad zorunlu.');

  const preferredChannel = normalizeContactChannel(data?.preferredChannel);
  const phoneType = normalizePhoneType(data?.phoneType);
  const phoneExtension = normalizePhoneExtension(data?.phoneExtension);

  const wantPrimary = !!data?.isPrimary;
  await prisma.$transaction(async (tx) => {
    if (wantPrimary) {
      await tx.accountContact.updateMany({
        where: { accountId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    await tx.accountContact.create({
      data: {
        accountId,
        fullName,
        title: data?.title || null,
        email: data?.email || null,
        phone: data?.phone || null,
        phoneType: phoneType ?? null,
        phoneExtension: phoneExtension ?? null,
        isPrimary: wantPrimary,
        isActive: data?.isActive === undefined ? true : !!data.isActive,
        preferredChannel: preferredChannel ?? null,
      },
    });
  });

  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/**
 * PATCH /api/accounts/:id/contacts/:contactId
 *
 * Güncellenebilir: fullName, title, email, phone, isPrimary, isActive,
 * preferredChannel. isPrimary=true verilirse diğer primary'ler düşer.
 */
export async function updateContact({ accountId, contactId, data, user }) {
  const row = await loadEditableContact({ accountId, contactId, user });
  if (!row) return null;

  const patch = {};
  if (data?.fullName !== undefined) {
    const trimmed = String(data.fullName).trim();
    if (!trimmed) throw new AccountValidationError('Ad Soyad boş olamaz.');
    patch.fullName = trimmed;
  }
  if (data?.title !== undefined) patch.title = data.title || null;
  if (data?.email !== undefined) patch.email = data.email || null;
  if (data?.phone !== undefined) patch.phone = data.phone || null;
  if (data?.phoneType !== undefined) patch.phoneType = normalizePhoneType(data.phoneType);
  if (data?.phoneExtension !== undefined) patch.phoneExtension = normalizePhoneExtension(data.phoneExtension);
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive;
  if (data?.preferredChannel !== undefined) {
    patch.preferredChannel = normalizeContactChannel(data.preferredChannel);
  }

  const wantPrimary = data?.isPrimary;
  await prisma.$transaction(async (tx) => {
    if (wantPrimary === true && !row.isPrimary) {
      await tx.accountContact.updateMany({
        where: { accountId, isPrimary: true, NOT: { id: contactId } },
        data: { isPrimary: false },
      });
      patch.isPrimary = true;
    } else if (wantPrimary === false && row.isPrimary) {
      patch.isPrimary = false;
    }
    if (Object.keys(patch).length === 0) return;
    await tx.accountContact.update({ where: { id: contactId }, data: patch });
  });

  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/**
 * DELETE /api/accounts/:id/contacts/:contactId
 *
 * Soft delete (isActive=false). isPrimary ise primary flag'i de düşer
 * — başka contact'a otomatik primary atanmaz; bilinçli karar.
 */
export async function removeContact({ accountId, contactId, user }) {
  const row = await loadEditableContact({ accountId, contactId, user });
  if (!row) return null;
  await prisma.accountContact.update({
    where: { id: contactId },
    data: { isActive: false, isPrimary: false },
  });
  return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
}

/* ---------- AccountProduct CRUD (Phase C2) ---------- */

/**
 * Bir AccountProduct'a yazma yetkisi: ürünün bağlı olduğu AccountCompany'nin
 * companyId'si kullanıcının yazma kapsamında olmalı (SystemAdmin hepsi).
 */
async function loadEditableProduct({ accountId, productId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const product = await prisma.accountProduct.findUnique({
    where: { id: productId },
    select: {
      id: true,
      accountCompanyId: true,
      accountCompany: { select: { accountId: true, companyId: true } },
    },
  });
  if (!product || product.accountCompany.accountId !== accountId) return null;
  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(product.accountCompany.companyId)) {
    throw new AccountAccessError('Bu ürünü düzenleme yetkin yok.');
  }
  return product;
}

/**
 * GET /api/accounts/:id/products?companyId=...
 *
 * AccountCompany izinli olanlardan ürünleri listeler. companyId verilirse
 * yalnız o şirketin AccountCompany'sindeki ürünler. Aksi halde izinli
 * tüm şirketlerdeki ürünler.
 */
export async function listProducts({ accountId, companyId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const allowed = ensureArray(user.allowedCompanyIds);
  const isSystemAdmin = user.role === 'SystemAdmin';

  const accountCompanyWhere = {
    accountId,
    ...(isSystemAdmin ? {} : { companyId: { in: allowed } }),
    ...(companyId ? { companyId } : {}),
  };

  if (companyId && !isSystemAdmin && !allowed.includes(companyId)) {
    return { products: [] };
  }

  const rows = await prisma.accountProduct.findMany({
    where: { accountCompany: accountCompanyWhere },
    orderBy: [{ isActive: 'desc' }, { productName: 'asc' }],
    select: {
      id: true,
      accountCompanyId: true,
      productId: true,
      productName: true,
      productCode: true,
      isActive: true,
      startedAt: true,
      endedAt: true,
      accountCompany: { select: { companyId: true, company: { select: { name: true } } } },
      // WR-A8 — catalog snapshot fields for UI display (supportLevel + group name).
      // Legacy rows (productId=null) keep ProductGroup-less display.
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          supportLevel: true,
          productGroup: { select: { id: true, name: true } },
        },
      },
    },
  });

  return {
    products: rows.map((p) => ({
      id: p.id,
      accountCompanyId: p.accountCompanyId,
      companyId: p.accountCompany.companyId,
      companyName: p.accountCompany.company?.name ?? null,
      // WR-A8 — Catalog linkage. Null for legacy rows.
      productId: p.productId ?? null,
      productCatalogActive: p.product ? p.product.isActive : null,
      productSupportLevel: p.product?.supportLevel ?? null,
      productGroupId: p.product?.productGroup?.id ?? null,
      productGroupName: p.product?.productGroup?.name ?? null,
      productName: p.productName,
      productCode: p.productCode ?? null,
      isActive: p.isActive,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
    })),
  };
}

/**
 * WR-A8 — Validate that a Product catalog row belongs to the given
 * companyId (the AccountCompany's company). Returns the product or
 * throws AccountValidationError with code='product_company_mismatch'
 * / 'product_not_found' / 'product_inactive'.
 *
 * @param {string} productId
 * @param {string} expectedCompanyId  AccountCompany.companyId
 */
async function assertProductInCompany(productId, expectedCompanyId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, companyId: true, code: true, name: true, isActive: true },
  });
  if (!product) {
    throw new AccountValidationError('Ürün bulunamadı.', { status: 404, code: 'product_not_found' });
  }
  if (product.companyId !== expectedCompanyId) {
    throw new AccountValidationError(
      'Seçilen ürün bu şirkete ait değil.',
      { status: 400, code: 'product_company_mismatch' },
    );
  }
  if (!product.isActive) {
    throw new AccountValidationError(
      'Seçilen ürün pasif. Aktif bir ürün seçin veya önce Yönetim Paneli → Ürün Kataloğu altında aktive edin.',
      { status: 400, code: 'product_inactive' },
    );
  }
  return product;
}

/**
 * POST /api/accounts/:id/products
 *
 * Body: { accountCompanyId, productName, productCode?, isActive?, startedAt?, endedAt? }
 * Validation:
 *  - accountCompanyId zorunlu, hedef AccountCompany bu account'a ait olmalı
 *  - Hedef AccountCompany.companyId allowedCompanyIds içinde (SystemAdmin hariç)
 *  - productName zorunlu
 *  - Duplicate productCode per accountCompanyId → 409 (NULL productCode birden çok kabul edilir)
 */
export async function addProduct({ accountId, data, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);

  const accountCompanyId = typeof data?.accountCompanyId === 'string' ? data.accountCompanyId : '';
  if (!accountCompanyId) throw new AccountValidationError('accountCompanyId zorunlu.');

  const ac = await prisma.accountCompany.findUnique({
    where: { id: accountCompanyId },
    select: { id: true, accountId: true, companyId: true },
  });
  if (!ac || ac.accountId !== accountId) {
    throw new AccountValidationError('Şirket ilişkisi bulunamadı.', { status: 404, code: 'not_found' });
  }
  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(ac.companyId)) {
    throw new AccountAccessError('Bu şirkete ürün ekleme yetkin yok.');
  }

  // WR-A8 — productId optional FK. Two paths:
  //  - Catalog: productId set → derive productName/Code from Product catalog
  //    (snapshot). Free-text productName allowed only when productId is null.
  //  - Legacy: productId null → free-text productName required (existing
  //    behavior preserved for backward compatibility).
  let productId = null;
  let productName = '';
  let productCode = data?.productCode ? String(data.productCode).trim() || null : null;
  if (data?.productId) {
    productId = String(data.productId).trim() || null;
  }
  if (productId) {
    const catalogRow = await assertProductInCompany(productId, ac.companyId);
    productName = catalogRow.name;
    if (!productCode) productCode = catalogRow.code; // snapshot from catalog
  } else {
    productName = typeof data?.productName === 'string' ? data.productName.trim() : '';
    if (!productName) throw new AccountValidationError('Ürün adı zorunlu.');
  }

  try {
    const created = await prisma.accountProduct.create({
      data: {
        accountCompanyId,
        productId,
        productName,
        productCode,
        isActive: data?.isActive === undefined ? true : !!data.isActive,
        startedAt: data?.startedAt ? new Date(data.startedAt) : null,
        endedAt: data?.endedAt ? new Date(data.endedAt) : null,
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AccountValidationError(
        'Bu şirkette aynı ürün kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_product_code' },
      );
    }
    throw err;
  }
}

/**
 * PATCH /api/accounts/:id/products/:productId
 * Düzenlenebilir: productName, productCode, isActive, startedAt, endedAt.
 * accountCompanyId değiştirilemez (taşıma için ayrı endpoint gerekir).
 */
export async function updateProduct({ accountId, productId, data, user }) {
  const product = await loadEditableProduct({ accountId, productId, user });
  if (!product) return null;

  const patch = {};

  // WR-A8 — productId catalog link patch:
  //  - undefined → leave catalog link alone
  //  - null      → clear catalog link (legacy free-text mode)
  //  - string id → set/replace catalog link; validate company scope
  if (data?.productId !== undefined) {
    if (data.productId === null || data.productId === '') {
      patch.productId = null;
    } else {
      const newProductId = String(data.productId).trim();
      const catalogRow = await assertProductInCompany(newProductId, product.accountCompany.companyId);
      patch.productId = catalogRow.id;
      // Snapshot from catalog if caller did NOT also provide a productName.
      if (data?.productName === undefined) patch.productName = catalogRow.name;
      // Snapshot code only if no explicit code change AND current is empty.
      if (data?.productCode === undefined) patch.productCode = catalogRow.code;
    }
  }

  if (data?.productName !== undefined) {
    const trimmed = String(data.productName).trim();
    if (!trimmed) throw new AccountValidationError('Ürün adı boş olamaz.');
    patch.productName = trimmed;
  }
  if (data?.productCode !== undefined) {
    patch.productCode = data.productCode ? String(data.productCode).trim() || null : null;
  }
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive;
  if (data?.startedAt !== undefined) {
    patch.startedAt = data.startedAt ? new Date(data.startedAt) : null;
  }
  if (data?.endedAt !== undefined) {
    patch.endedAt = data.endedAt ? new Date(data.endedAt) : null;
  }

  if (Object.keys(patch).length === 0) return { id: productId };
  try {
    await prisma.accountProduct.update({ where: { id: productId }, data: patch });
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AccountValidationError(
        'Bu şirkette aynı ürün kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_product_code' },
      );
    }
    throw err;
  }
  return { id: productId };
}

/**
 * DELETE /api/accounts/:id/products/:productId — soft delete (isActive=false).
 * Vaka detayında müşterinin ürün geçmişi korunur.
 */
export async function removeProduct({ accountId, productId, user }) {
  const product = await loadEditableProduct({ accountId, productId, user });
  if (!product) return null;
  await prisma.accountProduct.update({
    where: { id: productId },
    data: { isActive: false, endedAt: new Date() },
  });
  return { id: productId };
}

/* ---------- WR-A4 — AccountProject CRUD ---------- */

const VALID_PROJECT_STATUSES = new Set(['Active', 'Passive', 'Completed', 'Cancelled']);

/**
 * Faz B-temel — AccountProject.anaFirmaAccountId guard.
 *
 * 3-katmanlı validation:
 *   1. Account exists (404 not_found)
 *   2. Account.customerRole='Central' (409 not_central — Merkez Müşteri
 *      olmayan bir hesap ana firma seçilemez)
 *   3. Cross-tenant scope: anaFirma'nın accountCompanies içinde proje
 *      bayisinin (target AccountCompany'nin) companyId'sine eşleşen kayıt
 *      olmalı (403 out_of_scope — başka tenant'ın Central account'una
 *      bağlanamaz)
 *
 * Aynı tenant kontrolü için ayrı bir `targetCompanyId` parametresi
 * verilmesi şarttır (proje hangi AccountCompany'nin altında oluşacak →
 * onun companyId'si).
 *
 * @param {string} anaFirmaAccountId — Ana firma Account.id
 * @param {string} targetCompanyId — Proje'nin AccountCompany.companyId'si
 * @returns {Promise<{ ok: true } | { ok: false, code, status, message }>}
 */
async function validateAnaFirma(anaFirmaAccountId, targetCompanyId) {
  if (!anaFirmaAccountId) return { ok: true }; // null → OK (opsiyonel)

  const anaFirma = await prisma.account.findUnique({
    where: { id: anaFirmaAccountId },
    select: {
      id: true,
      customerRole: true,
      companies: { select: { companyId: true } },
    },
  });
  if (!anaFirma) {
    return {
      ok: false,
      code: 'ana_firma_not_found',
      status: 404,
      message: 'Seçilen ana firma bulunamadı.',
    };
  }
  if (anaFirma.customerRole !== 'Central') {
    return {
      ok: false,
      code: 'ana_firma_not_central',
      status: 409,
      message: 'Seçilen hesap "Merkez Müşteri" rolünde değil; ana firma olarak seçilemez.',
    };
  }
  // Cross-tenant — anaFirma aynı tenant'a bağlı olmalı.
  const sameTenant = anaFirma.companies.some((c) => c.companyId === targetCompanyId);
  if (!sameTenant) {
    return {
      ok: false,
      code: 'ana_firma_out_of_scope',
      status: 403,
      message: 'Ana firma bu şirkete bağlı değil. (Cross-tenant engellendi)',
    };
  }
  return { ok: true };
}

/**
 * Bir AccountProject'a yazma yetkisi: bağlı AccountCompany'nin companyId'si
 * kullanıcının yazma kapsamında olmalı (SystemAdmin tüm şirketler).
 */
async function loadEditableProject({ accountId, projectId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const project = await prisma.accountProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      accountCompanyId: true,
      accountCompany: { select: { accountId: true, companyId: true } },
    },
  });
  if (!project || project.accountCompany.accountId !== accountId) return null;
  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(project.accountCompany.companyId)) {
    throw new AccountAccessError('Bu projeyi düzenleme yetkin yok.');
  }
  return project;
}

/**
 * POST /api/accounts/:id/companies/:accountCompanyId/projects
 *
 * Body: { code, name, status?, startDate?, endDate?, description? }
 * Validation:
 *  - AccountCompany bu account'a ait olmalı + kullanıcı scope'unda
 *  - code zorunlu (tenant-içi unique per AccountCompany)
 *  - name zorunlu
 *  - status (varsa) VALID_PROJECT_STATUSES içinde
 *  - duplicate (accountCompanyId, code) → 409
 */
export async function addProject({ accountId, accountCompanyId, data, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);

  const ac = await prisma.accountCompany.findUnique({
    where: { id: accountCompanyId },
    select: { id: true, accountId: true, companyId: true },
  });
  if (!ac || ac.accountId !== accountId) {
    throw new AccountValidationError('Şirket ilişkisi bulunamadı.', {
      status: 404,
      code: 'not_found',
    });
  }
  const isSystemAdmin = user.role === 'SystemAdmin';
  const allowed = ensureArray(user.allowedCompanyIds);
  if (!isSystemAdmin && !allowed.includes(ac.companyId)) {
    throw new AccountAccessError('Bu şirkete proje ekleme yetkin yok.');
  }

  const code = typeof data?.code === 'string' ? data.code.trim() : '';
  if (!code) throw new AccountValidationError('Proje kodu zorunlu.');
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (!name) throw new AccountValidationError('Proje adı zorunlu.');

  const status = data?.status ?? 'Active';
  if (!VALID_PROJECT_STATUSES.has(status)) {
    throw new AccountValidationError('Geçersiz proje statüsü.');
  }

  // Faz B-temel — anaFirmaAccountId (opsiyonel). 3-katmanlı guard.
  const anaFirmaAccountId = data?.anaFirmaAccountId ?? null;
  if (anaFirmaAccountId) {
    const v = await validateAnaFirma(anaFirmaAccountId, ac.companyId);
    if (!v.ok) {
      throw new AccountValidationError(v.message, { status: v.status, code: v.code });
    }
  }

  try {
    const created = await prisma.accountProject.create({
      data: {
        accountCompanyId,
        code,
        name,
        status,
        startDate: data?.startDate ? new Date(data.startDate) : null,
        endDate: data?.endDate ? new Date(data.endDate) : null,
        description: data?.description ?? null,
        isActive: data?.isActive === undefined ? true : !!data.isActive,
        anaFirmaAccountId, // Faz B-temel
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AccountValidationError(
        'Bu şirkette aynı proje kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_project_code' },
      );
    }
    throw err;
  }
}

/**
 * PATCH /api/accounts/:id/projects/:projectId
 *
 * Düzenlenebilir: code, name, status, startDate, endDate, description, isActive.
 * accountCompanyId değiştirilemez (proje farklı AccountCompany'ye taşınamaz).
 */
export async function updateProject({ accountId, projectId, data, user }) {
  const project = await loadEditableProject({ accountId, projectId, user });
  if (!project) return null;

  const patch = {};
  if (data?.code !== undefined) {
    const code = String(data.code).trim();
    if (!code) throw new AccountValidationError('Proje kodu boş olamaz.');
    patch.code = code;
  }
  if (data?.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new AccountValidationError('Proje adı boş olamaz.');
    patch.name = name;
  }
  if (data?.status !== undefined) {
    if (!VALID_PROJECT_STATUSES.has(data.status)) {
      throw new AccountValidationError('Geçersiz proje statüsü.');
    }
    patch.status = data.status;
  }
  if (data?.startDate !== undefined) {
    patch.startDate = data.startDate ? new Date(data.startDate) : null;
  }
  if (data?.endDate !== undefined) {
    patch.endDate = data.endDate ? new Date(data.endDate) : null;
  }
  if (data?.description !== undefined) patch.description = data.description || null;
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive;

  // Faz B-temel — anaFirmaAccountId PATCH.
  // null → bağı temizle (allowed)
  // string → 3-katmanlı guard (validateAnaFirma)
  if (data?.anaFirmaAccountId !== undefined) {
    if (data.anaFirmaAccountId === null || data.anaFirmaAccountId === '') {
      patch.anaFirmaAccountId = null;
    } else {
      // Project'in target companyId'sini bul (loadEditableProject zaten
      // accountCompany.companyId döndürüyor; gerekli ek lookup).
      const projectFull = await prisma.accountProject.findUnique({
        where: { id: projectId },
        select: { accountCompany: { select: { companyId: true } } },
      });
      const targetCompanyId = projectFull?.accountCompany?.companyId;
      const v = await validateAnaFirma(data.anaFirmaAccountId, targetCompanyId);
      if (!v.ok) {
        throw new AccountValidationError(v.message, { status: v.status, code: v.code });
      }
      patch.anaFirmaAccountId = data.anaFirmaAccountId;
    }
  }

  if (Object.keys(patch).length === 0) return { id: projectId };

  try {
    await prisma.accountProject.update({ where: { id: projectId }, data: patch });
  } catch (err) {
    if (err?.code === 'P2002') {
      throw new AccountValidationError(
        'Bu şirkette aynı proje kodu zaten kullanılıyor.',
        { status: 409, code: 'duplicate_project_code' },
      );
    }
    throw err;
  }
  return { id: projectId };
}

/**
 * Faz B-temel — Listele "Merkez Müşteri" rolündeki account'lar
 * (AccountProject editor "Ana Firma" dropdown).
 *
 * Cross-tenant scope guard:
 *   - SystemAdmin: tüm şirketlerin Central account'ları
 *   - Diğer: user.allowedCompanyIds dışındaki Central account'lar HARİÇ
 *     (AccountCompany ilişkisi en az biri user scope'unda olmalı)
 *
 * @param {Object} params
 * @param {Object} params.user — { role, allowedCompanyIds }
 * @param {string} [params.targetCompanyId] — Belirli bir tenant filter
 *   (proje editör için: yalnız o tenant'a bağlı Central account'lar). Boş
 *   ise user.allowedCompanyIds'in tamamı kapsamlı.
 * @returns {Promise<Array<{id, name, vkn}>>}
 */
/**
 * Faz B-temel — listCentralAccounts SCOPE KARARI helper (pure).
 *
 * DB-bağımsız davranış testi için ayrı export edildi. Cross-tenant denial
 * smoke (CR zorunlu test) bu fonksiyon üzerinden mantığı çalıştırır:
 *   - SystemAdmin: tüm aktif şirketler (companyIdsToConsider = null)
 *   - Diğer + targetCompanyId verildi + user erişimi YOK → DENY (deny=true)
 *   - Diğer + targetCompanyId verildi + user erişimi var → o tek tenant
 *   - Diğer + targetCompanyId verilmedi → allowed listesi (boşsa DENY)
 *
 * @returns {{ deny: true } | { deny: false, companyIdsToConsider: string[] | null }}
 *   deny=true → caller hemen boş liste döner (cross-tenant engellendi)
 *   companyIdsToConsider=null → SystemAdmin, filtre yok (tüm şirketler)
 *   companyIdsToConsider=[...] → Prisma where.companies.some filter
 */
export function decideCentralListScope({ user, targetCompanyId = null }) {
  const isSystemAdmin = user?.role === 'SystemAdmin';
  const allowed = ensureArray(user?.allowedCompanyIds);

  if (targetCompanyId) {
    if (!isSystemAdmin && !allowed.includes(targetCompanyId)) {
      // CROSS-TENANT DENY — user'ın bu tenant'a erişimi yok
      return { deny: true };
    }
    return { deny: false, companyIdsToConsider: [targetCompanyId] };
  }
  // targetCompanyId yok
  if (isSystemAdmin) {
    return { deny: false, companyIdsToConsider: null }; // tüm şirketler
  }
  if (allowed.length === 0) {
    return { deny: true };
  }
  return { deny: false, companyIdsToConsider: allowed };
}

export async function listCentralAccounts({ user, targetCompanyId = null }) {
  const decision = decideCentralListScope({ user, targetCompanyId });
  if (decision.deny) return [];

  const where = {
    customerRole: 'Central',
    isActive: true,
  };
  if (decision.companyIdsToConsider !== null) {
    where.companies = {
      some: { companyId: { in: decision.companyIdsToConsider } },
    };
  }

  const accounts = await prisma.account.findMany({
    where,
    select: { id: true, name: true, vkn: true },
    orderBy: { name: 'asc' },
    take: 500, // defansif üst sınır
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    vkn: a.vkn ? maskVkn(a.vkn) : null,
  }));
}

/**
 * DELETE /api/accounts/:id/projects/:projectId — soft delete.
 * isActive=false + status=Cancelled. Linked case'ler korunur (Case.accountProjectId
 * Set NULL ile sıfırlanmaz; geçmişte hangi projede açıldı kaydı kalır).
 */
export async function removeProject({ accountId, projectId, user }) {
  const project = await loadEditableProject({ accountId, projectId, user });
  if (!project) return null;
  await prisma.accountProject.update({
    where: { id: projectId },
    data: { isActive: false, status: 'Cancelled' },
  });
  return { id: projectId };
}

/* ---------- Address CRUD (WR-A3 / PM-02) ---------- */

const ADDRESS_TYPES = new Set(['Billing', 'Shipping', 'Visit', 'Headquarters', 'Branch']);
const ISO2_RX = /^[A-Z]{2}$/;

/**
 * Address yazma yetkisi:
 *  - Account, kullanıcının erişebildiği scope'ta olmalı (assertAccountInScope)
 *  - Adres var ise bu account'a ait olmalı + companyId allowedCompanyIds içinde
 * Dönen `row`: { id, accountId, companyId, type, isDefault, isActive }
 */
async function loadEditableAddress({ accountId, addressId, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const row = await prisma.address.findUnique({
    where: { id: addressId },
    select: {
      id: true,
      accountId: true,
      companyId: true,
      type: true,
      isDefault: true,
      isActive: true,
    },
  });
  if (!row || row.accountId !== accountId) return null;
  const allowed = ensureArray(user.allowedCompanyIds);
  if (allowed.length && !allowed.includes(row.companyId)) return null;
  return row;
}

/**
 * Address input sanitization + validation. Yaratma ve güncelleme yollarında
 * aynı kurallar.
 */
function sanitizeAddressInput(data, { isCreate }) {
  const out = {};
  if (isCreate) {
    const type = typeof data?.type === 'string' ? data.type.trim() : '';
    if (!type) throw new AccountValidationError('Adres tipi zorunlu.', { code: 'address_type_required' });
    if (!ADDRESS_TYPES.has(type)) {
      throw new AccountValidationError('Geçersiz adres tipi.', { code: 'address_type_invalid' });
    }
    out.type = type;

    const companyId = typeof data?.companyId === 'string' ? data.companyId.trim() : '';
    if (!companyId) throw new AccountValidationError('Şirket zorunlu.', { code: 'address_company_required' });
    out.companyId = companyId;
  } else if (data?.type !== undefined) {
    const type = typeof data.type === 'string' ? data.type.trim() : '';
    if (!ADDRESS_TYPES.has(type)) {
      throw new AccountValidationError('Geçersiz adres tipi.', { code: 'address_type_invalid' });
    }
    out.type = type;
  }

  if (isCreate || data?.line1 !== undefined) {
    const line1 = typeof data?.line1 === 'string' ? data.line1.trim() : '';
    if (!line1) throw new AccountValidationError('Adres satırı (line1) zorunlu.', { code: 'address_line1_required' });
    out.line1 = line1;
  }
  if (data?.line2 !== undefined) out.line2 = (data.line2 ?? '').toString().trim() || null;
  if (data?.label !== undefined) out.label = (data.label ?? '').toString().trim() || null;
  if (data?.district !== undefined) out.district = (data.district ?? '').toString().trim() || null;
  if (data?.city !== undefined) out.city = (data.city ?? '').toString().trim() || null;
  if (data?.state !== undefined) out.state = (data.state ?? '').toString().trim() || null;
  if (data?.postalCode !== undefined) out.postalCode = (data.postalCode ?? '').toString().trim() || null;

  if (isCreate || data?.country !== undefined) {
    const raw = data?.country == null || data.country === '' ? 'TR' : String(data.country).trim().toUpperCase();
    if (!ISO2_RX.test(raw)) {
      throw new AccountValidationError(
        'Ülke kodu ISO-2 formatında olmalı (örn. TR, DE, US).',
        { code: 'address_country_invalid' },
      );
    }
    out.country = raw;
  }

  if (data?.isDefault !== undefined) out.isDefault = !!data.isDefault;
  if (data?.isActive !== undefined) out.isActive = !!data.isActive;
  return out;
}

/**
 * POST /api/accounts/:id/addresses
 *
 * Body: { companyId, type, line1, line2?, label?, district?, city?, state?,
 *   postalCode?, country?, isDefault?, isActive? }
 *
 * Doğrulamalar:
 *  - companyId account'un mevcut AccountCompany kaydıyla eşleşmeli (cross-tenant
 *    sızıntı önleme + tenant scope guard).
 *  - companyId kullanıcının allowedCompanyIds'inde olmalı.
 *  - isDefault=true → aynı (accountId, companyId, type) için diğer aktif
 *    default'lar app-layer transaction içinde temizlenir.
 */
export async function addAddress({ accountId, data, user }) {
  await assertAccountInScope(accountId, user.allowedCompanyIds);
  const patch = sanitizeAddressInput(data, { isCreate: true });

  // companyId account'un AccountCompany kaydı içinde olmalı + user scope'unda.
  const allowed = ensureArray(user.allowedCompanyIds);
  if (allowed.length && !allowed.includes(patch.companyId)) {
    throw new AccountValidationError(
      'Bu şirket erişiminiz dışında.',
      { code: 'address_company_forbidden' },
    );
  }
  const accountCompany = await prisma.accountCompany.findFirst({
    where: { accountId, companyId: patch.companyId },
    select: { id: true },
  });
  if (!accountCompany) {
    throw new AccountValidationError(
      'Bu müşteri bu şirkete bağlı değil — önce şirket ilişkisini ekleyin.',
      { code: 'address_company_mismatch' },
    );
  }

  const wantDefault = !!patch.isDefault;
  const wantActive = patch.isActive === undefined ? true : patch.isActive;

  const created = await prisma.$transaction(async (tx) => {
    if (wantDefault && wantActive) {
      await tx.address.updateMany({
        where: {
          accountId,
          companyId: patch.companyId,
          type: patch.type,
          isActive: true,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: {
        accountId,
        companyId: patch.companyId,
        type: patch.type,
        label: patch.label ?? null,
        line1: patch.line1,
        line2: patch.line2 ?? null,
        district: patch.district ?? null,
        city: patch.city ?? null,
        state: patch.state ?? null,
        postalCode: patch.postalCode ?? null,
        country: patch.country ?? 'TR',
        isDefault: wantDefault,
        isActive: wantActive,
      },
    });
  });

  return { id: created.id, account: await getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds }) };
}

/**
 * PATCH /api/accounts/:id/addresses/:addressId
 *
 * Güncellenebilir: type, label, line1, line2, district, city, state,
 * postalCode, country, isDefault, isActive. companyId değiştirilemez
 * (taşıma desteklenmiyor — yeni adres yarat + eskiyi pasifleştir).
 */
export async function updateAddress({ accountId, addressId, data, user }) {
  const row = await loadEditableAddress({ accountId, addressId, user });
  if (!row) return null;

  const patch = sanitizeAddressInput(data, { isCreate: false });
  // companyId immutable
  if (data?.companyId !== undefined && data.companyId !== row.companyId) {
    throw new AccountValidationError(
      'Adresin şirketi değiştirilemez. Yeni şirket için yeni adres ekleyin.',
      { code: 'address_company_immutable' },
    );
  }

  const nextType = patch.type ?? row.type;
  const nextIsDefault = patch.isDefault === undefined ? row.isDefault : patch.isDefault;
  const nextIsActive = patch.isActive === undefined ? row.isActive : patch.isActive;
  const becomesDefault = nextIsDefault && nextIsActive && (!row.isDefault || nextType !== row.type);

  await prisma.$transaction(async (tx) => {
    if (becomesDefault) {
      await tx.address.updateMany({
        where: {
          accountId,
          companyId: row.companyId,
          type: nextType,
          isActive: true,
          isDefault: true,
          NOT: { id: addressId },
        },
        data: { isDefault: false },
      });
    }
    if (Object.keys(patch).length === 0) return;
    await tx.address.update({ where: { id: addressId }, data: patch });
  });

  return { id: addressId, account: await getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds }) };
}

/**
 * DELETE /api/accounts/:id/addresses/:addressId — soft delete.
 * isActive=false + isDefault=false. Account silindiğinde Cascade DELETE
 * (DB-level); manuel hard-delete UI'de açık değil.
 */
export async function removeAddress({ accountId, addressId, user }) {
  const row = await loadEditableAddress({ accountId, addressId, user });
  if (!row) return null;
  await prisma.address.update({
    where: { id: addressId },
    data: { isActive: false, isDefault: false },
  });
  return { id: addressId, account: await getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds }) };
}

/**
 * Hafif müşteri context'i — Case detail panel'i için.
 *
 * accountId null → null döner (müşterisiz vaka).
 * Case scope'unun (companyId) AccountCompany kaydını döner; başka şirketlere
 * sızmaz. Agent için güvenli — `notes` ve `segment` (iç bilgi) dahil edilmez.
 */
export async function getCaseCustomerContext({ accountId, companyId, allowedCompanyIds }) {
  if (!accountId || !companyId) return null;
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length && !allowed.includes(companyId)) return null;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      vkn: true,
      isActive: true,
      companies: {
        where: { companyId },
        select: {
          id: true,
          companyId: true,
          status: true,
          externalCustomerCode: true,
          packageName: true,
          packageId: true,
          contractStartAt: true,
          contractEndAt: true,
          // WR-A7b — Catalog Package referansı.
          package: {
            select: { id: true, code: true, name: true, supportLevel: true, isActive: true },
          },
          products: {
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
            orderBy: { productName: 'asc' },
            take: 20,
          },
          company: {
            select: {
              name: true,
              settings: { select: { primaryColor: true } },
            },
          },
        },
        take: 1,
      },
      contacts: {
        where: { isActive: true, isPrimary: true },
        select: {
          id: true,
          fullName: true,
          title: true,
          phone: true,
          phoneType: true,
          phoneExtension: true,
          email: true,
          preferredChannel: true,
        },
        take: 1,
      },
    },
  });
  if (!account) return null;

  const ac = account.companies[0];
  return {
    accountId: account.id,
    accountName: account.name,
    vknMasked: maskVkn(account.vkn),
    isActive: account.isActive,
    company: ac
      ? {
          accountCompanyId: ac.id,
          companyId: ac.companyId,
          companyName: ac.company?.name ?? null,
          companyColor: ac.company?.settings?.primaryColor ?? null,
          status: ac.status,
          externalCustomerCode: ac.externalCustomerCode ?? null,
          packageName: ac.packageName ?? null,
          packageId: ac.packageId ?? null,
          // WR-A7b — Catalog package özet kartı.
          package: ac.package
            ? {
                id: ac.package.id,
                code: ac.package.code,
                name: ac.package.name,
                supportLevel: ac.package.supportLevel,
                isActive: ac.package.isActive,
              }
            : null,
          contractStartAt: ac.contractStartAt,
          contractEndAt: ac.contractEndAt,
          activeProducts: (ac.products ?? []).map((p) => ({
            id: p.id,
            productName: p.productName,
            productCode: p.productCode ?? null,
          })),
        }
      : null,
    primaryContact: account.contacts[0] ?? null,
  };
}

export const accountRepository = {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  assertAccountInScope,
  maskVkn,
  // Phase C — C1
  addCompanyRelation,
  updateCompanyRelation,
  removeCompanyRelation,
  addContact,
  updateContact,
  removeContact,
  // Phase C — C2
  listProducts,
  addProduct,
  updateProduct,
  removeProduct,
  // WR-A4 — AccountProject CRUD
  addProject,
  updateProject,
  removeProject,
  // Faz B-temel — AccountProject editor "Ana Firma" dropdown
  listCentralAccounts,
  // WR-A3 / PM-02 — Address CRUD
  addAddress,
  updateAddress,
  removeAddress,
  getCaseCustomerContext,
};
