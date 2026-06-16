/**
 * Case Report Studio — frontend service.
 *
 * Endpoint sözleşmesi: server/routes/reports.js. Bu modül ince bir wrapper —
 * üç fetch:
 *   - listColumns()  → registry + categories
 *   - preview()      → seçili kolonlarla sayfalı önizleme
 *   - exportXlsx()   → blob download
 *
 * apiFetch JSON parse ettiği için Excel download manuel fetch + Authorization
 * header pattern'iyle yapılır; aynı authClient.getAccessToken kullanılır.
 */
import { apiFetch } from '@/services/caseService';
import { getAccessToken } from '@/services/authClient';
import { notify } from '@/components/ui/Toast';

const BASE = '/api/reports/cases';

export type ReportColumnType = 'string' | 'text' | 'number' | 'datetime' | 'boolean';

export type ReportColumnCategory =
  | 'core'
  | 'classification'
  | 'assignment'
  | 'sla'
  | 'timeline'
  | 'resolution'
  | 'smart_ticket_opening'
  | 'smart_ticket_closure'
  | 'smart_ticket_drafts'
  | 'smart_ticket_solution_steps'
  | 'performance_flow'
  | 'account_pii';

export interface ReportColumnDef {
  id: string;
  label: string;
  category: ReportColumnCategory;
  type: ReportColumnType;
  /** Phase 2A: 'aggregate' / Phase 2D: 'join' — backend ek fetch yapar. */
  source: 'scalar' | 'json_path' | 'aggregate' | 'join';
  /** Phase 2D: PII kolonu işaretlemesi. UI badge/uyarı için kullanılabilir. */
  privacyTag?: 'pii';
}

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  companyIds?: string[] | string;
  statuses?: string[] | string;
  priorities?: string[] | string;
  assignedTeamId?: string;
  assignedPersonId?: string;
  search?: string;
}

export interface ReportPreviewResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  columns: { id: string; label: string; type: ReportColumnType }[];
}

export interface ReportColumnsResponse {
  categories: Record<ReportColumnCategory, string>;
  columns: ReportColumnDef[];
}

// Phase 3.1 — Pivot
export type PivotMeasureFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface PivotRequest {
  rowColumnId: string;
  colColumnId: string;
  measure: {
    fn: PivotMeasureFn;
    columnId?: string; // count fn için ignore
  };
  filters?: ReportFilters;
}

export interface PivotResponse {
  row: { id: string; label: string };
  col: { id: string; label: string };
  measure: { fn: PivotMeasureFn; columnId?: string; columnLabel?: string };
  rowLabels: string[];
  colLabels: string[];
  matrix: Record<string, Record<string, number | null>>;
  rowTotals: Record<string, number | null>;
  colTotals: Record<string, number | null>;
  grandTotal: number | null;
  total: number;
}

// Phase 3.2 — Drill-down
export interface PivotDrillRequest {
  rowColumnId: string;
  colColumnId: string;
  rowValue: string;
  colValue: string;
  filters?: ReportFilters;
  columns?: string[];
}

export interface PivotDrillResponse {
  rows: Record<string, unknown>[];
  total: number;
  columns: { id: string; label: string; type: ReportColumnType }[];
}

export const reportService = {
  async listColumns(): Promise<ReportColumnsResponse | undefined> {
    return apiFetch<ReportColumnsResponse>(`${BASE}/columns`, undefined, 'Rapor kolonları');
  },

  async preview(
    columns: string[],
    filters: ReportFilters,
    page = 1,
    pageSize = 50,
  ): Promise<ReportPreviewResponse | undefined> {
    return apiFetch<ReportPreviewResponse>(
      `${BASE}/preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, filters, page, pageSize }),
      },
      'Rapor önizlemesi',
    );
  },

  async pivot(req: PivotRequest): Promise<PivotResponse | undefined> {
    return apiFetch<PivotResponse>(
      `${BASE}/pivot`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      'Pivot raporu',
    );
  },

  async pivotDrill(req: PivotDrillRequest): Promise<PivotDrillResponse | undefined> {
    return apiFetch<PivotDrillResponse>(
      `${BASE}/pivot/drill`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      'Pivot detayı',
    );
  },

  async pivotExportXlsx(req: PivotRequest): Promise<void> {
    const token = await getAccessToken();
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
    let r: Response;
    try {
      r = await fetch(`${BASE}/pivot/export`, {
        method: 'POST', headers, body: JSON.stringify(req),
      });
    } catch (err) {
      notify({ type: 'error', title: 'Pivot Excel export başarısız', message: 'Sunucuya ulaşılamadı.', duration: 5000 });
      console.error('[reportService.pivotExportXlsx] network', err);
      return;
    }
    if (!r.ok) {
      let serverMessage = '';
      try { const body = await r.json(); serverMessage = body?.message ?? body?.error ?? ''; }
      catch { try { serverMessage = await r.text(); } catch {} }
      notify({ type: 'error', title: `Pivot export başarısız (${r.status})`, message: serverMessage || 'Sunucu hatası.', duration: 6000 });
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `vaka-pivot-${stamp}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /**
   * Excel export — binary blob download. apiFetch JSON parse ettiği için
   * burada manuel fetch + access token kullanıyoruz. Backend ya 200 + xlsx
   * Buffer ya 400/500 + JSON döner; ikinci durumda JSON parse edip notify
   * ederiz.
   */
  async exportXlsx(columns: string[], filters: ReportFilters): Promise<void> {
    const token = await getAccessToken();
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
    let r: Response;
    try {
      r = await fetch(`${BASE}/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ columns, filters }),
      });
    } catch (err) {
      notify({
        type: 'error',
        title: 'Excel export başarısız',
        message: 'Sunucuya ulaşılamadı.',
        duration: 5000,
      });
      console.error('[reportService.exportXlsx] network', err);
      return;
    }
    if (!r.ok) {
      let serverMessage = '';
      try {
        const body = await r.json();
        serverMessage = body?.message ?? body?.error ?? '';
      } catch {
        try {
          serverMessage = await r.text();
        } catch {
          // sessiz
        }
      }
      notify({
        type: 'error',
        title: `Excel export başarısız (${r.status})`,
        message: serverMessage || 'Sunucu hatası.',
        duration: 6000,
      });
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vaka-raporu-${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
