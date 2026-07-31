// İZOLE monitoring feature — API servisi. apiFetch'i sarar (konvansiyon:
// bileşenler doğrudan apiFetch çağırmaz). Yalnızca /api/monitoring/* okur.
import { apiFetch } from '@/services/caseService';
import type {
  Summary, TimeseriesPoint, BreakdownResponse, FiltersResponse,
  MonitoringFilters, Grain, Dimension,
} from './types';

function qs(filters: MonitoringFilters, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

export const monitoringService = {
  getSummary: (f: MonitoringFilters) =>
    apiFetch<Summary>(`/api/monitoring/summary?${qs(f)}`, undefined, 'Özet yüklenemedi'),
  getTimeseries: (f: MonitoringFilters, grain: Grain) =>
    apiFetch<TimeseriesPoint[]>(`/api/monitoring/timeseries?${qs(f, { grain })}`, undefined, 'Zaman serisi yüklenemedi'),
  getBreakdown: (f: MonitoringFilters, dimension: Dimension, page = 1, pageSize = 20) =>
    apiFetch<BreakdownResponse>(`/api/monitoring/breakdown?${qs(f, { dimension, page: String(page), pageSize: String(pageSize) })}`, undefined, 'Kırılım yüklenemedi'),
  getFilters: () =>
    apiFetch<FiltersResponse>('/api/monitoring/filters', undefined, 'Filtreler yüklenemedi'),
};
