import {
  MOCK_ACCOUNTS,
  MOCK_CASES,
  MOCK_CATEGORIES,
  MOCK_CHECKLIST_TEMPLATES,
  MOCK_COMPANIES,
  MOCK_EVRAK_TYPES,
  MOCK_OFFERED_SOLUTIONS,
  MOCK_PERSONS,
  MOCK_SLA_POLICIES,
  MOCK_TEAMS,
  MOCK_THIRD_PARTIES,
} from '@/mocks/caseMockData';

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
  type CaseListPagination,
  type CaseNote,
  type CaseRequestType,
  type CaseStatus,
  type CaseType,
  type EscalationLevel,
  type NoteVisibility,
  type SlaPolicy,
  type CaseChecklistTemplate,
} from '@/features/cases/types';

export const USE_MOCK = true;

const API_BASE = '/api/cases';

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

  // RUNA AI — kullanıcı "Uygula" derse set edilir, "Yoksay" derse rejectReason set edilir
  aiGeneratedFlag?: boolean;
  aiCategoryPrediction?: string;
  aiPriorityPrediction?: Case['priority'];
  aiConfidenceScore?: number;
  aiRejectReason?: string;
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
    const r = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return undefined;
    return r.json();
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
    const r = await fetch(`${API_BASE}/${id}/call-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) return undefined;
    return r.json();
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
    const r = await fetch(`${API_BASE}/${caseId}/checklist/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
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

  /**
   * Admin ekranlarının kullandığı sync helper'lar — performansı kritik değil,
   * await beklenmesin diye sync. FAZ 2 BFF için ayrı endpoint'lere mapping yapılır.
   */
  countByThirdParty(thirdPartyId: string): number {
    return store.filter((c) => c.thirdPartyId === thirdPartyId).length;
  },

  /**
   * FAZ 4'te dosya/evrak yükleme eklendiğinde gerçek sayım buraya gelecek.
   * Şimdilik admin tablosunda her satır 0 kullanım gösterir.
   */
  countByEvrakType(_evrakTypeId: string): number {
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
  teams:            () => clone(MOCK_TEAMS).filter((t) => t.isActive),
  persons:          () => clone(MOCK_PERSONS).filter((p) => p.isActive),
  personsByTeam:    (teamId: string) =>
    MOCK_PERSONS.filter((p) => p.teamId === teamId && p.isActive).map((p) => ({ ...p })),
  accounts:         () => clone(MOCK_ACCOUNTS),
  /**
   * Aktif kategoriler + her birinin aktif alt kategorileri.
   * Legacy shape ({ category, subCategories: string[] }) korunur — NewCaseForm /
   * CaseDetailPage gibi consumer'lar henüz id-bazlı modele geçmedi.
   */
  categories: () =>
    MOCK_CATEGORIES
      .filter((c) => c.isActive)
      .map((c) => ({
        category: c.name,
        subCategories: c.subCategories.filter((s) => s.isActive).map((s) => s.name),
      })),
  requestTypes:     () => [...CASE_REQUEST_TYPES],
  thirdParties:     () => clone(MOCK_THIRD_PARTIES).filter((tp) => tp.isActive),
  evrakTypes:       () => clone(MOCK_EVRAK_TYPES).filter((e) => e.isActive),
  offeredSolutions: () => clone(MOCK_OFFERED_SOLUTIONS).filter((o) => o.isActive),
  productGroups:    (): string[] => {
    const set = new Set<string>();
    MOCK_CASES.forEach((c) => {
      if (c.productGroup) set.add(c.productGroup);
    });
    return Array.from(set).sort();
  },
};
