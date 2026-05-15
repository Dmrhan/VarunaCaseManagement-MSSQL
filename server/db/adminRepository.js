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
// Teams — multi-tenant: her takım tek bir şirkete bağlı (Phase 1).
// list/create/update operasyonları allowedCompanyIds scope'u içinde çalışır.
// ─────────────────────────────────────────────────────────────────
export const teamRepo = {
  async list(companyId, allowedCompanyIds) {
    const where = {};
    if (companyId) {
      // Explicit companyId verilmişse, kullanıcının erişebildiği şirketler
      // arasında olduğunu doğrula.
      if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
        throw new AdminError('Bu şirket için yetki yok.');
      }
      where.companyId = companyId;
    } else if (allowedCompanyIds) {
      where.companyId = { in: allowedCompanyIds };
    }
    return prisma.team.findMany({ where, orderBy: [{ companyId: 'asc' }, { name: 'asc' }] });
  },
  async create(input, allowedCompanyIds) {
    if (!input.companyId) throw new AdminError('companyId gerekli.');
    if (allowedCompanyIds && !allowedCompanyIds.includes(input.companyId)) {
      throw new AdminError('Bu şirkete takım eklemeye yetkin yok.');
    }
    // Aynı şirket içinde aynı isimde takım kontrolü (cross-company duplicates ok)
    const exists = await prisma.team.findFirst({
      where: {
        companyId: input.companyId,
        name: { equals: input.name.trim(), mode: 'insensitive' },
      },
    });
    if (exists) throw new AdminError('Bu şirkette aynı isimde takım zaten mevcut.');
    return prisma.team.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        companyId: input.companyId,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch, allowedCompanyIds) {
    // Önce target team'in companyId'sini al, scope check
    const target = await prisma.team.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!target) throw new AdminError('Takım bulunamadı.');
    if (allowedCompanyIds && !allowedCompanyIds.includes(target.companyId)) {
      throw new AdminError('Bu takıma erişim yetkin yok.');
    }
    if (patch.name) {
      const dup = await prisma.team.findFirst({
        where: {
          id: { not: id },
          companyId: target.companyId,
          name: { equals: patch.name.trim(), mode: 'insensitive' },
        },
      });
      if (dup) throw new AdminError('Bu şirkette aynı isimde başka takım var.');
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
  async remove(id, allowedCompanyIds) {
    const target = await prisma.team.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!target) throw new AdminError('Takım bulunamadı.');
    if (allowedCompanyIds && !allowedCompanyIds.includes(target.companyId)) {
      throw new AdminError('Bu takıma erişim yetkin yok.');
    }
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
    // Tüm root + child kategoriler — frontend `subCategories` adıyla bekliyor.
    // companyId döndürülür; null = sistem geneli (eski seed verisi). Route
    // handler bu alana göre allowedCompanyIds filtresi uygular.
    const all = await prisma.categoryDef.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: { children: { orderBy: { name: 'asc' } } },
    });
    return all
      .filter((c) => c.parentId === null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        companyId: c.companyId,
        isActive: c.isActive,
        // Prisma relation `children` → frontend `subCategories`
        subCategories: (c.children ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          isActive: s.isActive,
        })),
      }));
  },
  async createParent(input) {
    // Aynı şirket × parent yok scope'unda isim duplication kontrol edilir.
    // Farklı şirketlerin aynı isimde kategorisi olması serbest.
    const exists = await prisma.categoryDef.findFirst({
      where: {
        parentId: null,
        companyId: input.companyId ?? null,
        name: { equals: input.name.trim(), mode: 'insensitive' },
      },
    });
    if (exists) throw new AdminError('Aynı isimde kategori zaten mevcut.');
    return prisma.categoryDef.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        companyId: input.companyId ?? null,
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

// ─────────────────────────────────────────────────────────────────
// Field Definitions (custom fields per company)
// ─────────────────────────────────────────────────────────────────
export const fieldDefinitionRepo = {
  async list(companyId) {
    const where = companyId ? { companyId } : {};
    return prisma.fieldDefinition.findMany({
      where,
      orderBy: [{ companyId: 'asc' }, { displayOrder: 'asc' }, { label: 'asc' }],
    });
  },
  async create(input) {
    if (!input.companyId) throw new AdminError('companyId gerekli.');
    if (!input.label?.trim()) throw new AdminError('label gerekli.');
    if (!input.fieldKey?.trim()) throw new AdminError('fieldKey gerekli.');
    const dup = await prisma.fieldDefinition.findFirst({
      where: { companyId: input.companyId, fieldKey: input.fieldKey.trim() },
    });
    if (dup) throw new AdminError('Bu şirkette aynı fieldKey ile başka tanım var.');
    return prisma.fieldDefinition.create({
      data: {
        companyId: input.companyId,
        label: input.label.trim(),
        fieldKey: input.fieldKey.trim(),
        fieldType: input.fieldType,
        caseType: input.caseType ?? null,
        isRequired: input.isRequired ?? false,
        displayOrder: input.displayOrder ?? 0,
        options: input.options ?? null,
        isActive: input.isActive ?? true,
      },
    });
  },
  async update(id, patch) {
    if (patch.fieldKey) {
      const cur = await prisma.fieldDefinition.findUnique({ where: { id } });
      if (!cur) throw new AdminError('Tanım bulunamadı.');
      const dup = await prisma.fieldDefinition.findFirst({
        where: {
          id: { not: id },
          companyId: cur.companyId,
          fieldKey: patch.fieldKey.trim(),
        },
      });
      if (dup) throw new AdminError('Bu fieldKey aynı şirkette başka tanımda kullanılıyor.');
    }
    return prisma.fieldDefinition.update({
      where: { id },
      data: {
        ...(patch.label !== undefined && { label: patch.label.trim() }),
        ...(patch.fieldKey !== undefined && { fieldKey: patch.fieldKey.trim() }),
        ...(patch.fieldType !== undefined && { fieldType: patch.fieldType }),
        ...(patch.caseType !== undefined && { caseType: patch.caseType }),
        ...(patch.isRequired !== undefined && { isRequired: patch.isRequired }),
        ...(patch.displayOrder !== undefined && { displayOrder: patch.displayOrder }),
        ...(patch.options !== undefined && { options: patch.options }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
  },
  async remove(id) {
    // Vakaların customFields'ında kullanılıyor olabilir — pasifleştir, hard delete yok
    return prisma.fieldDefinition.update({
      where: { id },
      data: { isActive: false },
    });
  },
};

// ─────────────────────────────────────────────────────────────────
// Company Settings (1-1 with Company, upsert tabanlı)
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// Users — Phase 5B: user-company assignment UI için.
//
// Erişim kuralları (route layer):
//   list:          Admin/SystemAdmin (Admin sadece allowedCompanyIds'indeki
//                  şirketlere atanmış kullanıcıları görür).
//   replace assg:  Requesting user'ın hedef assignment'lardaki TÜM companyId'lere
//                  Admin/SystemAdmin yetkisi olmalı.
//
// SystemAdmin (sistem rolü): UserCompany kayıtları kalsın ama UI bunu
// salt-okunur gösterir; verifyJwt zaten tüm aktif şirketleri runtime'da ekliyor.
// ─────────────────────────────────────────────────────────────────
const VALID_COMPANY_ROLES = new Set(['Agent', 'Supervisor', 'Admin', 'SystemAdmin']);
// User.role (UserRole enum) icin invite akisinda kabul edilen sistem rolleri.
// SystemAdmin invite UI'dan kabul edilmez — seedAuth-equivalent islem.
const INVITABLE_SYSTEM_ROLES = new Set(['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin']);
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const userRepo = {
  async list(allowedCompanyIds) {
    // Admin/SystemAdmin: SystemAdmin için allowedCompanyIds undefined (route
    // layer öyle gönderir), Admin için kendi şirketleri.
    const where = allowedCompanyIds
      ? {
          OR: [
            { role: 'SystemAdmin' }, // SystemAdmin'ler her zaman görünür (Admin onları görüp pasifleştiremez ama listede)
            { companies: { some: { companyId: { in: allowedCompanyIds }, isActive: true } } },
          ],
        }
      : {};
    const users = await prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
      include: {
        companies: {
          where: { isActive: true },
          select: { companyId: true, role: true, company: { select: { name: true, isActive: true } } },
        },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      isActive: u.isActive,
      personId: u.personId,
      assignments: u.companies.map((uc) => ({
        companyId: uc.companyId,
        companyName: uc.company.name,
        companyActive: uc.company.isActive,
        role: uc.role,
      })),
    }));
  },

  /**
   * Replace user's company assignments — full diff: gelen liste tek doğru.
   * Caller (route) yetki kontrolü:
   *   - assignments[].companyId TÜMÜ requestingUser.allowedCompanyIds'inde
   *     OLMALI (route'ta verify edilir).
   *   - assignments[].role 'Agent' | 'Supervisor' | 'Admin' (SystemAdmin atama
   *     yalnızca seedAuth-equivalent — UI/route burayı engellesin).
   * Edge: empty assignments → AdminError (en az 1 şirket).
   */
  async replaceCompanies(userId, assignments, allowedCompanyIds) {
    if (!Array.isArray(assignments) || assignments.length === 0) {
      throw new AdminError('En az bir şirket ataması gerekli.');
    }
    for (const a of assignments) {
      if (!a.companyId) throw new AdminError('Atamalardan birinde companyId eksik.');
      if (!VALID_COMPANY_ROLES.has(a.role)) {
        throw new AdminError(`Geçersiz rol: ${a.role}`);
      }
      // 'SystemAdmin' atamayı UI'dan kabul etmiyoruz — sadece sistem-rolü
      // SystemAdmin user'lar için seedAuth'da yapılır, runtime'da verifyJwt
      // tüm şirketlere otomatik ekler.
      if (a.role === 'SystemAdmin') {
        throw new AdminError('SystemAdmin per-company atanamaz; sistem rolüyle yönetilir.');
      }
      if (allowedCompanyIds && !allowedCompanyIds.includes(a.companyId)) {
        throw new AdminError(`${a.companyId} için yetkin yok.`, 403);
      }
    }
    // Hedef user var mı + SystemAdmin değil mi (sistem rolü değiştirilemez)
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, fullName: true },
    });
    if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (target.role === 'SystemAdmin') {
      throw new AdminError('SystemAdmin sistem rolüne sahip kullanıcının ataması değiştirilemez.', 403);
    }

    // Diff: aynı companyId ise role update; yeni ise create; eski ama yeni yoksa deactivate.
    // Mevcut atamalar (aktif olanlar)
    const existing = await prisma.userCompany.findMany({
      where: { userId, isActive: true },
      select: { companyId: true, role: true },
    });
    const desiredMap = new Map(assignments.map((a) => [a.companyId, a.role]));
    const existingMap = new Map(existing.map((e) => [e.companyId, e.role]));

    await prisma.$transaction(async (tx) => {
      // Yeni veya güncel → upsert
      for (const [companyId, role] of desiredMap) {
        await tx.userCompany.upsert({
          where: { userId_companyId: { userId, companyId } },
          update: { role, isActive: true },
          create: { userId, companyId, role, isActive: true },
        });
      }
      // Eski ama yeni listede yok → deactivate
      for (const [companyId] of existingMap) {
        if (!desiredMap.has(companyId)) {
          await tx.userCompany.updateMany({
            where: { userId, companyId },
            data: { isActive: false },
          });
        }
      }
    });

    return { id: userId, fullName: target.fullName, assignments };
  },

  /**
   * Admin'den davet akisi (Phase 5C):
   *  1) Supabase Auth `inviteUserByEmail` — kullaniciya magic-link davet maili
   *  2) Donen supabase user id ile DB User satiri yarat
   *  3) UserCompany ataması yap
   *
   * Eger DB yazma asamasi basarisiz olursa Supabase user'i geri al
   * (`auth.admin.deleteUser`) — orphan birakmamak icin best-effort cleanup.
   * fullName placeholder olarak email saklanir; kullanici ilk login'inde
   * Supabase'den gelen `user_metadata.full_name` ile auto-update edilebilir
   * (verifyJwt auto-provision kodunda var; biz davet edileni overwrite etmeyiz —
   * UI placeholder badge bunu "Davet bekliyor" gosterir).
   *
   * @param {object} input
   * @param {string} input.email
   * @param {string} input.role             — sistem rolu (User.role)
   * @param {string} input.companyId
   * @param {string} input.companyRole      — UserCompany.role
   * @param {object} deps                   — DI: { supabaseAdmin, redirectTo }
   * @param {string[]} allowedCompanyIds    — caller'in yetki sinirlari (null=SystemAdmin)
   */
  async invite(input, deps, allowedCompanyIds) {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email || !EMAIL_RX.test(email)) {
      throw new AdminError('Geçerli bir e-posta adresi gerekli.', 400);
    }
    const role = String(input.role ?? '');
    if (!INVITABLE_SYSTEM_ROLES.has(role)) {
      throw new AdminError(`Geçersiz sistem rolü: ${role}`, 400);
    }
    const companyId = String(input.companyId ?? '');
    if (!companyId) throw new AdminError('companyId zorunlu.', 400);
    if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
      throw new AdminError('Bu şirkete davet etme yetkin yok.', 403);
    }
    const companyRole = String(input.companyRole ?? '');
    if (!VALID_COMPANY_ROLES.has(companyRole) || companyRole === 'SystemAdmin') {
      throw new AdminError('Şirket rolü Agent / Supervisor / Admin olmalı.', 400);
    }

    // E-posta zaten kayitli mi?
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AdminError('Bu e-posta zaten kayıtlı.', 409);
    }

    // 1) Supabase Auth davet
    const { supabaseAdmin, redirectTo } = deps ?? {};
    if (!supabaseAdmin) throw new AdminError('Supabase admin istemcisi yok.', 500);
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (inviteErr || !invited?.user?.id) {
      // Supabase 422 = e-posta zaten Auth'ta (DB'de yok ama Auth'ta orphan)
      const status = inviteErr?.status === 422 ? 409 : 502;
      const msg = inviteErr?.status === 422
        ? 'Bu e-posta Supabase Auth\'ta zaten kayıtlı (orphan). Önce orphan kaydı temizle.'
        : `Supabase davet hatası: ${inviteErr?.message ?? 'bilinmeyen'}`;
      throw new AdminError(msg, status);
    }
    const supabaseUserId = invited.user.id;

    // 2) DB User + 3) UserCompany — TEK transaction. Basarisiz olursa Supabase
    // user'i geri al (compensation; idempotent — Supabase'da silinme idempotent).
    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: supabaseUserId,
            email,
            fullName: email, // placeholder; first-login sonrasi UI "Davet bekliyor" badge gizler
            role,
            isActive: true,
          },
        });
        await tx.userCompany.create({
          data: { userId: user.id, companyId, role: companyRole, isActive: true },
        });
        return user;
      });
      return {
        success: true,
        message: `Davet maili gönderildi: ${email}`,
        userId: created.id,
        email: created.email,
      };
    } catch (dbErr) {
      // Compensation: Supabase user'i geri al
      try {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
        console.warn(`[invite] DB hata sonrasi Supabase user temizlendi: ${email}`);
      } catch (cleanupErr) {
        console.error(`[invite] CRITICAL: Supabase user ${supabaseUserId} temizlenemedi:`, cleanupErr?.message);
      }
      throw new AdminError(`Kullanıcı DB'ye yazılamadı: ${dbErr?.message ?? 'unknown'}`, 500);
    }
  },

  /**
   * Pasiflestir: User.isActive=false. Aktif Supabase oturumlarini global
   * sign-out ile sonlandirir. Supabase Auth user'i SILINMEZ — tekrar
   * aktiflestirilebilsin. UserCompany kayitlarinda dokunma yapmaz (yetki cascaded
   * fakat veri korunur).
   *
   * Guards:
   *  - Kendini pasiflestiremezsin
   *  - SystemAdmin kullanicilari Admin pasiflestiremez (sadece SystemAdmin)
   *  - Hedef en az bir companyId'sinde requesting user Admin/SystemAdmin olmali
   *    (route layer assertCompanyAdmin ile dogrular — buraya gelmeden once)
   */
  async deactivate(userId, deps, requestingUser) {
    if (!userId) throw new AdminError('userId gerekli.', 400);
    if (userId === requestingUser?.id) {
      throw new AdminError('Kendi hesabını pasifleştiremezsin.', 400);
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (target.role === 'SystemAdmin' && requestingUser?.role !== 'SystemAdmin') {
      throw new AdminError('SystemAdmin kullanıcıyı yalnızca SystemAdmin pasifleştirebilir.', 403);
    }
    if (!target.isActive) {
      return { success: true, message: 'Zaten pasif.', userId, email: target.email };
    }

    // 1) DB: isActive = false
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    // 2) Supabase: aktif oturumlari sonlandir (best-effort; DB ana otorite)
    const { supabaseAdmin } = deps ?? {};
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.auth.admin.signOut(userId, 'global');
      } catch (err) {
        // Supabase tarafindan sign-out basarisiz olsa bile DB isActive=false
        // verifyJwt ilk istekte 403 'inactive' dondurur — kapsam guvende.
        console.warn(`[deactivate] Supabase signOut basarisiz (DB guvende):`, err?.message);
      }
    }
    return { success: true, message: 'Kullanıcı pasifleştirildi.', userId, email: target.email };
  },
};

// ─────────────────────────────────────────────────────────────────
// Companies — Phase 5A: company management UI için CRUD
//
// Erişim kuralları (route layer'da uygulanır):
//   list   → tüm Admin/SystemAdmin (kendi allowedCompanyIds'i)
//   create → SystemAdmin only
//   update → o şirkette Admin/SystemAdmin yetkisi (assertCompanyAdmin)
//   remove → SystemAdmin only (soft delete: isActive=false)
//
// Create akışında: Company satırı + boş CompanySettings tek transaction'da.
// CompanySettings.companyId @id (1-1) olduğu için Company silindiğinde manuel
// cleanup gerekir; ama soft delete (isActive=false) FK kalır, settings kalır.
// ─────────────────────────────────────────────────────────────────
export const companyRepo = {
  async list(allowedCompanyIds) {
    const where = allowedCompanyIds ? { id: { in: allowedCompanyIds } } : {};
    const companies = await prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { settings: true, _count: { select: { userCompanies: true } } },
    });
    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      logoUrl: c.settings?.logoUrl ?? null,
      primaryColor: c.settings?.primaryColor ?? null,
      appName: c.settings?.appName ?? null,
      supportEmail: c.settings?.supportEmail ?? null,
      userCount: c._count.userCompanies,
    }));
  },

  async create(input) {
    if (!input.name?.trim()) throw new AdminError('Şirket adı gerekli.');
    const dup = await prisma.company.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (dup) throw new AdminError('Bu isimde şirket zaten var.');

    // Company + CompanySettings tek transaction
    const created = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: input.name.trim(),
          isActive: input.isActive ?? true,
        },
      });
      await tx.companySettings.create({
        data: {
          companyId: company.id,
          logoUrl: input.logoUrl?.trim() || null,
          primaryColor: input.primaryColor?.trim() || null,
          appName: input.appName?.trim() || null,
          supportEmail: input.supportEmail?.trim() || null,
        },
      });
      return company;
    });
    return { id: created.id, name: created.name, isActive: created.isActive };
  },

  async update(id, patch) {
    const target = await prisma.company.findUnique({ where: { id } });
    if (!target) throw new AdminError('Şirket bulunamadı.', 404);
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new AdminError('Şirket adı boş olamaz.');
      const dup = await prisma.company.findFirst({
        where: { id: { not: id }, name: { equals: trimmed, mode: 'insensitive' } },
      });
      if (dup) throw new AdminError('Bu isimde başka şirket var.');
    }

    // Company alanları (name, isActive) + CompanySettings (branding) ayrı tablolar.
    // Tek transaction'da güncelle.
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.company.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name.trim() }),
          ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        },
      });
      const hasBranding =
        patch.logoUrl !== undefined ||
        patch.primaryColor !== undefined ||
        patch.appName !== undefined ||
        patch.supportEmail !== undefined;
      if (hasBranding) {
        await tx.companySettings.upsert({
          where: { companyId: id },
          update: {
            ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl?.trim() || null }),
            ...(patch.primaryColor !== undefined && { primaryColor: patch.primaryColor?.trim() || null }),
            ...(patch.appName !== undefined && { appName: patch.appName?.trim() || null }),
            ...(patch.supportEmail !== undefined && { supportEmail: patch.supportEmail?.trim() || null }),
          },
          create: {
            companyId: id,
            logoUrl: patch.logoUrl?.trim() || null,
            primaryColor: patch.primaryColor?.trim() || null,
            appName: patch.appName?.trim() || null,
            supportEmail: patch.supportEmail?.trim() || null,
          },
        });
      }
      return c;
    });
    return { id: updated.id, name: updated.name, isActive: updated.isActive };
  },

  async remove(id) {
    // Soft delete — isActive=false. Hard delete tehlikeli (Cases, Teams, vs FK).
    const target = await prisma.company.findUnique({ where: { id } });
    if (!target) throw new AdminError('Şirket bulunamadı.', 404);
    if (!target.isActive) {
      return { id, deactivated: true, alreadyInactive: true };
    }
    await prisma.company.update({ where: { id }, data: { isActive: false } });
    return { id, deactivated: true };
  },
};

// ─────────────────────────────────────────────────────────────────
// Knowledge Sources — Faz 1.5 Madde 6.
// "AI neye bakıyor?" şeffaflık paneli için kayıt defteri. Otomatik
// ingestion/embedding YOK — sadece kaynak kataloğu. contentCount admin'in
// raporladığı veya seed sırasında ilgili tablodan sayılan değer.
// ─────────────────────────────────────────────────────────────────

const VALID_SOURCE_TYPES = new Set([
  'PastCases',
  'ProductDocs',
  'SLARules',
  'Checklists',
  'ManualEntry',
]);

/**
 * autoPopulateIfEmpty: o şirkette hiç kaynak yoksa ilgili tablolardan
 * sayım çekip 4 default kaynak yarat. CategoryDef için null companyId'leri
 * de dahil (sistem geneli kategoriler her şirkete dahildir).
 */
async function autoPopulateIfEmpty(companyId) {
  const existing = await prisma.knowledgeSource.count({ where: { companyId } });
  if (existing > 0) return 0;

  const [caseCount, slaCount, checklistCount, categoryCount] = await Promise.all([
    prisma.case.count({ where: { companyId } }),
    prisma.sLAPolicy.count({ where: { companyId } }),
    prisma.checklistTemplate.count({ where: { companyId } }),
    prisma.categoryDef.count({
      where: { OR: [{ companyId }, { companyId: null }] },
    }),
  ]);

  await prisma.knowledgeSource.createMany({
    data: [
      {
        companyId,
        name: 'Geçmiş Vakalar',
        sourceType: 'PastCases',
        contentCount: caseCount,
        description: 'Çözülmüş vakalar — AI Araştırıcı rolü benzer geçmiş vakalardan öneri çıkarır.',
      },
      {
        companyId,
        name: 'Kategori Tanımları',
        sourceType: 'ProductDocs',
        contentCount: categoryCount,
        description: 'Şirkete özel + sistem geneli kategori/alt kategori yapısı.',
      },
      {
        companyId,
        name: 'SLA Kuralları',
        sourceType: 'SLARules',
        contentCount: slaCount,
        description: 'Kategori + alt kategori + talep türü bazında yanıt/çözüm süresi kuralları.',
      },
      {
        companyId,
        name: 'Kontrol Listeleri',
        sourceType: 'Checklists',
        contentCount: checklistCount,
        description: 'Vaka tipine göre tetiklenen zorunlu adım şablonları.',
      },
    ],
  });
  return 4;
}

/**
 * refreshSystemCounts: Bir sirketin 4 sistem kaynaginin (PastCases /
 * ProductDocs / SLARules / Checklists) contentCount alanlarini gercek
 * tablolardan tekrar sayar ve sapan kayitlari guncelller.
 *
 * - ManualEntry tipinde olanlara DOKUNULMAZ (admin tarafindan yonetiliyor)
 * - Sadece SAPMA varsa write yapilir; aksi halde gereksiz I/O yok
 * - `lastUpdated` yalnizca degisiklik halinde guncellenir
 *
 * Phase 1 hotfix (knowledge-sources-contentcount-refresh): list cagrisinda
 * cagrilarak admin'in gordugu sayilarin "AI buna baktigi tablonun gercek
 * boyutuyla" uyumlu kalmasini saglar.
 */
async function refreshSystemCounts(companyId) {
  const [caseCount, slaCount, checklistCount, categoryCount] = await Promise.all([
    prisma.case.count({ where: { companyId } }),
    prisma.sLAPolicy.count({ where: { companyId } }),
    prisma.checklistTemplate.count({ where: { companyId } }),
    prisma.categoryDef.count({
      where: { OR: [{ companyId }, { companyId: null }] },
    }),
  ]);
  const target = {
    PastCases: caseCount,
    ProductDocs: categoryCount,
    SLARules: slaCount,
    Checklists: checklistCount,
  };
  // Sistem 4 tipinden o sirkette olanlari cek, drift'leri tek tek guncelle
  const existing = await prisma.knowledgeSource.findMany({
    where: {
      companyId,
      sourceType: { in: ['PastCases', 'ProductDocs', 'SLARules', 'Checklists'] },
    },
    select: { id: true, sourceType: true, contentCount: true },
  });
  const now = new Date();
  await Promise.all(
    existing
      .filter((row) => target[row.sourceType] !== row.contentCount)
      .map((row) =>
        prisma.knowledgeSource.update({
          where: { id: row.id },
          data: { contentCount: target[row.sourceType], lastUpdated: now },
        }),
      ),
  );
}

export const knowledgeSourceRepo = {
  /**
   * Kullanıcının erişebildiği şirketler için kaynak listesi.
   * Eğer tek şirket görünüyor ve hiç kaynak yoksa otomatik 4 default yaratılır.
   * Multi-company kullanıcı için her şirketi ayrı ayrı populate ederiz.
   * Her çağrıda sistem kaynaklarinin contentCount'lari canli tablo
   * sayilariyla senkronize edilir (Faz 1 hotfix — bayatlamayı önler).
   */
  async list(allowedCompanyIds) {
    if (!allowedCompanyIds || allowedCompanyIds.length === 0) return [];
    // Her şirket için: önce boşsa auto-populate, sonra sistem 4 kaynagini tazele.
    for (const cid of allowedCompanyIds) {
      await autoPopulateIfEmpty(cid);
      await refreshSystemCounts(cid);
    }
    return prisma.knowledgeSource.findMany({
      where: { companyId: { in: allowedCompanyIds } },
      orderBy: [{ companyId: 'asc' }, { sourceType: 'asc' }, { name: 'asc' }],
    });
  },

  async create(input, allowedCompanyIds) {
    if (!input.name?.trim()) throw new AdminError('Ad gerekli.');
    if (!VALID_SOURCE_TYPES.has(input.sourceType)) {
      throw new AdminError(`Geçersiz kaynak türü: ${input.sourceType}`);
    }
    const companyId = input.companyId || allowedCompanyIds?.[0];
    if (!companyId) throw new AdminError('companyId belirlenemedi.');
    if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
      throw new AdminError('Bu şirkete kaynak eklemeye yetkin yok.', 403);
    }
    return prisma.knowledgeSource.create({
      data: {
        companyId,
        name: input.name.trim(),
        sourceType: input.sourceType,
        description: input.description?.trim() || null,
        contentCount: Number.isFinite(input.contentCount) ? Math.max(0, input.contentCount) : 0,
        isActive: input.isActive ?? true,
      },
    });
  },

  async update(id, patch, allowedCompanyIds) {
    const target = await prisma.knowledgeSource.findUnique({ where: { id } });
    if (!target) throw new AdminError('Kaynak bulunamadı.', 404);
    if (allowedCompanyIds && !allowedCompanyIds.includes(target.companyId)) {
      throw new AdminError('Bu kaynağa erişim yetkin yok.', 403);
    }
    if (patch.sourceType && !VALID_SOURCE_TYPES.has(patch.sourceType)) {
      throw new AdminError(`Geçersiz kaynak türü: ${patch.sourceType}`);
    }
    return prisma.knowledgeSource.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.sourceType !== undefined && { sourceType: patch.sourceType }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.contentCount !== undefined && {
          contentCount: Math.max(0, Number(patch.contentCount) || 0),
        }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        lastUpdated: new Date(),
      },
    });
  },
};

export const companySettingsRepo = {
  async get(companyId) {
    return prisma.companySettings.findUnique({ where: { companyId } });
  },
  async upsert(companyId, patch) {
    return prisma.companySettings.upsert({
      where: { companyId },
      update: {
        ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl }),
        ...(patch.primaryColor !== undefined && { primaryColor: patch.primaryColor }),
        ...(patch.appName !== undefined && { appName: patch.appName }),
        ...(patch.supportEmail !== undefined && { supportEmail: patch.supportEmail }),
      },
      create: {
        companyId,
        logoUrl: patch.logoUrl ?? null,
        primaryColor: patch.primaryColor ?? null,
        appName: patch.appName ?? null,
        supportEmail: patch.supportEmail ?? null,
      },
    });
  },
};

export { AdminError };
