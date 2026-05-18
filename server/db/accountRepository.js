import { prisma } from './client.js';

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
    email: account.email ?? null,
    isActive: account.isActive,
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
 * search: min 2 char. (name contains) OR (vkn startsWith) OR (contact phone/email contains).
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
    whereAnd.push({ companies: { some: { companyId } } });
  }

  if (status) {
    whereAnd.push({ companies: { some: { status } } });
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
        email: true,
        isActive: true,
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
  const allCases = accountIds.length
    ? await prisma.case.groupBy({
        by: ['accountId', 'status'],
        where: { accountId: { in: accountIds } },
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
      email: true,
      isActive: true,
      companyId: true,
      createdAt: true,
      companies: {
        select: {
          id: true,
          companyId: true,
          status: true,
          externalCustomerCode: true,
          packageName: true,
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
          products: {
            select: {
              id: true,
              productName: true,
              productCode: true,
              isActive: true,
              startedAt: true,
              endedAt: true,
            },
            orderBy: [{ isActive: 'desc' }, { productName: 'asc' }],
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
    },
  });
  if (!account) return null;

  // Sadece izinli AccountCompany'ler dışarı sızar.
  const visibleCompanies = account.companies.filter((c) => allowed.includes(c.companyId));

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
    email: account.email ?? null,
    isActive: account.isActive,
    createdAt: account.createdAt,
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
      contractStartAt: c.contractStartAt,
      contractEndAt: c.contractEndAt,
      segment: c.segment ?? null,
      notes: c.notes ?? null,
      products: (c.products ?? []).map((p) => ({
        id: p.id,
        productName: p.productName,
        productCode: p.productCode ?? null,
        isActive: p.isActive,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
      })),
    })),
    contacts: account.contacts,
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

  const vkn = typeof data?.vkn === 'string' ? data.vkn.trim() || null : null;
  if (vkn) {
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

  // Atomik: Account + AccountCompany kayıtları aynı transaction.
  try {
    const created = await prisma.account.create({
      data: {
        name,
        vkn,
        phone: data?.phone ?? null,
        email: data?.email ?? null,
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
  if (data?.phone !== undefined) patch.phone = data.phone || null;
  if (data?.email !== undefined) patch.email = data.email || null;
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive;

  if (data?.vkn !== undefined) {
    const newVkn = typeof data.vkn === 'string' ? data.vkn.trim() || null : null;
    if (newVkn) {
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

  if (Object.keys(patch).length === 0) {
    return getAccount(accountId, { allowedCompanyIds: user.allowedCompanyIds });
  }

  try {
    await prisma.account.update({ where: { id: accountId }, data: patch });
  } catch (err) {
    if (err?.code === 'P2002') {
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
 * Body: { companyId, externalCustomerCode?, packageName?, contractStartAt?,
 *         contractEndAt?, segment?, status?, notes? }
 *
 * Doğrulamalar:
 *  - companyId zorunlu, izinli (SystemAdmin hariç)
 *  - externalCustomerCode (varsa) tam 5 hane
 *  - status (varsa) VALID_STATUSES içinde
 *  - (accountId, companyId) ikilisi zaten varsa 409
 *  - (companyId, externalCustomerCode) çakışırsa 409
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

  try {
    await prisma.accountCompany.create({
      data: {
        accountId,
        companyId,
        externalCustomerCode,
        packageName: data?.packageName ?? null,
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
 * Düzenlenebilir alanlar: externalCustomerCode, packageName, contractStartAt,
 * contractEndAt, segment, status, notes. companyId DEĞIŞTIRILEMEZ
 * (taşıma istenirse ayrı endpoint gerekir; cross-tenant audit gerektirir).
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
      productName: true,
      productCode: true,
      isActive: true,
      startedAt: true,
      endedAt: true,
      accountCompany: { select: { companyId: true, company: { select: { name: true } } } },
    },
  });

  return {
    products: rows.map((p) => ({
      id: p.id,
      accountCompanyId: p.accountCompanyId,
      companyId: p.accountCompany.companyId,
      companyName: p.accountCompany.company?.name ?? null,
      productName: p.productName,
      productCode: p.productCode ?? null,
      isActive: p.isActive,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
    })),
  };
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

  const productName = typeof data?.productName === 'string' ? data.productName.trim() : '';
  if (!productName) throw new AccountValidationError('Ürün adı zorunlu.');

  const productCode = data?.productCode ? String(data.productCode).trim() || null : null;

  try {
    const created = await prisma.accountProduct.create({
      data: {
        accountCompanyId,
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
          contractStartAt: true,
          contractEndAt: true,
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
  getCaseCustomerContext,
};
