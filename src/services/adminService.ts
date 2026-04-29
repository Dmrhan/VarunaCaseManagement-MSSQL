/**
 * Admin tanım ekranlarının CRUD servisleri.
 *
 * Sprint A altyapısı; Sprint B–H itibarıyla tüm namespace dolu:
 * `thirdParties`, `evrakTypes`, `teams`, `persons`, `categories`, `sla`,
 * `checklists`, `offeredSolutions`. FAZ 1 admin ekranları tamamlandı.
 *
 * USE_MOCK = true (mock store doğrudan mutate edilir).
 * FAZ 2 geçişinde her metod fetch ile değiştirilir.
 */

import {
  MOCK_CATEGORIES,
  MOCK_CHECKLIST_TEMPLATES,
  MOCK_EVRAK_TYPES,
  MOCK_OFFERED_SOLUTIONS,
  MOCK_PERSONS,
  MOCK_SLA_POLICIES,
  MOCK_TEAMS,
  MOCK_THIRD_PARTIES,
} from '@/mocks/caseMockData';
import { caseService } from './caseService';
import type {
  CaseCategoryDef,
  CaseChecklistItem,
  CaseChecklistTemplate,
  CaseEvrakType,
  CasePerson,
  CaseRequestType,
  CaseSubCategoryDef,
  CaseTeam,
  CaseThirdParty,
  OfferedSolutionDef,
  SlaPolicy,
} from '@/features/cases/types';

let _idCounter = 1000;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36).slice(-4)}-${_idCounter}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ----------------------------------------------------------------
// Third Parties
// ----------------------------------------------------------------

export interface ThirdPartyInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface EvrakTypeInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface TeamInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface PersonInput {
  name: string;
  teamId: string;
  email?: string;
  isActive: boolean;
}

export interface CategoryInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface SubCategoryInput {
  name: string;
  isActive: boolean;
}

export interface OfferedSolutionInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface ChecklistTemplateInput {
  name: string;
  companyId: string;
  companyName: string;
  productGroup: string;
  categoryName: string;
  description?: string;
  isActive: boolean;
}

export interface ChecklistItemInput {
  label: string;
  required: boolean;
  isActive: boolean;
}

export interface SlaPolicyInput {
  companyId: string;
  companyName: string;
  productGroup: string;
  categoryName: string;
  subCategoryName: string;
  requestType: CaseRequestType;
  responseHours: number;
  resolutionHours: number;
  description?: string;
  isActive: boolean;
}

interface UsageInfo {
  count: number;
}

interface TeamUsageInfo {
  totalCases: number;
  openCases: number;
  memberCount: number;
}

interface PersonUsageInfo {
  totalCases: number;
  openCases: number;
}

interface CategoryUsageInfo {
  totalCases: number;
  subCategoryCount: number;
}

interface ChecklistUsageInfo {
  totalCases: number;
  itemCount: number;
}

export const adminService = {
  thirdParties: {
    /** Tüm kayıtlar (active + inactive). Admin tablosu için. */
    list(): CaseThirdParty[] {
      return clone(MOCK_THIRD_PARTIES);
    },

    get(id: string): CaseThirdParty | undefined {
      const found = MOCK_THIRD_PARTIES.find((tp) => tp.id === id);
      return found ? clone(found) : undefined;
    },

    /**
     * Yeni kayıt ekler. Aynı isimde başka kayıt varsa hata fırlatır.
     * Boş veya yalnızca whitespace isim kabul edilmez.
     */
    create(input: ThirdPartyInput): { ok: true; item: CaseThirdParty } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'İsim zorunludur.' };
      const exists = MOCK_THIRD_PARTIES.some(
        (tp) => tp.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) return { ok: false, error: 'Bu isimde başka bir kayıt zaten var.' };

      const item: CaseThirdParty = {
        id: nextId('TP'),
        name,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
      };
      MOCK_THIRD_PARTIES.push(item);
      return { ok: true, item: clone(item) };
    },

    /**
     * Mevcut kaydı günceller. İsim değişiyorsa benzersizlik kontrolü yapılır.
     */
    update(
      id: string,
      patch: Partial<ThirdPartyInput>,
    ): { ok: true; item: CaseThirdParty } | { ok: false; error: string } {
      const idx = MOCK_THIRD_PARTIES.findIndex((tp) => tp.id === id);
      if (idx < 0) return { ok: false, error: 'Kayıt bulunamadı.' };

      const next: CaseThirdParty = { ...MOCK_THIRD_PARTIES[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'İsim zorunludur.' };
        const dup = MOCK_THIRD_PARTIES.some(
          (tp) => tp.id !== id && tp.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde başka bir kayıt zaten var.' };
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || undefined;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_THIRD_PARTIES[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.thirdParties.update(id, { isActive });
    },

    /**
     * Hard delete. Caller önce usage() ile kullanım yerlerini kontrol etmeli;
     * vakalarda referans varsa servis yine de siler — vakalardaki thirdPartyName
     * denormalized olduğu için görüntüleme bozulmaz, sadece dropdown'da görünmez.
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_THIRD_PARTIES.findIndex((tp) => tp.id === id);
      if (idx < 0) return { ok: false, error: 'Kayıt bulunamadı.' };
      MOCK_THIRD_PARTIES.splice(idx, 1);
      return { ok: true };
    },

    /** Bu 3. parti kaç vakada referans veriliyor? */
    usage(id: string): UsageInfo {
      return { count: caseService.countByThirdParty(id) };
    },
  },

  // ----------------------------------------------------------------
  // Evrak Types
  // ----------------------------------------------------------------

  evrakTypes: {
    /** Tüm kayıtlar (active + inactive). Admin tablosu için. */
    list(): CaseEvrakType[] {
      return clone(MOCK_EVRAK_TYPES);
    },

    get(id: string): CaseEvrakType | undefined {
      const found = MOCK_EVRAK_TYPES.find((e) => e.id === id);
      return found ? clone(found) : undefined;
    },

    /**
     * Yeni kayıt ekler. Aynı isimde başka kayıt varsa hata fırlatır.
     * Boş veya yalnızca whitespace isim kabul edilmez.
     */
    create(input: EvrakTypeInput): { ok: true; item: CaseEvrakType } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'İsim zorunludur.' };
      const exists = MOCK_EVRAK_TYPES.some(
        (e) => e.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) return { ok: false, error: 'Bu isimde başka bir kayıt zaten var.' };

      const item: CaseEvrakType = {
        id: nextId('EVRAK'),
        name,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
      };
      MOCK_EVRAK_TYPES.push(item);
      return { ok: true, item: clone(item) };
    },

    /**
     * Mevcut kaydı günceller. İsim değişiyorsa benzersizlik kontrolü yapılır.
     */
    update(
      id: string,
      patch: Partial<EvrakTypeInput>,
    ): { ok: true; item: CaseEvrakType } | { ok: false; error: string } {
      const idx = MOCK_EVRAK_TYPES.findIndex((e) => e.id === id);
      if (idx < 0) return { ok: false, error: 'Kayıt bulunamadı.' };

      const next: CaseEvrakType = { ...MOCK_EVRAK_TYPES[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'İsim zorunludur.' };
        const dup = MOCK_EVRAK_TYPES.some(
          (e) => e.id !== id && e.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde başka bir kayıt zaten var.' };
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || undefined;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_EVRAK_TYPES[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.evrakTypes.update(id, { isActive });
    },

    /**
     * Hard delete. FAZ 4'te dosya yükleme eklendiğinde caller usage() ile
     * kullanım kontrolü yapmalı; şimdilik referans yok, doğrudan silinir.
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_EVRAK_TYPES.findIndex((e) => e.id === id);
      if (idx < 0) return { ok: false, error: 'Kayıt bulunamadı.' };
      MOCK_EVRAK_TYPES.splice(idx, 1);
      return { ok: true };
    },

    /** Bu evrak tipi kaç dosyada/vakada referans veriliyor? FAZ 4'e kadar 0 döner. */
    usage(id: string): UsageInfo {
      return { count: caseService.countByEvrakType(id) };
    },
  },

  // ----------------------------------------------------------------
  // Teams
  // ----------------------------------------------------------------

  teams: {
    list(): CaseTeam[] {
      return clone(MOCK_TEAMS);
    },

    get(id: string): CaseTeam | undefined {
      const found = MOCK_TEAMS.find((t) => t.id === id);
      return found ? clone(found) : undefined;
    },

    create(input: TeamInput): { ok: true; item: CaseTeam } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'Takım adı zorunludur.' };
      const exists = MOCK_TEAMS.some(
        (t) => t.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) return { ok: false, error: 'Bu isimde başka bir takım zaten var.' };

      const item: CaseTeam = {
        id: nextId('TEAM'),
        name,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
      };
      MOCK_TEAMS.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<TeamInput>,
    ): { ok: true; item: CaseTeam } | { ok: false; error: string } {
      const idx = MOCK_TEAMS.findIndex((t) => t.id === id);
      if (idx < 0) return { ok: false, error: 'Takım bulunamadı.' };

      const next: CaseTeam = { ...MOCK_TEAMS[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'Takım adı zorunludur.' };
        const dup = MOCK_TEAMS.some(
          (t) => t.id !== id && t.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde başka bir takım zaten var.' };
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || undefined;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_TEAMS[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.teams.update(id, { isActive });
    },

    /**
     * Hard delete. Üyesi olan takım silinemez (önce üyeleri başka takıma taşımalı).
     * Açık vakası olan takım silinemez (FK bütünlüğü için).
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_TEAMS.findIndex((t) => t.id === id);
      if (idx < 0) return { ok: false, error: 'Takım bulunamadı.' };

      const memberCount = MOCK_PERSONS.filter((p) => p.teamId === id).length;
      if (memberCount > 0) {
        return {
          ok: false,
          error: `Takımda ${memberCount} üye var. Önce üyeleri başka takıma taşıyın veya pasifleştirin.`,
        };
      }
      const openCases = caseService.countOpenByTeam(id);
      if (openCases > 0) {
        return {
          ok: false,
          error: `Takıma atanmış ${openCases} açık vaka var. Önce vakaları başka takıma transfer edin.`,
        };
      }
      MOCK_TEAMS.splice(idx, 1);
      return { ok: true };
    },

    /** Üye + toplam/açık vaka sayısı. Tabloda kullanım kolonu için. */
    usage(id: string): TeamUsageInfo {
      return {
        totalCases: caseService.countByTeam(id),
        openCases: caseService.countOpenByTeam(id),
        memberCount: MOCK_PERSONS.filter((p) => p.teamId === id).length,
      };
    },

    /** Belirli bir takımın üye listesi (active + inactive). */
    members(teamId: string): CasePerson[] {
      return MOCK_PERSONS.filter((p) => p.teamId === teamId).map((p) => clone(p));
    },
  },

  // ----------------------------------------------------------------
  // Persons
  // ----------------------------------------------------------------

  persons: {
    list(): CasePerson[] {
      return clone(MOCK_PERSONS);
    },

    /** Verilen takım dışındaki kişiler (üye ekleme modal'ında transfer için). */
    listOutsideTeam(teamId: string): CasePerson[] {
      return MOCK_PERSONS.filter((p) => p.teamId !== teamId).map((p) => clone(p));
    },

    get(id: string): CasePerson | undefined {
      const found = MOCK_PERSONS.find((p) => p.id === id);
      return found ? clone(found) : undefined;
    },

    create(input: PersonInput): { ok: true; item: CasePerson } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'İsim zorunludur.' };
      if (!input.teamId) return { ok: false, error: 'Takım seçimi zorunludur.' };
      const teamExists = MOCK_TEAMS.some((t) => t.id === input.teamId);
      if (!teamExists) return { ok: false, error: 'Seçilen takım bulunamadı.' };

      const email = input.email?.trim() || undefined;
      if (email) {
        const dup = MOCK_PERSONS.some(
          (p) => (p.email ?? '').toLowerCase() === email.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu e-posta başka bir kullanıcıda kayıtlı.' };
      }

      const item: CasePerson = {
        id: nextId('USR'),
        name,
        teamId: input.teamId,
        email,
        isActive: input.isActive,
      };
      MOCK_PERSONS.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<PersonInput>,
    ): { ok: true; item: CasePerson } | { ok: false; error: string } {
      const idx = MOCK_PERSONS.findIndex((p) => p.id === id);
      if (idx < 0) return { ok: false, error: 'Kullanıcı bulunamadı.' };

      const next: CasePerson = { ...MOCK_PERSONS[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'İsim zorunludur.' };
        next.name = name;
      }
      if (patch.teamId != null) {
        const teamExists = MOCK_TEAMS.some((t) => t.id === patch.teamId);
        if (!teamExists) return { ok: false, error: 'Seçilen takım bulunamadı.' };
        next.teamId = patch.teamId;
      }
      if (patch.email !== undefined) {
        const email = patch.email?.trim() || undefined;
        if (email) {
          const dup = MOCK_PERSONS.some(
            (p) => p.id !== id && (p.email ?? '').toLowerCase() === email.toLowerCase(),
          );
          if (dup) return { ok: false, error: 'Bu e-posta başka bir kullanıcıda kayıtlı.' };
        }
        next.email = email;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_PERSONS[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.persons.update(id, { isActive });
    },

    /** Kişiyi başka takıma taşır (üye yönetimi modal'ında "Takıma Ekle" için). */
    moveToTeam(id: string, teamId: string) {
      return adminService.persons.update(id, { teamId });
    },

    /**
     * Hard delete. Açık vakası varsa silinemez. Caller önce usage() ile kontrol etmeli.
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_PERSONS.findIndex((p) => p.id === id);
      if (idx < 0) return { ok: false, error: 'Kullanıcı bulunamadı.' };

      const openCases = caseService.countOpenByPerson(id);
      if (openCases > 0) {
        return {
          ok: false,
          error: `Kullanıcıya atanmış ${openCases} açık vaka var. Önce vakaları başka kullanıcıya transfer edin.`,
        };
      }
      MOCK_PERSONS.splice(idx, 1);
      return { ok: true };
    },

    usage(id: string): PersonUsageInfo {
      return {
        totalCases: caseService.countByPerson(id),
        openCases: caseService.countOpenByPerson(id),
      };
    },
  },

  // ----------------------------------------------------------------
  // Categories (master) + SubCategories (detail)
  // ----------------------------------------------------------------

  categories: {
    list(): CaseCategoryDef[] {
      return clone(MOCK_CATEGORIES);
    },

    get(id: string): CaseCategoryDef | undefined {
      const found = MOCK_CATEGORIES.find((c) => c.id === id);
      return found ? clone(found) : undefined;
    },

    create(input: CategoryInput): { ok: true; item: CaseCategoryDef } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'Kategori adı zorunludur.' };
      const exists = MOCK_CATEGORIES.some(
        (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) return { ok: false, error: 'Bu isimde başka bir kategori zaten var.' };

      const item: CaseCategoryDef = {
        id: nextId('CAT'),
        name,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
        subCategories: [],
      };
      MOCK_CATEGORIES.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<CategoryInput>,
    ): { ok: true; item: CaseCategoryDef } | { ok: false; error: string } {
      const idx = MOCK_CATEGORIES.findIndex((c) => c.id === id);
      if (idx < 0) return { ok: false, error: 'Kategori bulunamadı.' };

      const next: CaseCategoryDef = { ...MOCK_CATEGORIES[idx], subCategories: [...MOCK_CATEGORIES[idx].subCategories] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'Kategori adı zorunludur.' };
        const dup = MOCK_CATEGORIES.some(
          (c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde başka bir kategori zaten var.' };
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || undefined;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_CATEGORIES[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.categories.update(id, { isActive });
    },

    /**
     * Hard delete. Alt kategori varsa silinemez (önce hepsini taşımalı/silmeli).
     * Vakalarda kullanılıyorsa adı denormalized, silme bozmaz — sadece dropdown'dan kalkar.
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_CATEGORIES.findIndex((c) => c.id === id);
      if (idx < 0) return { ok: false, error: 'Kategori bulunamadı.' };
      const cat = MOCK_CATEGORIES[idx];
      if (cat.subCategories.length > 0) {
        return {
          ok: false,
          error: `"${cat.name}" altında ${cat.subCategories.length} alt kategori var. Önce alt kategorileri silin.`,
        };
      }
      MOCK_CATEGORIES.splice(idx, 1);
      return { ok: true };
    },

    /** Kategori + alt kategori sayısı + toplam vaka sayısı (ad-bazlı). */
    usage(id: string): CategoryUsageInfo {
      const cat = MOCK_CATEGORIES.find((c) => c.id === id);
      if (!cat) return { totalCases: 0, subCategoryCount: 0 };
      return {
        totalCases: caseService.countByCategory(cat.name),
        subCategoryCount: cat.subCategories.length,
      };
    },

    // -------- Sub-categories --------

    addSubCategory(
      categoryId: string,
      input: SubCategoryInput,
    ): { ok: true; item: CaseSubCategoryDef } | { ok: false; error: string } {
      const cat = MOCK_CATEGORIES.find((c) => c.id === categoryId);
      if (!cat) return { ok: false, error: 'Kategori bulunamadı.' };
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'Alt kategori adı zorunludur.' };
      const dup = cat.subCategories.some(
        (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (dup) return { ok: false, error: 'Bu isimde alt kategori zaten var.' };

      const item: CaseSubCategoryDef = {
        id: nextId('SUB'),
        name,
        isActive: input.isActive,
      };
      cat.subCategories.push(item);
      return { ok: true, item: clone(item) };
    },

    updateSubCategory(
      categoryId: string,
      subId: string,
      patch: Partial<SubCategoryInput>,
    ): { ok: true; item: CaseSubCategoryDef } | { ok: false; error: string } {
      const cat = MOCK_CATEGORIES.find((c) => c.id === categoryId);
      if (!cat) return { ok: false, error: 'Kategori bulunamadı.' };
      const idx = cat.subCategories.findIndex((s) => s.id === subId);
      if (idx < 0) return { ok: false, error: 'Alt kategori bulunamadı.' };

      const next: CaseSubCategoryDef = { ...cat.subCategories[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'Alt kategori adı zorunludur.' };
        const dup = cat.subCategories.some(
          (s) => s.id !== subId && s.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde alt kategori zaten var.' };
        next.name = name;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      cat.subCategories[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setSubCategoryActive(categoryId: string, subId: string, isActive: boolean) {
      return adminService.categories.updateSubCategory(categoryId, subId, { isActive });
    },

    removeSubCategory(categoryId: string, subId: string): { ok: true } | { ok: false; error: string } {
      const cat = MOCK_CATEGORIES.find((c) => c.id === categoryId);
      if (!cat) return { ok: false, error: 'Kategori bulunamadı.' };
      const idx = cat.subCategories.findIndex((s) => s.id === subId);
      if (idx < 0) return { ok: false, error: 'Alt kategori bulunamadı.' };
      cat.subCategories.splice(idx, 1);
      return { ok: true };
    },

    /** Alt kategorinin (ad-bazlı) vaka kullanımı. */
    subCategoryUsage(categoryId: string, subId: string): UsageInfo {
      const cat = MOCK_CATEGORIES.find((c) => c.id === categoryId);
      const sub = cat?.subCategories.find((s) => s.id === subId);
      if (!cat || !sub) return { count: 0 };
      return { count: caseService.countBySubCategory(cat.name, sub.name) };
    },
  },

  // ----------------------------------------------------------------
  // SLA Policies — PRODUCT_SPEC §6
  // ----------------------------------------------------------------

  sla: {
    list(): SlaPolicy[] {
      return clone(MOCK_SLA_POLICIES);
    },

    get(id: string): SlaPolicy | undefined {
      const found = MOCK_SLA_POLICIES.find((p) => p.id === id);
      return found ? clone(found) : undefined;
    },

    /**
     * Çakışma kontrolü: aynı 5-tuple'a (company, productGroup, category,
     * subCategory, requestType) sahip iki kural olmamalı.
     */
    create(input: SlaPolicyInput): { ok: true; item: SlaPolicy } | { ok: false; error: string } {
      const err = validateSlaInput(input);
      if (err) return { ok: false, error: err };
      const dup = MOCK_SLA_POLICIES.some((p) => sameSlaTuple(p, input));
      if (dup) return { ok: false, error: 'Bu 5-tuple için zaten bir kural tanımlı.' };

      const item: SlaPolicy = {
        id: nextId('SLA'),
        companyId: input.companyId,
        companyName: input.companyName,
        productGroup: input.productGroup.trim(),
        categoryName: input.categoryName.trim(),
        subCategoryName: input.subCategoryName.trim(),
        requestType: input.requestType,
        responseHours: input.responseHours,
        resolutionHours: input.resolutionHours,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
      };
      MOCK_SLA_POLICIES.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<SlaPolicyInput>,
    ): { ok: true; item: SlaPolicy } | { ok: false; error: string } {
      const idx = MOCK_SLA_POLICIES.findIndex((p) => p.id === id);
      if (idx < 0) return { ok: false, error: 'Kural bulunamadı.' };

      const next: SlaPolicy = { ...MOCK_SLA_POLICIES[idx] };
      if (patch.companyId !== undefined && patch.companyName !== undefined) {
        next.companyId = patch.companyId;
        next.companyName = patch.companyName;
      }
      if (patch.productGroup !== undefined) next.productGroup = patch.productGroup.trim();
      if (patch.categoryName !== undefined) next.categoryName = patch.categoryName.trim();
      if (patch.subCategoryName !== undefined) next.subCategoryName = patch.subCategoryName.trim();
      if (patch.requestType !== undefined) next.requestType = patch.requestType;
      if (patch.responseHours !== undefined) next.responseHours = patch.responseHours;
      if (patch.resolutionHours !== undefined) next.resolutionHours = patch.resolutionHours;
      if (patch.description !== undefined) next.description = patch.description?.trim() || undefined;
      if (patch.isActive !== undefined) next.isActive = patch.isActive;

      const err = validateSlaInput(next);
      if (err) return { ok: false, error: err };

      const dup = MOCK_SLA_POLICIES.some((p) => p.id !== id && sameSlaTuple(p, next));
      if (dup) return { ok: false, error: 'Bu 5-tuple için zaten başka bir kural var.' };

      MOCK_SLA_POLICIES[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.sla.update(id, { isActive });
    },

    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_SLA_POLICIES.findIndex((p) => p.id === id);
      if (idx < 0) return { ok: false, error: 'Kural bulunamadı.' };
      MOCK_SLA_POLICIES.splice(idx, 1);
      return { ok: true };
    },

    /** Bu kural kaç vakaya tam eşleşiyor (preview için). */
    usage(id: string): UsageInfo {
      return { count: caseService.countCasesMatchingPolicy(id) };
    },
  },

  // ----------------------------------------------------------------
  // Kontrol Listesi (Checklist Templates)
  // ----------------------------------------------------------------

  checklists: {
    list(): CaseChecklistTemplate[] {
      return clone(MOCK_CHECKLIST_TEMPLATES);
    },

    get(id: string): CaseChecklistTemplate | undefined {
      const found = MOCK_CHECKLIST_TEMPLATES.find((t) => t.id === id);
      return found ? clone(found) : undefined;
    },

    /**
     * Çakışma kontrolü: aynı 3-tuple (company + productGroup + category) için
     * birden fazla template olamaz — vakada otomatik yüklenecek tek bir template
     * beklenir.
     */
    create(input: ChecklistTemplateInput): { ok: true; item: CaseChecklistTemplate } | { ok: false; error: string } {
      const err = validateChecklistTemplateInput(input);
      if (err) return { ok: false, error: err };
      const dup = MOCK_CHECKLIST_TEMPLATES.some((t) => sameChecklistTuple(t, input));
      if (dup) return { ok: false, error: 'Bu Şirket + Ürün Grubu + Kategori için zaten bir şablon var.' };

      const item: CaseChecklistTemplate = {
        id: nextId('CHK'),
        name: input.name.trim(),
        companyId: input.companyId,
        companyName: input.companyName,
        productGroup: input.productGroup.trim(),
        categoryName: input.categoryName.trim(),
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
        items: [],
      };
      MOCK_CHECKLIST_TEMPLATES.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<ChecklistTemplateInput>,
    ): { ok: true; item: CaseChecklistTemplate } | { ok: false; error: string } {
      const idx = MOCK_CHECKLIST_TEMPLATES.findIndex((t) => t.id === id);
      if (idx < 0) return { ok: false, error: 'Şablon bulunamadı.' };

      const prev = MOCK_CHECKLIST_TEMPLATES[idx];
      const next: CaseChecklistTemplate = { ...prev, items: prev.items };

      if (patch.name !== undefined) next.name = patch.name.trim();
      if (patch.companyId !== undefined && patch.companyName !== undefined) {
        next.companyId = patch.companyId;
        next.companyName = patch.companyName;
      }
      if (patch.productGroup !== undefined) next.productGroup = patch.productGroup.trim();
      if (patch.categoryName !== undefined) next.categoryName = patch.categoryName.trim();
      if (patch.description !== undefined) next.description = patch.description?.trim() || undefined;
      if (patch.isActive !== undefined) next.isActive = patch.isActive;

      const err = validateChecklistTemplateInput(next);
      if (err) return { ok: false, error: err };

      const dup = MOCK_CHECKLIST_TEMPLATES.some((t) => t.id !== id && sameChecklistTuple(t, next));
      if (dup) return { ok: false, error: 'Bu Şirket + Ürün Grubu + Kategori için zaten başka bir şablon var.' };

      MOCK_CHECKLIST_TEMPLATES[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.checklists.update(id, { isActive });
    },

    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_CHECKLIST_TEMPLATES.findIndex((t) => t.id === id);
      if (idx < 0) return { ok: false, error: 'Şablon bulunamadı.' };
      MOCK_CHECKLIST_TEMPLATES.splice(idx, 1);
      return { ok: true };
    },

    /** Bu şablon kaç vakaya 3-tuple eşleşiyor + kaç madde içeriyor. */
    usage(id: string): ChecklistUsageInfo {
      const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === id);
      if (!t) return { totalCases: 0, itemCount: 0 };
      return {
        totalCases: caseService.countCasesMatchingChecklist(id),
        itemCount: t.items.length,
      };
    },

    // -------- Items --------

    addItem(
      templateId: string,
      input: ChecklistItemInput,
    ): { ok: true; item: CaseChecklistItem } | { ok: false; error: string } {
      const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
      if (!t) return { ok: false, error: 'Şablon bulunamadı.' };
      const label = input.label.trim();
      if (!label) return { ok: false, error: 'Madde metni zorunludur.' };
      const dup = t.items.some(
        (i) => i.label.trim().toLowerCase() === label.toLowerCase(),
      );
      if (dup) return { ok: false, error: 'Bu metinde madde zaten var.' };

      const item: CaseChecklistItem = {
        id: nextId('CHKI'),
        label,
        required: input.required,
        isActive: input.isActive,
      };
      t.items.push(item);
      return { ok: true, item: clone(item) };
    },

    updateItem(
      templateId: string,
      itemId: string,
      patch: Partial<ChecklistItemInput>,
    ): { ok: true; item: CaseChecklistItem } | { ok: false; error: string } {
      const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
      if (!t) return { ok: false, error: 'Şablon bulunamadı.' };
      const idx = t.items.findIndex((i) => i.id === itemId);
      if (idx < 0) return { ok: false, error: 'Madde bulunamadı.' };

      const next: CaseChecklistItem = { ...t.items[idx] };
      if (patch.label !== undefined) {
        const label = patch.label.trim();
        if (!label) return { ok: false, error: 'Madde metni zorunludur.' };
        const dup = t.items.some(
          (i) => i.id !== itemId && i.label.trim().toLowerCase() === label.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu metinde başka bir madde zaten var.' };
        next.label = label;
      }
      if (patch.required !== undefined) next.required = patch.required;
      if (patch.isActive !== undefined) next.isActive = patch.isActive;
      t.items[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setItemActive(templateId: string, itemId: string, isActive: boolean) {
      return adminService.checklists.updateItem(templateId, itemId, { isActive });
    },

    removeItem(templateId: string, itemId: string): { ok: true } | { ok: false; error: string } {
      const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
      if (!t) return { ok: false, error: 'Şablon bulunamadı.' };
      const idx = t.items.findIndex((i) => i.id === itemId);
      if (idx < 0) return { ok: false, error: 'Madde bulunamadı.' };
      t.items.splice(idx, 1);
      return { ok: true };
    },

    /** Madde sırasını değiştirir: -1 yukarı, +1 aşağı. */
    moveItem(
      templateId: string,
      itemId: string,
      direction: -1 | 1,
    ): { ok: true } | { ok: false; error: string } {
      const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
      if (!t) return { ok: false, error: 'Şablon bulunamadı.' };
      const idx = t.items.findIndex((i) => i.id === itemId);
      if (idx < 0) return { ok: false, error: 'Madde bulunamadı.' };
      const target = idx + direction;
      if (target < 0 || target >= t.items.length) {
        return { ok: false, error: 'Bu yönde taşınamaz.' };
      }
      const [moved] = t.items.splice(idx, 1);
      t.items.splice(target, 0, moved);
      return { ok: true };
    },
  },

  // ----------------------------------------------------------------
  // Offered Solutions (Churn retention teklifleri)
  // ----------------------------------------------------------------

  offeredSolutions: {
    list(): OfferedSolutionDef[] {
      return clone(MOCK_OFFERED_SOLUTIONS);
    },

    get(id: string): OfferedSolutionDef | undefined {
      const found = MOCK_OFFERED_SOLUTIONS.find((o) => o.id === id);
      return found ? clone(found) : undefined;
    },

    create(input: OfferedSolutionInput): { ok: true; item: OfferedSolutionDef } | { ok: false; error: string } {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'İsim zorunludur.' };
      const exists = MOCK_OFFERED_SOLUTIONS.some(
        (o) => o.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) return { ok: false, error: 'Bu isimde başka bir teklif zaten var.' };

      const item: OfferedSolutionDef = {
        id: nextId('OFFER'),
        name,
        description: input.description?.trim() || undefined,
        isActive: input.isActive,
      };
      MOCK_OFFERED_SOLUTIONS.push(item);
      return { ok: true, item: clone(item) };
    },

    update(
      id: string,
      patch: Partial<OfferedSolutionInput>,
    ): { ok: true; item: OfferedSolutionDef } | { ok: false; error: string } {
      const idx = MOCK_OFFERED_SOLUTIONS.findIndex((o) => o.id === id);
      if (idx < 0) return { ok: false, error: 'Teklif bulunamadı.' };

      const next: OfferedSolutionDef = { ...MOCK_OFFERED_SOLUTIONS[idx] };
      if (patch.name != null) {
        const name = patch.name.trim();
        if (!name) return { ok: false, error: 'İsim zorunludur.' };
        const dup = MOCK_OFFERED_SOLUTIONS.some(
          (o) => o.id !== id && o.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (dup) return { ok: false, error: 'Bu isimde başka bir teklif zaten var.' };
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || undefined;
      }
      if (patch.isActive !== undefined) {
        next.isActive = patch.isActive;
      }
      MOCK_OFFERED_SOLUTIONS[idx] = next;
      return { ok: true, item: clone(next) };
    },

    setActive(id: string, isActive: boolean) {
      return adminService.offeredSolutions.update(id, { isActive });
    },

    /**
     * Hard delete. Vakalardaki offeredSolutions: string[] alanı ID listesi tutar
     * (denormalized ad yok), silinince eski vakalarda "Bilinmeyen teklif"
     * görünür. Caller önce usage() ile uyarı vermeli; alternatif olarak
     * pasifleştirme önerilir.
     */
    remove(id: string): { ok: true } | { ok: false; error: string } {
      const idx = MOCK_OFFERED_SOLUTIONS.findIndex((o) => o.id === id);
      if (idx < 0) return { ok: false, error: 'Teklif bulunamadı.' };
      MOCK_OFFERED_SOLUTIONS.splice(idx, 1);
      return { ok: true };
    },

    /** Bu teklif kaç vakada sunulmuş — admin tablosunda "kullanım" kolonu. */
    usage(id: string): UsageInfo {
      return { count: caseService.countCasesUsingOffer(id) };
    },
  },
};

// ----------------------------------------------------------------
// Checklist helpers (private)
// ----------------------------------------------------------------

function validateChecklistTemplateInput(t: {
  name: string;
  companyId: string;
  productGroup: string;
  categoryName: string;
}): string | null {
  if (!t.name.trim()) return 'Şablon adı zorunludur.';
  if (!t.companyId) return 'Şirket seçimi zorunludur.';
  if (!t.productGroup.trim()) return 'Ürün grubu seçimi zorunludur.';
  if (!t.categoryName.trim()) return 'Kategori seçimi zorunludur.';
  return null;
}

function sameChecklistTuple(
  a: { companyId: string; productGroup: string; categoryName: string },
  b: { companyId: string; productGroup: string; categoryName: string },
): boolean {
  return (
    a.companyId === b.companyId &&
    a.productGroup.trim().toLowerCase() === b.productGroup.trim().toLowerCase() &&
    a.categoryName.trim().toLowerCase() === b.categoryName.trim().toLowerCase()
  );
}

// ----------------------------------------------------------------
// SLA helpers (private)
// ----------------------------------------------------------------

function validateSlaInput(p: {
  companyId: string;
  productGroup: string;
  categoryName: string;
  subCategoryName: string;
  requestType: string;
  responseHours: number;
  resolutionHours: number;
}): string | null {
  if (!p.companyId) return 'Şirket seçimi zorunludur.';
  if (!p.productGroup.trim()) return 'Ürün grubu seçimi zorunludur.';
  if (!p.categoryName.trim()) return 'Kategori seçimi zorunludur.';
  if (!p.subCategoryName.trim()) return 'Alt kategori seçimi zorunludur.';
  if (!p.requestType) return 'Talep türü seçimi zorunludur.';
  if (!Number.isFinite(p.responseHours) || p.responseHours <= 0) {
    return 'Yanıt süresi pozitif bir saat değeri olmalı.';
  }
  if (!Number.isFinite(p.resolutionHours) || p.resolutionHours <= 0) {
    return 'Çözüm süresi pozitif bir saat değeri olmalı.';
  }
  if (p.resolutionHours < p.responseHours) {
    return 'Çözüm süresi yanıt süresinden küçük olamaz.';
  }
  return null;
}

function sameSlaTuple(
  a: { companyId: string; productGroup: string; categoryName: string; subCategoryName: string; requestType: string },
  b: { companyId: string; productGroup: string; categoryName: string; subCategoryName: string; requestType: string },
): boolean {
  return (
    a.companyId === b.companyId &&
    a.productGroup.trim().toLowerCase() === b.productGroup.trim().toLowerCase() &&
    a.categoryName.trim().toLowerCase() === b.categoryName.trim().toLowerCase() &&
    a.subCategoryName.trim().toLowerCase() === b.subCategoryName.trim().toLowerCase() &&
    a.requestType === b.requestType
  );
}
