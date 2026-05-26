import { prisma } from './client.js';
import { CUSTOMER_TYPE_VALUES } from './enumMap.js';
// WR-A2 — Validation + privacy helpers.
import {
  validateVkn,
  validateTckn,
  hashTckn,
  maskTcknLast4,
  normalizePhoneE164,
} from '../utils/accountValidation.js';

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
    email: account.email ?? null,
    isActive: account.isActive,
    // WR-A1 / PM-01 — Müşteri tipi + opsiyonel ticari unvan/sicil no.
    customerType: account.customerType,
    legalName: account.legalName ?? null,
    registrationNo: account.registrationNo ?? null,
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
 *   - AccountCompany.externalCustomerCode (contains, case-insensitive) — C2
 *   - contact phone/email (contains, case-insensitive)
 * companyId: filter (allowedCompanyIds içinde olmalı).
 * status: AccountCompany.status filter (active/churn/prospect/inactive).
 */
export async function listAccounts({
  search,
  companyId,
  status,
  page = 1,
  limit = 25,
  allowedCompanyIds,
}) {
  const allowed = ensureArray(allowedCompanyIds);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));

  if (companyId && !allowed.includes(companyId)) {
    // İzinli olmayan bir şirket ID gönderildi → boş döner (403 yerine empty).
    return { accounts: [], total: 0, page: safePage, limit: safeLimit };
  }

  const whereAnd = [buildScopeWhere(allowed)];

  if (search && search.trim().length >= 2) {
    const q = search.trim();
    whereAnd.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { vkn: { startsWith: q } },
        // C2: müşterinin herhangi bir AccountCompany ilişkisindeki external
        // kodu içerikle eşle. allowedCompanyIds dış WHERE'de zorlandığı için
        // bu OR yalnız eşleştirme alanını genişletir, scope'u açmaz.
        {
          companies: {
            some: {
              externalCustomerCode: { contains: q, mode: 'insensitive' },
            },
          },
        },
        {
          contacts: {
            some: {
              OR: [
                { phone: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
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
        email: true,
        isActive: true,
        // WR-A1
        customerType: true,
        legalName: true,
        registrationNo: true,
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
      email: true,
      isActive: true,
      companyId: true,
      createdAt: true,
      // WR-A1
      customerType: true,
      legalName: true,
      registrationNo: true,
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
    email: account.email ?? null,
    isActive: account.isActive,
    createdAt: account.createdAt,
    // WR-A1 / PM-01 — Müşteri tipi + (opsiyonel) ticari unvan/sicil no.
    customerType: account.customerType,
    // WR-A2 — TCKN maskeli display only; tcknHash response'a girmez.
    tcknMasked: maskTcknLast4(account.tcknLast4),
    legalName: account.legalName ?? null,
    registrationNo: account.registrationNo ?? null,
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
  const legalName =
    typeof data?.legalName === 'string' && data.legalName.trim() ? data.legalName.trim() : null;
  const registrationNo =
    typeof data?.registrationNo === 'string' && data.registrationNo.trim()
      ? data.registrationNo.trim()
      : null;

  // WR-A2 — Phone E.164 normalize (display + e164 ayrı saklanır).
  const phoneRaw = typeof data?.phone === 'string' && data.phone.trim() ? data.phone.trim() : null;
  const phoneE164 = phoneRaw ? normalizePhoneE164(phoneRaw) : null;

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
  try {
    const created = await prisma.account.create({
      data: {
        name,
        vkn,
        phone: phoneRaw,
        phoneE164,
        email: data?.email ?? null,
        customerType,
        legalName,
        registrationNo,
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
    if (err?.code === 'P2002') {
      const target = err.meta?.target ?? [];
      const targets = Array.isArray(target) ? target : [target];
      if (targets.includes('vkn')) {
        throw new AccountValidationError('Bu VKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_vkn',
        });
      }
      if (targets.includes('tcknHash')) {
        throw new AccountValidationError('Bu TCKN ile kayıtlı müşteri var.', {
          status: 409,
          code: 'duplicate_tckn',
        });
      }
      if (targets.includes('externalCustomerCode') || targets.includes('companyId')) {
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

  if (Object.keys(patch).length === 0) {
    return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
  }

  try {
    await prisma.account.update({ where: { id: accountId }, data: patch });
  } catch (err) {
    if (err?.code === 'P2002') {
      const targets = Array.isArray(err.meta?.target) ? err.meta.target : [err.meta?.target];
      if (targets.includes('tcknHash')) {
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
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      const target = err.meta?.target ?? [];
      const targets = Array.isArray(target) ? target : [target];
      if (targets.includes('accountId') && targets.includes('companyId')) {
        throw new AccountValidationError('Bu müşteri zaten bu şirkete bağlı.', {
          status: 409,
          code: 'duplicate_relation',
        });
      }
      if (targets.includes('externalCustomerCode')) {
        throw new AccountValidationError(
          'Bu şirkette aynı müşteri kodu zaten kullanılıyor.',
          { status: 409, code: 'duplicate_external_code' },
        );
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
  // WR-A3 / PM-02 — Address CRUD
  addAddress,
  updateAddress,
  removeAddress,
  getCaseCustomerContext,
};
