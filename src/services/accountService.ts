import { apiFetch } from '@/services/caseService';
// WR-H2 — Client TTL cache helpers (sibling module, no circular dep via fetcher injection).
import {
  cachedGet,
  invalidateCacheMatching,
  invalidateCachePrefix,
  DEFAULT_CLIENT_CACHE_TTL_MS,
} from '@/services/clientCache';

/** WR-H2 — Account detail GET için cache key. */
function accountDetailCacheKey(id: string): string {
  return `/api/accounts/${id}`;
}

/** WR-H2 — Case-scoped customer-context için cache key. */
function caseCustomerContextCacheKey(caseId: string): string {
  return `/api/cases/${caseId}/customer-context`;
}

/**
 * WR-H2 — Account mutation'larından sonra çağrılır. Account detail +
 * sub-resource path'leri (companies/contacts/products) toplu drop.
 */
function invalidateAccountDetail(accountId: string): void {
  invalidateCachePrefix(accountDetailCacheKey(accountId));
}

/**
 * WR-H2 (PR review fix) — Account / AccountCompany / AccountContact /
 * AccountProduct mutation'ları getCaseCustomerContext payload'ını da
 * etkiler (primaryContact, activeProducts, packageName, contractDates).
 *
 * Client tarafta accountId → caseIds map'i tutmadığımız için **broad
 * invalidation** yapıyoruz: tüm `/api/cases/.../customer-context` cache
 * entry'lerini silinen sayar.
 *
 * Tradeoff: account mutation'dan sonra açılan ilk drawer/detail, ilgili
 * olmayan vakaları da yeniden fetch ettirir. Account mutation'ları admin-
 * only ve seyrek olduğundan kabul edilebilir (worst case: 30 sn boyunca
 * extra fetch'ler; correctness > efficiency for stale data).
 */
function invalidateAllCaseCustomerContexts(): number {
  return invalidateCacheMatching(
    (key) => key.startsWith('/api/cases/') && key.endsWith('/customer-context'),
  );
}

/** Yardımcı: account mutation sonrası iki invalidation'ı birden çalıştırır. */
function invalidateAccountAndCustomerContext(accountId: string): void {
  invalidateAccountDetail(accountId);
  invalidateAllCaseCustomerContexts();
}

/**
 * WR-A1 / PM-01 — Müşteri tipi (B2B/B2C ayırımı).
 *
 * API wire format: ASCII identifier (Individual/Corporate/Government/NonProfit).
 * UI'da TR label'a `CUSTOMER_TYPE_LABELS` üzerinden çevrilir.
 *
 * TCKN bu modelde YOK — A2'de privacy design sonrası.
 */
export type CustomerType = 'Individual' | 'Corporate' | 'Government' | 'NonProfit';

export const CUSTOMER_TYPES: CustomerType[] = [
  'Corporate',
  'Individual',
  'Government',
  'NonProfit',
];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  Corporate: 'Kurumsal',
  Individual: 'Bireysel',
  Government: 'Kamu',
  NonProfit: 'Vakıf / STK',
};

/**
 * Faz B-temel (2026-06-30) — Müşteri Türü (rol/ilişki sınıfı).
 *
 * customerType (LEGAL tip) ile FARKLI alan:
 *   - customerType (Müşteri Tipi) = yasal sınıf (Kurumsal/Bireysel/Kamu/Vakıf)
 *   - customerRole (Müşteri Türü) = bizimle çalışma rolü (n4b parite)
 *
 * API wire format: ASCII identifier. UI dropdown'da TR → ASCII map'lenir.
 *
 * Faz B bülteni: AccountProject.anaFirmaAccountId sadece 'Central' rolündeki
 * account'ları referans eder. Rol değişiminde bağlı proje WARN guard'ı var
 * (backend acknowledgedRoleDowngrade flag).
 */
export type CustomerRole =
  | 'Central'
  | 'Distributor'
  | 'RegionalOffice'
  | 'ChannelPartner'
  | 'International'
  | 'Stockbar';

export const CUSTOMER_ROLES: CustomerRole[] = [
  'Central',
  'Distributor',
  'RegionalOffice',
  'ChannelPartner',
  'International',
  'Stockbar',
];

export const CUSTOMER_ROLE_LABELS: Record<CustomerRole, string> = {
  Central: 'Merkez Müşteri',
  Distributor: 'Distribütör/Bayi',
  RegionalOffice: 'Bölge Müdürlüğü',
  ChannelPartner: 'Kanal/Çözüm Ortağı',
  International: 'Yurt Dışı',
  Stockbar: 'Stokbar',
};

/**
 * Account 360 — Phase B service layer.
 *
 * Phase A BFF endpoint'leri:
 *   GET    /api/accounts            (Supervisor/CSM/Admin/SystemAdmin)
 *   GET    /api/accounts/:id        (Supervisor/CSM/Admin/SystemAdmin)
 *   POST   /api/accounts            (Admin/SystemAdmin)
 *   PATCH  /api/accounts/:id        (Admin/SystemAdmin)
 *
 * apiFetch hata durumunda zaten toast atar ve `undefined` döner — bu
 * dosyada ek hata handling yok.
 */

export type AccountSearchField = 'name' | 'vkn' | 'phone' | 'code' | 'contact';

/** Picker inline proje listesi için minimal proje özeti. */
export interface AccountListProjectItem {
  id: string;
  name: string;
  code: string | null;
}

export interface AccountCompanyChip {
  accountCompanyId: string;
  companyId: string;
  companyName: string | null;
  /** Şirket renk kodu (#hex) — backend tarafından doldurulduğunda kullanılır; aksi halde neutral. */
  companyColor: string | null;
  status: string;
  externalCustomerCode: string | null;
  /** Picker single-step seçim için aktif projeler. */
  projects?: AccountListProjectItem[];
}

export interface AccountProductSummary {
  id: string;
  /** WR-A8 — Product Catalog FK (null for legacy free-text rows). */
  productId: string | null;
  /** Catalog'taki ürünün isActive durumu (null = catalog-linked değil). */
  productCatalogActive?: boolean | null;
  productSupportLevel?: 'L1' | 'L2' | 'L3' | 'Expert' | null;
  productGroupId?: string | null;
  productGroupName?: string | null;
  /** Display name. Catalog-linked rows store a snapshot from Product.name. */
  productName: string;
  productCode: string | null;
  isActive: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

/** WR-A4 / PM-04 — Proje statüsü (ASCII identifier; UI'da TR'ye çevrilir). */
export type ProjectStatus = 'Active' | 'Passive' | 'Completed' | 'Cancelled';

export const PROJECT_STATUSES: ProjectStatus[] = ['Active', 'Passive', 'Completed', 'Cancelled'];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  Active: 'Aktif',
  Passive: 'Pasif',
  Completed: 'Tamamlandı',
  Cancelled: 'İptal Edildi',
};

/** WR-A4 — AccountCompany altındaki proje. */
export interface AccountProjectSummary {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  /** Faz B-temel — Ana firma (Merkez Müşteri) referansı. Nullable. */
  anaFirmaAccountId?: string | null;
  /** Faz B-temel — Ana firma adı (display). Backend join'den gelir. */
  anaFirmaName?: string | null;
}

export interface AccountProjectMutationInput {
  code?: string;
  name?: string;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  isActive?: boolean;
  /** Faz B-temel — Ana firma seçimi. null = bağı temizle. */
  anaFirmaAccountId?: string | null;
}

/** Faz B-temel — Central account picker response shape. */
export interface CentralAccountRow {
  id: string;
  name: string;
  vkn: string | null;
}

/** WR-A3 / PM-02 — Adres tipi (ASCII identifier; UI'da TR'ye çevrilir). */
export type AddressType = 'Billing' | 'Shipping' | 'Visit' | 'Headquarters' | 'Branch';

export const ADDRESS_TYPES: AddressType[] = ['Billing', 'Shipping', 'Visit', 'Headquarters', 'Branch'];

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  Billing: 'Faturalama',
  Shipping: 'Sevkiyat',
  Visit: 'Saha/Ziyaret',
  Headquarters: 'Merkez',
  Branch: 'Şube',
};

/** WR-A3 — Account adres kaydı. Country-agnostic; TR default. */
export interface AccountAddressSummary {
  id: string;
  companyId: string;
  type: AddressType;
  label: string | null;
  line1: string;
  line2: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2 uppercase. */
  country: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface AccountAddressMutationInput {
  companyId?: string;
  type?: AddressType;
  label?: string | null;
  line1?: string;
  line2?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  /** ISO-2 uppercase; default "TR" backend tarafında uygulanır. */
  country?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface AccountListItem {
  id: string;
  name: string;
  vknMasked: string | null;
  phone: string | null;
  /** WR-A2 — E.164 normalize edilmiş telefon (search/dedup için iç UI). */
  phoneE164: string | null;
  /** Phase 2 — telefon metadata (UI display'de "Cep · ... · Dahili"). */
  phoneType: string | null;
  phoneExtension: string | null;
  /** Phase 3 — 3 telefon slot. Slot 2 ve 3 opsiyonel paralel kolonlar. */
  phone2: string | null;
  phone2E164: string | null;
  phone2Type: string | null;
  phone2Extension: string | null;
  phone3: string | null;
  phone3E164: string | null;
  phone3Type: string | null;
  phone3Extension: string | null;
  /** 1 / 2 / 3 — null ise ilk dolu slot birincil sayılır. */
  primaryPhoneSlot: number | null;
  email: string | null;
  isActive: boolean;
  /** WR-A1 / PM-01 — Müşteri tipi (default Corporate). */
  customerType: CustomerType;
  /** Faz B-temel — Müşteri Türü (rol/ilişki sınıfı). customerType ile FARKLI alan. */
  customerRole: CustomerRole | null;
  legalName: string | null;
  registrationNo: string | null;
  /** Vergi Dairesi — kurumsal müşterilerde VKN'den önce gösterilir. */
  taxOffice: string | null;
  /** WR-A2 — TCKN maskeli display ("*******1234"); plain TCKN ASLA API'da yok. */
  tcknMasked: string | null;
  companies: AccountCompanyChip[];
  openCaseCount: number;
  totalCaseCount: number;
}

export interface AccountListResponse {
  accounts: AccountListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AccountCompanyDetail extends AccountCompanyChip {
  packageName: string | null;
  /** WR-A7b — Catalog Package referansı. */
  packageId: string | null;
  package: {
    id: string;
    code: string;
    name: string;
    supportLevel: 'L1' | 'L2' | 'L3' | 'Expert';
    isActive: boolean;
  } | null;
  contractStartAt: string | null;
  contractEndAt: string | null;
  segment: string | null;
  notes: string | null;
  products: AccountProductSummary[];
  /** WR-A4 — AccountCompany altındaki projeler. */
  projects: AccountProjectSummary[];
  /** WR-D4/D3 Phase 3 — customer response channel preferences. */
  preferredResponseChannel: string | null;
  responseEmail: string | null;
  responsePhone: string | null;
  allowCustomerNotifications: boolean;
}

export interface AccountContact {
  id: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  /** Phase 2 phone metadata — telefon tipi (cep/iş/santral/whatsapp/diğer). */
  phoneType: string | null;
  /** Phase 2 phone metadata — santral arkası dahili numara. */
  phoneExtension: string | null;
  email: string | null;
  /** Primary contact/phone for the account. Set true demote others. */
  isPrimary: boolean;
  isActive: boolean;
  preferredChannel: string | null;
}

export interface AccountCaseStats {
  total: number;
  open: number;
  resolved: number;
  slaBreachCount: number;
}

export interface AccountRecentCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface AccountDetail {
  id: string;
  name: string;
  vknMasked: string | null;
  phone: string | null;
  /** WR-A2 — E.164 normalize edilmiş telefon. */
  phoneE164: string | null;
  /** Phase 2 — telefon metadata. */
  phoneType: string | null;
  phoneExtension: string | null;
  /** Phase 3 — 3 telefon slot + birincil işaretçi. */
  phone2: string | null;
  phone2E164: string | null;
  phone2Type: string | null;
  phone2Extension: string | null;
  phone3: string | null;
  phone3E164: string | null;
  phone3Type: string | null;
  phone3Extension: string | null;
  primaryPhoneSlot: number | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  /** WR-A2 — TCKN maskeli display ("*******1234"); plain TCKN ASLA API'da yok. */
  tcknMasked: string | null;
  /** WR-A1 / PM-01 — Müşteri tipi + (opsiyonel) kurumsal alanlar. */
  customerType: CustomerType;
  /** Faz B-temel — Müşteri Türü (rol/ilişki sınıfı). customerType ile FARKLI alan. */
  customerRole: CustomerRole | null;
  legalName: string | null;
  registrationNo: string | null;
  /** Vergi Dairesi — kurumsal müşterilerde VKN'den önce gösterilir. */
  taxOffice: string | null;
  companies: AccountCompanyDetail[];
  contacts: AccountContact[];
  /** WR-A3 / PM-02 — country-agnostic address list. Tenant-scope filtered. */
  addresses: AccountAddressSummary[];
  caseStats: AccountCaseStats;
  recentCases: AccountRecentCase[];
}

export interface AccountListParams {
  search?: string;
  companyId?: string;
  status?: string;
  /**
   * C2 recents revalidation: explicit account ids. Server applies tenant
   * scope on top, so an out-of-scope id passed from a stale localStorage
   * cache silently drops out instead of leaking. Empty array returns
   * empty result.
   */
  ids?: string[];
  searchFields?: AccountSearchField[];
  page?: number;
  limit?: number;
  /**
   * true ise yalnız isActive=true hesaplar döner. Vaka açma/eşleştirme
   * picker'ları (AccountSearchPicker) için — pasif müşteriye yanlışlıkla
   * yeni vaka açılmasın / vaka bağlanmasın. Müşteri yönetim listesi
   * (AccountsListPage) bu parametreyi göndermez, pasif kayıtları görmeye
   * devam eder.
   */
  activeOnly?: boolean;
}

export interface AccountCompanyCreateInput {
  companyId: string;
  externalCustomerCode?: string | null;
  packageName?: string | null;
  contractStartAt?: string | null;
}

export interface AccountCreateInput {
  name: string;
  vkn?: string | null;
  phone?: string | null;
  /** Phase 2 phone metadata — 'mobile' | 'work' | 'switchboard' | 'whatsapp' | 'other'. */
  phoneType?: string | null;
  /** Phase 2 phone metadata — dahili numara. */
  phoneExtension?: string | null;
  /** Phase 3 — slot 2 (opsiyonel) */
  phone2?: string | null;
  phone2Type?: string | null;
  phone2Extension?: string | null;
  /** Phase 3 — slot 3 (opsiyonel) */
  phone3?: string | null;
  phone3Type?: string | null;
  phone3Extension?: string | null;
  /** Phase 3 — birincil slot (1/2/3). null verirse backend ilk dolu slotu ayarlar. */
  primaryPhoneSlot?: number | null;
  email?: string | null;
  /** WR-A1 — default Corporate. */
  customerType?: CustomerType;
  /** Faz B-temel — Müşteri Türü (rol). Nullable; boş bırakılabilir. */
  customerRole?: CustomerRole | null;
  legalName?: string | null;
  registrationNo?: string | null;
  /** Vergi Dairesi (opsiyonel, kurumsal). */
  taxOffice?: string | null;
  /** WR-A2 — Plain TCKN. **Yalnız submit transient**; cache/storage'da tutulmaz, response'ta dönmez. */
  tckn?: string | null;
  companies: AccountCompanyCreateInput[];
}

export interface AccountUpdateInput {
  name?: string;
  vkn?: string | null;
  phone?: string | null;
  /** Phase 2 phone metadata. */
  phoneType?: string | null;
  phoneExtension?: string | null;
  /** Phase 3 — slot 2 */
  phone2?: string | null;
  phone2Type?: string | null;
  phone2Extension?: string | null;
  /** Phase 3 — slot 3 */
  phone3?: string | null;
  phone3Type?: string | null;
  phone3Extension?: string | null;
  /** Phase 3 — birincil slot. */
  primaryPhoneSlot?: number | null;
  email?: string | null;
  isActive?: boolean;
  /** WR-A1. */
  customerType?: CustomerType;
  /** Faz B-temel — Müşteri Türü (rol). 'CLEAR' sentinel'i ile null'a indirilir. */
  customerRole?: CustomerRole | 'CLEAR' | null;
  /** Faz B-temel — Central → başka role indirme onayı (downgrade WARN guard). */
  acknowledgedRoleDowngrade?: boolean;
  legalName?: string | null;
  registrationNo?: string | null;
  /** Vergi Dairesi (opsiyonel, kurumsal). */
  taxOffice?: string | null;
  /** WR-A2 — Plain TCKN (submit transient only). null/'' → TCKN clear. */
  tckn?: string | null;
}

// WR-A2 — Validation endpoint shapes.
export interface ValidationResult {
  valid: boolean;
  reason: string | null;
}

export async function validateVknRemote(value: string): Promise<ValidationResult | undefined> {
  const result = await apiFetch<ValidationResult>(
    `/api/lookups/validate-vkn?value=${encodeURIComponent(value)}`,
    undefined,
    'VKN doğrulama',
  );
  return result;
}

export async function validateTcknRemote(value: string): Promise<ValidationResult | undefined> {
  // SECURITY: plain TCKN query string'de gider; HTTPS şarttır. Response asla
  // hash veya normalized değer içermez — sadece valid/invalid + reason.
  const result = await apiFetch<ValidationResult>(
    `/api/lookups/validate-tckn?value=${encodeURIComponent(value)}`,
    undefined,
    'TCKN doğrulama',
  );
  return result;
}

/* Phase C1 — AccountCompany + AccountContact mutations */

export interface AccountCompanyMutationInput {
  companyId?: string;
  externalCustomerCode?: string | null;
  packageName?: string | null;
  /** WR-A7b — Catalog Package referansı. */
  packageId?: string | null;
  contractStartAt?: string | null;
  contractEndAt?: string | null;
  segment?: string | null;
  status?: string;
  notes?: string | null;
  /** WR-D4/D3 Phase 3 — customer response channel preferences. */
  preferredResponseChannel?: string | null;
  responseEmail?: string | null;
  responsePhone?: string | null;
  allowCustomerNotifications?: boolean;
}

export interface AccountContactMutationInput {
  fullName?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Phase 2 phone metadata. */
  phoneType?: string | null;
  phoneExtension?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
  preferredChannel?: string | null;
}

export interface AccountProduct {
  id: string;
  accountCompanyId: string;
  companyId: string;
  companyName: string | null;
  productName: string;
  productCode: string | null;
  isActive: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AccountProductMutationInput {
  accountCompanyId?: string;
  /** WR-A8 — Product Catalog FK. Pass `null` to clear (revert to legacy free-text). */
  productId?: string | null;
  productName?: string;
  productCode?: string | null;
  isActive?: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
}

/* Case-detail customer-context payload */

export interface CaseCustomerCompany {
  accountCompanyId: string;
  companyId: string;
  companyName: string | null;
  companyColor: string | null;
  status: string;
  externalCustomerCode: string | null;
  packageName: string | null;
  contractStartAt: string | null;
  contractEndAt: string | null;
  activeProducts: Array<{ id: string; productName: string; productCode: string | null }>;
}

export interface CaseCustomerContext {
  accountId: string;
  accountName: string;
  vknMasked: string | null;
  isActive: boolean;
  company: CaseCustomerCompany | null;
  primaryContact: {
    id: string;
    fullName: string;
    title: string | null;
    phone: string | null;
    email: string | null;
    preferredChannel: string | null;
  } | null;
}

function buildQuery(params: AccountListParams): string {
  const usp = new URLSearchParams();
  if (params.search && params.search.length >= 2) usp.set('search', params.search);
  if (params.companyId) usp.set('companyId', params.companyId);
  if (params.status) usp.set('status', params.status);
  if (params.ids && params.ids.length > 0) usp.set('ids', params.ids.join(','));
  if (params.searchFields && params.searchFields.length > 0) usp.set('searchFields', params.searchFields.join(','));
  if (params.activeOnly) usp.set('activeOnly', 'true');
  if (params.page) usp.set('page', String(params.page));
  if (params.limit) usp.set('limit', String(params.limit));
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export const accountService = {
  async list(params: AccountListParams = {}): Promise<AccountListResponse | undefined> {
    return apiFetch<AccountListResponse>(
      `/api/accounts${buildQuery(params)}`,
      undefined,
      'Müşteri listesi',
    );
  },

  /**
   * Faz B-temel — AccountProject editor "Ana Firma" dropdown için
   * customerRole='Central' olan account listesi.
   *
   * Backend scope: req.user.allowedCompanyIds intersect targetCompanyId.
   * User'ın bu tenant'a erişimi yoksa boş liste döner (cross-tenant
   * davranış testi smoke).
   */
  async listCentral(companyId: string | null = null): Promise<CentralAccountRow[]> {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    const r = await apiFetch<{ items: CentralAccountRow[] }>(
      `/api/accounts/central${qs}`,
      undefined,
      'Ana firma listesi',
    );
    return r?.items ?? [];
  },

  async get(id: string): Promise<AccountDetail | undefined> {
    // WR-H2 — TTL cache (30s) ile detay sayfa reopen sırasında network'ten kaçın.
    const key = accountDetailCacheKey(id);
    return cachedGet<AccountDetail>(key, DEFAULT_CLIENT_CACHE_TTL_MS, () =>
      apiFetch<AccountDetail>(key, undefined, 'Müşteri detayı'),
    );
  },

  async create(body: AccountCreateInput): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      '/api/accounts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Müşteri oluşturma',
    );
  },

  async update(id: string, body: AccountUpdateInput): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Müşteri güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(id); // WR-H2 (review fix)
    return result;
  },

  /* Phase C1 — AccountCompany mutations */

  async addCompanyRelation(
    accountId: string,
    body: AccountCompanyMutationInput,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Şirket ilişkisi ekleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async updateCompanyRelation(
    accountId: string,
    accountCompanyId: string,
    body: AccountCompanyMutationInput,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies/${accountCompanyId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Şirket ilişkisi güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async removeCompanyRelation(
    accountId: string,
    accountCompanyId: string,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies/${accountCompanyId}`,
      { method: 'DELETE' },
      'Şirket ilişkisi silme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  /* Phase C1 — AccountContact mutations */

  async addContact(
    accountId: string,
    body: AccountContactMutationInput,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Kontak ekleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async updateContact(
    accountId: string,
    contactId: string,
    body: AccountContactMutationInput,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts/${contactId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Kontak güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async removeContact(
    accountId: string,
    contactId: string,
  ): Promise<AccountDetail | undefined> {
    const result = await apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts/${contactId}`,
      { method: 'DELETE' },
      'Kontak silme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  /* Phase C2 — AccountProduct mutations */

  async listProducts(
    accountId: string,
    options: { companyId?: string } = {},
  ): Promise<{ products: AccountProduct[] } | undefined> {
    const qs = options.companyId ? `?companyId=${encodeURIComponent(options.companyId)}` : '';
    return apiFetch<{ products: AccountProduct[] }>(
      `/api/accounts/${accountId}/products${qs}`,
      undefined,
      'Ürün listesi',
    );
  },

  async addProduct(
    accountId: string,
    body: AccountProductMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Ürün ekleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async updateProduct(
    accountId: string,
    productId: string,
    body: AccountProductMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products/${productId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Ürün güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  async removeProduct(
    accountId: string,
    productId: string,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products/${productId}`,
      { method: 'DELETE' },
      'Ürün kaldırma',
    );
    if (result) invalidateAccountAndCustomerContext(accountId); // WR-H2 (review fix)
    return result;
  },

  /* WR-A4 — AccountProject mutations */

  async addProject(
    accountId: string,
    accountCompanyId: string,
    body: AccountProjectMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/companies/${accountCompanyId}/projects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Proje ekleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  async updateProject(
    accountId: string,
    projectId: string,
    body: AccountProjectMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/projects/${projectId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Proje güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  async removeProject(
    accountId: string,
    projectId: string,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/projects/${projectId}`,
      { method: 'DELETE' },
      'Proje kaldırma',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  /* WR-A3 / PM-02 — Address CRUD */

  async addAddress(
    accountId: string,
    body: AccountAddressMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/addresses`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Adres ekleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  async updateAddress(
    accountId: string,
    addressId: string,
    body: AccountAddressMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/addresses/${addressId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Adres güncelleme',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  async removeAddress(
    accountId: string,
    addressId: string,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    const result = await apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/addresses/${addressId}`,
      { method: 'DELETE' },
      'Adres kaldırma',
    );
    if (result) invalidateAccountAndCustomerContext(accountId);
    return result;
  },

  /**
   * Case detail customer-context — vakaya bağlı müşteri özetini hafif payload olarak çeker.
   * WR-H2 — TTL cache (30s); drawer reopen sırasında network'ten kaçınır.
   * caseService.invalidateCaseDetail() bu key'i de prefix match ile drop'lar.
   */
  async getCaseCustomerContext(caseId: string): Promise<{ context: CaseCustomerContext | null } | undefined> {
    const key = caseCustomerContextCacheKey(caseId);
    return cachedGet<{ context: CaseCustomerContext | null }>(
      key,
      DEFAULT_CLIENT_CACHE_TTL_MS,
      () => apiFetch<{ context: CaseCustomerContext | null }>(key, undefined, 'Müşteri özeti'),
    );
  },
};

/** Rol bazlı UI gating helper'ları — UI'da tek yerden tüketilsin. */
export const ACCOUNT_READ_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'] as const;
export const ACCOUNT_WRITE_ROLES = ['Admin', 'SystemAdmin'] as const;

export function canReadAccounts(role: string | undefined): boolean {
  return !!role && (ACCOUNT_READ_ROLES as readonly string[]).includes(role);
}

export function canWriteAccounts(role: string | undefined): boolean {
  return !!role && (ACCOUNT_WRITE_ROLES as readonly string[]).includes(role);
}
