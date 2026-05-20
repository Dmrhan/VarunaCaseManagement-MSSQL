import { prisma } from './client.js';
import { withDbRetry } from './retry.js';

/**
 * Vakalardaki distinct productGroup değerleri — admin productGroup tanımı
 * yapmıyor, vaka açılışında serbest yazılıyor; bu yüzden DB'den distinct
 * çekiyoruz. Dropdown autocomplete için.
 *
 * MULTI-TENANT: allowedCompanyIds verilirse yalnız o şirketlerin vakalarındaki
 * distinct değerler döner. Verilmezse (SystemAdmin dahili çağrı) tüm şirketler.
 * Aksi takdirde cross-tenant productGroup sızıntısı olur (Smoke Audit P0.2).
 */
async function listProductGroups(allowedCompanyIds) {
  const where = { productGroup: { not: null } };
  if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
  const rows = await prisma.case.findMany({
    where,
    select: { productGroup: true },
    distinct: ['productGroup'],
    orderBy: { productGroup: 'asc' },
  });
  return rows.map((r) => r.productGroup).filter(Boolean);
}

/**
 * Lookup repository — kategori, takım, kişi vb. referans verileri.
 *
 * Frontend'in lookupService bootstrap'ı tek istekle (`bootstrap()`) yapıp
 * React Context'te cache'liyor. Admin ekranları yine ayrı endpoint'leri
 * çağırabilsin diye CRUD'lar da burada.
 *
 * MULTI-TENANT KURALI: bootstrap() artık allowedCompanyIds parametresi alır.
 * Şirket-bağlı her tablo (teams, persons, accounts, categories, slaPolicies,
 * checklists, fieldDefinitions) bu set ile filtrelenir. Yeni bir lookup
 * tablosu eklendiğinde — özellikle Faz 2 collab tabloları (CaseWatcher
 * sahip listesi, CaseLink hedef listesi vb.) — companyId scope'unu burada
 * uygulamak zorunda. Aksi takdirde cross-tenant veri sızıntısı olur.
 */

export const lookupRepository = {
  /**
   * Bootstrap — uygulama açılışında frontend'e tüm lookup'ları tek seferde
   * gönderir. Cold start'ta ~5 sorgu, sıcak DB'de < 100ms.
   *
   * @param {string[]} allowedCompanyIds - req.user.allowedCompanyIds
   *   (verifyJwt middleware'den). Verilmezse (örn. dahili çağrı) tüm
   *   şirketlerin verisi döner — bunu yalnızca SystemAdmin context'te kullan.
   */
  async bootstrap(allowedCompanyIds) {
    // Geçici pooler aksaklıklarında 2x retry (300ms + 800ms). Tüm Promise.all
    // bloğu sarmalanır — herhangi biri P1001/P1017/P2024 atarsa hepsi retry.
    return withDbRetry(() => bootstrapInner(allowedCompanyIds), {
      retries: 2,
      delayMs: [300, 800],
      label: 'bootstrap',
    });
  },

  productGroups: listProductGroups,

  /**
   * WR-A7b / PM-05 — Vaka açılış catalog lookup.
   *
   * NewCaseForm + CaseDetail inline edit kullanır. Çağrı:
   *   GET /api/lookups/catalog?companyId=&accountId=
   *
   * Dönüş:
   *   - packages: companyId'deki aktif Package'lar [{ id, code, name, supportLevel }]
   *   - products: companyId'deki aktif Product'lar [{ id, code, name, supportLevel, productGroupId }]
   *   - packageItems: { [packageId]: productId[] } — UI paket filtresi için
   *   - suggestedPackage: accountId verildiyse AccountCompany(accountId, companyId).packageId
   *     veya null. NewCaseForm preselect için.
   *
   * Multi-tenant: allowedCompanyIds içermiyorsa companyId → 403.
   *
   * companyId zorunlu. accountId opsiyonel — verildiyse AccountCompany scope kontrol edilir.
   */
  async getCaseCatalog({ companyId, accountId = null, allowedCompanyIds }) {
    if (!companyId) {
      const err = new Error('companyId zorunlu.');
      err.status = 400;
      err.code = 'company_required';
      throw err;
    }
    const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
    if (allowed.length && !allowed.includes(companyId)) {
      const err = new Error('Bu şirkete erişim yetkin yok.');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }

    const [packages, products, packageItems, accountCompany] = await Promise.all([
      prisma.package.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true, supportLevel: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.product.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          supportLevel: true,
          productGroupId: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.packageItem.findMany({
        where: { package: { companyId, isActive: true } },
        select: { packageId: true, productId: true },
      }),
      accountId
        ? prisma.accountCompany.findUnique({
            where: { accountId_companyId: { accountId, companyId } },
            select: { packageId: true },
          })
        : Promise.resolve(null),
    ]);

    const packageItemsMap = {};
    for (const row of packageItems) {
      if (!packageItemsMap[row.packageId]) packageItemsMap[row.packageId] = [];
      packageItemsMap[row.packageId].push(row.productId);
    }

    return {
      companyId,
      accountId: accountId ?? null,
      packages,
      products,
      packageItems: packageItemsMap,
      suggestedPackage: accountCompany?.packageId ?? null,
    };
  },
};

async function bootstrapInner(allowedCompanyIds) {
    // Şirket-bağlı tablolar için where helper'ı.
    // Account ve CategoryDef'te companyId nullable: null = "tüm şirketlerle
    // paylaşılan kayıt" anlamına gelir; izin matrisine null'lar her zaman dahil.
    const companyScope = allowedCompanyIds
      ? { companyId: { in: allowedCompanyIds } }
      : {};
    const companyScopeNullable = allowedCompanyIds
      ? { OR: [{ companyId: { in: allowedCompanyIds } }, { companyId: null }] }
      : {};

    const [companies, accounts, teams, persons, thirdParties, documentTypes, categories, offeredSolutions, slaPolicies, checklists, fieldDefinitions] =
      await Promise.all([
        // Company listesi — kullanıcının erişebildiği şirketler (yeni şirket
        // yaratma UI'sı için tam liste SystemAdmin admin endpoint'inden gelir).
        // Phase D: CompanySettings.requireCustomerOnCaseCreate ile NewCaseForm
        // müşteri zorunluluğunu enforce eder; alan tüm rollere okutulur.
        prisma.company.findMany({
          where: allowedCompanyIds ? { isActive: true, id: { in: allowedCompanyIds } } : { isActive: true },
          orderBy: { name: 'asc' },
          include: {
            settings: {
              select: {
                requireCustomerOnCaseCreate: true,
                projectsEnabled: true,
                projectsRequired: true,
              },
            },
          },
        }),
        // Account scope — accountRepository.buildScopeWhere ile simetrik:
        //   (legacy Account.companyId in allowedCompanyIds)
        //   OR (legacy Account.companyId NULL = shared)
        //   OR (AccountCompany kaydı izinli şirkete bağlı — Phase A sonrası
        //       legacy companyId boş ama AccountCompany üzerinden bağlı müşteriler)
        // Eski hali sadece ilk iki dalı kapsıyordu; Phase A migration sonrası
        // legacy companyId set edilmemiş Account'lar bootstrap'tan kayıyordu.
        prisma.account.findMany({
          where: allowedCompanyIds
            ? {
                isActive: true,
                OR: [
                  { companyId: { in: allowedCompanyIds } },
                  { companyId: null },
                  { companies: { some: { companyId: { in: allowedCompanyIds } } } },
                ],
              }
            : { isActive: true },
          orderBy: { name: 'asc' },
        }),
        // Team: companyId zorunlu (Phase 1).
        prisma.team.findMany({
          where: { isActive: true, ...companyScope },
          orderBy: { name: 'asc' },
        }),
        // Person: companyId yok, Team üzerinden filter. teamId null Person'lar
        // hiç dönmez — bu kabul edilebilir (bir takıma bağlı olmayan operasyonel
        // kayıt zaten işe yaramıyor).
        prisma.person.findMany({
          where: allowedCompanyIds
            ? { isActive: true, team: { companyId: { in: allowedCompanyIds } } }
            : { isActive: true },
          orderBy: { name: 'asc' },
        }),
        // ThirdParty + DocumentType: şirket-agnostik (system-wide kayıtlar) — filtrelenmez.
        prisma.thirdParty.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.documentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        // CategoryDef: companyId nullable (null = sistem geneli) — null'lar dahil.
        prisma.categoryDef.findMany({
          where: { isActive: true, ...companyScopeNullable },
          include: { children: true },
        }),
        // OfferedSolutionDef: şirket-agnostik (yorum/karar bekliyor — şu an global).
        prisma.offeredSolutionDef.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        // SLAPolicy: companyId zorunlu.
        prisma.sLAPolicy.findMany({ where: { isActive: true, ...companyScope } }),
        // ChecklistTemplate: companyId zorunlu.
        prisma.checklistTemplate.findMany({ where: { isActive: true, ...companyScope } }),
        // FieldDefinition: companyId zorunlu.
        prisma.fieldDefinition.findMany({
          where: { isActive: true, ...companyScope },
          orderBy: [{ companyId: 'asc' }, { displayOrder: 'asc' }],
        }),
      ]);

    // Frontend legacy shape: { category, subCategories: string[] }
    const rootCategories = categories.filter((c) => c.parentId === null);
    const categoriesShaped = rootCategories.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      subCategories: c.children
        .filter((s) => s.isActive)
        .map((s) => ({ id: s.id, name: s.name, isActive: s.isActive })),
    }));

    const productGroups = await listProductGroups(allowedCompanyIds);

    // Frontend için flatten — settings sub-object yerine top-level field.
    const companiesShaped = companies.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      requireCustomerOnCaseCreate: c.settings?.requireCustomerOnCaseCreate ?? false,
      // WR-A4 / PM-04 — AccountProject opt-in (default false; mevcut davranışı korur)
      projectsEnabled: c.settings?.projectsEnabled ?? false,
      projectsRequired: c.settings?.projectsRequired ?? false,
    }));

    return {
      companies: companiesShaped,
      accounts,
      teams,
      persons,
      thirdParties,
      documentTypes,
      categories: categoriesShaped,
      offeredSolutions,
      slaPolicies,
      checklists,
      productGroups,
      fieldDefinitions,
    };
}
