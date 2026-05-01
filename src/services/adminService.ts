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

export interface CompanySettings {
  companyId: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  appName?: string | null;
  supportEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySettingsInput {
  logoUrl?: string | null;
  primaryColor?: string | null;
  appName?: string | null;
  supportEmail?: string | null;
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
      return data?.value ?? [];
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
      return data?.value ?? [];
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
      const data = await apiFetch<{ value: FieldDefinition[] }>(path, undefined, 'Custom Fields yüklenemedi');
      return data?.value ?? [];
    },
    async create(input: FieldDefinitionInput): Promise<AdminResult<FieldDefinition>> {
      const item = await apiFetch<FieldDefinition>(
        `${ADMIN_BASE}/field-definitions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
        'Custom Field oluşturulamadı',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true, item };
    },
    async update(id: string, patch: Partial<FieldDefinitionInput>): Promise<AdminResult<FieldDefinition>> {
      const item = await apiFetch<FieldDefinition>(
        `${ADMIN_BASE}/field-definitions/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Custom Field güncellenemedi',
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
        'Custom Field silinemedi',
      );
      if (!result) return { ok: false, error: 'Sunucu hatası' };
      await refreshBootstrap();
      return { ok: true };
    },
  },

  companySettings: {
    async get(companyId: string): Promise<CompanySettings | null> {
      const data = await apiFetch<CompanySettings | null>(
        `${ADMIN_BASE}/company-settings/${companyId}`,
        undefined,
        'Şirket ayarları yüklenemedi',
      );
      return data ?? null;
    },
    async upsert(companyId: string, patch: CompanySettingsInput): Promise<AdminResult<CompanySettings>> {
      const item = await apiFetch<CompanySettings>(
        `${ADMIN_BASE}/company-settings/${companyId}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
        'Şirket ayarları kaydedilemedi',
      );
      if (!item) return { ok: false, error: 'Sunucu hatası' };
      return { ok: true, item };
    },
  },
};
