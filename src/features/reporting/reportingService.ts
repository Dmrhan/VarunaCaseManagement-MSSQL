// İZOLE raporlama servisi — pivot bloklarını /api/monitoring/report/pivot'tan çeker.
import { apiFetch } from '@/services/caseService';
import type { PivotResponse, ReportFilters, ReportDimension } from './types';

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
};
