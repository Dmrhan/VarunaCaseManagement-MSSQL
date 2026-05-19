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

export interface AccountCompanyChip {
  accountCompanyId: string;
  companyId: string;
  companyName: string | null;
  /** Şirket renk kodu (#hex) — backend tarafından doldurulduğunda kullanılır; aksi halde neutral. */
  companyColor: string | null;
  status: string;
  externalCustomerCode: string | null;
}

export interface AccountProductSummary {
  id: string;
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
}

export interface AccountProjectMutationInput {
  code?: string;
  name?: string;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  isActive?: boolean;
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
  email: string | null;
  isActive: boolean;
  /** WR-A1 / PM-01 — Müşteri tipi (default Corporate). */
  customerType: CustomerType;
  legalName: string | null;
  registrationNo: string | null;
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
  contractStartAt: string | null;
  contractEndAt: string | null;
  segment: string | null;
  notes: string | null;
  products: AccountProductSummary[];
  /** WR-A4 — AccountCompany altındaki projeler. */
  projects: AccountProjectSummary[];
}

export interface AccountContact {
  id: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
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
  email: string | null;
  isActive: boolean;
  createdAt: string;
  /** WR-A2 — TCKN maskeli display ("*******1234"); plain TCKN ASLA API'da yok. */
  tcknMasked: string | null;
  /** WR-A1 / PM-01 — Müşteri tipi + (opsiyonel) kurumsal alanlar. */
  customerType: CustomerType;
  legalName: string | null;
  registrationNo: string | null;
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
  page?: number;
  limit?: number;
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
  email?: string | null;
  /** WR-A1 — default Corporate. */
  customerType?: CustomerType;
  legalName?: string | null;
  registrationNo?: string | null;
  /** WR-A2 — Plain TCKN. **Yalnız submit transient**; cache/storage'da tutulmaz, response'ta dönmez. */
  tckn?: string | null;
  companies: AccountCompanyCreateInput[];
}

export interface AccountUpdateInput {
  name?: string;
  vkn?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
  /** WR-A1. */
  customerType?: CustomerType;
  legalName?: string | null;
  registrationNo?: string | null;
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
  contractStartAt?: string | null;
  contractEndAt?: string | null;
  segment?: string | null;
  status?: string;
  notes?: string | null;
}

export interface AccountContactMutationInput {
  fullName?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
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
