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

export const myService = {
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
