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
// WR-A8 Phase 2a — Customer 360 types
// ─────────────────────────────────────────────────────────────────

export const CUSTOMER_360_ENTITY_KEYS = [
  'account',
  'accountCompany',
  'accountContact',
  'accountAddress',
  'accountProject',
] as const;

export type Customer360EntityKey = (typeof CUSTOMER_360_ENTITY_KEYS)[number];

export interface Customer360EntityDescriptor {
  entity: Customer360EntityKey;
  version: string;
  label: string;
  description: string;
  parentEntity: string | null;
  relationshipKeys: string[];
  fields: Array<TargetFieldDescriptor & {
    description: string;
    validationHint: string | null;
    normalizationHint: string | null;
    businessWarning: string | null;
    sensitive: boolean;
    pii: boolean;
  }>;
}

export interface Customer360Relationship {
  from: string;
  to: string;
  key: string;
}

export interface Customer360SchemaResponse {
  target: 'customer360';
  version: string;
  entities: Customer360EntityDescriptor[];
  relationships: Customer360Relationship[];
  matchingRules: Record<Customer360EntityKey, string[]>;
}

export interface Customer360EntitySummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  warning: number;
}

export interface Customer360CompletenessSlice {
  have: number;
  total: number;
  pct: number;
}

export interface Customer360DryRunResponse {
  ok: boolean;
  /** WR-A8 Phase 2b — true when registry-level validation passes (server still
   *  re-validates on commit). Phase 2a was hardcoded false; now reflects real
   *  commit eligibility. */
  commitAvailable: boolean;
  message: string;
  customer360SchemaVersion: string;
  code?: string;
  tcknLeaks?: Array<{ entity: string; columns: string[] }>;
  tooManyRows?: Array<{ entity: string; count: number; max: number }>;
  mappingValidation?: Record<string, MappingValidation>;
  summary?: {
    totalRows: number;
    totalErrors: number;
    totalWarnings: number;
    byEntity: Record<Customer360EntityKey, Customer360EntitySummary>;
    completenessScore: Record<string, Customer360CompletenessSlice>;
    orphansByEntity: Record<string, number[]>;
  };
  skipErrorsPreview?: {
    blockedIfSkipErrorsFalse: boolean;
    cascadingSkipIfSkipErrorsTrue: Record<Customer360EntityKey, number>;
  };
  preview?: Record<
    Customer360EntityKey,
    Array<{
      rowNumber: number;
      action: 'create' | 'update' | 'skip' | 'error';
      errors: Array<{ entity?: string; targetKey: string | null; label: string | null; message: string; code?: string }>;
      warnings: Array<{ entity?: string; targetKey: string | null; label: string | null; message: string; code?: string }>;
      normalized: Record<string, unknown>;
      matchedAccountName: string | null;
    }>
  >;
  relationships?: Customer360Relationship[];
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
          /**
           * WR-A8 review fix (no-swallow) — Başarısız rollback'lerin sayısı +
           * her satırın hata detayı. operator UI'da kısmi rollback bu alanlardan
           * okur.
           */
          errorCount?: number;
          failedRows?: Array<{
            rowNumber: number;
            errors: Array<{
              code: string;
              targetKey: string | null;
              label: string | null;
              message: string;
            }>;
          }>;
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

  // ─────────────────────────────────────────────────────────────
  // WR-A8 Phase 2a — Customer 360 (dry-run only)
  // ─────────────────────────────────────────────────────────────

  async customer360Schema(): Promise<Customer360SchemaResponse | undefined> {
    return apiFetch<Customer360SchemaResponse>(
      `${BASE}/targets/customer360/schema`,
      undefined,
      'Customer 360 şema okunamadı',
    );
  },

  async customer360AutoMap(input: {
    companyId: string;
    entity: string;
    columns: string[];
  }): Promise<{ ok: boolean; entity: string; suggestions: MappingItem[] } | undefined> {
    return postJson(`${BASE}/customer360/auto-map`, input, 'Otomatik eşleştirme başarısız');
  },

  async customer360Validate(input: {
    companyId: string;
    entity: string;
    mapping: MappingItem[];
  }): Promise<
    | { ok: boolean; entity: string; errors: MappingValidation['errors']; warnings: MappingValidation['warnings'] }
    | undefined
  > {
    return postJson(`${BASE}/customer360/validate`, input, 'Eşleştirme doğrulanamadı');
  },

  async customer360DryRun(input: {
    companyId: string;
    entities: Record<
      string,
      {
        columns: string[];
        mapping: MappingItem[];
        rows: Array<Record<string, unknown>>;
      }
    >;
    sourceMeta?: {
      sourceType: 'file' | 'api';
      fileName?: string | null;
      sourceUrlMasked?: string | null;
      dataPath?: string | null;
    };
  }): Promise<Customer360DryRunResponse | undefined> {
    return postJson(`${BASE}/customer360/dry-run`, input, 'Customer 360 dry-run başarısız');
  },

  async customer360Commit(input: {
    companyId: string;
    entities?: Record<
      string,
      { columns: string[]; mapping: MappingItem[]; rows: Array<Record<string, unknown>> }
    >;
    sourceMeta?: {
      sourceType: 'file' | 'api';
      fileName?: string | null;
      sourceUrlMasked?: string | null;
      dataPath?: string | null;
    };
    options?: { skipErrors?: boolean };
    jobId?: string;
  }): Promise<Customer360CommitResponse | undefined> {
    return postJson(`${BASE}/customer360/commit`, input, 'Customer 360 commit başarısız');
  },

  async customer360Rollback(jobId: string): Promise<Customer360RollbackResponse | undefined> {
    return postJson(`${BASE}/customer360/jobs/${encodeURIComponent(jobId)}/rollback`, {}, 'Customer 360 geri alma başarısız');
  },

  async customer360GetJob(jobId: string): Promise<Customer360JobDetail | undefined> {
    return apiFetch<Customer360JobDetail>(
      `${BASE}/customer360/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      'Customer 360 job okunamadı',
    );
  },

  async customer360GetJobRows(jobId: string, opts?: { entity?: string; status?: string; limit?: number; offset?: number }): Promise<{ value: Customer360JobRow[] } | undefined> {
    const qs = new URLSearchParams();
    if (opts?.entity) qs.set('entity', opts.entity);
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.offset) qs.set('offset', String(opts.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ value: Customer360JobRow[] }>(
      `${BASE}/customer360/jobs/${encodeURIComponent(jobId)}/rows${suffix}`,
      undefined,
      'Customer 360 job satırları okunamadı',
    );
  },
};

// ─────────────────────────────────────────────────────────────────
// WR-A8 Phase 2b — Customer 360 commit / rollback / job types
// ─────────────────────────────────────────────────────────────────

export interface Customer360EntityStats {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  error: number;
}

export interface Customer360JobDetail {
  id: string;
  companyId: string;
  targetType: 'customer360' | string;
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
  summaryJson?: unknown;
  entityCountsJson?: Record<string, Customer360EntityStats> | null;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rolledBackAt: string | null;
  rolledBackByUserId?: string | null;
}

export interface Customer360JobRow {
  id: string;
  rowNumber: number;
  entityType: string | null;
  parentRowNumber: number | null;
  relationshipKey: string | null;
  action: string;
  status: string;
  accountId: string | null;
  recordId: string | null;
  matchKey: string | null;
  errorsJson: unknown;
  warningsJson: unknown;
  normalizedJson: unknown;
  beforeJson: unknown;
  afterJson: unknown;
}

export interface Customer360CommitResponse {
  ok: boolean;
  job: Customer360JobDetail;
  runStats: { created: number; updated: number; skipped: number; error: number };
  entityCounts: Record<string, Customer360EntityStats>;
}

export interface Customer360RollbackResponse {
  ok: boolean;
  job: Pick<Customer360JobDetail, 'id' | 'status' | 'rolledBackAt'>;
  report: {
    rolledBackByEntity: Record<string, { rolledBack: number; failed: number; skipped: number }>;
    failedCount: number;
    errorCount?: number;
    failedRows: Array<{
      rowNumber: number;
      entity: string;
      errors: Array<{ code: string; targetKey: string | null; label: string | null; message: string }>;
    }>;
  };
}

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
