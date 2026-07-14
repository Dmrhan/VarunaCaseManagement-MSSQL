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
  CasePriority,
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
  companyId?: string;
  pausesSla?: boolean;
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
  /** WR-A5 — Takım default destek seviyesi (L1/L2/L3/Expert). Default L1. */
  defaultSupportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
}

export interface PersonInput {
  name: string;
  teamId: string;
  email?: string;
  isActive: boolean;
  /** WR-A5 — Kişinin destek seviyesi (L1/L2/L3/Expert). Default L1. */
  supportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
  /** WR-B1 — Takım lideri bayrağı. Default false. */
  isTeamLead?: boolean;
  /**
   * Compose-Signature F1 — Kişinin iş unvanı (örn. "Ürün Direktörü").
   * Şirket imza şablonundaki {{agent.title}} placeholder'ından render
   * edilir. Boş bırakılırsa imzada title satırı boş çıkar.
   */
  title?: string | null;
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
  productGroup: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  requestType: CaseRequestType | null;
  priority: CasePriority | null;
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
  /**
   * Compose-Signature F1 IA rework — bağlı Person'ın iş unvanı (mail
   * imzasında {{agent.title}} render kaynağı). Person yoksa null;
   * Kullanıcılar ekranında bu durumda title field disabled gösterilir.
   */
  personTitle: string | null;
  assignments: UserAssignment[];
}

// Phase 5A — Company management. CompanySettings (per-company branding) ile
// birleştirilmiş okuma görünümü; create/update tek payload kabul eder.
export interface Company {
  id: string;
  name: string;
  isActive: boolean;
  /// Vaka numarası öneki — 2-4 harf (örn. "UNV"). Yeni firmada zorunlu.
  /// Bir kez set edilince değiştirilebilir ama boşaltılamaz.
  caseNumberPrefix: string | null;
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
  /// Vaka numarası öneki — create'te zorunlu (backend 400 verir); update'te
  /// opsiyonel ama set edildikten sonra boşaltılamaz.
  caseNumberPrefix?: string;
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
  /** WR-A6 follow-up — Varsayılan destek seviyesi (L1/L2/L3/Expert). Default L1. */
  supportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
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
  /** WR-A6 follow-up — Varsayılan destek seviyesi (L1/L2/L3/Expert). */
  supportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
}

// WR-A7 / PM-05 — Package + PackageItem (foundation only; no Case form picker).
export interface Package {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  supportLevel: 'L1' | 'L2' | 'L3' | 'Expert';
  sortOrder: number;
  isActive: boolean;
  /** Eklenmiş ürün sayısı (list endpoint'inde groupBy ile gelir). */
  productCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PackageInput {
  companyId: string;
  code?: string;
  name?: string;
  description?: string | null;
  supportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
  sortOrder?: number;
  isActive?: boolean;
}

export interface PackageItem {
  packageId: string;
  productId: string;
  sortOrder: number;
  createdAt?: string;
  product?: { id: string; code: string; name: string; isActive: boolean; supportLevel?: string };
}

// Authorization Management — shadow-mode policy definitions.
export type AuthorizationPolicyTarget = 'menu' | 'resource' | 'field' | 'securityFilter';
export type AuthorizationPrincipalType = 'systemRole' | 'companyRole' | 'team' | 'user';
export type AuthorizationPolicyEffect = 'allow' | 'deny';

export interface AuthorizationPolicy {
  id: string;
  companyId: string;
  target: AuthorizationPolicyTarget;
  principalType: AuthorizationPrincipalType;
  principalKey: string;
  effect: AuthorizationPolicyEffect;
  menuKey: string | null;
  viewKey: string | null;
  resourceKey: string | null;
  action: string | null;
  scope: string | null;
  fieldKey: string | null;
  filterJson: string | null;
  priority: number;
  isActive: boolean;
  notes: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdBy?: { id: string; fullName?: string | null; email?: string | null } | null;
  updatedBy?: { id: string; fullName?: string | null; email?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthorizationPolicyInput {
  companyId: string;
  target: AuthorizationPolicyTarget;
  principalType: AuthorizationPrincipalType;
  principalKey: string;
  effect: AuthorizationPolicyEffect;
  menuKey?: string | null;
  viewKey?: string | null;
  resourceKey?: string | null;
  action?: string | null;
  scope?: string | null;
  fieldKey?: string | null;
  filterJson?: unknown;
  priority?: number;
  isActive?: boolean;
  notes?: string | null;
}

export interface AuthorizationPolicyListFilter {
  companyId: string;
  target?: AuthorizationPolicyTarget;
  isActive?: boolean;
}

export interface AuthorizationEffectivePreview {
  principal: {
    type: AuthorizationPrincipalType;
    key: string;
    syntheticUser: {
      id: string;
      role: string;
      teamId: string | null;
      companyRoles: string[];
      allowedCompanyIds: string[];
    };
  };
  summary: {
    menuAllowed: number;
    menuDenied: number;
    resourceAllowed: number;
    resourceDenied: number;
    securityFilterCount: number;
  };
  menus: Array<{
    key: string;
    viewKey: string;
    label: string;
    group: string;
    allowed: boolean;
    reason: string;
  }>;
  resources: Array<{
    key: string;
    label: string;
    category: string;
    actions: Array<{ action: string; allowed: boolean; reason: string }>;
  }>;
  fields: Array<{
    scope: string;
    fields: Array<{
      fieldKey: string;
      state: Record<string, boolean>;
      reasons: Record<string, string>;
    }>;
  }>;
  securityFilters: Array<{
    resourceKey: string;
    effect: AuthorizationPolicyEffect;
    priority: number;
    filter: unknown;
  }>;
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
    async listByCompany(companyId: string): Promise<CaseThirdParty[]> {
      const data = await apiFetch<{ value: CaseThirdParty[] }>(
        `${ADMIN_BASE}/third-parties?companyId=${encodeURIComponent(companyId)}`,
        undefined,
        'Liste yüklenemedi',
      );
      if (!data) throw new Error('Liste yüklenemedi');
      return data.value ?? [];
    },
    usage(_id: string): UsageInfo {
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
     * Faz 3 — Admin'den kullanıcı oluşturma (local auth, e-posta gönderimi yok).
     * Admin başlangıç şifresi belirler; kullanıcı ilk girişte değiştirmek zorunda.
     */
    async createUser(input: {
      email: string;
      fullName?: string;
      role: AdminUser['role'];
      companyId: string;
      companyRole: CompanyRole;
      password: string;
      teamId?: string;
    }): Promise<AdminResult<{ userId: string; email: string; message: string }>> {
      const item = await apiFetch<{
        success: boolean;
        userId: string;
        email: string;
        message: string;
      }>(
        `${ADMIN_BASE}/users`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Kullanıcı oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return {
        ok: true,
        item: {
          userId: item.userId,
          email: item.email,
          message: item.message,
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
     * Faz 3 — Admin'den geçici şifre atama ("şifremi unuttum"un on-prem karşılığı).
     * Kullanıcı yeni geçici şifreyle girer; ilk girişte değiştirmek zorunda.
     */
    async resetPassword(
      userId: string,
      password: string,
    ): Promise<AdminResult<{ message: string; email: string }>> {
      const item = await apiFetch<{ success: boolean; message: string; email: string }>(
        `${ADMIN_BASE}/users/${userId}/reset-password`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) },
        'Şifre sıfırlanamadı',
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
    /**
     * Sistem rolünü değiştir (yalnız SystemAdmin yetkili).
     * UserCompany.role'e dokunulmaz. Üst bar / global menü davranışı
     * kullanıcının yeniden login/refresh'inden sonra güncellenir.
     */
    async updateSystemRole(
      userId: string,
      role: AdminUser['role'],
    ): Promise<AdminResult<{ userId: string; email: string; previousRole: string; role: string }>> {
      const item = await apiFetch<{
        success: boolean;
        userId: string;
        email: string;
        previousRole: string;
        role: string;
      }>(
        `${ADMIN_BASE}/users/${userId}/system-role`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) },
        'Sistem rolü güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return {
        ok: true,
        item: {
          userId: item.userId,
          email: item.email,
          previousRole: item.previousRole,
          role: item.role,
        },
      };
    },

    /**
     * Compose-Signature F1 IA rework —
     * PATCH /admin/users/:id/title  body: { title: string | null }
     *
     * Bağlı Person'ın iş unvanını günceller. Person yoksa 409 → caller
     * UI'da disabled gösterir (sunucudan gelmez).
     */
    async setTitle(userId: string, title: string | null): Promise<AdminResult<{ personId: string; title: string | null }>> {
      const item = await apiFetch<{ personId: string; title: string | null }>(
        `${ADMIN_BASE}/users/${userId}/title`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
        'Unvan güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
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

  // WR-A7 / PM-05 — Package + PackageItem catalog (foundation only).
  // Tenant-scoped. Admin/SystemAdmin only. `code` immutable after create.
  packages: {
    async list(companyId?: string, opts: { includeInactive?: boolean } = {}): Promise<Package[]> {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      if (opts.includeInactive) q.set('includeInactive', '1');
      const data = await apiFetch<{ value: Package[] }>(
        `${ADMIN_BASE}/packages${q.toString() ? `?${q}` : ''}`,
        undefined,
        'Paketler yüklenemedi',
      );
      return data?.value ?? [];
    },
    async create(input: PackageInput): Promise<AdminResult<Package>> {
      const item = await apiFetch<Package>(
        `${ADMIN_BASE}/packages`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Paket oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<PackageInput>): Promise<AdminResult<Package>> {
      const item = await apiFetch<Package>(
        `${ADMIN_BASE}/packages/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Paket güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<Package>> {
      return this.update(id, { isActive });
    },
    async listItems(id: string): Promise<PackageItem[]> {
      const data = await apiFetch<{ value: PackageItem[] }>(
        `${ADMIN_BASE}/packages/${id}/items`,
        undefined,
        'Paket ürünleri yüklenemedi',
      );
      return data?.value ?? [];
    },
    async replaceItems(id: string, productIds: string[]): Promise<AdminResult<PackageItem[]>> {
      const data = await apiFetch<{ value: PackageItem[] }>(
        `${ADMIN_BASE}/packages/${id}/items`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productIds }) },
        'Paket ürünleri güncellenemedi',
      );
      if (!data) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item: data.value ?? [] };
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

  // WR-KB1 — External KB Integration Settings (admin-only config; no API call).
  externalKbSettings: {
    async get(companyId: string): Promise<ExternalKbSetting | undefined> {
      return apiFetch<ExternalKbSetting>(
        `${ADMIN_BASE}/external-kb-settings?companyId=${encodeURIComponent(companyId)}`,
        undefined,
        'Bilgi Bankası ayarları yüklenemedi',
      );
    },
    async save(
      companyId: string,
      patch: ExternalKbSettingInput,
    ): Promise<AdminResult<ExternalKbSetting>> {
      const item = await apiFetch<ExternalKbSetting>(
        `${ADMIN_BASE}/external-kb-settings/${encodeURIComponent(companyId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Bilgi Bankası ayarları kaydedilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
  },

  /**
   * DevOps Faz 2.1 — Per-tenant TFS integration settings (admin-only).
   *
   * PAT plain text bu service'te asla görünmez:
   *  - get() response'unda yok (sadece patIsSet + patSetAt)
   *  - save() request'inde `pat` opsiyonel; yalnız değiştirmek istediğinde
   *    gönderilir, yoksa mevcut şifreli PAT'a dokunulmaz
   *  - test() PAT'ı server-side decrypt edip TFS'e bir test çağrısı yapar
   */
  externalDevOpsSettings: {
    async get(companyId: string): Promise<ExternalDevOpsSetting | undefined> {
      return apiFetch<ExternalDevOpsSetting>(
        `${ADMIN_BASE}/external-devops-settings?companyId=${encodeURIComponent(companyId)}`,
        undefined,
        'DevOps ayarları yüklenemedi',
      );
    },
    async save(
      companyId: string,
      patch: ExternalDevOpsSettingInput,
    ): Promise<AdminResult<ExternalDevOpsSetting>> {
      const item = await apiFetch<ExternalDevOpsSetting>(
        `${ADMIN_BASE}/external-devops-settings/${encodeURIComponent(companyId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'DevOps ayarları kaydedilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async test(
      companyId: string,
      testWorkItemId?: number,
    ): Promise<ExternalDevOpsTestResult | undefined> {
      return apiFetch<ExternalDevOpsTestResult>(
        `${ADMIN_BASE}/external-devops-settings/${encodeURIComponent(companyId)}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testWorkItemId ? { testWorkItemId } : {}),
        },
        'DevOps bağlantı testi başarısız',
      );
    },
  },

  /**
   * Mail M5 — Per-tenant SMTP/IMAP integration settings (admin-only).
   *
   * Secret plain text bu service'te asla görünmez:
   *  - get() response'unda yok (sadece secretIsSet + secretSetAt)
   *  - save() request'inde `secret` opsiyonel; yalnız değiştirmek istediğinde
   *    gönderilir, yoksa mevcut şifreli secret'a dokunulmaz
   *  - test() secret'ı server-side decrypt edip mailProvider'a verir
   */
  externalMailSettings: {
    async get(companyId: string): Promise<ExternalMailSetting | undefined> {
      return apiFetch<ExternalMailSetting>(
        `${ADMIN_BASE}/external-mail-settings?companyId=${encodeURIComponent(companyId)}`,
        undefined,
        'Mail ayarları yüklenemedi',
      );
    },
    async save(
      companyId: string,
      patch: ExternalMailSettingInput,
    ): Promise<AdminResult<ExternalMailSetting>> {
      const item = await apiFetch<ExternalMailSetting>(
        `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Mail ayarları kaydedilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async test(
      companyId: string,
      testTo?: string,
    ): Promise<ExternalMailTestResult | undefined> {
      return apiFetch<ExternalMailTestResult>(
        `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testTo ? { testTo } : {}),
        },
        'Mail bağlantı testi başarısız',
      );
    },
    // Mail M5-extension — Per-company FromAlias CRUD (admin).
    aliases: {
      async list(companyId: string): Promise<FromAliasItem[]> {
        const out = await apiFetch<{ items: FromAliasItem[] }>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/from-aliases`,
          undefined,
          'Gönderen adresleri yüklenemedi',
        );
        return out?.items ?? [];
      },
      async create(companyId: string, draft: FromAliasDraft): Promise<FromAliasItem | undefined> {
        return apiFetch<FromAliasItem>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/from-aliases`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          },
          'Adres eklenemedi',
        );
      },
      async update(
        companyId: string,
        aliasId: string,
        draft: FromAliasDraft,
      ): Promise<FromAliasItem | undefined> {
        return apiFetch<FromAliasItem>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/from-aliases/${encodeURIComponent(aliasId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          },
          'Adres güncellenemedi',
        );
      },
      async remove(companyId: string, aliasId: string): Promise<boolean> {
        const out = await apiFetch<{ ok: boolean }>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/from-aliases/${encodeURIComponent(aliasId)}`,
          { method: 'DELETE' },
          'Adres silinemedi',
        );
        return !!out?.ok;
      },
      async setDefault(companyId: string, aliasId: string): Promise<boolean> {
        const out = await apiFetch<{ ok: boolean }>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/from-aliases/${encodeURIComponent(aliasId)}/set-default`,
          { method: 'POST' },
          'Varsayılan ayarlanamadı',
        );
        return !!out?.ok;
      },
    },
    // Mail Multi-Inbox (Faz A) — Per-company çoklu gelen mailbox CRUD.
    inboxes: {
      async list(companyId: string): Promise<MailInboxItem[]> {
        const out = await apiFetch<{ items: MailInboxItem[] }>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/inboxes`,
          undefined,
          'Inbox listesi yüklenemedi',
        );
        return out?.items ?? [];
      },
      async create(companyId: string, draft: MailInboxDraft): Promise<MailInboxItem | undefined> {
        return apiFetch<MailInboxItem>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/inboxes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          },
          'Inbox eklenemedi',
        );
      },
      async update(
        companyId: string,
        inboxId: string,
        draft: MailInboxDraft,
      ): Promise<MailInboxItem | undefined> {
        return apiFetch<MailInboxItem>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/inboxes/${encodeURIComponent(inboxId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          },
          'Inbox güncellenemedi',
        );
      },
      async remove(companyId: string, inboxId: string): Promise<boolean> {
        const out = await apiFetch<{ ok: boolean }>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/inboxes/${encodeURIComponent(inboxId)}`,
          { method: 'DELETE' },
          'Inbox silinemedi',
        );
        return !!out?.ok;
      },
      // 2026-07-02 — Inbox-başına IMAP bağlantı testi. Mail çekmez.
      // Dönüş code'una göre UI Türkçe aksiyon mesajı gösterir.
      async test(companyId: string, inboxId: string): Promise<InboxTestResult> {
        const out = await apiFetch<InboxTestResult>(
          `${ADMIN_BASE}/external-mail-settings/${encodeURIComponent(companyId)}/inboxes/${encodeURIComponent(inboxId)}/test`,
          { method: 'POST' },
          'Bağlantı testi başarısız',
        );
        return out ?? {
          ok: false,
          code: 'connection_failed',
          message: 'Sunucudan yanıt alınamadı.',
        };
      },
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // Mail M6.3b Faz 3 — CaseEmailTemplate admin CRUD.
  // Per-tenant, assertCompanyAdmin scope.
  // ─────────────────────────────────────────────────────────────────
  caseEmailTemplates: {
    async list(companyId: string) {
      const out = await apiFetch<{ items: CaseEmailTemplateRow[] }>(
        `${ADMIN_BASE}/case-email-templates?companyId=${encodeURIComponent(companyId)}`,
        undefined,
        'Şablonlar yüklenemedi',
      );
      return out?.items ?? [];
    },
    async create(companyId: string, draft: CaseEmailTemplateDraft) {
      return apiFetch<CaseEmailTemplateRow>(
        `${ADMIN_BASE}/case-email-templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, companyId }),
        },
        'Şablon oluşturulamadı',
      );
    },
    async update(companyId: string, id: string, draft: Partial<CaseEmailTemplateDraft>) {
      return apiFetch<CaseEmailTemplateRow>(
        `${ADMIN_BASE}/case-email-templates/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, companyId }),
        },
        'Şablon güncellenemedi',
      );
    },
    async remove(companyId: string, id: string) {
      const out = await apiFetch<{ ok: boolean }>(
        `${ADMIN_BASE}/case-email-templates/${encodeURIComponent(id)}?companyId=${encodeURIComponent(companyId)}`,
        { method: 'DELETE' },
        'Şablon silinemedi',
      );
      return !!out?.ok;
    },
    async preview(companyId: string, id: string, caseId?: string) {
      const qs = `companyId=${encodeURIComponent(companyId)}${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ''}`;
      return apiFetch<{ subject: string | null; bodyHtml: string; missing: string[] }>(
        `${ADMIN_BASE}/case-email-templates/${encodeURIComponent(id)}/preview?${qs}`,
        { method: 'POST' },
        'Önizleme başarısız',
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // WR-Smart-Ticket Phase 1b — TaxonomyDef admin CRUD.
  // ─────────────────────────────────────────────────────────────────
  taxonomyDefs: {
    async list(filter: TaxonomyDefListFilter): Promise<TaxonomyDef[]> {
      const qs = new URLSearchParams();
      qs.set('companyId', filter.companyId);
      if (filter.taxonomyType) qs.set('taxonomyType', filter.taxonomyType);
      if (filter.isActive !== undefined) qs.set('isActive', String(filter.isActive));
      if (filter.parentId !== undefined) qs.set('parentId', filter.parentId ?? '');
      const data = await apiFetch<{ value: TaxonomyDef[] }>(
        `${ADMIN_BASE}/taxonomy-defs?${qs.toString()}`,
        undefined,
        'Taxonomy listesi yüklenemedi',
      );
      if (!data) return [];
      return data.value ?? [];
    },
    async create(input: TaxonomyDefInput): Promise<AdminResult<TaxonomyDef>> {
      const item = await apiFetch<TaxonomyDef>(
        `${ADMIN_BASE}/taxonomy-defs`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Taxonomy oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<TaxonomyDefInput>): Promise<AdminResult<TaxonomyDef>> {
      const item = await apiFetch<TaxonomyDef>(
        `${ADMIN_BASE}/taxonomy-defs/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Taxonomy güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<TaxonomyDef>> {
      return this.update(id, { isActive });
    },
    async deactivate(
      id: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      // Soft delete — backend her zaman isActive=false yapar.
      const result = await apiFetch<{ id: string; deactivated: boolean }>(
        `${ADMIN_BASE}/taxonomy-defs/${id}`,
        { method: 'DELETE' },
        'Pasifleştirme başarısız',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true };
    },
  },

  // Authorization Management — policy CRUD + active runtime pilot coverage.
  // Runtime enforcement is intentionally deny-only: policies can narrow
  // existing role access, but they do not widen backend route gates.
  authorizationPolicies: {
    async list(filter: AuthorizationPolicyListFilter): Promise<AuthorizationPolicy[]> {
      const qs = new URLSearchParams();
      qs.set('companyId', filter.companyId);
      if (filter.target) qs.set('target', filter.target);
      if (filter.isActive !== undefined) qs.set('isActive', String(filter.isActive));
      const data = await apiFetch<{ value: AuthorizationPolicy[] }>(
        `${ADMIN_BASE}/authorization-policies?${qs.toString()}`,
        undefined,
        'Yetkilendirme politikaları yüklenemedi',
      );
      if (!data) return [];
      return data.value ?? [];
    },
    async create(input: AuthorizationPolicyInput): Promise<AdminResult<AuthorizationPolicy>> {
      const item = await apiFetch<AuthorizationPolicy>(
        `${ADMIN_BASE}/authorization-policies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Yetkilendirme politikası oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async update(
      id: string,
      patch: Partial<AuthorizationPolicyInput>,
    ): Promise<AdminResult<AuthorizationPolicy>> {
      const item = await apiFetch<AuthorizationPolicy>(
        `${ADMIN_BASE}/authorization-policies/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Yetkilendirme politikası güncellenemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
    async setActive(id: string, isActive: boolean): Promise<AdminResult<AuthorizationPolicy>> {
      return this.update(id, { isActive });
    },
    async deactivate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const result = await apiFetch<{ id: string; deactivated: boolean }>(
        `${ADMIN_BASE}/authorization-policies/${id}`,
        { method: 'DELETE' },
        'Yetkilendirme politikası pasifleştirilemedi',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true };
    },
    async effectivePreview(input: {
      companyId: string;
      principalType: AuthorizationPrincipalType;
      principalKey: string;
      featureFlags?: Record<string, boolean>;
    }): Promise<AuthorizationEffectivePreview> {
      const data = await apiFetch<AuthorizationEffectivePreview>(
        `${ADMIN_BASE}/authorization-policies/effective-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Yetki önizlemesi hesaplanamadı',
      );
      if (!data) throw new Error('Yetki önizlemesi hesaplanamadı');
      return data;
    },
  },

  // ── Çalışma Takvimi (SLA iş-saati Faz 2) — SysAdmin-only ──
  workCalendar: {
    async get(companyId: string): Promise<WorkCalendar | null> {
      const data = await apiFetch<{ value: WorkCalendar | null }>(
        `${ADMIN_BASE}/work-calendar/${encodeURIComponent(companyId)}`,
        undefined,
        'Çalışma takvimi yüklenemedi',
      );
      return data?.value ?? null;
    },
    async save(companyId: string, patch: WorkCalendarInput): Promise<WorkCalendar | undefined> {
      return apiFetch<WorkCalendar>(
        `${ADMIN_BASE}/work-calendar/${encodeURIComponent(companyId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Çalışma takvimi kaydedilemedi',
      );
    },
    async addHoliday(companyId: string, input: HolidayInput): Promise<WorkCalendarHoliday | undefined> {
      return apiFetch<WorkCalendarHoliday>(
        `${ADMIN_BASE}/work-calendar/${encodeURIComponent(companyId)}/holidays`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Tatil eklenemedi',
      );
    },
    async removeHoliday(companyId: string, holidayId: string): Promise<unknown> {
      return apiFetch(
        `${ADMIN_BASE}/work-calendar/${encodeURIComponent(companyId)}/holidays/${encodeURIComponent(holidayId)}`,
        { method: 'DELETE' },
        'Tatil silinemedi',
      );
    },
    async copyFrom(companyId: string, sourceCompanyId: string): Promise<{ copied: number; skipped: number } | undefined> {
      return apiFetch<{ copied: number; skipped: number }>(
        `${ADMIN_BASE}/work-calendar/${encodeURIComponent(companyId)}/copy-from/${encodeURIComponent(sourceCompanyId)}`,
        { method: 'POST' },
        'Tatiller kopyalanamadı',
      );
    },
    async preview(
      calendar: WorkCalendarDraft,
      scenarios: WorkCalendarScenario[],
    ): Promise<{ results: WorkCalendarPreviewResult[] } | undefined> {
      return apiFetch<{ results: WorkCalendarPreviewResult[] }>(
        `${ADMIN_BASE}/work-calendar/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendar, scenarios }),
        },
        'Örnek hesap alınamadı',
      );
    },
  },
};

// ── Çalışma Takvimi tipleri ──
export interface WorkCalendarDay { day: number; startMin: number; endMin: number }
export interface WorkCalendarHoliday {
  id: string;
  date: string;
  name: string;
  isHalfDay: boolean;
  halfDayEndMin: number | null;
}
export interface WorkCalendar {
  id: string;
  companyId: string;
  workDays: WorkCalendarDay[];
  breakStartMin: number | null;
  breakEndMin: number | null;
  isActive: boolean;
  pauseOnCustomerWait: boolean;
  effectiveFrom: string | null;
  holidays: WorkCalendarHoliday[];
}
export interface WorkCalendarInput {
  workDays?: WorkCalendarDay[];
  breakStartMin?: number | null;
  breakEndMin?: number | null;
  isActive?: boolean;
  pauseOnCustomerWait?: boolean;
  effectiveFrom?: string | null;
}
export interface HolidayInput {
  date: string;
  name: string;
  isHalfDay?: boolean;
  halfDayEndMin?: number | null;
}
export interface WorkCalendarDraft extends WorkCalendarInput {
  holidays?: Array<{ date: string; isHalfDay?: boolean; halfDayEndMin?: number | null }>;
}
export type WorkCalendarScenario =
  | { startIso: string; addMinutes: number }
  | { fromIso: string; toIso: string };
export interface WorkCalendarPreviewResult {
  kind: 'add' | 'between' | 'invalid';
  resultIso?: string | null;
  minutes?: number | null;
}

// ─────────────────────────────────────────────────────────────────
// Smart Ticket TaxonomyDef
// ─────────────────────────────────────────────────────────────────

export const SMART_TICKET_TAXONOMY_TYPES = [
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
] as const;

export type SmartTicketTaxonomyType = (typeof SMART_TICKET_TAXONOMY_TYPES)[number];

export const SMART_TICKET_TAXONOMY_TYPE_LABELS: Record<SmartTicketTaxonomyType, string> = {
  platform:            'Platform',
  businessProcess:     'İş Süreci',
  operationType:       'İşlem Tipi',
  affectedObject:      'Etkilenen Nesne',
  impact:              'Etki',
  rootCauseGroup:      'Kök Neden Grubu',
  rootCauseDetail:     'Kök Neden Detayı',
  resolutionType:      'Çözüm Tipi',
  permanentPrevention: 'Kalıcı Önlem',
};

export interface TaxonomyDef {
  id: string;
  companyId: string;
  taxonomyType: SmartTicketTaxonomyType;
  code: string;
  label: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyDefInput {
  companyId: string;
  taxonomyType: SmartTicketTaxonomyType;
  code: string;
  label: string;
  parentId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface TaxonomyDefListFilter {
  companyId: string;
  taxonomyType?: SmartTicketTaxonomyType;
  isActive?: boolean;
  parentId?: string | null;
}

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

// ─────────────────────────────────────────────────────────────────
// WR-KB1 — External KB Integration Settings
// ─────────────────────────────────────────────────────────────────
export type ExternalKbAuthType = 'none' | 'apiKey' | 'bearerToken';

export type ExternalKbStrictness = 'lenient' | 'normal' | 'strict';

export interface ExternalKbSetting {
  id: string | null;
  companyId: string;
  enabled: boolean;
  providerName: string | null;
  baseUrl: string | null;
  askEndpointPath: string;
  searchEndpointPath: string;
  healthEndpointPath: string;
  statsEndpointPath: string;
  categorizeEndpointPath: string;
  analyzeEndpointPath: string;
  authType: ExternalKbAuthType;
  /** Sadece environment secret referans adı; raw secret değildir. */
  apiKeySecretName: string | null;
  timeoutMs: number;
  defaultTopK: number;
  defaultStrictness: ExternalKbStrictness;
  defaultRerank: boolean;
  defaultVerify: boolean;
  showCitations: boolean;
  allowAgentUse: boolean;
  allowSupervisorUse: boolean;
  allowCsmUse: boolean;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExternalKbSettingInput {
  enabled?: boolean;
  providerName?: string | null;
  baseUrl?: string | null;
  askEndpointPath?: string;
  searchEndpointPath?: string;
  healthEndpointPath?: string;
  statsEndpointPath?: string;
  categorizeEndpointPath?: string;
  analyzeEndpointPath?: string;
  authType?: ExternalKbAuthType;
  apiKeySecretName?: string | null;
  timeoutMs?: number;
  defaultTopK?: number;
  defaultStrictness?: ExternalKbStrictness;
  defaultRerank?: boolean;
  defaultVerify?: boolean;
  showCitations?: boolean;
  allowAgentUse?: boolean;
  allowSupervisorUse?: boolean;
  allowCsmUse?: boolean;
  notes?: string | null;
}

/**
 * DevOps Faz 2.1 — Per-tenant TFS entegrasyon ayarları (admin).
 *
 * PAT plain text bu interface'te YOK; sadece patIsSet + patSetAt. Server
 * GET response'unda hiçbir ciphertext/iv/authTag alanı dönmez.
 */
export interface ExternalDevOpsSetting {
  id: string | null;
  companyId: string;
  enabled: boolean;
  baseUrl: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  /**
   * Faz 2.1 follow-up — Basic auth kullanıcı adı (örn. "DOMAIN\\user").
   * SECRET DEĞİL; plain GET'te döner. On-prem TFS user+secret bekliyor;
   * cloud Azure DevOps boş bırakılabilir (PAT-only).
   */
  username: string | null;
  /** PAT/parola şifreli olarak DB'de var mı? */
  patIsSet: boolean;
  /** PAT/parola'nın en son set edildiği zaman (ISO). */
  patSetAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExternalDevOpsSettingInput {
  enabled?: boolean;
  baseUrl?: string | null;
  apiVersion?: string | null;
  timeoutMs?: number;
  /** Basic auth kullanıcı adı (plain saklanır; örn. "DOMAIN\\user"). */
  username?: string | null;
  /**
   * Yalnız yeni PAT/parola set/rotate ederken gönderilir. Undefined →
   * mevcut secret'a dokunulmaz. Server tarafta AES-256-GCM ile şifrelenir.
   */
  pat?: string;
}

export interface ExternalDevOpsTestResult {
  ok: boolean;
  workItem?: { id: number; title: string | null; state: string | null };
  meta?: { apiVersion?: string; latencyMs?: number };
  error?: { code: string; message: string; status?: number };
}

/**
 * Mail M5 — Per-tenant SMTP/IMAP entegrasyon ayarları (admin).
 *
 * Secret plain text bu interface'te YOK; sadece secretIsSet + secretSetAt.
 * Server GET response'unda hiçbir ciphertext/iv/authTag alanı dönmez.
 */
export interface ExternalMailSetting {
  id: string | null;
  companyId: string;
  enabled: boolean;
  fromAddress: string | null;
  inboundAddress: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  imapHost: string | null;
  imapPort: number | null;
  authMode: 'password' | 'oauth2';
  /** SMTP/IMAP kullanıcı adı (genelde inboundAddress ile aynı). */
  username: string | null;
  /**
   * Compose-Signature F2 — Şirket imza şablonu (placeholder'lı HTML).
   * `{{agent.name}}` + `{{agent.title}}` Mustache placeholder'larıyla
   * mail dispatch anında User → Person üzerinden render edilir.
   */
  signatureHtml: string | null;
  /** Secret şifreli olarak DB'de var mı? */
  secretIsSet: boolean;
  /** Secret'in en son set edildiği zaman (ISO). */
  secretSetAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExternalMailSettingInput {
  enabled?: boolean;
  fromAddress?: string | null;
  inboundAddress?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  imapHost?: string | null;
  imapPort?: number | null;
  authMode?: 'password' | 'oauth2';
  username?: string | null;
  /** Compose-Signature F2 — Şirket imza şablonu (sanitize-html backend). */
  signatureHtml?: string | null;
  /**
   * Yalnız yeni secret set/rotate ederken gönderilir. Undefined → mevcut
   * secret'a dokunulmaz. Server tarafta AES-256-GCM ile şifrelenir.
   */
  secret?: string;
}

export interface ExternalMailTestResult {
  ok: boolean;
  messageId?: string | null;
  previewUrl?: string | null;
  meta?: { transport?: string; source?: 'db' | 'env' };
  error?: { code: string; message: string; status?: number };
}

// Mail M5-extension — Per-company FromAlias.
export interface FromAliasItem {
  id: string;
  companyId: string;
  externalMailSettingId: string | null;
  address: string;
  displayName: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FromAliasDraft {
  address?: string;
  displayName?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

// Mail Multi-Inbox (Faz A + FAZ B 2026-07-02) — Per-company çoklu tam
// kredili mailbox. Her satır AYRI IMAP + SMTP hesabı + AYRI takım routing.
export interface MailInboxItem {
  id: string;
  companyId: string;
  address: string;
  displayName: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  /// FAZ B — Per-inbox SMTP. NULL → tenant-ortak fallback.
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  fromAddress: string | null;
  username: string | null;
  secretIsSet: boolean;
  secretSetAt: string | null;
  assignedTeamId: string | null;
  enabled: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// 2026-07-02 — Inbox-başına IMAP + SMTP bağlantı testi sonuç tipi.
// Backend imapPoller.testInboxConnection'dan gelir. Secret response'a inmez.
export type InboxTestCode =
  | 'ok'
  | 'auth_failed'
  | 'connection_failed'
  | 'config_incomplete'
  | 'inbox_disabled'
  | 'inbox_invalid'
  | 'not_found';

// FAZ B — Kanal başına sonuç.
export interface InboxTestChannelResult {
  ok: boolean;
  code: InboxTestCode;
  message: string;
  /** SMTP: config eksik → fallback devrede (hata değil). */
  fallbackAvailable?: boolean;
}

export interface InboxTestResult {
  ok: boolean;
  code: InboxTestCode;
  message: string;
  imap?: InboxTestChannelResult | null;
  smtp?: InboxTestChannelResult | null;
  meta?: { startedAt?: string };
}

export interface MailInboxDraft {
  address?: string;
  displayName?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean;
  /// FAZ B — SMTP per-inbox
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  fromAddress?: string | null;
  username?: string | null;
  /// Secret yalnız set/rotation için body'de gönderilir; response'a düz secret DÖNMEZ.
  secret?: string;
  assignedTeamId?: string | null;
  enabled?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

// M6.3b Faz 3 — CaseEmailTemplate types
export interface CaseEmailTemplateRow {
  id: string;
  companyId: string;
  name: string;
  category: string | null;
  subject: string | null;
  bodyHtml: string;
  variables: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
}

export interface CaseEmailTemplateDraft {
  name?: string;
  category?: string | null;
  subject?: string | null;
  bodyHtml?: string;
  variables?: string;
  isActive?: boolean;
}
