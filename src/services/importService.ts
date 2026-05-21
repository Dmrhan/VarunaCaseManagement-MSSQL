/**
 * WR-A8 — Data Integration Studio frontend service.
 *
 * BFF /api/admin/imports/* endpoint'leriyle konuşur. Mock veri YOK; hepsi
 * gerçek backend çağrısı. Tüm Account import akışları (schema, parse, sample,
 * auto-map, validate, dry-run, commit, rollback, history) bu modülden geçer.
 */

import { apiFetch } from './caseService';

const BASE = '/api/admin/imports';

// ─────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────

export type TargetFieldType = 'text' | 'number' | 'email' | 'phone' | 'vkn' | 'boolean' | 'enum';

export interface TargetFieldDescriptor {
  key: string;
  label: string;
  group: string;
  required: boolean;
  type: TargetFieldType;
  aliases: string[];
  description: string;
  example?: string;
  writable: boolean;
  createAllowed: boolean;
  updateAllowed: boolean;
  warningIfMissing: { code: string; message: string } | null;
  target?: 'account' | 'accountCompany';
}

export interface TargetSchemaResponse {
  target: string;
  version: string;
  fields: TargetFieldDescriptor[];
}

export interface MappingItem {
  source: string;
  targetKey: string | null;
  confidence?: number;
}

export interface MappingValidation {
  ok: boolean;
  errors: Array<{ code: string; targetKey?: string; source?: string; message?: string }>;
  warnings: Array<{ code: string; targetKey: string; message: string }>;
  targetSchemaVersion?: string;
}

export interface FieldDiff {
  account: Record<string, { from: unknown; to: unknown }>;
  accountCompany: Record<string, { from: unknown; to: unknown }>;
}

export interface DryRunRowPreview {
  rowNumber: number;
  action: 'create' | 'update' | 'skip' | 'error';
  status: 'pending' | 'error' | 'skipped';
  errors: Array<{ targetKey: string | null; label: string | null; message: string }>;
  warnings: Array<{ targetKey: string; label: string; message: string }>;
  normalized: Record<string, unknown>;
  matchedAccountName: string | null;
  matchedAccountVknMasked: string | null;
  fieldDiff: FieldDiff | null;
}

export interface DryRunSummary {
  totalRows: number;
  createCount: number;
  updateCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  qualityScore: number;
}

export interface DryRunResponse {
  ok: boolean;
  jobId?: string;
  status?: string;
  targetSchemaVersion: string;
  summary?: DryRunSummary;
  mapping?: MappingValidation;
  preview?: DryRunRowPreview[];
}

export interface ImportJob {
  id: string;
  companyId: string;
  targetType: string;
  sourceType: 'file' | 'api';
  sourceName: string | null;
  sourceUrlMasked?: string | null;
  fileName: string | null;
  dataPath?: string | null;
  targetSchemaVersion?: string;
  status:
    | 'draft'
    | 'validated'
    | 'running'
    | 'partial'
    | 'completed'
    | 'failed'
    | 'rolled_back'
    | 'rollback_partial';
  totalRows: number;
  createCount: number;
  updateCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rolledBackAt: string | null;
  rolledBackByUserId?: string | null;
  summaryJson?: unknown;
}

export interface ImportJobRow {
  id: string;
  rowNumber: number;
  action: string;
  status: string;
  accountId: string | null;
  matchKey: string | null;
  errorsJson: unknown;
  warningsJson: unknown;
  rawJson: unknown;
  normalizedJson: unknown;
  beforeJson: unknown;
  afterJson: unknown;
}

export interface FileParseResult {
  ok: boolean;
  fileName: string | null;
  columns: string[];
  totalRows: number;
  sample: Array<Record<string, unknown>>;
}

export interface ApiSampleResult {
  ok: boolean;
  code?: string;
  message?: string;
  status?: number | null;
  sourceName?: string | null;
  sourceUrlMasked?: string | null;
  columns?: string[];
  totalRows?: number;
  /**
   * WR-A8 review fix (Issue 1) — Tüm import satırları (sampleLimit'ten bağımsız;
   * maks. MAX_IMPORT_ROWS=5000). Dry-run / commit yalnız `rows`'u kullanır.
   */
  rows?: Array<Record<string, unknown>>;
  /** Preview için ilk N satır (sampleLimit). UX dışında kullanılmaz. */
  sample?: Array<Record<string, unknown>>;
  /** code='too_many_rows' durumunda backend tarafından döndürülen limit. */
  maxRows?: number | null;
}

export interface ApiSampleInput {
  companyId: string;
  sourceName?: string;
  url: string;
  method: 'GET' | 'POST';
  authType: 'none' | 'bearerToken' | 'apiKeyHeader';
  secretName?: string;
  headersJson?: Record<string, string> | null;
  bodyJson?: unknown;
  dataPath?: string | null;
  sampleLimit?: number;
}

// ─────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────

async function postJson<T>(path: string, body: unknown, errCtx: string): Promise<T | undefined> {
  return apiFetch<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    errCtx,
  );
}

export const importService = {
  async schema(): Promise<TargetSchemaResponse | undefined> {
    return apiFetch<TargetSchemaResponse>(
      `${BASE}/targets/account/schema`,
      undefined,
      'Hedef şema okunamadı',
    );
  },

  templateUrl(): string {
    return `${BASE}/account/template.csv`;
  },

  async parseFile(input: {
    companyId: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    fileName?: string;
  }): Promise<FileParseResult | undefined> {
    return postJson<FileParseResult>(
      `${BASE}/account/sources/file/parse`,
      input,
      'Dosya okunamadı',
    );
  },

  async sampleApi(input: ApiSampleInput): Promise<ApiSampleResult | undefined> {
    return postJson<ApiSampleResult>(
      `${BASE}/account/sources/api/sample`,
      input,
      'API örneklemesi başarısız',
    );
  },

  async autoMap(input: { companyId: string; columns: string[] }): Promise<{
    ok: boolean;
    suggestions: MappingItem[];
    targetSchemaVersion: string;
  } | undefined> {
    return postJson(`${BASE}/account/auto-map`, input, 'Otomatik eşleştirme başarısız');
  },

  async validateMapping(input: { companyId: string; mapping: MappingItem[] }): Promise<
    MappingValidation | undefined
  > {
    return postJson(`${BASE}/account/validate`, input, 'Eşleştirme doğrulanamadı');
  },

  async dryRun(input: {
    companyId: string;
    mapping: MappingItem[];
    rows: Array<Record<string, unknown>>;
    sourceMeta: {
      sourceType: 'file' | 'api';
      sourceName?: string | null;
      sourceUrlMasked?: string | null;
      fileName?: string | null;
      dataPath?: string | null;
    };
  }): Promise<DryRunResponse | undefined> {
    return postJson<DryRunResponse>(`${BASE}/account/dry-run`, input, 'Dry-run başarısız');
  },

  async commit(input: {
    companyId: string;
    jobId: string;
    options?: { skipErrors?: boolean };
  }): Promise<
    | {
        ok: boolean;
        job: ImportJob;
        runStats: {
          createdCount: number;
          updatedCount: number;
          skippedCount: number;
          errorCount: number;
        };
      }
    | undefined
  > {
    return postJson(`${BASE}/account/commit`, input, 'İçe aktarım başarısız');
  },

  async rollback(jobId: string): Promise<
    | {
        ok: boolean;
        job: ImportJob;
        report: {
          rolledBackCreatedCount: number;
          rolledBackUpdatedCount: number;
          /** WR-A8 review fix (Issue 2) — Geri yüklenen AccountCompany ilişkisi sayısı. */
          rolledBackAccountCompanyCount?: number;
          failedCount: number;
          totalAttempted: number;
        };
      }
    | undefined
  > {
    return postJson(`${BASE}/jobs/${encodeURIComponent(jobId)}/rollback`, {}, 'Geri alma başarısız');
  },

  async listJobs(companyId?: string): Promise<{ value: ImportJob[] } | undefined> {
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch<{ value: ImportJob[] }>(`${BASE}/jobs${q}`, undefined, 'Geçmiş okunamadı');
  },

  async getJob(jobId: string): Promise<ImportJob | undefined> {
    return apiFetch<ImportJob>(
      `${BASE}/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      'Job okunamadı',
    );
  },

  async getJobRows(
    jobId: string,
    opts?: { status?: string; limit?: number; offset?: number },
  ): Promise<{ value: ImportJobRow[] } | undefined> {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.offset) qs.set('offset', String(opts.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ value: ImportJobRow[] }>(
      `${BASE}/jobs/${encodeURIComponent(jobId)}/rows${suffix}`,
      undefined,
      'Job satırları okunamadı',
    );
  },
};

// ─────────────────────────────────────────────────────────────────
// Client-side CSV/XLSX parsing helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Minimal RFC4180 CSV parser — quoted fields ("foo,bar"), escaped quotes (""),
 * BOM, \r\n + \n satır sonları desteklenir. 5MB / 5000 satır cap caller
 * sorumluluğunda.
 */
export function parseCsvText(text: string): { columns: string[]; rows: Array<Record<string, string>> } {
  if (!text) return { columns: [], rows: [] };
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      cur.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // skip \r; \n will close the row
      i += 1;
      continue;
    }
    if (c === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Son alan + satır
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  if (rows.length === 0) return { columns: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const data: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === '') continue; // boş satır atla
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (row[j] ?? '').trim();
    }
    data.push(obj);
  }
  return { columns: headers, rows: data };
}
