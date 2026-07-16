import bcrypt from 'bcryptjs';
import { prisma } from './client.js';
import { fromDb, toDb } from './enumMap.js';
import { assertActorObject } from '../lib/actor.js';
import { invalidateWorkCalendarCache } from '../lib/sla/businessTime.js';
import { getTrHolidays } from '../lib/sla/trHolidays.js';

/**
 * PR-3 follow-up (Codex P2) — Audit field corruption guard.
 *
 * Admin route'ları req.body'yi passthrough yapıyor; toDb() bilinmeyen
 * field'ları korur. Eğer client body'de createdByUserId/updatedByUserId
 * gönderirse, repository'deki `data: { ...patch, updatedByUserId: actor.userId }`
 * spread'i yalnız updatedByUserId'yi override eder — createdByUserId
 * client'in attacker değerine kayar. Server-authoritative audit
 * korumasını kıran kritik bug.
 *
 * Fix: tüm update/create input'larından audit field'larını strip et.
 * Server her zaman actor.userId'den yazar.
 */
function stripAuditFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  delete out.createdByUserId;
  delete out.updatedByUserId;
  return out;
}

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
  async list(companyId) {
    const where = companyId ? { companyId } : {};
    return prisma.thirdParty.findMany({ where, orderBy: { name: 'asc' } });
  },
  async create(input) {
    const companyId = input.companyId ?? null;
    const exists = await prisma.thirdParty.findFirst({
      where: { name: { equals: input.name.trim() }, companyId },
    });
    if (exists) throw new AdminError('Aynı isimde 3. parti bu şirkette zaten mevcut.');
    return prisma.thirdParty.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive ?? true,
        companyId,
        pausesSla: input.pausesSla !== false, // default true; undefined → true
        // Uzatılmış SLA v1 (U-B) — iki parçalı tetik; default'lar fail-safe
        // (uygular=false, DevOps-şartı=true).
        triggersExtendedSla: input.triggersExtendedSla === true,
        extendedSlaRequiresDevopsLink: input.extendedSlaRequiresDevopsLink !== false,
      },
    });
  },
  async update(id, patch) {
    if (patch.name) {
      const current = await prisma.thirdParty.findUnique({ where: { id }, select: { companyId: true } });
      const dup = await prisma.thirdParty.findFirst({
        where: { id: { not: id }, name: { equals: patch.name.trim() }, companyId: current?.companyId ?? null },
      });
      if (dup) throw new AdminError('Aynı isimde başka 3. parti var.');
    }
    return prisma.thirdParty.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...(patch.pausesSla !== undefined && { pausesSla: patch.pausesSla }),
        ...(patch.triggersExtendedSla !== undefined && { triggersExtendedSla: !!patch.triggersExtendedSla }),
        ...(patch.extendedSlaRequiresDevopsLink !== undefined && { extendedSlaRequiresDevopsLink: !!patch.extendedSlaRequiresDevopsLink }),
      },
    });
  },
  async remove(id) {
    const usage = await prisma.case.count({ where: { thirdPartyId: id } });
    if (usage > 0) {
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
      where: { name: { equals: input.name.trim() } },
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
        where: { id: { not: id }, name: { equals: patch.name.trim() } },
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
  async create(input, allowedCompanyIds, actor) {
    // PR-3 — admin audit attribution: req.user.id createdBy/updatedBy.
    assertActorObject(actor, 'teamRepo.create');
    if (!input.companyId) throw new AdminError('companyId gerekli.');
    if (allowedCompanyIds && !allowedCompanyIds.includes(input.companyId)) {
      throw new AdminError('Bu şirkete takım eklemeye yetkin yok.');
    }
    // Aynı şirket içinde aynı isimde takım kontrolü (cross-company duplicates ok)
    const exists = await prisma.team.findFirst({
      where: {
        companyId: input.companyId,
        name: { equals: input.name.trim() },
      },
    });
    if (exists) throw new AdminError('Bu şirkette aynı isimde takım zaten mevcut.');
    const defaultSupportLevel = normalizeSupportLevel(input.defaultSupportLevel);
    return prisma.team.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        companyId: input.companyId,
        isActive: input.isActive ?? true,
        ...(defaultSupportLevel !== undefined && { defaultSupportLevel }),
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },
  async update(id, patch, allowedCompanyIds, actor) {
    assertActorObject(actor, 'teamRepo.update');
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
          name: { equals: patch.name.trim() },
        },
      });
      if (dup) throw new AdminError('Bu şirkette aynı isimde başka takım var.');
    }
    const defaultSupportLevel = normalizeSupportLevel(patch.defaultSupportLevel);
    return prisma.team.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...(defaultSupportLevel !== undefined && { defaultSupportLevel }),
        updatedByUserId: actor.userId,
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
const VALID_SUPPORT_LEVELS = new Set(['L1', 'L2', 'L3', 'Expert']);
function normalizeSupportLevel(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return undefined;
  const s = String(raw).trim();
  if (!VALID_SUPPORT_LEVELS.has(s)) {
    // WR-A6 follow-up — explicit error code so client/smoke can dispatch.
    const err = new AdminError('Geçersiz destek seviyesi (L1/L2/L3/Expert).', 400);
    err.code = 'support_level_invalid';
    throw err;
  }
  return s;
}

/**
 * WR-B1 review fix — Team lead invariant: a Person can be isTeamLead=true
 * only when an effective teamId is set. Throws AdminError(400) with code
 * `team_lead_requires_team` on violation.
 *
 * Inputs are "effective" values (already merged from patch + existing row by
 * caller for the update path). Empty string treated as null/missing.
 */
function assertTeamLeadInvariant({ effectiveIsTeamLead, effectiveTeamId }) {
  if (!effectiveIsTeamLead) return;
  const hasTeam = typeof effectiveTeamId === 'string' && effectiveTeamId.trim().length > 0;
  if (!hasTeam) {
    const err = new AdminError(
      'Takım lideri olabilmek için bir takıma bağlı olmalı.',
      400,
    );
    err.code = 'team_lead_requires_team';
    throw err;
  }
}

export const personRepo = {
  async list() {
    return prisma.person.findMany({ orderBy: { name: 'asc' } });
  },
  async create(input) {
    if (input.email) {
      const dup = await prisma.person.findFirst({
        where: { email: { equals: input.email.trim() } },
      });
      if (dup) throw new AdminError('Bu e-posta adresiyle başka kullanıcı var.');
    }
    const supportLevel = normalizeSupportLevel(input.supportLevel);

    // WR-B1 review fix — isTeamLead=true must come with an effective teamId.
    assertTeamLeadInvariant({
      effectiveIsTeamLead: !!input.isTeamLead,
      effectiveTeamId: input.teamId,
    });

    return prisma.person.create({
      data: {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        teamId: input.teamId,
        isActive: input.isActive ?? true,
        // WR-A5 / B1
        ...(supportLevel !== undefined && { supportLevel }),
        ...(input.isTeamLead !== undefined && { isTeamLead: !!input.isTeamLead }),
        // Compose-Signature F1 — opsiyonel title
        ...(input.title !== undefined && {
          title: typeof input.title === 'string' && input.title.trim()
            ? input.title.trim() : null,
        }),
      },
    });
  },
  async update(id, patch) {
    if (patch.email) {
      const dup = await prisma.person.findFirst({
        where: { id: { not: id }, email: { equals: patch.email.trim() } },
      });
      if (dup) throw new AdminError('Bu e-posta adresiyle başka kullanıcı var.');
    }
    const supportLevel = normalizeSupportLevel(patch.supportLevel);

    // WR-B1 review fix — compute effective (teamId, isTeamLead) AFTER patch.
    //   patch.teamId === undefined → keep existing (need a single fetch)
    //   patch.teamId === null/''    → cleared
    //   patch.isTeamLead === undefined → keep existing
    const teamIdInPatch = 'teamId' in patch;
    const isTeamLeadInPatch = 'isTeamLead' in patch;
    let effectiveTeamId;
    let effectiveIsTeamLead;
    if (teamIdInPatch && isTeamLeadInPatch) {
      effectiveTeamId = patch.teamId;
      effectiveIsTeamLead = !!patch.isTeamLead;
    } else {
      const existing = await prisma.person.findUnique({
        where: { id },
        select: { teamId: true, isTeamLead: true },
      });
      if (!existing) throw new AdminError('Kişi bulunamadı.', 404);
      effectiveTeamId = teamIdInPatch ? patch.teamId : existing.teamId;
      effectiveIsTeamLead = isTeamLeadInPatch ? !!patch.isTeamLead : existing.isTeamLead;
    }
    assertTeamLeadInvariant({ effectiveIsTeamLead, effectiveTeamId });

    return prisma.person.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.email !== undefined && { email: patch.email?.trim() || null }),
        ...(patch.teamId !== undefined && { teamId: patch.teamId }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        // WR-A5 / B1
        ...(supportLevel !== undefined && { supportLevel }),
        ...(patch.isTeamLead !== undefined && { isTeamLead: !!patch.isTeamLead }),
        // Compose-Signature F1 — opsiyonel title; boş string → null (temizleme)
        ...(patch.title !== undefined && {
          title: typeof patch.title === 'string' && patch.title.trim()
            ? patch.title.trim() : null,
        }),
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
  async createParent(input, actor) {
    // PR-3 — admin audit attribution.
    assertActorObject(actor, 'categoryRepo.createParent');
    // Aynı şirket × parent yok scope'unda isim duplication kontrol edilir.
    // Farklı şirketlerin aynı isimde kategorisi olması serbest.
    const exists = await prisma.categoryDef.findFirst({
      where: {
        parentId: null,
        companyId: input.companyId ?? null,
        name: { equals: input.name.trim() },
      },
    });
    if (exists) throw new AdminError('Aynı isimde kategori zaten mevcut.');
    return prisma.categoryDef.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        companyId: input.companyId ?? null,
        isActive: input.isActive ?? true,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },
  async createSub(parentId, input, actor) {
    assertActorObject(actor, 'categoryRepo.createSub');
    const exists = await prisma.categoryDef.findFirst({
      where: { parentId, name: { equals: input.name.trim() } },
    });
    if (exists) throw new AdminError('Bu kategoride aynı isimde alt kategori zaten var.');
    const parent = await prisma.categoryDef.findUnique({ where: { id: parentId } });
    if (!parent || parent.parentId !== null) throw new AdminError('Üst kategori bulunamadı.');
    return prisma.categoryDef.create({
      data: {
        name: input.name.trim(),
        parentId,
        isActive: input.isActive ?? true,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },
  async update(id, patch, actor) {
    assertActorObject(actor, 'categoryRepo.update');
    if (patch.name) {
      const target = await prisma.categoryDef.findUnique({ where: { id } });
      if (!target) throw new AdminError('Kategori bulunamadı.');
      const dup = await prisma.categoryDef.findFirst({
        where: {
          id: { not: id },
          parentId: target.parentId,
          name: { equals: patch.name.trim() },
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
        updatedByUserId: actor.userId,
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
  async create(input, actor) {
    // PR-3 — admin audit attribution.
    assertActorObject(actor, 'slaPolicyRepo.create');
    // Codex P2 — client body audit field strip
    const safeInput = stripAuditFields(input);
    const dup = await prisma.sLAPolicy.findFirst({
      where: {
        companyId: safeInput.companyId,
        productGroup: safeInput.productGroup ?? null,
        categoryName: safeInput.categoryName ?? null,
        subCategoryName: safeInput.subCategoryName ?? null,
        requestType: toDb({ requestType: safeInput.requestType }).requestType ?? null,
        priority: safeInput.priority ?? null,
      },
    });
    if (dup) throw new AdminError('Aynı tuple eşleşmesinde başka kural zaten var.');
    const created = await prisma.sLAPolicy.create({
      data: {
        ...safeInput,
        requestType: toDb({ requestType: safeInput.requestType }).requestType ?? null,
        priority: safeInput.priority ?? null,
        // Uzatılmış SLA v1 — yalnız pozitif tam dakika; aksi her değer null
        // (fail-safe: bozuk giriş uzatma tanımlamış SAYILMAZ).
        extendedResolutionMin:
          Number.isInteger(safeInput.extendedResolutionMin) && safeInput.extendedResolutionMin > 0
            ? safeInput.extendedResolutionMin
            : null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    return fromDb(created);
  },
  async update(id, patch, actor) {
    assertActorObject(actor, 'slaPolicyRepo.update');
    // Codex P2 — client body'sinde createdByUserId/updatedByUserId varsa strip
    const dbPatch = stripAuditFields(toDb(patch));
    // Uzatılmış SLA v1 — normalize: pozitif tam dakika değilse null.
    if ('extendedResolutionMin' in dbPatch) {
      dbPatch.extendedResolutionMin =
        Number.isInteger(dbPatch.extendedResolutionMin) && dbPatch.extendedResolutionMin > 0
          ? dbPatch.extendedResolutionMin
          : null;
    }
    // 5-tuple değişiyorsa duplicate kontrolü
    if (
      patch.companyId || patch.productGroup || patch.categoryName ||
      patch.subCategoryName || patch.requestType || 'priority' in patch
    ) {
      const cur = await prisma.sLAPolicy.findUnique({ where: { id } });
      if (!cur) throw new AdminError('Kural bulunamadı.');
      const tuple = {
        companyId: patch.companyId ?? cur.companyId,
        productGroup: 'productGroup' in patch ? (patch.productGroup ?? null) : cur.productGroup,
        categoryName: 'categoryName' in patch ? (patch.categoryName ?? null) : cur.categoryName,
        subCategoryName: 'subCategoryName' in patch ? (patch.subCategoryName ?? null) : cur.subCategoryName,
        requestType: dbPatch.requestType !== undefined ? (dbPatch.requestType ?? null) : cur.requestType,
        priority: 'priority' in patch ? (patch.priority ?? null) : cur.priority,
      };
      const dup = await prisma.sLAPolicy.findFirst({ where: { id: { not: id }, ...tuple } });
      if (dup) throw new AdminError('Aynı tuple eşleşmesinde başka kural var.');
    }
    const updated = await prisma.sLAPolicy.update({
      where: { id },
      data: { ...dbPatch, updatedByUserId: actor.userId },
    });
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
  async create(input, actor) {
    // PR-3 — admin audit attribution.
    assertActorObject(actor, 'checklistRepo.create');
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
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },
  async update(id, patch, actor) {
    assertActorObject(actor, 'checklistRepo.update');
    return prisma.checklistTemplate.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.items !== undefined && { items: patch.items }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        updatedByUserId: actor.userId,
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
      where: { name: { equals: input.name.trim() } },
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
        where: { id: { not: id }, name: { equals: patch.name.trim() } },
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
  async create(input, actor) {
    // PR-3 — admin audit attribution.
    assertActorObject(actor, 'fieldDefinitionRepo.create');
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
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },
  async update(id, patch, actor) {
    assertActorObject(actor, 'fieldDefinitionRepo.update');
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
        updatedByUserId: actor.userId,
      },
    });
  },
  async remove(id, actor) {
    // PR-3 — soft delete de updatedByUserId stamp atar.
    assertActorObject(actor, 'fieldDefinitionRepo.remove');
    // Vakaların customFields'ında kullanılıyor olabilir — pasifleştir, hard delete yok
    return prisma.fieldDefinition.update({
      where: { id },
      data: { isActive: false, updatedByUserId: actor.userId },
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
    // Compose-Signature F1 IA rework — bağlı Person'ların title'larını
    // tek toplu query ile çek (schema'da User→Person @relation tanımlı
    // değil; manual join). personId'si olmayan user'lar null kalır.
    const personIds = users.map((u) => u.personId).filter(Boolean);
    const persons = personIds.length
      ? await prisma.person.findMany({
          where: { id: { in: personIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleByPersonId = new Map(persons.map((p) => [p.id, p.title]));

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      isActive: u.isActive,
      personId: u.personId,
      // Compose-Signature F1 IA rework — bağlı Person'ın unvanı (mail
      // imzasında {{agent.title}} placeholder render kaynağı). Person
      // yoksa null; UI bu durumda title edit'i disabled gösterir.
      personTitle: u.personId ? (titleByPersonId.get(u.personId) ?? null) : null,
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

  // Faz 3 (on-prem): Supabase Auth kaldırıldı. _findSupabaseUserByEmail ve
  // invite/resendInvite akışları yerine createUser/resetPassword geldi —
  // admin kullanıcıyı başlangıç şifresiyle açar, e-posta gönderimi yok.

  /**
   * Admin'den kullanıcı oluşturma (Faz 3 — on-prem local auth).
   *
   * Supabase davet akışının yerini aldı: e-posta GÖNDERİLMEZ. Admin,
   * kullanıcıyı başlangıç şifresiyle açar ve şifreyi kendisi iletir.
   * mustChangePassword=true → kullanıcı ilk girişte şifresini değiştirmek
   * zorunda kalır (route /api/auth/change-password).
   *
   * @param {object} input
   * @param {string} input.email
   * @param {string} [input.fullName]      — boşsa email-local-part kullanılır
   * @param {string} input.role            — sistem rolü (User.role)
   * @param {string} input.companyId
   * @param {string} input.companyRole     — UserCompany.role
   * @param {string} input.password        — başlangıç şifresi (min 8)
   * @param {string[]} allowedCompanyIds   — caller'ın yetki sınırları (undefined=SystemAdmin)
   */
  async createUser(input, allowedCompanyIds) {
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
      throw new AdminError('Bu şirkete kullanıcı ekleme yetkin yok.', 403);
    }
    const companyRole = String(input.companyRole ?? '');
    if (!VALID_COMPANY_ROLES.has(companyRole) || companyRole === 'SystemAdmin') {
      throw new AdminError('Şirket rolü Agent / Supervisor / Admin olmalı.', 400);
    }
    const password = String(input.password ?? '');
    if (password.length < 8) {
      throw new AdminError('Başlangıç şifresi en az 8 karakter olmalı.', 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AdminError('Bu e-posta zaten kayıtlı.', 409);
    }

    const fullName = String(input.fullName ?? '').trim() || email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);

    const teamId = input.teamId ? String(input.teamId) : null;

    const created = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          name: fullName,
          teamId: teamId || null,
          isActive: true,
          isTeamLead: false,
          supportLevel: 'L1',
        },
      });
      const user = await tx.user.create({
        data: {
          email,
          fullName,
          role,
          isActive: true,
          passwordHash,
          mustChangePassword: true,
          passwordUpdatedAt: new Date(),
          personId: person.id,
        },
      });
      await tx.userCompany.create({
        data: { userId: user.id, companyId, role: companyRole, isActive: true },
      });
      return user;
    });

    return {
      success: true,
      message: `Kullanıcı oluşturuldu: ${email}. Başlangıç şifresini kullanıcıya iletin; ilk girişte değiştirmesi istenecek.`,
      userId: created.id,
      email: created.email,
    };
  },

  /**
   * Admin'den şifre sıfırlama (Faz 3 — "şifremi unuttum"un on-prem karşılığı).
   *
   * Admin hedef kullanıcıya yeni geçici şifre atar; mustChangePassword=true
   * olur, kullanıcı ilk girişte değiştirir. E-posta gönderimi yok.
   *
   * Guards: SystemAdmin'in şifresini yalnız SystemAdmin sıfırlar; pasif
   * kullanıcıya atanmaz; kendi şifreni buradan değil /auth/change-password'dan.
   */
  async resetPassword(userId, newPassword, requestingUser) {
    if (!userId) throw new AdminError('userId gerekli.', 400);
    if (userId === requestingUser?.id) {
      throw new AdminError('Kendi şifreni ayarlar ekranından değiştir.', 400);
    }
    const password = String(newPassword ?? '');
    if (password.length < 8) {
      throw new AdminError('Yeni şifre en az 8 karakter olmalı.', 400);
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (target.role === 'SystemAdmin' && requestingUser?.role !== 'SystemAdmin') {
      throw new AdminError('SystemAdmin şifresini yalnızca SystemAdmin sıfırlayabilir.', 403);
    }
    if (!target.isActive) {
      throw new AdminError('Pasif kullanıcıya şifre atanamaz. Önce yeniden aktifleştirin.', 400);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, passwordUpdatedAt: new Date() },
    });

    return {
      success: true,
      message: `Geçici şifre atandı: ${target.email}. Kullanıcı ilk girişte değiştirecek.`,
      userId: target.id,
      email: target.email,
    };
  },


  /**
   * Pasiflestir: User.isActive=false. Bu DB flag verifyJwt middleware'inde
   * **enforced barrier**: pasif user'in Authorization header'iyla yapılan
   * tum API cagrilari 403 'inactive' doner.
   *
   * Local JWT stateless oldugu icin aktif token iptali yapilmaz; her istekte
   * verifyJwt'nin DB isActive kontrolu cached token'i pratikte gecersiz kilar.
   * Frontend `app:unauthenticated` event'i ile oturumu yerel olarak kapatir.
   * UserCompany kayitlarinda dokunma yapmaz (kasitli — yetki cascaded fakat veri korunur).
   *
   * Compose-Signature F1 IA rework — Kullanıcılar ekranından Person.title
   * düzenleme. Person'ı olmayan user (SystemAdmin gibi) için 409 döner;
   * route layer ve UI bu durumda field'ı disabled gösterir.
   *
   * Boş string / null → title temizleme semantiği (personRepo.update ile
   * tutarlı).
   */
  async setPersonTitle(userId, title) {
    if (!userId) throw new AdminError('userId gerekli.', 400);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { personId: true },
    });
    if (!user) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (!user.personId) {
      throw new AdminError(
        'Bu kullanıcının kart sahibi bir Person kaydı yok (örn. SystemAdmin). Unvan düzenlenemez.',
        409,
      );
    }
    const trimmed = typeof title === 'string' && title.trim() ? title.trim() : null;
    const person = await prisma.person.update({
      where: { id: user.personId },
      data: { title: trimmed },
      select: { id: true, title: true },
    });
    return { personId: person.id, title: person.title };
  },

  /**
   * Guards:
   *  - Kendini pasiflestiremezsin
   *  - SystemAdmin kullanicilari Admin pasiflestiremez (sadece SystemAdmin)
   *  - Hedef en az bir companyId'sinde requesting user Admin/SystemAdmin olmali
   *    (route layer dogrular — buraya gelmeden once)
   */
  async deactivate(userId, _deps, requestingUser) {
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

    // DB: isActive = false — verifyJwt bunu enforced barrier olarak kullanir
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    return {
      success: true,
      message: 'Kullanıcı pasifleştirildi. DB barrier aktif; client cached JWT verifyJwt\'de 403 \'inactive\' alacak.',
      userId,
      email: target.email,
    };
  },

  /**
   * Reactivate — pasif kullaniciyi tekrar aktiflestir. `isActive=true` atar.
   * UserCompany assignment'lari deaktive sirasinda DOKUNULMADIGI icin burada
   * da dokunmayiz — onceki yetkiler korunur. Supabase Auth user zaten silinmedi
   * → kullanici cached JWT veya yeniden login ile dogrudan erisir.
   *
   * Guards:
   *  - Hedef DB'de yoksa 404
   *  - Zaten aktifse idempotent 200 doner
   *  - SystemAdmin kullanicilari Admin reactivate edemez (sadece SystemAdmin)
   *  - Hedef en az bir companyId'sinde requesting user Admin/SystemAdmin olmali
   *    (route layer dogrular — buraya gelmeden once)
   *
   * Reactivate sonrasi:
   *  - Frontend `app:unauthenticated` event'i tetiklenmesi gerekmez — kullanici
   *    yeni bir session acmak zorunda degil; eski JWT verifyJwt'de 200 doner.
   */
  /**
   * Sistem rolünü değiştir — yalnız SystemAdmin yetkili.
   *
   * Guardrails:
   *  - requestingUser.role !== 'SystemAdmin' → 403
   *  - userId === requestingUser.id → 400 (kendi rolünü kilitleme önle)
   *  - target SystemAdmin → 403 (SystemAdmin promote/demote bu PR scope dışı)
   *  - target not found → 404
   *  - role geçersizse 400
   *
   * UserCompany.role'e dokunulmaz; sadece User.role güncellenir.
   */
  async updateSystemRole(userId, role, requestingUser) {
    if (!userId) throw new AdminError('userId gerekli.', 400);
    if (requestingUser?.role !== 'SystemAdmin') {
      throw new AdminError('Sistem rolünü yalnızca SystemAdmin değiştirebilir.', 403);
    }
    if (userId === requestingUser?.id) {
      throw new AdminError('Kendi sistem rolünü değiştiremezsin.', 400);
    }
    const ALLOWED_ROLES = ['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin'];
    if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
      throw new AdminError(
        `Geçersiz rol. Kabul edilenler: ${ALLOWED_ROLES.join(', ')}.`,
        400,
      );
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (target.role === 'SystemAdmin') {
      throw new AdminError(
        'SystemAdmin kullanıcıların sistem rolü bu yoldan değiştirilemez (seed/bootstrap).',
        403,
      );
    }
    if (target.role === role) {
      // Idempotent — yeniden aynı rolü atama hata değildir
      return {
        success: true,
        userId: target.id,
        email: target.email,
        fullName: target.fullName,
        previousRole: target.role,
        role,
        unchanged: true,
      };
    }
    await prisma.user.update({
      where: { id: userId },
      data: { role },
    });
    return {
      success: true,
      userId: target.id,
      email: target.email,
      fullName: target.fullName,
      previousRole: target.role,
      role,
    };
  },

  async reactivate(userId, _deps, requestingUser) {
    if (!userId) throw new AdminError('userId gerekli.', 400);
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
    if (target.role === 'SystemAdmin' && requestingUser?.role !== 'SystemAdmin') {
      throw new AdminError('SystemAdmin kullanıcıyı yalnızca SystemAdmin yeniden aktifleştirebilir.', 403);
    }
    if (target.isActive) {
      return { success: true, message: 'Zaten aktif.', userId, email: target.email };
    }
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    return {
      success: true,
      message: 'Kullanıcı yeniden aktifleştirildi.',
      userId,
      email: target.email,
    };
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
// Vaka numarası öneki — 2-4 BÜYÜK harf. Format validasyonu ortak helper.
const CASE_NUMBER_PREFIX_RE = /^[A-Z]{2,4}$/;

function normalizePrefix(raw) {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toUpperCase();
  return s === '' ? null : s;
}

function assertPrefixFormat(prefix) {
  if (!CASE_NUMBER_PREFIX_RE.test(prefix)) {
    throw new AdminError(
      'Vaka No Öneki 2-4 büyük harf olmalı (örn. UNV, PRM).',
      400,
    );
  }
}

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
      /// Vaka numarası öneki — 2-4 harf (örn. "UNV"). Yeni firmada zorunlu.
      caseNumberPrefix: c.caseNumberPrefix ?? null,
      logoUrl: c.settings?.logoUrl ?? null,
      primaryColor: c.settings?.primaryColor ?? null,
      appName: c.settings?.appName ?? null,
      supportEmail: c.settings?.supportEmail ?? null,
      // Phase D — Müşterisiz vaka açma kısıtı; default false (geri uyumlu).
      requireCustomerOnCaseCreate: c.settings?.requireCustomerOnCaseCreate ?? false,
      // WR-A4 / PM-04 — AccountProject opt-in flag'leri.
      projectsEnabled: c.settings?.projectsEnabled ?? false,
      projectsRequired: c.settings?.projectsRequired ?? false,
      userCount: c._count.userCompanies,
    }));
  },

  async create(input) {
    if (!input.name?.trim()) throw new AdminError('Şirket adı gerekli.');
    const dup = await prisma.company.findFirst({
      where: { name: { equals: input.name.trim() } },
    });
    if (dup) throw new AdminError('Bu isimde şirket zaten var.');

    // Vaka No Öneki — YENİ firmada ZORUNLU. Motor prefix'siz vaka create
    // yapamaz (PR-2). Buradan reject yapmazsak firma "havada" kalır: kaydı
    // görünür ama vaka açılamaz.
    const prefixNorm = normalizePrefix(input.caseNumberPrefix);
    if (prefixNorm == null) {
      throw new AdminError(
        'Vaka No Öneki zorunlu (2-4 büyük harf, örn. UNV). Vaka numaraları bu önekle üretilir.',
        400,
      );
    }
    assertPrefixFormat(prefixNorm);
    // Codex P2 (round 1) — cross-tenant enumeration sızıntısını önlemek için
    // firma adını mesaja koymuyoruz. Kimin sahibi olduğu bilgisi hassas.
    // create SystemAdmin-only olsa da davranışı update ile hizala (aynı repo).
    const prefixDup = await prisma.company.findFirst({
      where: { caseNumberPrefix: prefixNorm },
      select: { id: true },
    });
    if (prefixDup) {
      throw new AdminError(
        'Bu önek zaten kullanımda. Farklı bir 2-4 harfli önek seç.',
        400,
      );
    }

    // Company + CompanySettings tek transaction
    const created = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: input.name.trim(),
          isActive: input.isActive ?? true,
          caseNumberPrefix: prefixNorm,
        },
      });
      await tx.companySettings.create({
        data: {
          companyId: company.id,
          logoUrl: input.logoUrl?.trim() || null,
          primaryColor: input.primaryColor?.trim() || null,
          appName: input.appName?.trim() || null,
          supportEmail: input.supportEmail?.trim() || null,
          // Phase D — Müşteri zorunluluğu (default false)
          requireCustomerOnCaseCreate: !!input.requireCustomerOnCaseCreate,
          // WR-A4 / PM-04 — AccountProject opt-in (default false)
          projectsEnabled: !!input.projectsEnabled,
          projectsRequired: !!input.projectsRequired,
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
        where: { id: { not: id }, name: { equals: trimmed } },
      });
      if (dup) throw new AdminError('Bu isimde başka şirket var.');
    }

    // Vaka No Öneki update — 3 kural:
    //   1) undefined → dokunma (kısmi update).
    //   2) null/boş: SET olmuşsa BOŞALTMAK YASAK (eski vakalar önekle
    //      tutarsız olur). Zaten NULL ise kabul (henüz set edilmedi).
    //   3) dolu → format + benzersizlik. Aynı prefix varsa reject.
    let normalizedPrefix;
    if (patch.caseNumberPrefix !== undefined) {
      normalizedPrefix = normalizePrefix(patch.caseNumberPrefix);
      if (normalizedPrefix == null) {
        if (target.caseNumberPrefix != null) {
          throw new AdminError(
            'Vaka No Öneki boşaltılamaz. Bir kez atandıktan sonra sadece değiştirilebilir.',
            400,
          );
        }
        // NULL → NULL: no-op (henüz set edilmedi, patch de boş bıraktı).
      } else {
        assertPrefixFormat(normalizedPrefix);
        if (normalizedPrefix !== target.caseNumberPrefix) {
          // Codex P2 (round 1) — company-scoped Admin update path
          // assertCompanyAdmin ile geçer; başka firmanın adını mesajda
          // dönmek cross-tenant company enumeration olur. Sadece
          // "kullanımda" bilgisi yeter.
          const prefixDup = await prisma.company.findFirst({
            where: { id: { not: id }, caseNumberPrefix: normalizedPrefix },
            select: { id: true },
          });
          if (prefixDup) {
            throw new AdminError(
              'Bu önek zaten kullanımda. Farklı bir 2-4 harfli önek seç.',
              400,
            );
          }
        }
      }
    }

    // Company alanları (name, isActive, caseNumberPrefix) + CompanySettings
    // (branding) ayrı tablolar. Tek transaction'da güncelle.
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.company.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name.trim() }),
          ...(patch.isActive !== undefined && { isActive: patch.isActive }),
          // undefined → gönderme; null → boşaltma reddi yukarıda; dolu → set.
          ...(patch.caseNumberPrefix !== undefined
            && normalizedPrefix != null
            && { caseNumberPrefix: normalizedPrefix }),
        },
      });
      const hasBranding =
        patch.logoUrl !== undefined ||
        patch.primaryColor !== undefined ||
        patch.appName !== undefined ||
        patch.supportEmail !== undefined ||
        patch.requireCustomerOnCaseCreate !== undefined ||
        patch.projectsEnabled !== undefined ||
        patch.projectsRequired !== undefined;
      if (hasBranding) {
        await tx.companySettings.upsert({
          where: { companyId: id },
          update: {
            ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl?.trim() || null }),
            ...(patch.primaryColor !== undefined && { primaryColor: patch.primaryColor?.trim() || null }),
            ...(patch.appName !== undefined && { appName: patch.appName?.trim() || null }),
            ...(patch.supportEmail !== undefined && { supportEmail: patch.supportEmail?.trim() || null }),
            ...(patch.requireCustomerOnCaseCreate !== undefined && {
              requireCustomerOnCaseCreate: !!patch.requireCustomerOnCaseCreate,
            }),
            // WR-A4 / PM-04 — AccountProject toggles
            ...(patch.projectsEnabled !== undefined && {
              projectsEnabled: !!patch.projectsEnabled,
            }),
            ...(patch.projectsRequired !== undefined && {
              projectsRequired: !!patch.projectsRequired,
            }),
          },
          create: {
            companyId: id,
            logoUrl: patch.logoUrl?.trim() || null,
            primaryColor: patch.primaryColor?.trim() || null,
            appName: patch.appName?.trim() || null,
            supportEmail: patch.supportEmail?.trim() || null,
            requireCustomerOnCaseCreate: !!patch.requireCustomerOnCaseCreate,
            projectsEnabled: !!patch.projectsEnabled,
            projectsRequired: !!patch.projectsRequired,
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
    // Review fix — arşivli vakalar bu sayaca dahil olmamalı.
    prisma.case.count({ where: { companyId, isArchived: false } }),
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
    // Review fix — arşivli vakalar bu sayaca dahil olmamalı.
    prisma.case.count({ where: { companyId, isArchived: false } }),
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
        // Phase D — Müşteri zorunluluğu toggle
        ...(patch.requireCustomerOnCaseCreate !== undefined && {
          requireCustomerOnCaseCreate: !!patch.requireCustomerOnCaseCreate,
        }),
        // WR-A4 — Project module flags.
        ...(patch.projectsEnabled !== undefined && {
          projectsEnabled: !!patch.projectsEnabled,
        }),
        ...(patch.projectsRequired !== undefined && {
          projectsRequired: !!patch.projectsRequired,
        }),
      },
      create: {
        companyId,
        logoUrl: patch.logoUrl ?? null,
        primaryColor: patch.primaryColor ?? null,
        appName: patch.appName ?? null,
        supportEmail: patch.supportEmail ?? null,
        requireCustomerOnCaseCreate: !!patch.requireCustomerOnCaseCreate,
        projectsEnabled: !!patch.projectsEnabled,
        projectsRequired: !!patch.projectsRequired,
      },
    });
  },
};

/* ─────────────────────────────────────────────────────────────────
 * WR-A6 / PM-05 — ProductGroup + Product catalog (foundation only).
 * Tenant-scoped. `code` immutable after create. Soft delete only.
 * Mevcut Case.productGroup string'ini ve AccountProduct tablosunu
 * etkilemez (A7b'de catalog'a switch).
 * ───────────────────────────────────────────────────────────────── */

const CODE_RX = /^[A-Z0-9][A-Z0-9_-]*$/;

function normalizeCode(raw) {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!s) throw new AdminError('Kod zorunlu.');
  if (s.length > 64) throw new AdminError('Kod 64 karakteri geçemez.');
  if (!CODE_RX.test(s)) {
    throw new AdminError('Kod ASCII büyük harf/rakam/_/- olmalı (örn. PARAM_POS).');
  }
  return s;
}

function normalizeName(raw, max = 160) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) throw new AdminError('Ad zorunlu.');
  if (s.length > max) throw new AdminError(`Ad ${max} karakteri geçemez.`);
  return s;
}

function assertCompanyScope(companyId, allowedCompanyIds) {
  if (!companyId) throw new AdminError('companyId gerekli.');
  if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
    throw new AdminError('Bu şirket için yetkin yok.', 403);
  }
}

export const productGroupRepo = {
  /**
   * Product Catalog RBAC audit — lookup helper for per-company admin gate.
   * Returns companyId or null (not found). Route layer calls assertCompanyAdmin
   * BEFORE delegating to update path. Same pattern as packageRepo.getCompanyId.
   */
  async getCompanyId(id) {
    if (!id) return null;
    const row = await prisma.productGroup.findUnique({
      where: { id },
      select: { companyId: true },
    });
    return row?.companyId ?? null;
  },

  async list({ companyId, allowedCompanyIds, includeInactive = false }) {
    const where = {};
    if (companyId) {
      assertCompanyScope(companyId, allowedCompanyIds);
      where.companyId = companyId;
    } else if (allowedCompanyIds) {
      where.companyId = { in: allowedCompanyIds };
    }
    if (!includeInactive) where.isActive = true;
    return prisma.productGroup.findMany({
      where,
      orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: 500,
    });
  },

  async create(input, allowedCompanyIds) {
    assertCompanyScope(input.companyId, allowedCompanyIds);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    try {
      return await prisma.productGroup.create({
        data: {
          companyId: input.companyId,
          code,
          name,
          description: input.description?.trim() || null,
          sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
          isActive: input.isActive === undefined ? true : !!input.isActive,
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new AdminError('Bu şirkette aynı kodda bir ürün grubu var.', 409);
      }
      throw err;
    }
  },

  async update(id, patch, allowedCompanyIds) {
    const target = await prisma.productGroup.findUnique({
      where: { id },
      select: { id: true, companyId: true, code: true },
    });
    if (!target) throw new AdminError('Ürün grubu bulunamadı.', 404);
    assertCompanyScope(target.companyId, allowedCompanyIds);

    // `code` immutable — silently ignore (D-A6.2).
    const data = {};
    if (patch.name !== undefined) data.name = normalizeName(patch.name);
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.sortOrder !== undefined) data.sortOrder = Number(patch.sortOrder) || 0;
    if (patch.isActive !== undefined) data.isActive = !!patch.isActive;
    if (Object.keys(data).length === 0) return target;

    return prisma.productGroup.update({ where: { id }, data });
  },
};

export const productRepo = {
  /**
   * Product Catalog RBAC audit — same getCompanyId pattern as productGroupRepo.
   * Used by route gate before PATCH.
   */
  async getCompanyId(id) {
    if (!id) return null;
    const row = await prisma.product.findUnique({
      where: { id },
      select: { companyId: true },
    });
    return row?.companyId ?? null;
  },

  async list({ companyId, productGroupId, allowedCompanyIds, includeInactive = false }) {
    const where = {};
    if (companyId) {
      assertCompanyScope(companyId, allowedCompanyIds);
      where.companyId = companyId;
    } else if (allowedCompanyIds) {
      where.companyId = { in: allowedCompanyIds };
    }
    if (productGroupId) where.productGroupId = productGroupId;
    if (!includeInactive) where.isActive = true;
    return prisma.product.findMany({
      where,
      orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        productGroup: { select: { id: true, code: true, name: true } },
      },
      take: 500,
    });
  },

  async create(input, allowedCompanyIds) {
    assertCompanyScope(input.companyId, allowedCompanyIds);
    if (!input.productGroupId) throw new AdminError('productGroupId gerekli.');
    const group = await prisma.productGroup.findUnique({
      where: { id: input.productGroupId },
      select: { id: true, companyId: true, isActive: true },
    });
    if (!group) throw new AdminError('Ürün grubu bulunamadı.', 404);
    if (group.companyId !== input.companyId) {
      throw new AdminError(
        'Ürün grubu farklı şirkete ait — cross-tenant referans reddedildi.',
        400,
      );
    }
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    // WR-A6 follow-up — Product.supportLevel additive field.
    const supportLevel = normalizeSupportLevel(input.supportLevel);
    try {
      return await prisma.product.create({
        data: {
          companyId: input.companyId,
          productGroupId: input.productGroupId,
          code,
          name,
          description: input.description?.trim() || null,
          sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
          isActive: input.isActive === undefined ? true : !!input.isActive,
          // WR-A6 follow-up — DB default L1 if omitted; only override when set.
          ...(supportLevel !== undefined && { supportLevel }),
        },
        include: {
          productGroup: { select: { id: true, code: true, name: true } },
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new AdminError('Bu şirkette aynı kodda bir ürün var.', 409);
      }
      throw err;
    }
  },

  async update(id, patch, allowedCompanyIds) {
    const target = await prisma.product.findUnique({
      where: { id },
      select: { id: true, companyId: true, productGroupId: true, code: true },
    });
    if (!target) throw new AdminError('Ürün bulunamadı.', 404);
    assertCompanyScope(target.companyId, allowedCompanyIds);

    // `code` immutable — silently ignore (D-A6.2).
    const data = {};
    if (patch.name !== undefined) data.name = normalizeName(patch.name);
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.sortOrder !== undefined) data.sortOrder = Number(patch.sortOrder) || 0;
    if (patch.isActive !== undefined) data.isActive = !!patch.isActive;
    // WR-A6 follow-up — supportLevel mutable.
    const supportLevel = normalizeSupportLevel(patch.supportLevel);
    if (supportLevel !== undefined) data.supportLevel = supportLevel;

    // productGroupId değiştirilebilir — aynı şirkete bağlı bir grup olmalı.
    if (patch.productGroupId !== undefined && patch.productGroupId !== target.productGroupId) {
      const grp = await prisma.productGroup.findUnique({
        where: { id: patch.productGroupId },
        select: { id: true, companyId: true },
      });
      if (!grp) throw new AdminError('Hedef ürün grubu bulunamadı.', 404);
      if (grp.companyId !== target.companyId) {
        throw new AdminError(
          'Ürün grubu farklı şirkete ait — taşınamaz.',
          400,
        );
      }
      data.productGroupId = patch.productGroupId;
    }

    if (Object.keys(data).length === 0) return target;

    return prisma.product.update({
      where: { id },
      data,
      include: {
        productGroup: { select: { id: true, code: true, name: true } },
      },
    });
  },
};

/* ─────────────────────────────────────────────────────────────────
 * WR-A7 / PM-05 — Package + PackageItem catalog (foundation).
 * Tenant-scoped Package; PackageItem composite (packageId, productId).
 * Cross-table invariant: Package.companyId === Product.companyId for every
 * PackageItem — enforced here (Prisma cannot enforce cross-table CHECK).
 * `code` immutable after create (A6 D-A6.2 pattern).
 * ───────────────────────────────────────────────────────────────── */

const PACKAGE_ITEM_MAX = 200; // PUT items body cap (Performance Gate item #4)

export const packageRepo = {
  /**
   * WR-A7 review fix — lookup helper for per-company admin gate.
   * Returns companyId or null (not found). Route layer uses this to call
   * assertCompanyAdmin BEFORE delegating to the repo's CRUD path.
   */
  async getCompanyId(id) {
    if (!id) return null;
    const row = await prisma.package.findUnique({
      where: { id },
      select: { companyId: true },
    });
    return row?.companyId ?? null;
  },

  async list({ companyId, allowedCompanyIds, includeInactive = false }) {
    const where = {};
    if (companyId) {
      assertCompanyScope(companyId, allowedCompanyIds);
      where.companyId = companyId;
    } else if (allowedCompanyIds) {
      where.companyId = { in: allowedCompanyIds };
    }
    if (!includeInactive) where.isActive = true;
    const packages = await prisma.package.findMany({
      where,
      orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    if (packages.length === 0) return [];
    // Tek groupBy ile productCount; N+1 önlenir.
    const counts = await prisma.packageItem.groupBy({
      by: ['packageId'],
      where: { packageId: { in: packages.map((p) => p.id) } },
      _count: { productId: true },
    });
    const countMap = new Map(counts.map((c) => [c.packageId, c._count.productId]));
    return packages.map((p) => ({ ...p, productCount: countMap.get(p.id) ?? 0 }));
  },

  async create(input, allowedCompanyIds) {
    assertCompanyScope(input.companyId, allowedCompanyIds);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    const supportLevel = normalizeSupportLevel(input.supportLevel);
    try {
      return await prisma.package.create({
        data: {
          companyId: input.companyId,
          code,
          name,
          description: input.description?.trim() || null,
          sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
          isActive: input.isActive === undefined ? true : !!input.isActive,
          ...(supportLevel !== undefined && { supportLevel }),
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new AdminError('Bu şirkette aynı kodda bir paket var.', 409);
      }
      throw err;
    }
  },

  async update(id, patch, allowedCompanyIds) {
    const target = await prisma.package.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!target) throw new AdminError('Paket bulunamadı.', 404);
    assertCompanyScope(target.companyId, allowedCompanyIds);

    // `code` immutable — silently ignore (D-A6.2 pattern).
    const data = {};
    if (patch.name !== undefined) data.name = normalizeName(patch.name);
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.sortOrder !== undefined) data.sortOrder = Number(patch.sortOrder) || 0;
    if (patch.isActive !== undefined) data.isActive = !!patch.isActive;
    const supportLevel = normalizeSupportLevel(patch.supportLevel);
    if (supportLevel !== undefined) data.supportLevel = supportLevel;

    if (Object.keys(data).length === 0) return target;
    return prisma.package.update({ where: { id }, data });
  },

  async listItems(packageId, allowedCompanyIds) {
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      select: { id: true, companyId: true },
    });
    if (!pkg) throw new AdminError('Paket bulunamadı.', 404);
    assertCompanyScope(pkg.companyId, allowedCompanyIds);
    return prisma.packageItem.findMany({
      where: { packageId },
      orderBy: { sortOrder: 'asc' },
      include: {
        product: { select: { id: true, code: true, name: true, isActive: true, supportLevel: true } },
      },
    });
  },

  /**
   * Bulk-replace package items. Body: { productIds: string[] }.
   * - Dedupes productIds.
   * - Validates every product belongs to the same company as the package.
   * - Unknown product → 400 `package_product_invalid`.
   * - Cross-company product → 400 `package_product_company_mismatch`.
   * - Atomic via $transaction (deleteMany + createMany).
   * - Cap PACKAGE_ITEM_MAX (200).
   */
  async replaceItems(packageId, productIds, allowedCompanyIds) {
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      select: { id: true, companyId: true },
    });
    if (!pkg) throw new AdminError('Paket bulunamadı.', 404);
    assertCompanyScope(pkg.companyId, allowedCompanyIds);

    if (!Array.isArray(productIds)) {
      throw new AdminError('productIds dizisi gerekli.', 400);
    }
    // Dedupe + filter falsy.
    const cleaned = Array.from(new Set(productIds.filter((id) => typeof id === 'string' && id.length > 0)));
    if (cleaned.length > PACKAGE_ITEM_MAX) {
      throw new AdminError(`Bir pakette en fazla ${PACKAGE_ITEM_MAX} ürün olabilir.`, 400);
    }

    if (cleaned.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: cleaned } },
        select: { id: true, companyId: true },
      });
      if (products.length !== cleaned.length) {
        const err = new AdminError('Bir veya daha fazla ürün bulunamadı.', 400);
        err.code = 'package_product_invalid';
        throw err;
      }
      const mismatch = products.find((p) => p.companyId !== pkg.companyId);
      if (mismatch) {
        const err = new AdminError(
          'Ürün paketin şirketine ait değil — cross-tenant referans reddedildi.',
          400,
        );
        err.code = 'package_product_company_mismatch';
        throw err;
      }
    }

    await prisma.$transaction([
      prisma.packageItem.deleteMany({ where: { packageId } }),
      ...(cleaned.length > 0
        ? [prisma.packageItem.createMany({
            data: cleaned.map((productId, idx) => ({ packageId, productId, sortOrder: idx })),
          })]
        : []),
    ]);

    return packageRepo.listItems(packageId, allowedCompanyIds);
  },
};

// ─────────────────────────────────────────────────────────────────
// TaxonomyDef — WR-Smart-Ticket Phase 1b admin CRUD.
// Per-tenant (companyId zorunlu). Hiyerarşi: rootCauseDetail satırları
// rootCauseGroup parent'a bağlanır; diğer 7 tip flat. Bu repo HARD DELETE
// yapmaz — `remove` her zaman isActive=false ile soft delete uygular.
// ─────────────────────────────────────────────────────────────────

const SMART_TICKET_TAXONOMY_TYPES = [
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
];
const TAXONOMY_TYPE_SET = new Set(SMART_TICKET_TAXONOMY_TYPES);

function assertTaxonomyAllowed(companyId, allowedCompanyIds) {
  // SECURITY: empty allowedCompanyIds bypass değil — explicit membership
  // şart. Lookups endpoint Codex P1 fix'iyle aynı pattern.
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (!allowed.includes(companyId)) {
    throw new AdminError('Bu şirkete taxonomy erişim yetkin yok.', 403);
  }
}

function assertTaxonomyType(taxonomyType) {
  if (!taxonomyType || !TAXONOMY_TYPE_SET.has(taxonomyType)) {
    throw new AdminError(
      `taxonomyType geçersiz. Geçerli değerler: ${SMART_TICKET_TAXONOMY_TYPES.join(', ')}`,
      400,
    );
  }
}

function trimRequired(value, label) {
  if (typeof value !== 'string') throw new AdminError(`${label} gerekli.`, 400);
  const out = value.trim();
  if (!out) throw new AdminError(`${label} gerekli.`, 400);
  return out;
}

const TAXONOMY_DEF_SELECT = {
  id: true,
  companyId: true,
  taxonomyType: true,
  code: true,
  label: true,
  parentId: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
};

// Kapanış + açılış taksonomileri BAĞIMSIZ düz listelerdir (ürün kararı:
// kapanış kategorileri birbirine bağlı olmamalı). rootCauseDetail artık
// rootCauseGroup'a parent ile bağlanmaz; parentId bu akışta hiçbir tip için
// yazılmaz — her zaman null döner. TaxonomyDef.parentId kolonu şemada
// forward-compat için durur ama kullanılmaz.
async function assertParentValid() {
  return null;
}

export const taxonomyDefRepo = {
  /**
   * ID üzerinden companyId döndürür (route-level per-company admin guard
   * için — assertCompanyAdmin çağrılır). Bulunamazsa null.
   */
  async getCompanyId(id) {
    const row = await prisma.taxonomyDef.findUnique({
      where: { id },
      select: { companyId: true },
    });
    return row?.companyId ?? null;
  },

  async list({ companyId, taxonomyType, isActive, parentId } = {}, allowedCompanyIds) {
    assertTaxonomyAllowed(companyId, allowedCompanyIds);
    const where = { companyId };
    if (taxonomyType) {
      assertTaxonomyType(taxonomyType);
      where.taxonomyType = taxonomyType;
    }
    if (isActive === true || isActive === false) where.isActive = isActive;
    if (parentId !== undefined) {
      where.parentId = parentId === null || parentId === '' ? null : parentId;
    }
    return prisma.taxonomyDef.findMany({
      where,
      select: TAXONOMY_DEF_SELECT,
      // 2026-07-16 — kullanıcı kararı: açılış/kapanış etiket içerikleri
      // alfabetik gelsin (admin ekranı da agent'ların gördüğü sırayla
      // tutarlı olsun). sortOrder kolonu veri modelinde/formda durur,
      // sıralama için artık kullanılmıyor.
      orderBy: [{ taxonomyType: 'asc' }, { label: 'asc' }],
    });
  },

  async create(input, allowedCompanyIds, actor) {
    // PR-3 — admin audit attribution.
    assertActorObject(actor, 'taxonomyDefRepo.create');
    const companyId = trimRequired(input?.companyId, 'companyId');
    assertTaxonomyAllowed(companyId, allowedCompanyIds);
    const taxonomyType = trimRequired(input?.taxonomyType, 'taxonomyType');
    assertTaxonomyType(taxonomyType);
    const code = trimRequired(input?.code, 'code');
    const label = trimRequired(input?.label, 'label');
    const parentId = await assertParentValid({
      taxonomyType,
      parentId: input?.parentId ?? null,
      companyId,
    });

    const dup = await prisma.taxonomyDef.findUnique({
      where: { companyId_taxonomyType_code: { companyId, taxonomyType, code } },
      select: { id: true },
    });
    if (dup) {
      const err = new AdminError(
        `Bu şirket+taxonomy tipinde "${code}" kodu zaten mevcut.`,
        409,
      );
      err.code = 'taxonomy_def_duplicate_code';
      throw err;
    }

    return prisma.taxonomyDef.create({
      data: {
        companyId,
        taxonomyType,
        code,
        label,
        parentId,
        isActive: input?.isActive ?? true,
        sortOrder: Number.isFinite(input?.sortOrder) ? Number(input.sortOrder) : 0,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      select: TAXONOMY_DEF_SELECT,
    });
  },

  async update(id, patch, allowedCompanyIds, actor) {
    assertActorObject(actor, 'taxonomyDefRepo.update');
    const target = await prisma.taxonomyDef.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        taxonomyType: true,
        code: true,
        parentId: true,
      },
    });
    if (!target) throw new AdminError('Taxonomy satırı bulunamadı.', 404);
    assertTaxonomyAllowed(target.companyId, allowedCompanyIds);

    // companyId ve taxonomyType immutable — değiştirilemez (entegrasyon
    // riskini ve hierarchy invariant'ını korumak için). Frontend disabled
    // gösterir; backend yine de defensive ret eder.
    if (patch?.companyId && patch.companyId !== target.companyId) {
      throw new AdminError('Şirket değiştirilemez.', 400);
    }
    if (patch?.taxonomyType && patch.taxonomyType !== target.taxonomyType) {
      throw new AdminError('Taxonomy tipi değiştirilemez.', 400);
    }

    const nextCode =
      typeof patch?.code === 'string' && patch.code.trim() !== target.code
        ? trimRequired(patch.code, 'code')
        : target.code;
    if (nextCode !== target.code) {
      const dup = await prisma.taxonomyDef.findUnique({
        where: {
          companyId_taxonomyType_code: {
            companyId: target.companyId,
            taxonomyType: target.taxonomyType,
            code: nextCode,
          },
        },
        select: { id: true },
      });
      if (dup && dup.id !== id) {
        const err = new AdminError(
          `Bu şirket+taxonomy tipinde "${nextCode}" kodu zaten mevcut.`,
          409,
        );
        err.code = 'taxonomy_def_duplicate_code';
        throw err;
      }
    }

    let nextParentId = target.parentId;
    if (patch?.parentId !== undefined) {
      nextParentId = await assertParentValid({
        taxonomyType: target.taxonomyType,
        parentId: patch.parentId === '' ? null : patch.parentId,
        companyId: target.companyId,
        excludeId: id,
      });
    }

    const data = { code: nextCode, parentId: nextParentId, updatedByUserId: actor.userId };
    if (patch?.label !== undefined) data.label = trimRequired(patch.label, 'label');
    if (patch?.isActive !== undefined) data.isActive = Boolean(patch.isActive);
    if (patch?.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))) {
      data.sortOrder = Number(patch.sortOrder);
    }

    return prisma.taxonomyDef.update({
      where: { id },
      data,
      select: TAXONOMY_DEF_SELECT,
    });
  },

  async remove(id, allowedCompanyIds, actor) {
    // PR-3 — soft delete updatedByUserId stamp atar.
    assertActorObject(actor, 'taxonomyDefRepo.remove');
    // SOFT DELETE — spec gereği hard delete yasak. isActive=false yapılır.
    // Kapanış decouple — taksonomiler bağımsız; parent/child ilişkisi yok,
    // pasifleştirme yalnız ilgili satırı etkiler.
    const target = await prisma.taxonomyDef.findUnique({
      where: { id },
      select: { id: true, companyId: true, isActive: true },
    });
    if (!target) throw new AdminError('Taxonomy satırı bulunamadı.', 404);
    assertTaxonomyAllowed(target.companyId, allowedCompanyIds);
    if (!target.isActive) return { id, deactivated: true, alreadyInactive: true };
    await prisma.taxonomyDef.update({
      where: { id },
      data: { isActive: false, updatedByUserId: actor.userId },
    });
    return { id, deactivated: true };
  },
};


// ─────────────────────────────────────────────────────────────────
// Çalışma Takvimi (SLA iş-saati Faz 2) — şirket başına TEK kayıt +
// tatiller. SysAdmin-only (route katmanında kapılı). Her yazımda motor
// cache'i invalidate edilir (businessTime.loadWorkCalendar 5dk TTL).
// ─────────────────────────────────────────────────────────────────
export const workCalendarRepo = {
  /** Takvim + tatiller; yoksa null (FE "tanımsız — duvar-saati" gösterir). */
  async get(companyId) {
    return prisma.workCalendar.findUnique({
      where: { companyId },
      include: { holidays: { orderBy: { date: 'asc' } } },
    });
  },

  /**
   * Upsert — companySettingsRepo dersinden: alan-alan koşullu patch;
   * listede olmayan alan SESSİZCE yazılmaz diye buraya alan eklemeyi
   * unutma (smoke assert'i kilitler). workDays dizi olarak gelir;
   * jsonFieldMap köprüsü stringify'ı otomatik yapar.
   */
  async upsert(companyId, patch, actor) {
    assertActorObject(actor, 'workCalendarRepo.upsert');
    const data = {
      ...(patch.workDays !== undefined && { workDays: patch.workDays }),
      ...(patch.breakStartMin !== undefined && { breakStartMin: patch.breakStartMin }),
      ...(patch.breakEndMin !== undefined && { breakEndMin: patch.breakEndMin }),
      ...(patch.isActive !== undefined && { isActive: !!patch.isActive }),
      ...(patch.pauseOnCustomerWait !== undefined && { pauseOnCustomerWait: !!patch.pauseOnCustomerWait }),
      ...(patch.effectiveFrom !== undefined && {
        effectiveFrom: patch.effectiveFrom ? new Date(patch.effectiveFrom) : null,
      }),
    };
    const saved = await prisma.workCalendar.upsert({
      where: { companyId },
      update: { ...data, updatedByUserId: actor.userId },
      create: {
        companyId,
        workDays: patch.workDays ?? [],
        breakStartMin: patch.breakStartMin ?? null,
        breakEndMin: patch.breakEndMin ?? null,
        isActive: patch.isActive !== undefined ? !!patch.isActive : true,
        pauseOnCustomerWait: !!patch.pauseOnCustomerWait,
        effectiveFrom: patch.effectiveFrom ? new Date(patch.effectiveFrom) : null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    invalidateWorkCalendarCache(companyId);
    return this.get(companyId);
  },

  /** Tatil ekle — companyId+date unique (çift kayıt AdminError). */
  async addHoliday(companyId, { date, name, isHalfDay, halfDayEndMin }, actor) {
    assertActorObject(actor, 'workCalendarRepo.addHoliday');
    const cal = await prisma.workCalendar.findUnique({ where: { companyId } });
    if (!cal) throw new AdminError('Önce çalışma takvimi kaydedilmeli.');
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new AdminError('Tatil adı zorunlu.');
    const day = new Date(String(date).slice(0, 10));
    if (Number.isNaN(day.getTime())) throw new AdminError('Geçersiz tarih.');
    const dup = await prisma.holiday.findFirst({ where: { companyId, date: day } });
    if (dup) throw new AdminError('Bu tarihte zaten tatil tanımlı.');
    const created = await prisma.holiday.create({
      data: {
        calendarId: cal.id,
        companyId,
        date: day,
        name: trimmed,
        isHalfDay: !!isHalfDay,
        halfDayEndMin: isHalfDay
          ? (Number.isFinite(Number(halfDayEndMin)) ? Number(halfDayEndMin) : 780)
          : null,
        createdByUserId: actor.userId,
      },
    });
    invalidateWorkCalendarCache(companyId);
    return created;
  },

  async removeHoliday(companyId, holidayId) {
    // Scope guard: tatil bu şirkete ait olmalı (id tahmin edilemez ama yine de).
    const hol = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!hol || hol.companyId !== companyId) throw new AdminError('Tatil bulunamadı.');
    await prisma.holiday.delete({ where: { id: holidayId } });
    invalidateWorkCalendarCache(companyId);
    return { id: holidayId, deleted: true };
  },

  /**
   * TR resmî tatillerini yıla göre içe aktar (gömülü Diyanet tablosu;
   * mevcut tarihler atlanır — copyHolidays deseni). Tablo dışı yıl AdminError.
   */
  async importTrHolidays(companyId, year, actor) {
    assertActorObject(actor, 'workCalendarRepo.importTrHolidays');
    const cal = await prisma.workCalendar.findUnique({ where: { companyId } });
    if (!cal) throw new AdminError('Önce çalışma takvimi kaydedilmeli.');
    const list = getTrHolidays(Number(year));
    if (!list) {
      throw new AdminError(
        `${year} yılı gömülü TR tatil tablosunda yok — tatilleri elle girin ya da tabloyu güncelletin.`,
      );
    }
    const existing = new Set(
      (await prisma.holiday.findMany({ where: { companyId }, select: { date: true } }))
        .map((h) => h.date.toISOString().slice(0, 10)),
    );
    let added = 0;
    for (const h of list) {
      if (existing.has(h.date)) continue;
      await prisma.holiday.create({
        data: {
          calendarId: cal.id,
          companyId,
          date: new Date(h.date),
          name: h.name,
          isHalfDay: h.isHalfDay,
          halfDayEndMin: h.halfDayEndMin,
          createdByUserId: actor.userId,
        },
      });
      added += 1;
    }
    invalidateWorkCalendarCache(companyId);
    return { added, skipped: list.length - added };
  },

  /** Kaynak şirketin tatillerini hedefe kopyala (mevcut tarihler atlanır). */
  async copyHolidays(companyId, sourceCompanyId, actor) {
    assertActorObject(actor, 'workCalendarRepo.copyHolidays');
    const cal = await prisma.workCalendar.findUnique({ where: { companyId } });
    if (!cal) throw new AdminError('Önce çalışma takvimi kaydedilmeli.');
    const source = await prisma.holiday.findMany({ where: { companyId: sourceCompanyId } });
    const existing = new Set(
      (await prisma.holiday.findMany({ where: { companyId }, select: { date: true } }))
        .map((h) => h.date.toISOString().slice(0, 10)),
    );
    let copied = 0;
    for (const h of source) {
      if (existing.has(h.date.toISOString().slice(0, 10))) continue;
      await prisma.holiday.create({
        data: {
          calendarId: cal.id,
          companyId,
          date: h.date,
          name: h.name,
          isHalfDay: h.isHalfDay,
          halfDayEndMin: h.halfDayEndMin,
          createdByUserId: actor.userId,
        },
      });
      copied += 1;
    }
    invalidateWorkCalendarCache(companyId);
    return { copied, skipped: source.length - copied };
  },
};

export { AdminError, SMART_TICKET_TAXONOMY_TYPES };
