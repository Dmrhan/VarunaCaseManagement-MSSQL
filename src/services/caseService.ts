import {
  MOCK_ACCOUNTS,
  MOCK_CASES,
  MOCK_CATEGORIES,
  MOCK_COMPANIES,
  MOCK_OFFERED_SOLUTIONS,
  MOCK_PERSONS,
  MOCK_TEAMS,
  MOCK_THIRD_PARTIES,
} from '@/mocks/caseMockData';
import {
  CASE_REQUEST_TYPES,
  type Case,
  type CaseFilters,
  type CaseListPagination,
  type CaseNote,
  type CaseRequestType,
  type CaseStatus,
  type CaseType,
  type EscalationLevel,
  type NoteVisibility,
} from '@/features/cases/types';

export const USE_MOCK = true;

const API_BASE = '/api/cases';

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
          c.accountName.toLowerCase().includes(q),
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
  accountId: string;
  accountName: string;
  category: string;
  subCategory: string;
  requestType: CaseRequestType;
  productGroup?: string;
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
    if (pagination) {
      params.set('page', String(pagination.page));
      params.set('pageSize', String(pagination.pageSize));
    }
    const r = await fetch(`${API_BASE}?${params.toString()}`);
    const data = await r.json();
    return { items: data.value ?? [], total: data['@odata.count'] ?? 0 };
  },

  async get(id: string): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(80);
      const found = store.find((c) => c.id === id);
      return found ? clone(found) : undefined;
    }
    const r = await fetch(`${API_BASE}/${id}`);
    if (!r.ok) return undefined;
    return r.json();
  },

  async create(input: NewCaseInput): Promise<Case> {
    if (USE_MOCK) {
      await delay(150);
      const idx = store.length + 1;
      const newCase: Case = {
        id: uid('CASE'),
        caseNumber: `CASE-2026-${String(10000 + idx).padStart(5, '0')}`,
        title: input.title,
        description: input.description,
        caseType: input.caseType,
        status: 'Açık',
        priority: input.priority,
        origin: input.origin,
        originDescription: input.originDescription,
        companyId: input.companyId,
        companyName: input.companyName,
        accountId: input.accountId,
        accountName: input.accountName,
        category: input.category,
        subCategory: input.subCategory,
        requestType: input.requestType,
        productGroup: input.productGroup,
        assignedTeamId: input.assignedTeamId,
        assignedTeamName: input.assignedTeamName,
        assignedPersonId: input.assignedPersonId,
        assignedPersonName: input.assignedPersonName,
        escalationLevel: 'Yok',
        slaViolation: false,
        slaPausedDurationMin: 0,
        slaThirdPartyWaitMin: 0,
        aiGeneratedFlag: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        notes: [],
        files: [],
        callLogs: [],
        history: [
          { id: uid('H'), caseId: '', action: 'Vaka oluşturuldu', actor: 'Mock User', at: nowIso() },
        ],
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
    const r = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return r.json();
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
    const r = await fetch(`${API_BASE}/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextStatus, ...payload }),
    });
    return r.json();
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
        return [{
          id: uid('H'),
          caseId: prev.id,
          action: 'Alan güncellendi',
          fieldName: String(key),
          fromValue: oldVal == null ? '—' : String(oldVal),
          toValue: newVal == null ? '—' : String(newVal),
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
    const r = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return undefined;
    return r.json();
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
    const r = await fetch(`${API_BASE}/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    });
    return r.json();
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
    const r = await fetch(`${API_BASE}/duplicate-check?accountId=${accountId}&caseType=${caseType}`);
    if (!r.ok) return undefined;
    const data = await r.json();
    return data?.case ?? undefined;
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
    if (options?.statusIn)  params.set('statusIn', options.statusIn.join(','));
    const r = await fetch(`${API_BASE}/by-account?${params.toString()}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data?.value ?? [];
  },
};

export const lookupService = {
  companies:        () => clone(MOCK_COMPANIES),
  teams:            () => clone(MOCK_TEAMS),
  persons:          () => clone(MOCK_PERSONS),
  personsByTeam:    (teamId: string) => MOCK_PERSONS.filter((p) => p.teamId === teamId).map((p) => ({ ...p })),
  accounts:         () => clone(MOCK_ACCOUNTS),
  categories:       () => clone(MOCK_CATEGORIES),
  requestTypes:     () => [...CASE_REQUEST_TYPES],
  thirdParties:     () => clone(MOCK_THIRD_PARTIES).filter((tp) => tp.isActive),
  offeredSolutions: () => clone(MOCK_OFFERED_SOLUTIONS).filter((o) => o.isActive),
};
