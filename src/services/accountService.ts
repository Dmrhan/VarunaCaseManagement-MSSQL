import { apiFetch } from '@/services/caseService';

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

export interface AccountListItem {
  id: string;
  name: string;
  vknMasked: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  /** WR-A1 / PM-01 — Müşteri tipi (default Corporate). */
  customerType: CustomerType;
  legalName: string | null;
  registrationNo: string | null;
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
  email: string | null;
  isActive: boolean;
  createdAt: string;
  /** WR-A1 / PM-01 — Müşteri tipi + (opsiyonel) kurumsal alanlar. */
  customerType: CustomerType;
  legalName: string | null;
  registrationNo: string | null;
  companies: AccountCompanyDetail[];
  contacts: AccountContact[];
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
    return apiFetch<AccountDetail>(`/api/accounts/${id}`, undefined, 'Müşteri detayı');
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
    return apiFetch<AccountDetail>(
      `/api/accounts/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Müşteri güncelleme',
    );
  },

  /* Phase C1 — AccountCompany mutations */

  async addCompanyRelation(
    accountId: string,
    body: AccountCompanyMutationInput,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Şirket ilişkisi ekleme',
    );
  },

  async updateCompanyRelation(
    accountId: string,
    accountCompanyId: string,
    body: AccountCompanyMutationInput,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies/${accountCompanyId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Şirket ilişkisi güncelleme',
    );
  },

  async removeCompanyRelation(
    accountId: string,
    accountCompanyId: string,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/companies/${accountCompanyId}`,
      { method: 'DELETE' },
      'Şirket ilişkisi silme',
    );
  },

  /* Phase C1 — AccountContact mutations */

  async addContact(
    accountId: string,
    body: AccountContactMutationInput,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Kontak ekleme',
    );
  },

  async updateContact(
    accountId: string,
    contactId: string,
    body: AccountContactMutationInput,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts/${contactId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Kontak güncelleme',
    );
  },

  async removeContact(
    accountId: string,
    contactId: string,
  ): Promise<AccountDetail | undefined> {
    return apiFetch<AccountDetail>(
      `/api/accounts/${accountId}/contacts/${contactId}`,
      { method: 'DELETE' },
      'Kontak silme',
    );
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
    return apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Ürün ekleme',
    );
  },

  async updateProduct(
    accountId: string,
    productId: string,
    body: AccountProductMutationInput,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    return apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products/${productId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Ürün güncelleme',
    );
  },

  async removeProduct(
    accountId: string,
    productId: string,
  ): Promise<{ id: string; account: AccountDetail } | undefined> {
    return apiFetch<{ id: string; account: AccountDetail }>(
      `/api/accounts/${accountId}/products/${productId}`,
      { method: 'DELETE' },
      'Ürün kaldırma',
    );
  },

  /** Case detail customer-context — vakaya bağlı müşteri özetini hafif payload olarak çeker. */
  async getCaseCustomerContext(caseId: string): Promise<{ context: CaseCustomerContext | null } | undefined> {
    return apiFetch<{ context: CaseCustomerContext | null }>(
      `/api/cases/${caseId}/customer-context`,
      undefined,
      'Müşteri özeti',
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
