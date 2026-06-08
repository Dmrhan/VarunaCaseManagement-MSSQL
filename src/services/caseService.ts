import {
  MOCK_ACCOUNTS,
  MOCK_CASES,
  MOCK_CATEGORIES,
  MOCK_CHECKLIST_TEMPLATES,
  MOCK_COMPANIES,
  MOCK_DOCUMENT_TYPES,
  MOCK_OFFERED_SOLUTIONS,
  MOCK_PERSONS,
  MOCK_SLA_POLICIES,
  MOCK_TEAMS,
  MOCK_THIRD_PARTIES,
} from '@/mocks/caseMockData';
import { getBootstrap } from '@/services/lookupBootstrap';
import { getAccessToken } from '@/services/supabase';
import { notify } from '@/components/ui/Toast';

// History entry'leri için insan-okur değer formatlayıcı
// Boolean → Evet/Hayır, ISO date → DD.MM.YYYY HH:mm, FK → ad, null/empty → '—'
function formatHistoryValue(field: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'string') {
    // FK alanlarını ad'a çevir
    if (field === 'assignedPersonId' || field === 'assignedPersonName') {
      const found = MOCK_PERSONS.find((p) => p.id === value || p.name === value);
      return found ? found.name : value;
    }
    if (field === 'assignedTeamId' || field === 'assignedTeamName') {
      const found = MOCK_TEAMS.find((t) => t.id === value || t.name === value);
      return found ? found.name : value;
    }
    if (field === 'thirdPartyId' || field === 'thirdPartyName') {
      const found = MOCK_THIRD_PARTIES.find((tp) => tp.id === value || tp.name === value);
      return found ? found.name : value;
    }
    if (field === 'companyId' || field === 'companyName') {
      const found = MOCK_COMPANIES.find((c) => c.id === value || c.name === value);
      return found ? found.name : value;
    }
    if (field === 'accountId' || field === 'accountName') {
      const found = MOCK_ACCOUNTS.find((a) => a.id === value || a.name === value);
      return found ? found.name : value;
    }
    // ISO datetime tespiti
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      try {
        return new Date(value).toLocaleString('tr-TR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} öğe`;
  }
  return String(value);
}
import {
  CASE_REQUEST_TYPES,
  type Case,
  type CallDisposition,
  type CallOutcome,
  type CaseCallLog,
  type CaseFilters,
  type CaseStatsResponse,
  type CaseHistoryActionType,
  type CaseListPagination,
  type CaseNote,
  type CaseFile,
  type CasePriority,
  type CaseRequestType,
  type CaseStatus,
  type ActionSummary,
  type CaseLinkType,
  type CaseTransferRecord,
  type CaseWatcherRecord,
  type LinkedCaseEntry,
  type CustomerPulse,
  type MentionableUser,
  type UnreadMention,
  type CaseType,
  type EscalationLevel,
  type NoteVisibility,
  type SlaPolicy,
  type CaseChecklistTemplate,
  type SupportLevel,
} from '@/features/cases/types';
import { CASE_FILE_MAX_COUNT, CASE_FILE_MAX_SIZE } from '@/features/cases/types';

// FAZ 2 — Supabase Postgres üzerinden gerçek BFF entegrasyonu aktif.
// Mock dalı dev-only fallback olarak kodda kalıyor (test/storybook için).
export const USE_MOCK = false;

const API_BASE = '/api/cases';

// WR-H2 — Client cache helpers (import after API_BASE def to keep this block grouped).
// clientCache is a sibling module with no circular dep (it takes a fetcher callback).
import {
  cachedGet,
  invalidateCachePrefix,
  DEFAULT_CLIENT_CACHE_TTL_MS,
} from '@/services/clientCache';

/** WR-H2 — case detail + customer-context cache key'i için tek noktadan helper. */
function caseDetailCacheKey(id: string): string {
  return `${API_BASE}/${id}`;
}

/**
 * WR-H2 — Vaka mutation'larından sonra çağrılır. Hem case detail hem
 * customer-context (aynı id prefix'li tüm GET key'ler) drop'lanır.
 */
function invalidateCaseDetail(id: string): void {
  invalidateCachePrefix(caseDetailCacheKey(id));
}

/**
 * SLA fallback saatleri — Sprint F SlaPolicy 5-tuple match'i bulunamadığında
 * priority bazlı varsayılan değerler kullanılır.
 */
const SLA_FALLBACK_HOURS: Record<Case['priority'], number> = {
  Critical: 4,
  High: 24,
  Medium: 72,
  Low: 168,
};

let store: Case[] = MOCK_CASES.map((c) => ({
  ...c,
  notes:    [...c.notes],
  files:    [...c.files],
  history:  [...c.history],
  callLogs: [...c.callLogs],
}));

const delay = (ms = 120) => new Promise<void>((res) => setTimeout(res, ms));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Merkezi fetch wrapper — caseService altındaki tüm BFF çağrıları buradan geçer.
 * Hata olduğunda kullanıcıya MUTLAKA toast gösterir (sessiz fail yok).
 *
 * Davranış:
 *  - 2xx + JSON gövde → parse edilip döner
 *  - 2xx + boş gövde → null döner
 *  - 4xx/5xx → toast (server'ın döndüğü `error.message` veya generic) + undefined
 *  - Network/timeout → toast + undefined
 *
 * Caller perspektifinden: sonuç undefined ise işlem başarısız ve kullanıcı
 * zaten uyarıldı — UI ek aksiyon yapmaya gerek duymaz, sadece state'ini
 * geri almasın.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
  errorContext = 'İşlem',
): Promise<T | undefined> {
  // Auth: aktif Supabase oturumundan access token'ı çek, Authorization header'a ekle
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const finalInit: RequestInit = { ...init, headers };

  let r: Response;
  try {
    r = await fetch(path, finalInit);
  } catch (err) {
    notify({
      type: 'error',
      title: `${errorContext} başarısız`,
      message: 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.',
      duration: 5000,
    });
    console.error('[apiFetch] network', path, err);
    return undefined;
  }
  if (!r.ok) {
    let serverMessage = '';
    let serverMaxBytes: number | null = null;
    try {
      const body = await r.json();
      serverMessage = body?.message ?? body?.error ?? '';
      if (typeof body?.maxBytes === 'number') serverMaxBytes = body.maxBytes;
    } catch {
      try {
        serverMessage = await r.text();
      } catch {
        // sessiz: hiçbir gövde yok
      }
    }
    // 401: oturum geçersiz → AuthContext dinleyicileri haberdar olsun
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent('app:unauthenticated'));
    }
    // 413: payload too large. Gövde JSON parse olmasa bile (Express
    // default HTML hatası) kullanıcıya truthful + aksiyonable mesaj
    // gösteriyoruz; "Sunucu hatası — yöneticine bildir." asla bu durumda
    // çıkmasın.
    let displayMessage = serverMessage || 'Sunucu hatası — yöneticine bildir.';
    if (r.status === 413) {
      const limitMb = serverMaxBytes ? Math.round((serverMaxBytes / (1024 * 1024)) * 10) / 10 : null;
      displayMessage =
        serverMessage ||
        (limitMb
          ? `Dosya dry-run için çok büyük (sunucu sınırı ~${limitMb} MB). Dosyayı daha küçük parçalara bölüp yeniden deneyin.`
          : 'Dosya dry-run için çok büyük. Dosyayı daha küçük parçalara bölüp yeniden deneyin.');
    }
    notify({
      type: 'error',
      title: `${errorContext} başarısız (${r.status})`,
      message: displayMessage,
      duration: 6000,
    });
    console.error('[apiFetch]', r.status, path, serverMessage);
    return undefined;
  }
  // 204 No Content veya boş gövde
  if (r.status === 204) return undefined;
  try {
    return (await r.json()) as T;
  } catch {
    // Beklenen gövde yoksa null/undefined
    return undefined;
  }
}

function applyFilters(items: Case[], f?: CaseFilters): Case[] {
  if (!f) return items;
  let out = items;
  if (f.search) {
    const q = f.search.toLowerCase().trim();
    if (q) {
      out = out.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.caseNumber.toLowerCase().includes(q) ||
          // Phase C2: accountName artık nullable (müşterisiz vakalar)
          (c.accountName ?? '').toLowerCase().includes(q),
      );
    }
  }
  if (f.statuses && f.statuses.length > 0) {
    out = out.filter((c) => f.statuses!.includes(c.status));
  }
  if (f.caseType && f.caseType !== 'Tümü') out = out.filter((c) => c.caseType === f.caseType);
  if (f.priorities && f.priorities.length > 0) {
    out = out.filter((c) => f.priorities!.includes(c.priority));
  }
  if (f.teamId)   out = out.filter((c) => c.assignedTeamId === f.teamId);
  if (f.personId) out = out.filter((c) => c.assignedPersonId === f.personId);
  if (f.dateFrom) {
    const fromMs = new Date(f.dateFrom).getTime();
    out = out.filter((c) => new Date(c.createdAt).getTime() >= fromMs);
  }
  if (f.dateTo) {
    const toMs = new Date(f.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1; // gün sonu dahil
    out = out.filter((c) => new Date(c.createdAt).getTime() <= toMs);
  }
  return out;
}

export interface NewCaseInput {
  title: string;
  description: string;
  caseType: CaseType;
  priority: Case['priority'];
  origin: Case['origin'];
  originDescription?: string;
  companyId: string;
  companyName: string;
  // Phase C2: müşterisiz vaka — picker boş geçilirse her ikisi undefined.
  accountId?: string;
  accountName?: string;
  // WR-A4 / PM-04 — Şirket-ilişkisi altındaki opsiyonel proje bağı (UNIVERA).
  accountProjectId?: string;
  accountProjectName?: string;
  // Phase D Step 2 — opsiyonel başvuran bilgileri.
  customerContactName?: string;
  customerContactPhone?: string;
  customerContactEmail?: string;
  customerCompanyName?: string;
  category: string;
  subCategory: string;
  requestType: CaseRequestType;
  productGroup?: string;
  // WR-A7b — Catalog Product/Package referansları (opsiyonel).
  productId?: string;
  packageId?: string;
  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;

  // Spec 5.2 — ProactiveTracking (caseType=ProactiveTracking ile)
  financialStatus?:    Case['financialStatus'];
  productUsage?:       Case['productUsage'];
  usageChangeAlert?:   Case['usageChangeAlert'];
  responseLevel?:      Case['responseLevel'];

  // Spec 5.3 — Churn
  cancellationRequest?: boolean;
  offeredSolutions?:    string[];
  offerExpiryDate?:     string;
  offerOutcome?:        Case['offerOutcome'];
  offerRejectionReason?: string;
  actionTaken?:         string;
  followUpDate?:        string;

  // RUNA AI — kullanıcı "Uygula" derse set edilir, "Yoksay" derse rejectReason set edilir
  aiGeneratedFlag?: boolean;
  aiCategoryPrediction?: string;
  aiPriorityPrediction?: Case['priority'];
  aiConfidenceScore?: number;
  aiRejectReason?: string;

  // Custom Fields — şirket FieldDefinition'larına göre dinamik
  customFields?: Record<string, unknown>;
}

// Phase D Step 2 — Customer Match Suggestions (deterministic, no AI).
export type CustomerMatchReasonType = 'phone' | 'email' | 'externalCode' | 'name' | 'product';
export interface CustomerMatchReason {
  type: CustomerMatchReasonType;
  label: string;
  valueMasked: string | null;
}
export interface CustomerMatchSuggestion {
  accountId: string;
  accountName: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: CustomerMatchReason[];
  companies: Array<{
    companyId: string;
    companyName: string | null;
    companyColor: string | null;
    externalCustomerCode: string | null;
  }>;
  openCaseCount: number;
  totalCaseCount: number;
}
export interface CustomerMatchSuggestionsResponse {
  suggestions: CustomerMatchSuggestion[];
  generatedAt: string;
  reason?: 'case_already_linked';
}

export const caseService = {
  async list(
    filters?: CaseFilters,
    pagination?: CaseListPagination,
  ): Promise<{ items: Case[]; total: number }> {
    if (USE_MOCK) {
      await delay();
      const all = clone(store);
      const filtered = applyFilters(all, filters);
      const total = filtered.length;
      if (pagination) {
        const start = (pagination.page - 1) * pagination.pageSize;
        return { items: filtered.slice(start, start + pagination.pageSize), total };
      }
      return { items: filtered, total };
    }
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.statuses?.length) params.set('statuses', filters.statuses.join(','));
    if (filters?.caseType && filters.caseType !== 'Tümü') params.set('caseType', filters.caseType);
    if (filters?.priorities?.length) params.set('priorities', filters.priorities.join(','));
    if (filters?.teamId)   params.set('teamId', filters.teamId);
    if (filters?.personId) params.set('personId', filters.personId);
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo)   params.set('dateTo', filters.dateTo);
    if (filters?.customerMatchPending !== undefined) {
      params.set('customerMatchPending', String(filters.customerMatchPending));
    }
    // KPI tile click intents — server-side resolve edilir.
    if (filters?.assignedToMe) params.set('assignedToMe', 'true');
    if (filters?.teamScope) params.set('teamScope', 'true');
    if (filters?.slaViolation) params.set('slaViolation', 'true');
    if (filters?.resolvedToday) params.set('resolvedToday', 'true');
    if (pagination) {
      params.set('page', String(pagination.page));
      params.set('pageSize', String(pagination.pageSize));
    }
    const data = await apiFetch<{ value: Case[]; '@odata.count': number }>(
      `${API_BASE}?${params.toString()}`,
      undefined,
      'Vakalar yüklenemedi',
    );
    return { items: data?.value ?? [], total: data?.['@odata.count'] ?? 0 };
  },

  /**
   * Role-aware KPI stats for the cases list page header.
   * Mode chosen server-side from req.user.role. Use the discriminated union
   * `mode` field to render the right tile set.
   */
  async getStats(): Promise<CaseStatsResponse | null> {
    if (USE_MOCK) {
      // Mock mode: compute personal stats from local store for Agent-style demo.
      return null;
    }
    const data = await apiFetch<CaseStatsResponse>(
      `${API_BASE}/stats`,
      undefined,
      'KPI verileri yüklenemedi',
    );
    return data ?? null;
  },

  async get(id: string): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const found = store.find((c) => c.id === id);
      return found ? clone(found) : undefined;
    }
    // WR-H2 — TTL cache (30s) ile drawer/detail reopen sırasında network'ten kaçın.
    const key = caseDetailCacheKey(id);
    return cachedGet<Case>(key, DEFAULT_CLIENT_CACHE_TTL_MS, () =>
      apiFetch<Case>(key, undefined, 'Vaka yüklenemedi'),
    );
  },

  async create(input: NewCaseInput): Promise<Case> {
    if (USE_MOCK) {
      await delay(150);
      const idx = store.length + 1;

      // SLA motoru — Sprint F kuralları (5-tuple match), yoksa priority fallback.
      // Eşleşme bulunursa policy.responseHours/resolutionHours kullanılır,
      // yoksa SLA_FALLBACK_HOURS[priority] devreye girer (eski mock davranışı).
      const matchedPolicy = caseService.getSlaPolicyFor({
        companyId: input.companyId,
        productGroup: input.productGroup,
        category: input.category,
        subCategory: input.subCategory,
        requestType: input.requestType,
      });
      const resolutionHours = matchedPolicy?.resolutionHours ?? SLA_FALLBACK_HOURS[input.priority];
      const responseHours = matchedPolicy?.responseHours ?? Math.max(1, Math.round(resolutionHours * 0.3));
      const createdAtMs = Date.now();
      const slaResponseDueAt = new Date(createdAtMs + responseHours * 3600_000).toISOString();
      const slaResolutionDueAt = new Date(createdAtMs + resolutionHours * 3600_000).toISOString();

      // Kontrol Listesi — 3-tuple match (company + productGroup + category).
      // Eşleşme varsa template item'ları snapshot olarak kopyalanır
      // (admin sonradan değiştirse vaka etkilenmez).
      const matchedChecklist = caseService.getChecklistFor({
        companyId: input.companyId,
        productGroup: input.productGroup,
        category: input.category,
      });
      const checklistItems = matchedChecklist
        ? matchedChecklist.items
            .filter((it) => it.isActive)
            .map((it) => ({
              id: uid('CHKR'),
              templateItemId: it.id,
              label: it.label,
              required: it.required,
              checked: false,
              checkedAt: undefined,
              checkedBy: undefined,
            }))
        : undefined;

      const initialHistory: typeof MOCK_CASES[number]['history'] = [
        { id: uid('H'), caseId: '', action: 'Vaka oluşturuldu', actor: 'Mock User', at: nowIso() },
      ];
      if (matchedPolicy) {
        initialHistory.push({
          id: uid('H'),
          caseId: '',
          action: `SLA kuralı uygulandı: ${matchedPolicy.id} (${responseHours}sa yanıt / ${resolutionHours}sa çözüm)`,
          actor: 'Sistem',
          at: nowIso(),
        });
      } else {
        initialHistory.push({
          id: uid('H'),
          caseId: '',
          action: `SLA varsayılan: ${input.priority} öncelik (${responseHours}sa yanıt / ${resolutionHours}sa çözüm)`,
          actor: 'Sistem',
          at: nowIso(),
        });
      }
      if (matchedChecklist) {
        initialHistory.push({
          id: uid('H'),
          caseId: '',
          action: `Kontrol listesi yüklendi: ${matchedChecklist.name} (${checklistItems!.length} madde)`,
          actor: 'Sistem',
          at: nowIso(),
        });
      }

      const newCase: Case = {
        id: uid('CASE'),
        caseNumber: `CASE-2026-${String(10000 + idx).padStart(5, '0')}`,
        title: input.title,
        description: input.description,
        caseType: input.caseType,
        // Phase D — mock store: accountId yoksa müşteri eşleştirme bekleyen.
        customerMatchPending: !input.accountId,
        status: 'Açık',
        priority: input.priority,
        origin: input.origin,
        originDescription: input.originDescription,
        companyId: input.companyId,
        companyName: input.companyName,
        // Mock path: Case tipi string istiyor; picker boş geçildiyse default değerler.
        accountId: input.accountId ?? '',
        accountName: input.accountName ?? 'Müşteri Belirtilmedi',
        category: input.category,
        subCategory: input.subCategory,
        requestType: input.requestType,
        productGroup: input.productGroup,
        assignedTeamId: input.assignedTeamId,
        assignedTeamName: input.assignedTeamName,
        assignedPersonId: input.assignedPersonId,
        assignedPersonName: input.assignedPersonName,
        escalationLevel: 'Yok',
        slaResponseDueAt,
        slaResolutionDueAt,
        slaViolation: false,
        slaPausedDurationMin: 0,
        slaThirdPartyWaitMin: 0,
        aiGeneratedFlag: input.aiGeneratedFlag ?? false,
        aiCategoryPrediction: input.aiCategoryPrediction,
        aiPriorityPrediction: input.aiPriorityPrediction,
        aiConfidenceScore: input.aiConfidenceScore,
        aiRejectReason: input.aiRejectReason,
        checklistItems,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        notes: [],
        files: [],
        callLogs: [],
        history: initialHistory,
        // Type-spesifik alanlar (yalnızca seçili tipe ait olanlar set edilir)
        financialStatus:      input.caseType === 'ProactiveTracking' ? input.financialStatus    : undefined,
        productUsage:         input.caseType === 'ProactiveTracking' ? input.productUsage       : undefined,
        usageChangeAlert:     input.caseType === 'ProactiveTracking' ? input.usageChangeAlert   : undefined,
        responseLevel:        input.caseType === 'ProactiveTracking' ? input.responseLevel      : undefined,
        cancellationRequest:  input.caseType === 'Churn'             ? input.cancellationRequest : undefined,
        offeredSolutions:     input.caseType === 'Churn'             ? input.offeredSolutions    : undefined,
        offerExpiryDate:      input.caseType === 'Churn'             ? input.offerExpiryDate     : undefined,
        offerOutcome:         input.caseType === 'Churn'             ? input.offerOutcome        : undefined,
        offerRejectionReason: input.caseType === 'Churn'             ? input.offerRejectionReason: undefined,
        actionTaken:          input.caseType === 'Churn'             ? input.actionTaken         : undefined,
        followUpDate:         input.caseType === 'Churn'             ? input.followUpDate        : undefined,
      };
      store = [newCase, ...store];
      return clone(newCase);
    }
    const created = await apiFetch<Case>(
      API_BASE,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Vaka oluşturulamadı',
    );
    if (!created) {
      // apiFetch zaten toast gösterdi; tip uyumu için exception fırlat —
      // çağıran yer try/catch'le veya undefined kontrolüyle koruyabilir.
      throw new Error('Vaka oluşturulamadı');
    }
    return created;
  },

  async transitionStatus(
    id: string,
    nextStatus: CaseStatus,
    payload?: {
      resolutionNote?: string;
      cancellationReason?: string;
      thirdPartyId?: string;
      thirdPartyName?: string;
      escalationLevel?: EscalationLevel;
      escalationReason?: string;
    },
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(100);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const prev = store[idx];

      // Spec section 6 — SLA duraklatma mantığı
      const enteringPause = nextStatus === '3rdPartyBekleniyor' && prev.status !== '3rdPartyBekleniyor';
      const leavingPause = prev.status === '3rdPartyBekleniyor' && nextStatus !== '3rdPartyBekleniyor';

      let nextSlaPausedAt = prev.slaPausedAt;
      let nextPausedDurationMin = prev.slaPausedDurationMin;
      let nextThirdPartyWaitMin = prev.slaThirdPartyWaitMin;
      let nextResolutionDueAt = prev.slaResolutionDueAt;

      if (enteringPause) {
        nextSlaPausedAt = nowIso();
      } else if (leavingPause && prev.slaPausedAt) {
        const pausedMin = Math.round((Date.now() - new Date(prev.slaPausedAt).getTime()) / 60000);
        nextPausedDurationMin += pausedMin;
        nextThirdPartyWaitMin += pausedMin;
        if (prev.slaResolutionDueAt) {
          nextResolutionDueAt = new Date(
            new Date(prev.slaResolutionDueAt).getTime() + pausedMin * 60000,
          ).toISOString();
        }
        nextSlaPausedAt = undefined;
      }

      const enteringEscalation = nextStatus === 'Eskalasyon';
      const newEscalationLevel = enteringEscalation
        ? payload?.escalationLevel ?? prev.escalationLevel
        : prev.escalationLevel;

      const extraHistory: typeof prev.history = [];
      if (enteringEscalation && payload?.escalationLevel && payload.escalationLevel !== prev.escalationLevel) {
        extraHistory.push({
          id: uid('H'),
          caseId: prev.id,
          action: 'Eskalasyon seviyesi',
          fromValue: prev.escalationLevel,
          toValue: payload.escalationLevel,
          actor: 'Mock User',
          at: nowIso(),
        });
      }
      if (enteringEscalation && payload?.escalationReason) {
        extraHistory.push({
          id: uid('H'),
          caseId: prev.id,
          action: 'Eskalasyon gerekçesi',
          toValue: payload.escalationReason,
          actor: 'Mock User',
          at: nowIso(),
        });
      }

      const updated: Case = {
        ...prev,
        status: nextStatus,
        updatedAt: nowIso(),
        resolutionNote: payload?.resolutionNote ?? prev.resolutionNote,
        cancellationReason: payload?.cancellationReason ?? prev.cancellationReason,
        thirdPartyId: enteringPause ? payload?.thirdPartyId ?? prev.thirdPartyId : prev.thirdPartyId,
        thirdPartyName: enteringPause ? payload?.thirdPartyName ?? prev.thirdPartyName : prev.thirdPartyName,
        escalationLevel: newEscalationLevel,
        slaPausedAt: nextSlaPausedAt,
        slaPausedDurationMin: nextPausedDurationMin,
        slaThirdPartyWaitMin: nextThirdPartyWaitMin,
        slaResolutionDueAt: nextResolutionDueAt,
        resolvedAt: nextStatus === 'Çözüldü' ? nowIso() : prev.resolvedAt,
        history: [
          ...prev.history,
          {
            id: uid('H'),
            caseId: prev.id,
            action: 'Statü değişti',
            fromValue: prev.status,
            toValue: nextStatus,
            actor: 'Mock User',
            at: nowIso(),
          },
          ...extraHistory,
        ],
      };
      store[idx] = updated;
      return clone(updated);
    }
    const result = await apiFetch<Case>(
      `${API_BASE}/${id}/transition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextStatus, ...payload }),
      },
      'Statü geçişi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2
    return result;
  },

  // Spec section 15 — CaseActivity her değişiklik: field_name, old_value, new_value
  async update(
    id: string,
    patch: Partial<Case>,
    actor = 'Mock User',
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const prev = store[idx];
      const historyAdds = (Object.keys(patch) as (keyof Case)[]).flatMap((key) => {
        const oldVal = prev[key];
        const newVal = patch[key];
        if (oldVal === newVal) return [];
        // Denormalized name alanları (assignedTeamName vs.) sessiz tutulur — id alanı zaten log'lanır
        if (
          key === 'assignedPersonName' ||
          key === 'assignedTeamName' ||
          key === 'thirdPartyName' ||
          key === 'companyName' ||
          key === 'accountName'
        ) return [];
        return [{
          id: uid('H'),
          caseId: prev.id,
          action: 'Alan güncellendi',
          fieldName: String(key),
          fromValue: formatHistoryValue(String(key), oldVal),
          toValue:   formatHistoryValue(String(key), newVal),
          actor,
          at: nowIso(),
        }];
      });
      const updated: Case = {
        ...prev,
        ...patch,
        updatedAt: nowIso(),
        history: [...prev.history, ...historyAdds],
      };
      store[idx] = updated;
      return clone(updated);
    }
    const result = await apiFetch<Case>(
      `${API_BASE}/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      'Vaka güncellenemedi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2
    return result;
  },

  /**
   * Phase D Step 2 — Deterministic müşteri eşleştirme önerileri.
   * AI YOK; auto-link YOK. Supervisor+ manuel onay verir.
   */
  async getCustomerMatchSuggestions(
    caseId: string,
    limit = 5,
  ): Promise<CustomerMatchSuggestionsResponse | undefined> {
    return apiFetch<CustomerMatchSuggestionsResponse>(
      `${API_BASE}/${caseId}/customer-match-suggestions?limit=${limit}`,
      undefined,
      'Müşteri önerileri',
    );
  },

  /**
   * Phase D — Müşteri eşleştirme. Supervisor/Admin/CSM/SystemAdmin vakayı bir
   * Account'a bağlar. Backend doğrular: Account vakanın companyId'sine bağlı,
   * kullanıcının scope'unda.
   */
  async linkAccount(caseId: string, accountId: string): Promise<Case | undefined> {
    const result = await apiFetch<Case>(
      `${API_BASE}/${caseId}/link-account`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      },
      'Müşteri eşleştirme',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * WR-C1 / PM-07 — "Üstlen" / Claim.
   * Atomik backend update; race conflict 409 → apiFetch toast eder, undefined döner.
   * Cache invalidate edilir (assignedPersonId/Name/TeamId değişti).
   */
  async claimCase(caseId: string): Promise<Case | undefined> {
    const result = await apiFetch<Case>(
      `${API_BASE}/${caseId}/claim`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      'Vaka üstlenilemedi',
    );
    if (result) invalidateCaseDetail(caseId);
    return result;
  },

  /**
   * Yeni çağrı logu ekler. UI tarafında oluşturulan log'u case.callLogs'a önder.
   * AI özetlemesi caller tarafında yapılır (aiService.callSummary → ardından
   * caseService.update ile aiCallBrief set edilir).
   */
  async addCallLog(
    id: string,
    input: {
      callerName: string;
      callDate?: string;
      durationMin: number;
      callDisposition: CallDisposition;
      callOutcome: CallOutcome;
      description?: string;
      nextFollowupDate?: string;
    },
  ): Promise<{ caseUpdated: Case; callLog: CaseCallLog } | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const newLog: CaseCallLog = {
        id: uid('CALL'),
        caseId: id,
        callDate: input.callDate ?? nowIso(),
        durationMin: input.durationMin,
        callDisposition: input.callDisposition,
        callOutcome: input.callOutcome,
        description: input.description?.trim() || undefined,
        callerId: 'mock-user',
        callerName: input.callerName,
        nextFollowupDate: input.nextFollowupDate,
        lastInteractionDate: nowIso(),
      };
      const updated: Case = {
        ...store[idx],
        callLogs: [newLog, ...store[idx].callLogs],
        updatedAt: nowIso(),
      };
      store[idx] = updated;
      return { caseUpdated: clone(updated), callLog: clone(newLog) };
    }
    const result = await apiFetch<{ caseUpdated: Case; callLog: CaseCallLog }>(
      `${API_BASE}/${id}/call-logs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Çağrı kaydı eklenemedi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2
    return result;
  },

  /**
   * Vakaya manuel aktivite kaydı ekler (Transfer, FieldUpdate, vb.).
   * `update()` zaten alan değişimlerini otomatik loglar; bu helper transfer
   * gibi özel akışlarda actionType + note ile zenginleştirilmiş entry üretir.
   */
  async addActivity(
    caseId: string,
    input: {
      actionType: CaseHistoryActionType;
      action: string;                  // Human-readable başlık
      fieldName?: string;
      oldValue?: string;
      newValue?: string;
      note?: string;
      actor?: string;
    },
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(40);
      const idx = store.findIndex((c) => c.id === caseId);
      if (idx < 0) return undefined;
      const prev = store[idx];
      const entry = {
        id: uid('H'),
        caseId,
        action: input.action,
        actionType: input.actionType,
        fieldName: input.fieldName,
        fromValue: input.oldValue,
        toValue: input.newValue,
        note: input.note,
        actor: input.actor ?? 'Mock User',
        at: nowIso(),
      };
      const updated: Case = {
        ...prev,
        history: [...prev.history, entry],
        updatedAt: nowIso(),
      };
      store[idx] = updated;
      return clone(updated);
    }
    const result = await apiFetch<Case>(
      `${API_BASE}/${caseId}/activity`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Aktivite kaydı eklenemedi',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * Kontrol listesi item'ını işaretle/işareti kaldır.
   * checked=true → checkedAt/checkedBy doldurulur, history'e log atılır.
   * checked=false → tüm meta alanlar undefined olur.
   */
  async toggleChecklistItem(
    caseId: string,
    itemId: string,
    checked: boolean,
    actor = 'Mock User',
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(50);
      const idx = store.findIndex((c) => c.id === caseId);
      if (idx < 0) return undefined;
      const prev = store[idx];
      if (!prev.checklistItems) return clone(prev);
      const items = prev.checklistItems.map((it) => {
        if (it.id !== itemId) return it;
        return checked
          ? { ...it, checked: true, checkedAt: nowIso(), checkedBy: actor }
          : { ...it, checked: false, checkedAt: undefined, checkedBy: undefined };
      });
      const target = prev.checklistItems.find((it) => it.id === itemId);
      const updated: Case = {
        ...prev,
        checklistItems: items,
        updatedAt: nowIso(),
        history: [
          ...prev.history,
          {
            id: uid('H'),
            caseId: prev.id,
            action: checked ? 'Kontrol maddesi işaretlendi' : 'Kontrol maddesi işareti kaldırıldı',
            fieldName: 'checklist',
            toValue: target?.label ?? itemId,
            actor,
            at: nowIso(),
          },
        ],
      };
      store[idx] = updated;
      return clone(updated);
    }
    const result = await apiFetch<Case>(
      `${API_BASE}/${caseId}/checklist/${itemId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      },
      'Kontrol listesi güncellenemedi',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  async addNote(id: string, note: { content: string; visibility: NoteVisibility; authorName: string }): Promise<CaseNote | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const newNote: CaseNote = {
        id: uid('NOTE'),
        caseId: id,
        authorName: note.authorName,
        content: note.content,
        visibility: note.visibility,
        createdAt: nowIso(),
      };
      store[idx] = {
        ...store[idx],
        notes: [newNote, ...store[idx].notes],
        updatedAt: nowIso(),
      };
      return clone(newNote);
    }
    const result = await apiFetch<CaseNote>(
      `${API_BASE}/${id}/notes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      },
      'Not eklenemedi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2 — note Case response'unda embed
    return result;
  },

  /**
   * Bir notun thread reply'larini getirir. Thread acildiginda lazy fetch.
   * createdAt ASC siralidir.
   */
  async listReplies(caseId: string, noteId: string): Promise<CaseNote[]> {
    if (USE_MOCK) {
      await delay(50);
      const c = store.find((c) => c.id === caseId);
      if (!c) return [];
      return clone(c.notes.filter((n) => n.parentNoteId === noteId));
    }
    const res = await apiFetch<{ value: CaseNote[] }>(
      `${API_BASE}/${caseId}/notes/${noteId}/replies`,
      { method: 'GET' },
      'Yanitlar yuklenemedi',
    );
    return res?.value ?? [];
  },

  /**
   * Bir nota yanit ekle (max 1 derinlik). Backend `replyCount`'i increment eder,
   * watcher bildirimi + CaseActivity yazar.
   */
  async addReply(
    caseId: string,
    noteId: string,
    reply: { content: string; visibility: NoteVisibility; authorName: string },
  ): Promise<CaseNote | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const idx = store.findIndex((c) => c.id === caseId);
      if (idx < 0) return undefined;
      const newReply: CaseNote = {
        id: uid('NOTE'),
        caseId,
        authorName: reply.authorName,
        content: reply.content,
        visibility: reply.visibility,
        parentNoteId: noteId,
        replyCount: 0,
        createdAt: nowIso(),
      };
      const updatedNotes = store[idx].notes.map((n) =>
        n.id === noteId ? { ...n, replyCount: (n.replyCount ?? 0) + 1 } : n,
      );
      store[idx] = {
        ...store[idx],
        notes: [...updatedNotes, newReply],
        updatedAt: nowIso(),
      };
      return clone(newReply);
    }
    const result = await apiFetch<CaseNote>(
      `${API_BASE}/${caseId}/notes/${noteId}/reply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reply),
      },
      'Yanit eklenemedi',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * Silent variant — used by the Aksiyonlarım inline-reply composer so
   * we can detect `max_depth` / `not_found` and fall back to a fresh
   * top-level note without showing the user an intermediate error toast.
   *
   * Returns a discriminated union; never shows a toast (the outer
   * fallback either calls `addNote` and uses its own toast on failure,
   * or surfaces `forbidden`/`unknown` via the composer's inline error).
   *
   * Mock mode mirrors `addReply` semantics (no max_depth check in mock).
   */
  async tryAddReply(
    caseId: string,
    noteId: string,
    reply: { content: string; visibility: NoteVisibility; authorName: string },
  ): Promise<
    | { ok: true; note: CaseNote }
    | { ok: false; reason: 'max_depth' | 'not_found' | 'forbidden' | 'empty' | 'unknown'; status?: number }
  > {
    if (USE_MOCK) {
      const note = await this.addReply(caseId, noteId, reply);
      return note ? { ok: true, note } : { ok: false, reason: 'unknown' };
    }
    const token = await getAccessToken();
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/${caseId}/notes/${noteId}/reply`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reply),
      });
    } catch {
      return { ok: false, reason: 'unknown' };
    }
    if (r.ok) {
      let note: CaseNote;
      try {
        note = (await r.json()) as CaseNote;
      } catch {
        return { ok: false, reason: 'unknown', status: r.status };
      }
      invalidateCaseDetail(caseId);
      return { ok: true, note };
    }
    // Parse structured error so the caller can decide between fallback
    // (max_depth / not_found) and hard failure (forbidden / unknown).
    let bodyError: string | undefined;
    try {
      const body = await r.json();
      bodyError = body?.error;
    } catch {
      // ignore
    }
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent('app:unauthenticated'));
      return { ok: false, reason: 'forbidden', status: r.status };
    }
    if (r.status === 403) return { ok: false, reason: 'forbidden', status: r.status };
    if (r.status === 404) return { ok: false, reason: 'not_found', status: r.status };
    if (r.status === 400 && bodyError === 'max_depth') {
      return { ok: false, reason: 'max_depth', status: r.status };
    }
    if (r.status === 400 && bodyError === 'empty') {
      return { ok: false, reason: 'empty', status: r.status };
    }
    return { ok: false, reason: 'unknown', status: r.status };
  },

  /**
   * Kendi notunu/yanıtını sil. Backend yetki + cascade güvenliği
   * kontrolü yapar. Discriminated union döner — UI 403/409 mesajlarını
   * doğru gösterebilsin diye structured.
   *
   * Reasons:
   *  - 'forbidden'     → başka kullanıcının notu (UI butonu zaten gizli olmalı)
   *  - 'orphan'        → authorId NULL eski not
   *  - 'has_replies'   → yanıtı olan top-level note (soft-delete yok)
   *  - 'not_found'     → vaka veya not bulunamadı (cross-tenant 404 dahil)
   *  - 'unknown'       → network/5xx
   */
  async deleteNote(
    caseId: string,
    noteId: string,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: 'forbidden' | 'orphan' | 'has_replies' | 'not_found' | 'unknown'; message?: string; status?: number }
  > {
    if (USE_MOCK) {
      await delay(60);
      const idx = store.findIndex((c) => c.id === caseId);
      if (idx < 0) return { ok: false, reason: 'not_found' };
      const note = store[idx].notes.find((n) => n.id === noteId);
      if (!note) return { ok: false, reason: 'not_found' };
      // Mock doesn't track currentUserId — allow.
      store[idx] = {
        ...store[idx],
        notes: store[idx].notes
          .filter((n) => n.id !== noteId)
          .map((n) =>
            note.parentNoteId && n.id === note.parentNoteId
              ? { ...n, replyCount: Math.max(0, (n.replyCount ?? 0) - 1) }
              : n,
          ),
      };
      return { ok: true };
    }
    const token = await getAccessToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let r: Response;
    try {
      r = await fetch(
        `${API_BASE}/${encodeURIComponent(caseId)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'DELETE', headers },
      );
    } catch {
      return { ok: false, reason: 'unknown' };
    }
    if (r.ok) {
      invalidateCaseDetail(caseId);
      return { ok: true };
    }
    let bodyError: string | undefined;
    let bodyMessage: string | undefined;
    try {
      const body = await r.json();
      bodyError = body?.error;
      bodyMessage = body?.message;
    } catch {
      // ignore
    }
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent('app:unauthenticated'));
      return { ok: false, reason: 'forbidden', message: bodyMessage, status: r.status };
    }
    if (r.status === 403) {
      const reason = bodyError === 'orphan' ? 'orphan' : 'forbidden';
      return { ok: false, reason, message: bodyMessage, status: r.status };
    }
    if (r.status === 404) {
      return { ok: false, reason: 'not_found', message: bodyMessage, status: r.status };
    }
    if (r.status === 409 && bodyError === 'has_replies') {
      return { ok: false, reason: 'has_replies', message: bodyMessage, status: r.status };
    }
    return { ok: false, reason: 'unknown', message: bodyMessage, status: r.status };
  },

  /**
   * Bir nota emoji reaksiyonu toggle eder.
   * Backend ayni (note, user, emoji) varsa kaldirir, yoksa ekler.
   * Mock'ta currentUserId bilinmedigi icin reaction'lar atlanir.
   */
  async toggleReaction(
    caseId: string,
    noteId: string,
    emoji: string,
  ): Promise<{ action: 'added' | 'removed' } | undefined> {
    if (USE_MOCK) {
      await delay(40);
      return { action: 'added' };
    }
    const result = await apiFetch<{ action: 'added' | 'removed' }>(
      `${API_BASE}/${caseId}/notes/${noteId}/reactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      },
      'Reaksiyon kaydedilemedi',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * Vakaya dosya ekler. 3 adımlı orchestration:
   *  1. BFF'den signed upload URL al
   *  2. Doğrudan Supabase Storage'a PUT (Vercel 4.5MB body limitini bypass)
   *  3. BFF'ye finalize çağrısı → DB satırı + history log
   *
   * onProgress callback (opsiyonel) — XHR ile yükleme yüzdesi raporlar.
   * Mock'ta tek adımda in-memory store'a yazar.
   */
  async addFile(
    id: string,
    fileOrInput:
      | File
      | { fileName: string; fileSize: number; mimeType: string; dataUrl?: string; uploadedBy?: string },
    onProgress?: (percent: number) => void,
  ): Promise<{ caseUpdated: Case; file: CaseFile } | { error: string } | undefined> {
    if (USE_MOCK) {
      await delay(60);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const prev = store[idx];
      if (prev.files.length >= CASE_FILE_MAX_COUNT) {
        return { error: `Bu vakada en fazla ${CASE_FILE_MAX_COUNT} dosya olabilir.` };
      }
      const meta =
        fileOrInput instanceof File
          ? { fileName: fileOrInput.name, fileSize: fileOrInput.size, mimeType: fileOrInput.type || 'application/octet-stream' }
          : fileOrInput;
      if (meta.fileSize > CASE_FILE_MAX_SIZE) {
        return { error: `Dosya boyutu üst sınırı ${Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024))} MB.` };
      }
      const actor = ('uploadedBy' in meta && meta.uploadedBy) || 'Mock User';
      const dataUrl = 'dataUrl' in meta ? meta.dataUrl : undefined;
      const file: CaseFile = {
        id: uid('FILE'),
        caseId: id,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        mimeType: meta.mimeType,
        uploadedBy: actor,
        uploadedAt: nowIso(),
        dataUrl,
      };
      const updated: Case = {
        ...prev,
        files: [file, ...prev.files],
        updatedAt: nowIso(),
        history: [
          ...prev.history,
          {
            id: uid('H'),
            caseId: id,
            action: 'Dosya yüklendi',
            actionType: 'FileUploaded',
            fieldName: 'files',
            toValue: file.fileName,
            actor,
            at: nowIso(),
          },
        ],
      };
      store[idx] = updated;
      return { caseUpdated: clone(updated), file: clone(file) };
    }

    // FAZ 2: BFF + Supabase Storage 3-step orchestration
    if (!(fileOrInput instanceof File)) {
      return { error: 'Dosya yüklemek için File nesnesi gerekli.' };
    }
    const file = fileOrInput;
    if (file.size > CASE_FILE_MAX_SIZE) {
      return { error: `Dosya boyutu üst sınırı ${Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024))} MB.` };
    }

    // Adım 1 — signed upload URL al
    const upload = await apiFetch<{ uploadUrl: string; path: string; attachmentId: string } | { error: string }>(
      `${API_BASE}/${id}/files/upload-url`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
        }),
      },
      'Yükleme adresi alınamadı',
    );
    if (!upload) return undefined;
    if ('error' in upload) return upload;

    // Adım 2 — doğrudan Supabase Storage'a PUT (XHR ile progress takibi)
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload.uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress?.(100);
            resolve();
          } else {
            reject(new Error(`Storage ${xhr.status}: ${xhr.responseText}`));
          }
        };
        xhr.onerror = () => reject(new Error('Storage bağlantı hatası'));
        xhr.onabort = () => reject(new Error('Yükleme iptal edildi'));
        xhr.send(file);
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'Storage hatası';
      notify({
        type: 'error',
        title: 'Dosya yüklenemedi',
        message: msg.startsWith('Storage') ? msg : `Storage hatası: ${msg}`,
      });
      console.error('[caseService] storage put', err);
      return undefined;
    }

    // Adım 3 — finalize: DB satırı + history
    const result = await apiFetch<{ caseUpdated: Case; file: CaseFile }>(
      `${API_BASE}/${id}/files/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachmentId: upload.attachmentId,
          path: upload.path,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
        }),
      },
      'Dosya kaydedilemedi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2
    return result;
  },

  /** Dosya indirme için kısa ömürlü signed URL al + tarayıcıda aç. */
  async downloadFile(caseId: string, fileId: string): Promise<void> {
    if (USE_MOCK) {
      // Mock: dataUrl zaten dosyada
      const c = store.find((x) => x.id === caseId);
      const f = c?.files.find((x) => x.id === fileId);
      if (f?.dataUrl) {
        const a = document.createElement('a');
        a.href = f.dataUrl;
        a.download = f.fileName;
        a.click();
      }
      return;
    }
    const result = await apiFetch<{ url: string; fileName: string }>(
      `${API_BASE}/${caseId}/files/${fileId}/download`,
      undefined,
      'Dosya indirilemedi',
    );
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.fileName;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  },

  /** Vakadan dosya siler ve history'e FileRemoved entry'si atar. */
  async removeFile(
    id: string,
    fileId: string,
    actor = 'Mock User',
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(50);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const prev = store[idx];
      const target = prev.files.find((f) => f.id === fileId);
      if (!target) return clone(prev);
      const updated: Case = {
        ...prev,
        files: prev.files.filter((f) => f.id !== fileId),
        updatedAt: nowIso(),
        history: [
          ...prev.history,
          {
            id: uid('H'),
            caseId: id,
            action: 'Dosya silindi',
            actionType: 'FileRemoved',
            fieldName: 'files',
            fromValue: target.fileName,
            actor,
            at: nowIso(),
          },
        ],
      };
      store[idx] = updated;
      return clone(updated);
    }
    const result = await apiFetch<Case>(
      `${API_BASE}/${id}/files/${fileId}`,
      { method: 'DELETE' },
      'Dosya silinemedi',
    );
    if (result) invalidateCaseDetail(id); // WR-H2
    return result;
  },

  async findOpenCaseFor(accountId: string, caseType: CaseType): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(40);
      const found = store.find(
        (c) =>
          c.accountId === accountId &&
          c.caseType === caseType &&
          c.status !== 'Çözüldü' &&
          c.status !== 'İptalEdildi',
      );
      return found ? clone(found) : undefined;
    }
    const data = await apiFetch<{ case?: Case }>(
      `${API_BASE}/duplicate-check?accountId=${encodeURIComponent(accountId)}&caseType=${encodeURIComponent(caseType)}`,
      undefined,
      'Duplicate kontrolü',
    );
    return data?.case ?? undefined;
  },

  /**
   * Admin ekranlarının kullandığı sync helper'lar — performansı kritik değil,
   * await beklenmesin diye sync. FAZ 2 BFF için ayrı endpoint'lere mapping yapılır.
   */
  countByThirdParty(thirdPartyId: string): number {
    return store.filter((c) => c.thirdPartyId === thirdPartyId).length;
  },

  /**
   * Belge türü-vaka ilişkisi modellendiğinde gerçek sayım buraya gelecek.
   * Şimdilik admin tablosunda her satır 0 kullanım gösterir.
   */
  countByDocumentType(_documentTypeId: string): number {
    return 0;
  },

  /** Bu takıma atanmış (her statüde) kaç vaka var? Admin silme uyarısı için. */
  countByTeam(teamId: string): number {
    return store.filter((c) => c.assignedTeamId === teamId).length;
  },

  /** Sadece açık (henüz çözülmemiş/iptal olmamış) vaka sayısı. Pasifleştirme uyarısı için. */
  countOpenByTeam(teamId: string): number {
    return store.filter(
      (c) => c.assignedTeamId === teamId && c.status !== 'Çözüldü' && c.status !== 'İptalEdildi',
    ).length;
  },

  /** Bu kişiye atanmış (her statüde) kaç vaka var? */
  countByPerson(personId: string): number {
    return store.filter((c) => c.assignedPersonId === personId).length;
  },

  /** Sadece açık vaka sayısı (kişi). */
  countOpenByPerson(personId: string): number {
    return store.filter(
      (c) => c.assignedPersonId === personId && c.status !== 'Çözüldü' && c.status !== 'İptalEdildi',
    ).length;
  },

  /**
   * Vakalarda category alanı denormalized ad olarak saklı (ID yok),
   * dolayısıyla sayım ada göre yapılır. Admin'de kategori adı değiştirilirse
   * eski vakalardaki ad korunur ama bu helper o adla artık eşleşmez —
   * bu kabul edilebilir (eski adı değiştiren kullanıcı bilinçli karar verir).
   */
  countByCategory(categoryName: string): number {
    return store.filter((c) => c.category === categoryName).length;
  },

  countBySubCategory(categoryName: string, subCategoryName: string): number {
    return store.filter(
      (c) => c.category === categoryName && c.subCategory === subCategoryName,
    ).length;
  },

  /**
   * PRODUCT_SPEC §6 — SLA 5-tuple match. Sadece aktif policy'ler arasında arar.
   * FAZ 2'de BFF SLA motoru bu fonksiyonu kullanmayacak; admin preview için.
   */
  getSlaPolicyFor(c: {
    companyId: string;
    productGroup?: string;
    category: string;
    subCategory: string;
    requestType: CaseRequestType;
  }): SlaPolicy | undefined {
    if (!c.productGroup) return undefined;
    return MOCK_SLA_POLICIES.find(
      (p) =>
        p.isActive &&
        p.companyId === c.companyId &&
        p.productGroup === c.productGroup &&
        p.categoryName === c.category &&
        p.subCategoryName === c.subCategory &&
        p.requestType === c.requestType,
    );
  },

  /**
   * Bir SLA policy kaç vakaya tam eşleşiyor — admin tablosunda "kullanım" kolonu.
   * Pasif policy'ler de saysın (silme uyarısı için).
   */
  countCasesMatchingPolicy(policyId: string): number {
    const p = MOCK_SLA_POLICIES.find((x) => x.id === policyId);
    if (!p) return 0;
    return store.filter(
      (c) =>
        c.companyId === p.companyId &&
        c.productGroup === p.productGroup &&
        c.category === p.categoryName &&
        c.subCategory === p.subCategoryName &&
        c.requestType === p.requestType,
    ).length;
  },

  /**
   * Kontrol Listesi 3-tuple match (company + productGroup + category).
   * Vaka detayında otomatik yüklenir — sadece aktif template'lerde arar.
   */
  getChecklistFor(c: {
    companyId: string;
    productGroup?: string;
    category: string;
  }): CaseChecklistTemplate | undefined {
    if (!c.productGroup) return undefined;
    return MOCK_CHECKLIST_TEMPLATES.find(
      (t) =>
        t.isActive &&
        t.companyId === c.companyId &&
        t.productGroup === c.productGroup &&
        t.categoryName === c.category,
    );
  },

  /** Bu checklist template kaç vakaya tam eşleşiyor — admin "kullanım" kolonu. */
  countCasesMatchingChecklist(templateId: string): number {
    const t = MOCK_CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return 0;
    return store.filter(
      (c) =>
        c.companyId === t.companyId &&
        c.productGroup === t.productGroup &&
        c.category === t.categoryName,
    ).length;
  },

  /**
   * Bu teklif kaç vakada sunulmuş — vakanın offeredSolutions: string[]
   * alanı ID listesi içerir (denormalized ad yok, silinince eski vakalarda
   * "Bilinmeyen teklif" görünür).
   */
  countCasesUsingOffer(offerId: string): number {
    return store.filter((c) => c.offeredSolutions?.includes(offerId)).length;
  },

  // ─────────────────────────────────────────────────────────────────
  // @mention — Faz 1.5 Madde 3
  // ─────────────────────────────────────────────────────────────────

  /**
   * Vakaya not yazarken @mention dropdown için aday liste.
   * Vakanın şirketine bağlı + Person'a bağlı aktif User'lar.
   */
  async listMentionableUsers(caseId: string): Promise<MentionableUser[]> {
    const data = await apiFetch<{ value: MentionableUser[] }>(
      `${API_BASE}/${caseId}/mentionable-users`,
      undefined,
      'Etiketlenebilir kullanıcılar yüklenemedi',
    );
    return data?.value ?? [];
  },

  /** Bell badge için kullanıcının okunmamış mention listesi. */
  async listUnreadMentions(): Promise<{ items: UnreadMention[]; total: number }> {
    const data = await apiFetch<{ value: UnreadMention[]; '@odata.count': number }>(
      `${API_BASE}/me/mentions/unread`,
      undefined,
      'Bildirimler yüklenemedi',
    );
    return { items: data?.value ?? [], total: data?.['@odata.count'] ?? 0 };
  },

  /** Vaka açıldığında o vakadaki kullanıcının mention'larını seen yapar. */
  async markMentionsSeen(caseId: string): Promise<{ updated: number } | undefined> {
    return apiFetch(
      `${API_BASE}/${caseId}/mentions/seen`,
      { method: 'POST' },
      'Mention seen güncellenemedi',
    );
  },

  /**
   * Bell badge için generic CaseNotification listesi (watcher_update,
   * watcher_added, note_reaction). Mention'lar ayrı kanaldan gelir.
   */
  async listUnreadNotifications(): Promise<{ items: import('@/features/cases/types').UnreadNotification[]; total: number }> {
    const data = await apiFetch<{ value: import('@/features/cases/types').UnreadNotification[]; '@odata.count': number }>(
      `${API_BASE}/me/notifications/unread`,
      undefined,
      'Bildirimler yüklenemedi',
    );
    return { items: data?.value ?? [], total: data?.['@odata.count'] ?? 0 };
  },

  /**
   * Drawer açıldığında veya kullanıcı "tümünü okundu işaretle" yaparken.
   * `ids` verilmezse tüm okunmamışlar seen yapılır.
   */
  async markNotificationsSeen(ids?: string[]): Promise<{ updated: number } | undefined> {
    return apiFetch(
      `${API_BASE}/me/notifications/seen`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids ?? [] }),
      },
      'Bildirimler işaretlenemedi',
    );
  },

  /**
   * FAZ 2 §20.2 — vaka aktarımı.
   * Body: takım/kişi + gerekçe + AI önerisi snapshot (opsiyonel).
   * Backend transferCount++ + CaseTransfer audit + Activity log üretir.
   * 2+ transfer olduğunda supervisor uyarısı + AI kök neden analizi tetiklenir
   * (fire-and-forget; activity feed'de RUNA AI satırı sonradan belirir).
   */
  async transferCase(
    caseId: string,
    body: {
      toTeamId: string;
      toPersonId?: string | null;
      reason: string;
      reasonCode?: string;
      aiSuggestedTeamId?: string;
      aiSuggestedReason?: string;
      aiReasonCode?: string;
      aiConfidence?: number;
    },
  ): Promise<Case | undefined> {
    const result = await apiFetch<Case>(
      `${API_BASE}/${caseId}/transfer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Vaka aktarımı başarısız',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * Aktarım sonrası RUNA AI'dan devir notu üret. Yeni takım için 3 madde
   * (yapılanlar / kritik nokta / önerilen ilk adım). 503 → AI yapılandırılmamış.
   */
  async transferBrief(
    caseId: string,
    body: { toTeamId?: string; toPersonId?: string | null },
  ): Promise<{ brief: string } | undefined> {
    return apiFetch<{ brief: string }>(
      `${API_BASE}/${caseId}/transfer-brief`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Devir notu alınamadı',
    );
  },

  /** Bir vakanın tüm aktarım geçmişi (en yeni en üstte). */
  async listTransfers(caseId: string): Promise<CaseTransferRecord[]> {
    const data = await apiFetch<{ value: CaseTransferRecord[] }>(
      `${API_BASE}/${caseId}/transfers`,
      undefined,
      'Aktarım geçmişi yüklenemedi',
    );
    return data?.value ?? [];
  },

  /**
   * Customer Pulse — vakanın müşterisinin geniş durumu (state + metrics +
   * recommended action). Deterministic; AI yoksa da çalışır. UI'da
   * panel olarak gösterilir; başarısız olursa case detail bozulmaz.
   */
  async getCustomerPulse(caseId: string): Promise<CustomerPulse | undefined> {
    return apiFetch<CustomerPulse>(
      `${API_BASE}/${caseId}/customer-pulse`,
      undefined,
      'Müşteri durumu yüklenemedi',
    );
  },

  /**
   * Account-based Customer Pulse — yeni vaka açılışı için (caseId yok).
   * Response.caseId null gelir; deterministic only (AI upgrade istemcide skip).
   * Cross-tenant: companyId allowedCompanyIds'de olmalı.
   */
  async getCustomerPulseByAccount(
    accountId: string,
    companyId: string,
  ): Promise<CustomerPulse | undefined> {
    const qs = new URLSearchParams({ companyId }).toString();
    return apiFetch<CustomerPulse>(
      `${API_BASE}/accounts/${accountId}/customer-pulse?${qs}`,
      undefined,
      'Müşteri durumu yüklenemedi',
    );
  },

  /**
   * Action Timeline Summary — vakanın operasyonel aksiyon geçmişi (CaseActivity)
   * AI ile kronolojik özetlenir. aiSummary (vaka içeriği) ve supervisor-summary
   * (risk) ile FARKLI amaç: vakanın yolculuğunu anlatır.
   *
   * Persist edilmez — UI her "Yenile" tıklayışında yeniden üretir.
   * AI yoksa 503 → UI fallback mesajı gösterir.
   */
  async getActionSummary(caseId: string): Promise<ActionSummary | undefined> {
    return apiFetch<ActionSummary>(
      `${API_BASE}/${caseId}/action-summary`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      'Eylem özeti üretilemedi',
    );
  },

  // ── FAZ 2 Collab — Watcher (izleyici) ────────────────────────

  /** Vakanın izleyici listesi. UI'da LeftPanel "İZLEYİCİLER" bölümünde gösterilir. */
  async listWatchers(caseId: string): Promise<CaseWatcherRecord[]> {
    const data = await apiFetch<{ value: CaseWatcherRecord[] }>(
      `${API_BASE}/${caseId}/watchers`,
      undefined,
      'İzleyiciler yüklenemedi',
    );
    return data?.value ?? [];
  },

  /**
   * İzleyici ekle. userId === current user.id ise self-watch (her rol için).
   * Başka user için Supervisor+ veya assigned owner (BFF enforces).
   */
  async addWatcher(
    caseId: string,
    userId: string,
  ): Promise<{ id: string; userId: string; addedAt: string } | undefined> {
    const result = await apiFetch<{ id: string; userId: string; addedAt: string }>(
      `${API_BASE}/${caseId}/watchers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      },
      'İzleyici eklenemedi',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /** İzleyici kaldır. Self veya Supervisor+. */
  async removeWatcher(caseId: string, userId: string): Promise<{ ok: true } | undefined> {
    const result = await apiFetch<{ ok: true }>(
      `${API_BASE}/${caseId}/watchers/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      'İzleyici çıkarılamadı',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /** Kullanıcının izlediği vakalar (Watcher Inbox — ileri faz). */
  async listWatching(): Promise<Case[]> {
    const data = await apiFetch<{ value: Case[] }>(
      `${API_BASE}/watching`,
      undefined,
      'İzlenen vakalar yüklenemedi',
    );
    return data?.value ?? [];
  },

  // ── FAZ 2 Collab — Linked Cases (bağlantılar) ────────────────

  /** Vakanın bağlantıları (3 tip karışık liste — UI gruplar). */
  async listLinks(caseId: string): Promise<LinkedCaseEntry[]> {
    const data = await apiFetch<{ value: LinkedCaseEntry[] }>(
      `${API_BASE}/${caseId}/links`,
      undefined,
      'Bağlantılar yüklenemedi',
    );
    return data?.value ?? [];
  },

  /**
   * Bağlantı ekle. linkType 'Related'|'Duplicate'|'Parent'.
   * Duplicate symmetric — BFF reverse de yazar.
   */
  async addLink(
    caseId: string,
    linkedCaseId: string,
    linkType: CaseLinkType,
  ): Promise<{ linkId: string; linkType: CaseLinkType; linkedCaseNumber: string } | undefined> {
    const result = await apiFetch<{ linkId: string; linkType: CaseLinkType; linkedCaseNumber: string }>(
      `${API_BASE}/${caseId}/links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedCaseId, linkType }),
      },
      'Bağlantı eklenemedi',
    );
    if (result) {
      invalidateCaseDetail(caseId);
      invalidateCaseDetail(linkedCaseId); // WR-H2 — symmetric link side
    }
    return result;
  },

  /** Bağlantı kaldır. Symmetric Duplicate ters yön de silinir (BFF). */
  async removeLink(caseId: string, linkId: string): Promise<{ ok: true } | undefined> {
    const result = await apiFetch<{ ok: true }>(
      `${API_BASE}/${caseId}/links/${encodeURIComponent(linkId)}`,
      { method: 'DELETE' },
      'Bağlantı kaldırılamadı',
    );
    if (result) invalidateCaseDetail(caseId); // WR-H2
    return result;
  },

  /**
   * Toplu güncelleme — Faz 1.5 Madde 2.
   * Backend whitelist: assignedPersonId, assignedTeamId, priority, status.
   * Status'te kapatma yasak (Cozuldu/IptalEdildi). Cross-tenant ID denenirse 403.
   */
  async bulkUpdate(
    caseIds: string[],
    updates: {
      assignedPersonId?: string;
      assignedTeamId?: string;
      priority?: CasePriority;
      status?: CaseStatus;
    },
  ): Promise<{ updated: number; failed: number; errors: { caseId: string; error: string }[] } | undefined> {
    const result = await apiFetch<{ updated: number; failed: number; errors: { caseId: string; error: string }[] }>(
      `${API_BASE}/bulk-update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds, updates }),
      },
      'Toplu güncelleme başarısız',
    );
    if (result) caseIds.forEach((id) => invalidateCaseDetail(id)); // WR-H2
    return result;
  },

  async findByAccount(
    accountId: string,
    options?: { excludeId?: string; statusIn?: CaseStatus[]; statusNotIn?: CaseStatus[] },
  ): Promise<Case[]> {
    if (USE_MOCK) {
      await delay(40);
      let out = store.filter((c) => c.accountId === accountId);
      if (options?.excludeId)    out = out.filter((c) => c.id !== options.excludeId);
      if (options?.statusIn)     out = out.filter((c) => options.statusIn!.includes(c.status));
      if (options?.statusNotIn)  out = out.filter((c) => !options.statusNotIn!.includes(c.status));
      return out.map((c) => clone(c));
    }
    const params = new URLSearchParams();
    params.set('accountId', accountId);
    if (options?.excludeId) params.set('excludeId', options.excludeId);
    if (options?.statusIn) params.set('statusIn', options.statusIn.join(','));
    // P0 hotfix: statusNotIn frontend'de gönderilmiyordu; backend destekliyor
    // (server/routes/cases.js:158-161). CustomerSearchModal "Çözüldü/İptalEdildi"
    // hariç gönderiyor — filter şimdi backend'de uygulanır.
    if (options?.statusNotIn) params.set('statusNotIn', options.statusNotIn.join(','));
    const data = await apiFetch<{ value: Case[] }>(
      `${API_BASE}/by-account?${params.toString()}`,
      undefined,
      'Geçmiş vakalar yüklenemedi',
    );
    return data?.value ?? [];
  },
};

/**
 * lookupService — sync getter API. Kaynak USE_MOCK'a göre değişir:
 *  - USE_MOCK=true → MOCK_* dizilerinden okur
 *  - USE_MOCK=false → loadBootstrap() ile çekilmiş cache'den okur
 *
 * App boot'ta `<LookupGate>` cache'i doldurur; bu sayede sayfaların
 * lookupService.X() çağrıları async refactor istemez.
 */
function getCache() {
  if (USE_MOCK) return null;
  const data = getBootstrap();
  if (!data) {
    // LookupGate boot tamamlanmadan render edilmemeli — bu uyarı bootstrap
    // sırası bozulduğunda geliştiriciye işaret eder.
    console.warn(
      '[lookupService] bootstrap cache boş — <LookupGate /> render dışında çağırma yapılmış olabilir.',
    );
  }
  return data;
}

export const lookupService = {
  companies: () => {
    const b = getCache();
    return b ? clone(b.companies) : clone(MOCK_COMPANIES);
  },
  teams: () => {
    const b = getCache();
    return b ? clone(b.teams).filter((t) => t.isActive)
             : clone(MOCK_TEAMS).filter((t) => t.isActive);
  },
  persons: () => {
    const b = getCache();
    return b ? clone(b.persons).filter((p) => p.isActive)
             : clone(MOCK_PERSONS).filter((p) => p.isActive);
  },
  personsByTeam: (teamId: string) => {
    const b = getCache();
    const src = b ? b.persons : MOCK_PERSONS;
    return src.filter((p) => p.teamId === teamId && p.isActive).map((p) => ({ ...p }));
  },
  accounts: () => {
    const b = getCache();
    return b ? clone(b.accounts) : clone(MOCK_ACCOUNTS);
  },
  /**
   * Aktif kategoriler + her birinin aktif alt kategorileri.
   * Legacy shape ({ category, subCategories: string[] }) korunur.
   */
  categories: () => {
    const b = getCache();
    if (b) {
      return b.categories
        .filter((c) => c.isActive)
        .map((c) => ({
          category: c.name,
          subCategories: c.subCategories.filter((s) => s.isActive).map((s) => s.name),
        }));
    }
    return MOCK_CATEGORIES
      .filter((c) => c.isActive)
      .map((c) => ({
        category: c.name,
        subCategories: c.subCategories.filter((s) => s.isActive).map((s) => s.name),
      }));
  },
  requestTypes: () => [...CASE_REQUEST_TYPES],
  thirdParties: () => {
    const b = getCache();
    return b ? clone(b.thirdParties).filter((tp) => tp.isActive)
             : clone(MOCK_THIRD_PARTIES).filter((tp) => tp.isActive);
  },
  documentTypes: () => {
    const b = getCache();
    return b ? clone(b.documentTypes).filter((e) => e.isActive)
             : clone(MOCK_DOCUMENT_TYPES).filter((e) => e.isActive);
  },
  offeredSolutions: () => {
    const b = getCache();
    return b ? clone(b.offeredSolutions).filter((o) => o.isActive)
             : clone(MOCK_OFFERED_SOLUTIONS).filter((o) => o.isActive);
  },
  productGroups: (): string[] => {
    const b = getCache();
    if (b) return [...b.productGroups];
    // Fallback: mock'tan distinct (USE_MOCK=true ya da bootstrap fail durumunda)
    const set = new Set<string>();
    MOCK_CASES.forEach((c) => {
      if (c.productGroup) set.add(c.productGroup);
    });
    return Array.from(set).sort();
  },
  fieldDefinitions: () => {
    const b = getCache();
    return b ? clone(b.fieldDefinitions) : [];
  },
  /**
   * WR-A7b — Vaka açılış catalog lookup (Package/Product). Bootstrap'tan ayrı,
   * companyId + opsiyonel accountId scope'unda anlık çekilir.
   */
  async caseCatalog(params: { companyId: string; accountId?: string | null }): Promise<{
    companyId: string;
    accountId: string | null;
    packages: Array<{ id: string; code: string; name: string; supportLevel: SupportLevel }>;
    products: Array<{
      id: string;
      code: string;
      name: string;
      supportLevel: SupportLevel;
      productGroupId: string;
    }>;
    packageItems: Record<string, string[]>;
    suggestedPackage: string | null;
  }> {
    const url = new URL('/api/lookups/catalog', window.location.origin);
    url.searchParams.set('companyId', params.companyId);
    if (params.accountId) url.searchParams.set('accountId', params.accountId);
    const data = await apiFetch<{
      companyId: string;
      accountId: string | null;
      packages: Array<{ id: string; code: string; name: string; supportLevel: SupportLevel }>;
      products: Array<{
        id: string;
        code: string;
        name: string;
        supportLevel: SupportLevel;
        productGroupId: string;
      }>;
      packageItems: Record<string, string[]>;
      suggestedPackage: string | null;
    }>(url.pathname + url.search, undefined, 'Katalog yüklenemedi');
    return (
      data ?? {
        companyId: params.companyId,
        accountId: params.accountId ?? null,
        packages: [],
        products: [],
        packageItems: {},
        suggestedPackage: null,
      }
    );
  },

  /**
   * WR-Smart-Ticket Phase 1c — per-tenant taxonomy fetch.
   * GET /api/lookups/taxonomies?companyId=...
   *
   * Response shape (PR-1a sözleşmesi):
   *   {
   *     companyId,
   *     taxonomies: {
   *       platform:        [{ code, label, sortOrder, metadata? }, ...],
   *       businessProcess: [...],
   *       ...
   *       rootCauseGroup:  [{ code, label, sortOrder,
   *                           children: [{ code, label, sortOrder }, ...] }, ...]
   *     }
   *   }
   *
   * NOT: bootstrap'a dahil edilmedi — Smart Ticket intake'i flag-arkası
   * şu an. Flag açıldığında intake screen on-demand çağırır; mevcut
   * Quick Case / New Case akışı bu lookup'tan etkilenmez.
   */
  async smartTicketTaxonomies(companyId: string): Promise<SmartTicketTaxonomyResponse> {
    const url = new URL('/api/lookups/taxonomies', window.location.origin);
    url.searchParams.set('companyId', companyId);
    const data = await apiFetch<SmartTicketTaxonomyResponse>(
      url.pathname + url.search,
      undefined,
      'Akıllı Ticket taxonomy listesi yüklenemedi',
    );
    return (
      data ?? {
        companyId,
        taxonomies: {
          platform: [],
          businessProcess: [],
          operationType: [],
          affectedObject: [],
          impact: [],
          rootCauseGroup: [],
          resolutionType: [],
          permanentPrevention: [],
        },
      }
    );
  },
};

export interface SmartTicketTaxonomyItem {
  code: string;
  label: string;
  sortOrder: number;
  metadata?: unknown;
}
export interface SmartTicketRootCauseGroup extends SmartTicketTaxonomyItem {
  children: SmartTicketTaxonomyItem[];
}
export interface SmartTicketTaxonomyResponse {
  companyId: string;
  taxonomies: {
    platform: SmartTicketTaxonomyItem[];
    businessProcess: SmartTicketTaxonomyItem[];
    operationType: SmartTicketTaxonomyItem[];
    affectedObject: SmartTicketTaxonomyItem[];
    impact: SmartTicketTaxonomyItem[];
    rootCauseGroup: SmartTicketRootCauseGroup[];
    resolutionType: SmartTicketTaxonomyItem[];
    permanentPrevention: SmartTicketTaxonomyItem[];
  };
}
