/**
 * Admin tanım ekranlarının BFF servisleri.
 *
 * USE_MOCK = false (FAZ 2). Tüm mutasyonlar BFF üzerinden DB'ye gider.
 * Hata durumunda apiFetch otomatik toast gösterir; bu modülün dönüş
 * sözleşmesi UI uyumluluğu için { ok: true, item } | { ok: false, error }.
 *
 * Mutasyon sonrası bootstrap cache invalidate edilir → NewCaseForm gibi
 * lookupService kullanan ekranlar yeni veriyi sync olarak görür.
 */

import { apiFetch, caseService } from './caseService';
import { loadBootstrap } from './lookupBootstrap';
import type {
  CaseCategoryDef,
  CaseChecklistItem,
  CaseChecklistTemplate,
  CaseDocumentType,
  CasePerson,
  CaseRequestType,
  CaseTeam,
  CaseThirdParty,
  OfferedSolutionDef,
  SlaPolicy,
} from '@/features/cases/types';

const ADMIN_BASE = '/api/admin';

// ─────────────────────────────────────────────────────────────────
// Input tipleri
// ─────────────────────────────────────────────────────────────────

export interface ThirdPartyInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface DocumentTypeInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface TeamInput {
  name: string;
  description?: string;
  /** Phase 5C — backend body.companyId zorunlu (multi-tenant scope). */
  companyId: string;
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
  /**
   * Hangi şirkete ait? Admin için kendi allowedCompanyIds'inden biri zorunlu.
   * SystemAdmin için null bırakılabilir = sistem geneli (cross-company şablon).
   */
  companyId?: string | null;
}

export interface SubCategoryInput {
  name: string;
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

export interface ChecklistTemplateInput {
  name: string;
  companyId: string;
  companyName: string;
  productGroup: string;
  categoryName: string;
  description?: string;
  items: CaseChecklistItem[];
  isActive: boolean;
}

export interface OfferedSolutionInput {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface UsageInfo {
  count: number;
}

export interface TeamUsageInfo {
  count: number;
  openCount: number;
  memberCount: number;
}

export interface PersonUsageInfo {
  count: number;
  openCount: number;
}

export interface CategoryUsageInfo {
  count: number;
  subCategoryCount: number;
}

export interface ChecklistUsageInfo {
  count: number;
  itemCount: number;
}

export type FieldType = 'Text' | 'Number' | 'Date' | 'Select' | 'Boolean' | 'Textarea';

export interface FieldDefinition {
  id: string;
  companyId: string;
  label: string;
  fieldKey: string;
  fieldType: FieldType;
  caseType?: string | null;
  isRequired: boolean;
  displayOrder: number;
  options?: { value: string; label: string }[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FieldDefinitionInput {
  companyId: string;
  label: string;
  fieldKey: string;
  fieldType: FieldType;
  caseType?: string | null;
  isRequired?: boolean;
  displayOrder?: number;
  options?: { value: string; label: string }[] | null;
  isActive?: boolean;
}

// Phase 5B — User management types.
export type CompanyRole = 'Agent' | 'Supervisor' | 'Admin' | 'SystemAdmin';

export interface UserAssignment {
  companyId: string;
  companyName: string;
  companyActive: boolean;
  role: CompanyRole;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: 'Agent' | 'Backoffice' | 'Supervisor' | 'CSM' | 'Admin' | 'SystemAdmin';
  isActive: boolean;
  personId: string | null;
  assignments: UserAssignment[];
}

// Phase 5A — Company management. CompanySettings (per-company branding) ile
// birleştirilmiş okuma görünümü; create/update tek payload kabul eder.
export interface Company {
  id: string;
  name: string;
  isActive: boolean;
  logoUrl: string | null;
  primaryColor: string | null;
  appName: string | null;
  supportEmail: string | null;
  // Phase D — müşterisiz vaka açma zorunluluğu (per-company toggle)
  requireCustomerOnCaseCreate?: boolean;
  // WR-A4 / PM-04 — AccountProject opt-in toggles (default false)
  projectsEnabled?: boolean;
  projectsRequired?: boolean;
  userCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanyInput {
  name: string;
  isActive?: boolean;
  logoUrl?: string;
  primaryColor?: string;
  appName?: string;
  supportEmail?: string;
  requireCustomerOnCaseCreate?: boolean;
  // WR-A4 / PM-04
  projectsEnabled?: boolean;
  projectsRequired?: boolean;
}

// WR-A6 / PM-05 — ProductGroup + Product catalog (foundation only).
export interface ProductGroup {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductGroupInput {
  companyId: string;
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface Product {
  id: string;
  companyId: string;
  productGroupId: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** BFF select chip — group code/name UI'da kullanılır. */
  productGroup?: { id: string; code: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductInput {
  companyId: string;
  productGroupId?: string;
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export type AdminResult<T> = { ok: true; item: T } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

async function refreshBootstrap() {
  try {
    await loadBootstrap({ force: true });
  } catch {
    // Toast zaten gösterildi; sessiz devam.
  }
}

// Generic CRUD factory — basit entity'ler için (thirdParties, docs, etc.)
function crud<T, I>(path: string) {
  return {
    async list(): Promise<T[]> {
      const data = await apiFetch<{ value: T[] }>(`${ADMIN_BASE}/${path}`, undefined, 'Liste yüklenemedi');
      if (!data) throw new Error('Liste yüklenemedi');
      return data.value ?? [];
    },
    async get(id: string): Promise<T | undefined> {
      const list = await this.list();
      return (list as Array<T & { id: string }>).find((x) => x.id === id);
    },
    async create(input: I): Promise<AdminResult<T>> {
      const item = await apiFetch<T>(
        `${ADMIN_BASE}/${path}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Kayıt oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<I>): Promise<AdminResult<T>> {
      const item = await apiFetch<T>(
        `${ADMIN_BASE}/${path}/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Kayıt güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<T>> {
      return this.update(id, { isActive } as unknown as Partial<I>);
    },
    async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const result = await apiFetch<{ deleted?: boolean }>(
        `${ADMIN_BASE}/${path}/${id}`,
        { method: 'DELETE' },
        'Silme başarısız',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true };
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Main service
// ─────────────────────────────────────────────────────────────────

export const adminService = {
  thirdParties: {
    ...crud<CaseThirdParty, ThirdPartyInput>('third-parties'),
    usage(_id: string): UsageInfo {
      // Yaklaşık sayım — kesin sonuç BFF'in remove handler'ında. Stale olabilir.
      return { count: 0 };
    },
  },

  documentTypes: {
    ...crud<CaseDocumentType, DocumentTypeInput>('document-types'),
    usage(_id: string): UsageInfo {
      return { count: 0 };
    },
  },

  teams: {
    ...crud<CaseTeam, TeamInput>('teams'),
    async members(teamId: string): Promise<CasePerson[]> {
      const all = await adminService.persons.list();
      return all.filter((p) => p.teamId === teamId);
    },
    usage(id: string): TeamUsageInfo {
      return {
        count: caseService.countByTeam(id),
        openCount: caseService.countOpenByTeam(id),
        memberCount: 0, // members() async; bu sync stub kullanıcı UI'da görmüyor
      };
    },
  },

  persons: {
    ...crud<CasePerson, PersonInput>('persons'),
    async listOutsideTeam(teamId: string): Promise<CasePerson[]> {
      const all = await adminService.persons.list();
      return all.filter((p) => p.teamId !== teamId);
    },
    async moveToTeam(personId: string, teamId: string): Promise<AdminResult<CasePerson>> {
      return adminService.persons.update(personId, { teamId } as Partial<PersonInput>);
    },
    usage(id: string): PersonUsageInfo {
      return {
        count: caseService.countByPerson(id),
        openCount: caseService.countOpenByPerson(id),
      };
    },
  },

  categories: {
    async list(): Promise<CaseCategoryDef[]> {
      const data = await apiFetch<{ value: CaseCategoryDef[] }>(
        `${ADMIN_BASE}/categories`,
        undefined,
        'Kategoriler yüklenemedi',
      );
      if (!data) throw new Error('Kategoriler yüklenemedi');
      return data.value ?? [];
    },
    async get(id: string): Promise<CaseCategoryDef | undefined> {
      const list = await this.list();
      return list.find((c) => c.id === id);
    },
    async create(input: CategoryInput): Promise<AdminResult<CaseCategoryDef>> {
      const item = await apiFetch<CaseCategoryDef>(
        `${ADMIN_BASE}/categories`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Kategori oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<CategoryInput>): Promise<AdminResult<CaseCategoryDef>> {
      const item = await apiFetch<CaseCategoryDef>(
        `${ADMIN_BASE}/categories/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Kategori güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<CaseCategoryDef>> {
      return adminService.categories.update(id, { isActive });
    },
    async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const result = await apiFetch<{ deleted?: boolean }>(
        `${ADMIN_BASE}/categories/${id}`,
        { method: 'DELETE' },
        'Kategori silinemedi',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true };
    },
    async addSubCategory(parentId: string, input: SubCategoryInput): Promise<AdminResult<CaseCategoryDef>> {
      const item = await apiFetch<CaseCategoryDef>(
        `${ADMIN_BASE}/categories/${parentId}/sub`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Alt kategori eklenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async updateSubCategory(id: string, patch: Partial<SubCategoryInput>): Promise<AdminResult<CaseCategoryDef>> {
      return adminService.categories.update(id, patch);
    },
    async setSubCategoryActive(id: string, isActive: boolean): Promise<AdminResult<CaseCategoryDef>> {
      return adminService.categories.update(id, { isActive });
    },
    async removeSubCategory(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      return adminService.categories.remove(id);
    },
    usage(id: string): CategoryUsageInfo {
      return {
        count: caseService.countByCategory(id),
        subCategoryCount: 0, // list() async; pages bunu kendi hesaplıyor
      };
    },
    subCategoryUsage(_id: string): UsageInfo {
      return { count: 0 };
    },
  },

  sla: {
    ...crud<SlaPolicy, SlaPolicyInput>('sla-policies'),
    usage(id: string): UsageInfo {
      return { count: caseService.countCasesMatchingPolicy(id) };
    },
  },

  checklists: {
    ...crud<CaseChecklistTemplate, ChecklistTemplateInput>('checklists'),
    async addItem(
      templateId: string,
      item: Omit<CaseChecklistItem, 'id'>,
    ): Promise<AdminResult<CaseChecklistTemplate>> {
      const list = await adminService.checklists.list();
      const tpl = list.find((t) => t.id === templateId);
      if (!tpl) return { ok: false, error: 'Şablon bulunamadı.' };
      const newItem: CaseChecklistItem = { id: `CHK-${Date.now().toString(36)}`, ...item };
      const items = [...tpl.items, newItem];
      return adminService.checklists.update(templateId, { items });
    },
    async updateItem(
      templateId: string,
      itemId: string,
      patch: Partial<CaseChecklistItem>,
    ): Promise<AdminResult<CaseChecklistTemplate>> {
      const list = await adminService.checklists.list();
      const tpl = list.find((t) => t.id === templateId);
      if (!tpl) return { ok: false, error: 'Şablon bulunamadı.' };
      const items = tpl.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
      return adminService.checklists.update(templateId, { items });
    },
    async removeItem(
      templateId: string,
      itemId: string,
    ): Promise<AdminResult<CaseChecklistTemplate>> {
      const list = await adminService.checklists.list();
      const tpl = list.find((t) => t.id === templateId);
      if (!tpl) return { ok: false, error: 'Şablon bulunamadı.' };
      const items = tpl.items.filter((it) => it.id !== itemId);
      return adminService.checklists.update(templateId, { items });
    },
    async moveItem(
      templateId: string,
      itemId: string,
      direction: 'up' | 'down',
    ): Promise<AdminResult<CaseChecklistTemplate>> {
      const list = await adminService.checklists.list();
      const tpl = list.find((t) => t.id === templateId);
      if (!tpl) return { ok: false, error: 'Şablon bulunamadı.' };
      const items = [...tpl.items];
      const idx = items.findIndex((it) => it.id === itemId);
      if (idx < 0) return { ok: false, error: 'Madde bulunamadı.' };
      const swap = direction === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= items.length) {
        return { ok: true, item: tpl };
      }
      [items[idx], items[swap]] = [items[swap], items[idx]];
      return adminService.checklists.update(templateId, { items });
    },
    async setItemActive(
      templateId: string,
      itemId: string,
      isActive: boolean,
    ): Promise<AdminResult<CaseChecklistTemplate>> {
      return adminService.checklists.updateItem(templateId, itemId, { isActive });
    },
    usage(id: string): ChecklistUsageInfo {
      return {
        count: caseService.countCasesMatchingChecklist(id),
        itemCount: 0,
      };
    },
  },

  offeredSolutions: {
    ...crud<OfferedSolutionDef, OfferedSolutionInput>('offered-solutions'),
    usage(id: string): UsageInfo {
      return { count: caseService.countCasesUsingOffer(id) };
    },
  },

  fieldDefinitions: {
    async list(companyId?: string): Promise<FieldDefinition[]> {
      const path = companyId
        ? `${ADMIN_BASE}/field-definitions?companyId=${encodeURIComponent(companyId)}`
        : `${ADMIN_BASE}/field-definitions`;
      const data = await apiFetch<{ value: FieldDefinition[] }>(path, undefined, 'Dinamik alanlar yüklenemedi');
      if (!data) throw new Error('Dinamik alanlar yüklenemedi');
      return data.value ?? [];
    },
    async create(input: FieldDefinitionInput): Promise<AdminResult<FieldDefinition>> {
      const item = await apiFetch<FieldDefinition>(
        `${ADMIN_BASE}/field-definitions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Dinamik alan oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<FieldDefinitionInput>): Promise<AdminResult<FieldDefinition>> {
      const item = await apiFetch<FieldDefinition>(
        `${ADMIN_BASE}/field-definitions/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Dinamik alan güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<FieldDefinition>> {
      return adminService.fieldDefinitions.update(id, { isActive });
    },
    async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const result = await apiFetch<FieldDefinition>(
        `${ADMIN_BASE}/field-definitions/${id}`,
        { method: 'DELETE' },
        'Dinamik alan silinemedi',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true };
    },
  },

  // Phase 5B — Users + per-company assignment yönetimi.
  // Phase 5C: invite / deactivate / reactivate eklendi.
  users: {
    async list(): Promise<AdminUser[]> {
      const data = await apiFetch<{ value: AdminUser[] }>(
        `${ADMIN_BASE}/users`,
        undefined,
        'Kullanıcılar yüklenemedi',
      );
      if (!data) throw new Error('Kullanıcılar yüklenemedi');
      return data.value ?? [];
    },
    async replaceCompanies(
      userId: string,
      assignments: { companyId: string; role: CompanyRole }[],
    ): Promise<AdminResult<{ id: string }>> {
      const item = await apiFetch<{ id: string }>(
        `${ADMIN_BASE}/users/${userId}/companies`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignments }),
        },
        'Şirket atamaları güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    /**
     * Phase 5C — Admin'den e-posta ile kullanıcı davet.
     * Supabase Auth `inviteUserByEmail` → DB placeholder User + UserCompany.
     */
    async invite(input: {
      email: string;
      role: AdminUser['role'];
      companyId: string;
      companyRole: CompanyRole;
    }): Promise<AdminResult<{ userId: string; email: string; message: string; orphanRecovered: boolean }>> {
      const item = await apiFetch<{
        success: boolean;
        userId: string;
        email: string;
        message: string;
        orphanRecovered: boolean;
      }>(
        `${ADMIN_BASE}/users/invite`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Davet gönderilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return {
        ok: true,
        item: {
          userId: item.userId,
          email: item.email,
          message: item.message,
          orphanRecovered: item.orphanRecovered,
        },
      };
    },
    /**
     * Phase 5C — Kullanıcıyı pasifleştir. DB `isActive=false`, verifyJwt'de barrier.
     */
    async deactivate(userId: string): Promise<AdminResult<{ message: string }>> {
      const item = await apiFetch<{ success: boolean; message: string }>(
        `${ADMIN_BASE}/users/${userId}/deactivate`,
        { method: 'DELETE' },
        'Pasifleştirme başarısız',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item: { message: item.message } };
    },
    /**
     * Phase 5C-resend — Davet bekleyen (fullName === email) aktif kullanıcıya
     * yeni magic-link mail göndermek için. Supabase `resetPasswordForEmail`
     * çağrısı yapılır; redirectTo backend env'inden gelir (prod URL).
     */
    async resendInvite(userId: string): Promise<AdminResult<{ message: string; email: string }>> {
      const item = await apiFetch<{ success: boolean; message: string; email: string }>(
        `${ADMIN_BASE}/users/${userId}/resend-invite`,
        { method: 'POST' },
        'Davet yeniden gönderilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item: { message: item.message, email: item.email } };
    },
    /**
     * Phase 5C — Pasif kullanıcıyı yeniden aktiflestir. UserCompany atamaları
     * korunur — sadece `isActive=true` döner. Idempotent.
     */
    async reactivate(userId: string): Promise<AdminResult<{ message: string }>> {
      const item = await apiFetch<{ success: boolean; message: string }>(
        `${ADMIN_BASE}/users/${userId}/reactivate`,
        { method: 'PATCH' },
        'Yeniden aktifleştirme başarısız',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item: { message: item.message } };
    },
  },

  // Phase 5A — Companies CRUD. Backend list endpoint'i kullanıcının
  // allowedCompanyIds'iyle filtrelenmiş döner; UI tarafında ek scope yok.
  companies: {
    async list(): Promise<Company[]> {
      const data = await apiFetch<{ value: Company[] }>(
        `${ADMIN_BASE}/companies`,
        undefined,
        'Şirketler yüklenemedi',
      );
      if (!data) throw new Error('Şirketler yüklenemedi');
      return data.value ?? [];
    },
    async create(input: CompanyInput): Promise<AdminResult<Company>> {
      const item = await apiFetch<Company>(
        `${ADMIN_BASE}/companies`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Şirket oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<CompanyInput>): Promise<AdminResult<Company>> {
      const item = await apiFetch<Company>(
        `${ADMIN_BASE}/companies/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Şirket güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<Company>> {
      return this.update(id, { isActive });
    },
    async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const result = await apiFetch<{ deactivated?: boolean }>(
        `${ADMIN_BASE}/companies/${id}`,
        { method: 'DELETE' },
        'Pasifleştirme başarısız',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true };
    },
  },

  // WR-A6 / PM-05 — ProductGroup + Product catalog (foundation only).
  // Tenant-scoped. Admin/SystemAdmin only. `code` immutable after create.
  productGroups: {
    async list(companyId?: string, opts: { includeInactive?: boolean } = {}): Promise<ProductGroup[]> {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      if (opts.includeInactive) q.set('includeInactive', '1');
      const data = await apiFetch<{ value: ProductGroup[] }>(
        `${ADMIN_BASE}/product-groups${q.toString() ? `?${q}` : ''}`,
        undefined,
        'Ürün grupları yüklenemedi',
      );
      return data?.value ?? [];
    },
    async create(input: ProductGroupInput): Promise<AdminResult<ProductGroup>> {
      const item = await apiFetch<ProductGroup>(
        `${ADMIN_BASE}/product-groups`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Ürün grubu oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<ProductGroupInput>): Promise<AdminResult<ProductGroup>> {
      const item = await apiFetch<ProductGroup>(
        `${ADMIN_BASE}/product-groups/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Ürün grubu güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<ProductGroup>> {
      return this.update(id, { isActive });
    },
  },

  products: {
    async list(
      companyId?: string,
      opts: { productGroupId?: string; includeInactive?: boolean } = {},
    ): Promise<Product[]> {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      if (opts.productGroupId) q.set('productGroupId', opts.productGroupId);
      if (opts.includeInactive) q.set('includeInactive', '1');
      const data = await apiFetch<{ value: Product[] }>(
        `${ADMIN_BASE}/products${q.toString() ? `?${q}` : ''}`,
        undefined,
        'Ürünler yüklenemedi',
      );
      return data?.value ?? [];
    },
    async create(input: ProductInput): Promise<AdminResult<Product>> {
      const item = await apiFetch<Product>(
        `${ADMIN_BASE}/products`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Ürün oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<ProductInput>): Promise<AdminResult<Product>> {
      const item = await apiFetch<Product>(
        `${ADMIN_BASE}/products/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Ürün güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<Product>> {
      return this.update(id, { isActive });
    },
  },

  // Phase 1.5 Madde 6 — Bilgi Kaynakları
  knowledgeSources: {
    async list(): Promise<KnowledgeSource[]> {
      const data = await apiFetch<{ value: KnowledgeSource[] }>(
        `${ADMIN_BASE}/knowledge-sources`,
        undefined,
        'Bilgi kaynakları yüklenemedi',
      );
      return data?.value ?? [];
    },
    async create(input: KnowledgeSourceInput): Promise<AdminResult<KnowledgeSource>> {
      const item = await apiFetch<KnowledgeSource>(
        `${ADMIN_BASE}/knowledge-sources`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Kaynak oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<KnowledgeSourceInput>): Promise<AdminResult<KnowledgeSource>> {
      const item = await apiFetch<KnowledgeSource>(
        `${ADMIN_BASE}/knowledge-sources/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Kaynak güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<KnowledgeSource>> {
      return this.update(id, { isActive });
    },
  },
};

// ─────────────────────────────────────────────────────────────────
// Knowledge Sources types
// ─────────────────────────────────────────────────────────────────
export type KnowledgeSourceType = 'PastCases' | 'ProductDocs' | 'SLARules' | 'Checklists' | 'ManualEntry';

export interface KnowledgeSource {
  id: string;
  companyId: string;
  name: string;
  sourceType: KnowledgeSourceType;
  contentCount: number;
  description: string | null;
  isActive: boolean;
  lastUpdated: string;
  createdAt: string;
}

export interface KnowledgeSourceInput {
  name?: string;
  sourceType?: KnowledgeSourceType;
  contentCount?: number;
  description?: string;
  isActive?: boolean;
  companyId?: string;
}
