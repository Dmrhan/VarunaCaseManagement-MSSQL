import {
  MOCK_ACCOUNTS,
  MOCK_CASES,
  MOCK_CATEGORIES,
  MOCK_PERSONS,
  MOCK_REQUEST_TYPES,
  MOCK_TEAMS,
} from '@/mocks/caseMockData';
import type {
  Case,
  CaseFilters,
  CaseNote,
  CaseStatus,
  CaseType,
  NoteVisibility,
} from '@/features/cases/types';

export const USE_MOCK = true;

const API_BASE = '/api/cases';

let store: Case[] = MOCK_CASES.map((c) => ({ ...c, notes: [...c.notes], files: [...c.files], history: [...c.history] }));

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
  if (f.status && f.status !== 'Tümü') out = out.filter((c) => c.status === f.status);
  if (f.caseType && f.caseType !== 'Tümü') out = out.filter((c) => c.caseType === f.caseType);
  if (f.priority && f.priority !== 'Tümü') out = out.filter((c) => c.priority === f.priority);
  return out;
}

export interface NewCaseInput {
  title: string;
  description: string;
  caseType: CaseType;
  priority: Case['priority'];
  origin: Case['origin'];
  originDescription?: string;
  accountId: string;
  accountName: string;
  category: string;
  subCategory: string;
  requestType: string;
  productGroup?: string;
  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;
}

export const caseService = {
  async list(filters?: CaseFilters): Promise<{ items: Case[]; total: number }> {
    if (USE_MOCK) {
      await delay();
      const all = clone(store);
      const filtered = applyFilters(all, filters);
      return { items: filtered, total: filtered.length };
    }
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.status && filters.status !== 'Tümü') params.set('status', filters.status);
    if (filters?.caseType && filters.caseType !== 'Tümü') params.set('caseType', filters.caseType);
    if (filters?.priority && filters.priority !== 'Tümü') params.set('priority', filters.priority);
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
        slaPaused: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        notes: [],
        files: [],
        history: [
          { id: uid('H'), caseId: '', action: 'Vaka oluşturuldu', actor: 'Mock User', at: nowIso() },
        ],
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
    payload?: { resolutionNote?: string; cancellationReason?: string; thirdPartyWaitingFor?: string },
  ): Promise<Case | undefined> {
    if (USE_MOCK) {
      await delay(100);
      const idx = store.findIndex((c) => c.id === id);
      if (idx < 0) return undefined;
      const prev = store[idx];
      const updated: Case = {
        ...prev,
        status: nextStatus,
        updatedAt: nowIso(),
        resolutionNote: payload?.resolutionNote ?? prev.resolutionNote,
        cancellationReason: payload?.cancellationReason ?? prev.cancellationReason,
        thirdPartyWaitingFor: payload?.thirdPartyWaitingFor ?? prev.thirdPartyWaitingFor,
        slaPaused: nextStatus === '3rdPartyBekleniyor',
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

  async hasOpenCaseFor(accountId: string, caseType: CaseType): Promise<boolean> {
    if (USE_MOCK) {
      await delay(40);
      return store.some(
        (c) =>
          c.accountId === accountId &&
          c.caseType === caseType &&
          c.status !== 'Çözüldü' &&
          c.status !== 'İptalEdildi',
      );
    }
    const r = await fetch(`${API_BASE}/duplicate-check?accountId=${accountId}&caseType=${caseType}`);
    const data = await r.json();
    return Boolean(data.exists);
  },
};

export const lookupService = {
  teams: () => clone(MOCK_TEAMS),
  persons: () => clone(MOCK_PERSONS),
  personsByTeam: (teamId: string) => MOCK_PERSONS.filter((p) => p.teamId === teamId).map((p) => ({ ...p })),
  accounts: () => clone(MOCK_ACCOUNTS),
  categories: () => clone(MOCK_CATEGORIES),
  requestTypes: () => [...MOCK_REQUEST_TYPES],
};
