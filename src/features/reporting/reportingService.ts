// İZOLE raporlama servisi — pivot bloklarını /api/monitoring/report/pivot'tan çeker.
import { apiFetch } from '@/services/caseService';
import type { PivotResponse, ReportFilters, ReportDimension, S4Response } from './types';

function qs(f: ReportFilters, extra: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

export const reportingService = {
  getPivot: (f: ReportFilters, dimension: ReportDimension) =>
    apiFetch<PivotResponse>(`/api/monitoring/report/pivot?${qs(f, { dimension })}`, undefined, 'Rapor bloğu yüklenemedi'),

  // Sheet 1 (Kök Neden) — MADDE-seviyesi özel endpoint (distinct TFS madde, madde
  // açılış tarihi, ¬DinRap). blok: b1/b2/b3/b4. Generic pivot'tan farklı olduğu için ayrı.
  getS1: (from: string, to: string, blok: 'b1' | 'b2' | 'b3' | 'b4') =>
    apiFetch<PivotResponse>(`/api/monitoring/report/s1?${new URLSearchParams({ from, to, blok }).toString()}`, undefined, 'S1 bloğu yüklenemedi'),

  // Sheet 4 (Süre) — mesai-duyarlı süre analizi (2 taban × 3 blok × Tipi×ay).
  getS4: (from: string, to: string, kaynak: string) =>
    apiFetch<S4Response>(`/api/monitoring/report/s4?${qs({ from, to, kaynak }, {})}`, undefined, 'Süre raporu yüklenemedi'),
};
