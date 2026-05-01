import { prisma } from './client.js';

/**
 * Vakalardaki distinct productGroup değerleri — admin productGroup tanımı
 * yapmıyor, vaka açılışında serbest yazılıyor; bu yüzden DB'den distinct
 * çekiyoruz. Dropdown autocomplete için.
 */
async function listProductGroups() {
  const rows = await prisma.case.findMany({
    where: { productGroup: { not: null } },
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
 */

export const lookupRepository = {
  /**
   * Bootstrap — uygulama açılışında frontend'e tüm lookup'ları tek seferde
   * gönderir. Cold start'ta ~5 sorgu, sıcak DB'de < 100ms.
   */
  async bootstrap() {
    const [companies, accounts, teams, persons, thirdParties, documentTypes, categories, offeredSolutions, slaPolicies, checklists] =
      await Promise.all([
        prisma.company.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.account.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.team.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.person.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.thirdParty.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.documentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.categoryDef.findMany({ where: { isActive: true }, include: { children: true } }),
        prisma.offeredSolutionDef.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.sLAPolicy.findMany({ where: { isActive: true } }),
        prisma.checklistTemplate.findMany({ where: { isActive: true } }),
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

    const productGroups = await listProductGroups();

    return {
      companies,
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
    };
  },

  productGroups: listProductGroups,
};
