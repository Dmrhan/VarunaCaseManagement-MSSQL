import { apiFetch } from './caseService';

/**
 * /my/* — kişisel takvim & hatırlatıcılar.
 * Multi-tenant scope tüm endpoint'lerde backend'de uygulanır.
 */

export type CalendarEventType = 'reminder' | 'snooze' | 'sla_response' | 'sla_resolution' | 'followup';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  /** Vakasız reminder için null. */
  caseId: string | null;
  caseNumber: string | null;
  customerName: string | null;
  priority: string | null;
  /** ISO datetime */
  date: string;
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Dashboard ("Benim Sayfam") — Agent/Supervisor anasayfa veri seti.
// Tek round-trip; backend allowedCompanyIds + personId scope uygular.
// ─────────────────────────────────────────────────────────────────

export type UrgentSignal =
  // caseIds: backend count() kullanıyor, normalde dönmez. Optional bıraktık —
  // tüketici şu an yok; ileride detay drawer eklenirse ayrı endpoint tercih edilir.
  | { type: 'sla_risk'; count: number; caseIds?: string[] }
  | { type: 'unread_mentions'; count: number }
  | { type: 'awaiting_reply'; count: number; caseIds?: string[] }
  | { type: 'pattern_alert'; count: number; category: string };

export interface DashboardStats {
  assignedToMe: number;
  resolvedToday: number;
  snoozed: number;
  followupToday: number;
}

export interface DashboardCalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  caseId: string | null;
  caseNumber: string | null;
  customerName: string | null;
  /** ISO datetime */
  time: string;
}

export type PendingApprovalType = 'followup' | 'reminder' | 'sla' | 'awaiting';

export interface PendingApproval {
  caseId: string | null;
  caseNumber: string | null;
  customerName: string | null;
  type: PendingApprovalType;
  reason: string;
  /** ISO; "Ekle" tıklamasında modal'a pre-fill için. */
  suggestedTime: string;
}

export interface DashboardTopCase {
  caseId: string;
  caseNumber: string;
  title: string;
  customerName: string;
  priority: string;
  status: string;
  slaViolation: boolean;
  /** Kart altındaki vurgu metni (örn. "⚡ SLA 3 saat kaldı"). */
  aiSignal: string | null;
}

export interface PerformanceDimension {
  /** 0-5 arası ondalıklı puan; null = yetersiz veri. */
  score: number | null;
  /** Trend ileride zaman serisi gelince doldurulacak. Şimdilik null. */
  trend: number | null;
  /** Takım ortalamasından fark (+/-). */
  vsTeam: number;
}

export interface DashboardPerformance {
  period: '30d';
  empathy: PerformanceDimension;
  clarity: PerformanceDimension;
  speed: PerformanceDimension;
  aiCoachMessage: string;
}

export interface DashboardDailySummary {
  resolvedToday: number;
  newCasesToday: number;
  avgResolutionHours: number;
}

export interface DashboardData {
  greeting: { name: string; timeOfDay: 'morning' | 'afternoon' | 'evening' };
  urgentSignals: UrgentSignal[];
  stats: DashboardStats;
  todayCalendar: DashboardCalendarEvent[];
  pendingApprovals: PendingApproval[];
  myTopCases: DashboardTopCase[];
  performance: DashboardPerformance | null;
  dailySummary: DashboardDailySummary;
}

export const myService = {
  /**
   * "Benim Sayfam" tek-round-trip dashboard verisi.
   * BFF tarafı 15 paralel sorgu; FE bir sonuç bekler.
   */
  async getDashboard(opts?: { fresh?: boolean }): Promise<DashboardData | undefined> {
    // fresh=true → BFF 30sn cache'i bypass eder. Mutation sonrası (reminder
    // create/update/delete, snooze, mention seen) refresh çağrılarında geçilir.
    const qs = opts?.fresh ? '?fresh=1' : '';
    return apiFetch<DashboardData>(
      `/api/my/dashboard${qs}`,
      undefined,
      'Anasayfa yüklenemedi',
    );
  },

  /**
   * Aralıktaki olayları çek. from/to ISO formatında olmalı.
   * Backend max 90 gün desteğine sahip — UI bunun üstüne çıkmaz.
   *
   * @param types — fetch edilecek olay türleri. Verilmezse hepsi gelir.
   *   Boş array geçerse backend hiç sorgu çalıştırmaz (lazy load).
   */
  async getCalendar(from: Date, to: Date, types?: CalendarEventType[]): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (types !== undefined) {
      params.set('types', types.join(','));
    }
    const data = await apiFetch<{ events: CalendarEvent[] }>(
      `/api/my/calendar?${params.toString()}`,
      undefined,
      'Takvim yüklenemedi',
    );
    return data?.events ?? [];
  },

  async updateReminder(
    id: string,
    input: {
      caseId?: string | null;
      remindAt?: string;
      message?: string | null;
    },
  ): Promise<{ id: string; caseId: string | null; remindAt: string; message: string | null } | undefined> {
    return apiFetch(
      `/api/my/reminders/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Hatırlatıcı güncellenemedi',
    );
  },

  async createReminder(input: {
    /** Boş bırakılırsa vakasız (kişisel) hatırlatıcı; bu durumda message zorunlu. */
    caseId?: string | null;
    remindAt: string;
    message?: string;
  }): Promise<{ id: string; caseId: string | null; remindAt: string; message: string | null } | undefined> {
    return apiFetch(
      '/api/my/reminders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Hatırlatıcı oluşturulamadı',
    );
  },

  async deleteReminder(id: string): Promise<{ id: string; deleted: boolean } | undefined> {
    return apiFetch(
      `/api/my/reminders/${id}`,
      { method: 'DELETE' },
      'Hatırlatıcı silinemedi',
    );
  },
};
