import { prisma } from './client.js';
import { fromDb, toDb } from './enumMap.js';

/**
 * Admin tanım ekranlarının CRUD repository'si.
 *
 * Convention: tüm metotlar `{ ok: true, item } | { ok: false, error: string }`
 * yerine direkt nesne döner ya da exception fırlatır. Route handler 4xx/5xx'e
 * çevirir; frontend apiFetch toast gösterir. Hata mesajları Türkçe ve
 * kullanıcıya gösterilebilir.
 *
 * Silme/pasifleştirme öncesi usage kontrolü route'da değil burada — atomik
 * olsun diye.
 */

// Standart hata wrapper
class AdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────
// Third Parties
// ─────────────────────────────────────────────────────────────────
export const thirdPartyRepo = {
  async list() {
    return prisma.thirdParty.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    const exists = await prisma.thirdParty.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Aynı isimde 3. parti zaten mevcut.');
    return prisma.thirdParty.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const dup = await prisma.thirdParty.findFirst({
        where: { id: { not: id }, name: { equals: patch.name.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Aynı isimde başka 3. parti var.');
    }
    return prisma.thirdParty.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    const usage = await prisma.case.count({ where: { thirdPartyId: id } });
    if (usage > 0) {
      // Veriye bağlı: pasifleştir
      return prisma.thirdParty.update({ where: { id }, data: { isActive: false } });
    }
    await prisma.thirdParty.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Document Types
// ─────────────────────────────────────────────────────────────────
export const documentTypeRepo = {
  async list() {
    return prisma.documentType.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    const exists = await prisma.documentType.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Aynı isimde belge türü zaten mevcut.');
    return prisma.documentType.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const dup = await prisma.documentType.findFirst({
        where: { id: { not: id }, name: { equals: patch.name.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Aynı isimde başka belge türü var.');
    }
    return prisma.documentType.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    // CaseAttachment.documentTypeId şu an yok — usage hep 0. Her zaman delete.
    await prisma.documentType.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Teams
// ─────────────────────────────────────────────────────────────────
export const teamRepo = {
  async list() {
    return prisma.team.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    const exists = await prisma.team.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Aynı isimde takım zaten mevcut.');
    return prisma.team.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const dup = await prisma.team.findFirst({
        where: { id: { not: id }, name: { equals: patch.name.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Aynı isimde başka takım var.');
    }
    return prisma.team.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    const openCases = await prisma.case.count({
      where: {
        assignedTeamId: id,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
    });
    if (openCases > 0) {
      throw new AdminError(`Bu takıma atanmış ${openCases} açık vaka var. Önce devret.`);
    }
    const totalCases = await prisma.case.count({ where: { assignedTeamId: id } });
    if (totalCases > 0) {
      // Geçmiş vakalar var — pasifleştir
      return prisma.team.update({ where: { id }, data: { isActive: false } });
    }
    const memberCount = await prisma.person.count({ where: { teamId: id } });
    if (memberCount > 0) {
      throw new AdminError(`Bu takımda ${memberCount} kişi var. Önce taşı.`);
    }
    await prisma.team.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Persons
// ─────────────────────────────────────────────────────────────────
export const personRepo = {
  async list() {
    return prisma.person.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    if (input.email) {
      const dup = await prisma.person.findFirst({
        where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Bu e-posta adresiyle başka kullanıcı var.');
    }
    return prisma.person.create({
      data: {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        teamId: input.teamId,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.email) {
      const dup = await prisma.person.findFirst({
        where: { id: { not: id }, email: { equals: patch.email.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Bu e-posta adresiyle başka kullanıcı var.');
    }
    return prisma.person.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.email !== undefined && { email: patch.email?.trim() || null }),
        ...(patch.teamId !== undefined && { teamId: patch.teamId }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    const openCases = await prisma.case.count({
      where: {
        assignedPersonId: id,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
    });
    if (openCases > 0) {
      throw new AdminError(`Bu kişiye atanmış ${openCases} açık vaka var. Önce devret.`);
    }
    const totalCases = await prisma.case.count({ where: { assignedPersonId: id } });
    if (totalCases > 0) {
      return prisma.person.update({ where: { id }, data: { isActive: false } });
    }
    await prisma.person.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Categories (parent + sub-categories)
// ─────────────────────────────────────────────────────────────────
export const categoryRepo = {
  async list() {
    // Tüm root + child kategoriler — frontend tree shape'i kendi kurar
    const all = await prisma.categoryDef.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: { children: { orderBy: { name: 'asc' } } },
    });
    return all.filter((c) => c.parentId === null);
  },
  async createParent(input) {
    const exists = await prisma.categoryDef.findFirst({
      where: { parentId: null, name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Aynı isimde kategori zaten mevcut.');
    return prisma.categoryDef.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async createSub(parentId, input) {
    const exists = await prisma.categoryDef.findFirst({
      where: { parentId, name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Bu kategoride aynı isimde alt kategori zaten var.');
    const parent = await prisma.categoryDef.findUnique({ where: { id: parentId } });
    if (!parent || parent.parentId !== null) throw new AdminError('Üst kategori bulunamadı.');
    return prisma.categoryDef.create({
      data: {
        name: input.name.trim(),
        parentId,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const target = await prisma.categoryDef.findUnique({ where: { id } });
      if (!target) throw new AdminError('Kategori bulunamadı.');
      const dup = await prisma.categoryDef.findFirst({
        where: {
          id: { not: id },
          parentId: target.parentId,
          name: { equals: patch.name.trim(), mode: 'insensitive' },
        },
      });
      if (dup) throw new AdminError('Aynı isimde başka kategori var.');
    }
    return prisma.categoryDef.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    const target = await prisma.categoryDef.findUnique({ where: { id }, include: { children: true } });
    if (!target) throw new AdminError('Kategori bulunamadı.');
    // Vakalar denormalized name tutuyor — hard delete OK
    if (target.parentId === null && target.children.length > 0) {
      throw new AdminError(`Bu kategoride ${target.children.length} alt kategori var. Önce sil.`);
    }
    await prisma.categoryDef.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// SLA Policies
// ─────────────────────────────────────────────────────────────────
export const slaPolicyRepo = {
  async list() {
    const all = await prisma.sLAPolicy.findMany({ orderBy: { companyName: 'asc' } });
    return all.map(fromDb);
  },
  async create(input) {
    const dup = await prisma.sLAPolicy.findFirst({
      where: {
        companyId: input.companyId,
        productGroup: input.productGroup,
        categoryName: input.categoryName,
        subCategoryName: input.subCategoryName,
        requestType: toDb({ requestType: input.requestType }).requestType,
      },
    });
    if (dup) throw new AdminError('Aynı 5-tuple eşleşmesinde başka kural zaten var.');
    const created = await prisma.sLAPolicy.create({
      data: {
        ...input,
        requestType: toDb({ requestType: input.requestType }).requestType,
      },
    });
    return fromDb(created);
  },
  async update(id, patch) {
    const dbPatch = toDb(patch);
    // 5-tuple değişiyorsa duplicate kontrolü
    if (
      patch.companyId || patch.productGroup || patch.categoryName ||
      patch.subCategoryName || patch.requestType
    ) {
      const cur = await prisma.sLAPolicy.findUnique({ where: { id } });
      if (!cur) throw new AdminError('Kural bulunamadı.');
      const tuple = {
        companyId: patch.companyId ?? cur.companyId,
        productGroup: patch.productGroup ?? cur.productGroup,
        categoryName: patch.categoryName ?? cur.categoryName,
        subCategoryName: patch.subCategoryName ?? cur.subCategoryName,
        requestType: dbPatch.requestType ?? cur.requestType,
      };
      const dup = await prisma.sLAPolicy.findFirst({ where: { id: { not: id }, ...tuple } });
      if (dup) throw new AdminError('Aynı 5-tuple eşleşmesinde başka kural var.');
    }
    const updated = await prisma.sLAPolicy.update({ where: { id }, data: dbPatch });
    return fromDb(updated);
  },
  async remove(id) {
    await prisma.sLAPolicy.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Checklist Templates
// ─────────────────────────────────────────────────────────────────
export const checklistRepo = {
  async list() {
    return prisma.checklistTemplate.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    const dup = await prisma.checklistTemplate.findFirst({
      where: {
        companyId: input.companyId,
        productGroup: input.productGroup,
        categoryName: input.categoryName,
      },
    });
    if (dup) throw new AdminError('Aynı 3-tuple eşleşmesinde başka kontrol listesi var.');
    return prisma.checklistTemplate.create({
      data: {
        name: input.name.trim(),
        companyId: input.companyId,
        companyName: input.companyName,
        productGroup: input.productGroup,
        categoryName: input.categoryName,
        description: input.description?.trim() || null,
        items: input.items ?? [],
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    return prisma.checklistTemplate.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.items !== undefined && { items: patch.items }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    await prisma.checklistTemplate.delete({ where: { id } });
    return { id, deleted: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Offered Solutions
// ─────────────────────────────────────────────────────────────────
export const offeredSolutionRepo = {
  async list() {
    return prisma.offeredSolutionDef.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    const exists = await prisma.offeredSolutionDef.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (exists) throw new AdminError('Aynı isimde teklif zaten mevcut.');
    return prisma.offeredSolutionDef.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const dup = await prisma.offeredSolutionDef.findFirst({
        where: { id: { not: id }, name: { equals: patch.name.trim(), mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Aynı isimde başka teklif var.');
    }
    return prisma.offeredSolutionDef.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    // Vakalar offeredSolutions'ı JSON ID listesi olarak tutar — usage tespiti
    // raw SQL gerektirir; basit yaklaşım: pasifleştir, yeni vakalarda görünmesin.
    return prisma.offeredSolutionDef.update({
      where: { id },
      data: { isActive: false },
    });
  },
};

export { AdminError };
