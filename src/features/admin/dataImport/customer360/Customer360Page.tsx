import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Upload, FileSpreadsheet, Globe2, RefreshCcw, ArrowRight, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/services/AuthContext';
import { lookupService } from '@/services/caseService';
import {
  importService,
  type Customer360DryRunResponse,
  type Customer360EntityKey,
  type Customer360SchemaResponse,
  type MappingItem,
  CUSTOMER_360_ENTITY_KEYS,
} from '@/services/importService';
import {
  flattenCustomer360Json,
  parseCustomer360Xlsx,
  type Customer360Bundle,
} from './parsers';
import { RelationshipGraph } from './RelationshipGraph';
import { cn } from '@/components/ui/cn';

const ROW_CAPS: Record<Customer360EntityKey, number> = {
  account: 5000,
  accountCompany: 10000,
  accountContact: 10000,
  accountAddress: 10000,
  accountProject: 10000,
};

function emptyBundle(): Customer360Bundle {
  return {
    account: { columns: [], rows: [], sample: [], totalRows: 0 },
    accountCompany: { columns: [], rows: [], sample: [], totalRows: 0 },
    accountContact: { columns: [], rows: [], sample: [], totalRows: 0 },
    accountAddress: { columns: [], rows: [], sample: [], totalRows: 0 },
    accountProject: { columns: [], rows: [], sample: [], totalRows: 0 },
  };
}

/**
 * WR-A8 Phase 2a — Customer 360 dry-run-only workspace.
 *
 * Source → entity-aware mapping → dry-run impact preview. No commit, no
 * rollback. Banner explicitly says commitAvailable=false. Phase 2b adds
 * commit + rollback.
 */
export function Customer360Page() {
  const { user } = useAuth();
  void user;
  const manageable = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState<string>('');
  const [schema, setSchema] = useState<Customer360SchemaResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);

  const [sourceMode, setSourceMode] = useState<'file' | 'api'>('file');
  const [bundle, setBundle] = useState<Customer360Bundle>(emptyBundle);
  const [sourceMeta, setSourceMeta] = useState<{
    sourceType: 'file' | 'api';
    fileName: string | null;
    sourceUrlMasked: string | null;
    dataPath: string | null;
  } | null>(null);
  const [parseInfo, setParseInfo] = useState<{
    unmappedSheets?: string[];
    overflow?: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [mappingByEntity, setMappingByEntity] = useState<Record<string, MappingItem[]>>({});
  const [selectedEntity, setSelectedEntity] = useState<Customer360EntityKey | null>('account');
  const [dryRun, setDryRun] = useState<Customer360DryRunResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId && manageable.length > 0) setCompanyId(manageable[0].id);
  }, [companyId, manageable]);

  useEffect(() => {
    let alive = true;
    setSchemaLoading(true);
    void importService.customer360Schema().then((r) => {
      if (!alive) return;
      setSchema(r ?? null);
      setSchemaLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  function resetFlow() {
    setBundle(emptyBundle());
    setSourceMeta(null);
    setParseInfo(null);
    setParseError(null);
    setMappingByEntity({});
    setDryRun(null);
    setSelectedEntity('account');
  }

  async function autoMapAll(b: Customer360Bundle) {
    if (!schema || !companyId) return;
    const next: Record<string, MappingItem[]> = {};
    await Promise.all(
      CUSTOMER_360_ENTITY_KEYS.map(async (e) => {
        const block = b[e];
        if (block.columns.length === 0) {
          next[e] = [];
          return;
        }
        const r = await importService.customer360AutoMap({
          companyId,
          entity: e,
          columns: block.columns,
        });
        next[e] = r?.suggestions.filter((s) => s.targetKey !== null) ?? [];
      }),
    );
    setMappingByEntity(next);
  }

  async function onBundleParsed(
    b: Customer360Bundle,
    meta: {
      sourceType: 'file' | 'api';
      fileName: string | null;
      sourceUrlMasked: string | null;
      dataPath: string | null;
    },
    info: {
      unmappedSheets?: string[];
      overflow?: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
    },
  ) {
    setBundle(b);
    setSourceMeta(meta);
    setParseInfo(info);
    setDryRun(null);
    await autoMapAll(b);
  }

  async function runDryRun() {
    if (!companyId || !sourceMeta) return;
    setBusy(true);
    const payload: Record<string, { columns: string[]; mapping: MappingItem[]; rows: Array<Record<string, unknown>> }> = {};
    for (const e of CUSTOMER_360_ENTITY_KEYS) {
      payload[e] = {
        columns: bundle[e].columns,
        mapping: mappingByEntity[e] ?? [],
        rows: bundle[e].rows,
      };
    }
    const r = await importService.customer360DryRun({
      companyId,
      entities: payload,
      sourceMeta,
    });
    setBusy(false);
    if (!r) return;
    setDryRun(r);
  }

  function updateMapping(entity: Customer360EntityKey, source: string, targetKey: string | null) {
    setMappingByEntity((prev) => {
      const cur = prev[entity] ?? [];
      const next: MappingItem[] = [];
      let touched = false;
      for (const m of cur) {
        if (m.source === source) {
          if (targetKey !== null) next.push({ source, targetKey });
          touched = true;
        } else {
          next.push(m);
        }
      }
      if (!touched && targetKey !== null) next.push({ source, targetKey });
      return { ...prev, [entity]: next };
    });
  }

  const hasSource = (bundle.account.totalRows ?? 0) > 0;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-ndark-text">
            <Database size={18} /> Müşteri 360 İçe Aktarım
          </h2>
          <p className="text-xs text-slate-500 dark:text-ndark-muted">
            Müşteri ana kartı, ilişkili şirket, iletişim, adres ve proje verisini birlikte yükleyin. Bu sayfa Phase 2a'dır — yalnız doğrulama ve dry-run sağlar.
          </p>
        </div>
        <Button variant="ghost" onClick={resetFlow}>
          <RefreshCcw size={12} />
          Sıfırla
        </Button>
      </header>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
        <strong>Phase 2a:</strong> Bu sayfa Customer 360 verisini doğrular ve dry-run önizlemesi sağlar. Gerçek aktarım Phase 2b'de eklenecektir. Bu adımda DB'ye hiçbir kayıt yazılmaz.
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Şirket" className="min-w-[220px]" required>
              <Select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  resetFlow();
                }}
              >
                <option value="">— şirket seçin —</option>
                {manageable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex-1 text-[11px] text-slate-500 dark:text-ndark-muted">
              {schema ? (
                <>
                  Hedef şema: <strong>{schema.target}</strong> · {schema.version}
                </>
              ) : schemaLoading ? 'Şema yükleniyor…' : 'Şema okunamadı.'}
            </div>
          </div>
        </CardBody>
      </Card>

      {!companyId && (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">Devam etmek için şirket seçin.</p>
          </CardBody>
        </Card>
      )}

      {companyId && schemaLoading && <Skeleton className="h-40 w-full" />}

      {companyId && schema && !schemaLoading && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSourceMode('file')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                  sourceMode === 'file'
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-text dark:border-ndark-accent'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
                }`}
              >
                <FileSpreadsheet size={14} /> Multi-sheet XLSX
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('api')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                  sourceMode === 'api'
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-text dark:border-ndark-accent'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
                }`}
              >
                <Globe2 size={14} /> Nested API JSON
              </button>
            </div>

            {sourceMode === 'file' ? (
              <FileSourcePanel onBundle={onBundleParsed} />
            ) : (
              <ApiSourcePanel companyId={companyId} onBundle={onBundleParsed} />
            )}

            {parseError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
                {parseError}
              </div>
            )}
            {parseInfo?.unmappedSheets && parseInfo.unmappedSheets.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                <strong>Atlanan sayfalar:</strong> {parseInfo.unmappedSheets.join(', ')} (entity isimleriyle eşleşmedi).
              </div>
            )}
            {parseInfo?.overflow && parseInfo.overflow.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                {parseInfo.overflow.map((o) => (
                  <div key={o.entity}>
                    <strong>{o.entity}:</strong> {o.count} satır {o.max} limitini aştı.
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {hasSource && schema && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardBody className="space-y-2">
              <RelationshipGraph
                schema={schema}
                bundle={bundle}
                dryRun={dryRun}
                selected={selectedEntity}
                onSelect={setSelectedEntity}
              />
            </CardBody>
          </Card>

          <div className="space-y-3">
            {selectedEntity && (
              <EntityMappingCard
                schema={schema}
                entity={selectedEntity}
                bundle={bundle}
                mapping={mappingByEntity[selectedEntity] ?? []}
                onUpdate={(source, targetKey) => updateMapping(selectedEntity, source, targetKey)}
              />
            )}

            <Card>
              <CardBody className="flex items-center justify-end gap-2">
                <Button onClick={runDryRun} disabled={busy}>
                  {busy ? 'Doğrulanıyor…' : 'Doğrula ve Dry-run'}
                  <ArrowRight size={12} />
                </Button>
              </CardBody>
            </Card>

            {dryRun && <DryRunSummaryCard dryRun={dryRun} schema={schema} selectedEntity={selectedEntity} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────
// File source (multi-sheet XLSX)
// ───────────────────────────────────────────────────────

function FileSourcePanel({
  onBundle,
}: {
  onBundle: (
    b: Customer360Bundle,
    meta: { sourceType: 'file' | 'api'; fileName: string | null; sourceUrlMasked: string | null; dataPath: string | null },
    info: { unmappedSheets?: string[]; overflow?: Array<{ entity: Customer360EntityKey; count: number; max: number }> },
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setPicked({ name: file.name, size: file.size });
    const lower = file.name.toLowerCase();
    if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls'))) {
      setError('Yalnız XLSX dosyaları desteklenir.');
      return;
    }
    setBusy(true);
    try {
      const { bundle, unmappedSheets, perEntityOverflow } = await parseCustomer360Xlsx(file, ROW_CAPS);
      onBundle(
        bundle,
        { sourceType: 'file', fileName: file.name, sourceUrlMasked: null, dataPath: null },
        { unmappedSheets, overflow: perEntityOverflow },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya okunamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center hover:border-brand-400 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-surface"
      >
        <Upload size={24} className="text-slate-400" />
        <div className="text-sm font-medium text-slate-700 dark:text-ndark-text">5 sheetli XLSX yükleyin</div>
        <div className="text-[10px] text-slate-500">Accounts · Companies · Contacts · Addresses · Projects</div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {picked && (
        <div className="text-[11px] text-slate-600 dark:text-ndark-muted">
          {picked.name} · {(picked.size / 1024).toFixed(1)} KB
        </div>
      )}
      {busy && <div className="text-xs text-slate-500">Dosya işleniyor…</div>}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────
// API source (nested JSON via BFF outbound)
// ───────────────────────────────────────────────────────

function ApiSourcePanel({
  companyId,
  onBundle,
}: {
  companyId: string;
  onBundle: (
    b: Customer360Bundle,
    meta: { sourceType: 'file' | 'api'; fileName: string | null; sourceUrlMasked: string | null; dataPath: string | null },
    info: { unmappedSheets?: string[]; overflow?: Array<{ entity: Customer360EntityKey; count: number; max: number }> },
  ) => void;
}) {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [authType, setAuthType] = useState<'none' | 'bearerToken' | 'apiKeyHeader'>('none');
  const [secretName, setSecretName] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [dataPath, setDataPath] = useState('accounts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSample() {
    setError(null);
    if (!url.trim()) {
      setError('URL gerekli.');
      return;
    }
    let headersJson: Record<string, string> | null = null;
    if (headersText.trim()) {
      try {
        headersJson = JSON.parse(headersText);
      } catch {
        setError('Headers JSON çözümlenemedi.');
        return;
      }
    }
    let bodyJson: unknown = undefined;
    if (method === 'POST' && bodyText.trim()) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        setError('Body JSON çözümlenemedi.');
        return;
      }
    }
    setBusy(true);
    // Reuse Phase 1 sampleApi for outbound (returns full rows). dataPath
    // taking us to the accounts array. The response.rows is the flat
    // accounts array; we then nest-flatten on the client.
    const r = await importService.sampleApi({
      companyId,
      url: url.trim(),
      method,
      authType,
      secretName: secretName.trim() || undefined,
      headersJson,
      bodyJson,
      dataPath: dataPath.trim() || null,
      sampleLimit: 50,
    });
    setBusy(false);
    if (!r) return;
    if (!r.ok) {
      setError(r.message ?? 'API çağrısı başarısız.');
      return;
    }
    const rows = r.rows ?? r.sample ?? [];
    // Re-wrap as { accounts: [...] } so flatten handles it uniformly.
    const { bundle, perEntityOverflow } = flattenCustomer360Json({ accounts: rows }, ROW_CAPS);
    onBundle(
      bundle,
      {
        sourceType: 'api',
        fileName: null,
        sourceUrlMasked: r.sourceUrlMasked ?? null,
        dataPath: dataPath.trim() || null,
      },
      { overflow: perEntityOverflow },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="URL" className="md:col-span-2" required>
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/customers" />
      </Field>
      <Field label="Metot">
        <Select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </Select>
      </Field>
      <Field label="Yetkilendirme">
        <Select value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)}>
          <option value="none">Yok</option>
          <option value="bearerToken">Bearer Token</option>
          <option value="apiKeyHeader">X-API-Key Header</option>
        </Select>
      </Field>
      <Field label="Secret Env Adı" hint="Anahtar burada saklanmaz. Sunucu env değişkeni adı.">
        <TextInput value={secretName} onChange={(e) => setSecretName(e.target.value)} disabled={authType === 'none'} />
      </Field>
      <Field label="dataPath" hint='Yanıttaki accounts array yolu (örn. "accounts" veya "data").'>
        <TextInput value={dataPath} onChange={(e) => setDataPath(e.target.value)} placeholder="accounts" />
      </Field>
      <Field label="Headers (JSON)" className="md:col-span-2">
        <TextArea rows={2} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder='{}' />
      </Field>
      {method === 'POST' && (
        <Field label="Body (JSON)" className="md:col-span-2">
          <TextArea rows={3} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
        </Field>
      )}
      <div className="md:col-span-2 flex items-center gap-2">
        <Button onClick={fetchSample} disabled={busy || !url.trim()}>
          {busy ? 'Çekiliyor…' : 'API Verisini Getir'}
        </Button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────
// Entity mapping card
// ───────────────────────────────────────────────────────

function EntityMappingCard({
  schema,
  entity,
  bundle,
  mapping,
  onUpdate,
}: {
  schema: Customer360SchemaResponse;
  entity: Customer360EntityKey;
  bundle: Customer360Bundle;
  mapping: MappingItem[];
  onUpdate: (source: string, targetKey: string | null) => void;
}) {
  const entityDesc = schema.entities.find((e) => e.entity === entity);
  const block = bundle[entity];
  if (!entityDesc) return null;
  const mappedSet = new Set(mapping.map((m) => m.source));
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{entityDesc.label}</h3>
            <p className="text-[11px] text-slate-500 dark:text-ndark-muted">{entityDesc.description}</p>
          </div>
          <span className="text-[10px] text-slate-500">{block.totalRows} satır · {block.columns.length} sütun</span>
        </div>
        {block.columns.length === 0 ? (
          <p className="text-xs text-slate-500">Bu entity için kaynak veride sütun yok.</p>
        ) : (
          <ul className="space-y-2">
            {block.columns.map((col) => {
              const cur = mapping.find((m) => m.source === col)?.targetKey ?? '';
              const samples = block.sample
                .slice(0, 3)
                .map((r) => r[col])
                .filter((v) => v !== null && v !== undefined && v !== '');
              return (
                <li
                  key={col}
                  className={cn(
                    'rounded-md border p-2 text-xs',
                    cur
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-900/10'
                      : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{col}</div>
                      {samples.length > 0 && (
                        <div className="line-clamp-1 text-[10px] text-slate-500">
                          {samples.map((s) => String(s)).join(' · ')}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">{mappedSet.has(col) ? 'eşlendi' : 'boşta'}</span>
                  </div>
                  <Select
                    className="text-xs"
                    value={cur}
                    onChange={(e) => onUpdate(col, e.target.value || null)}
                  >
                    <option value="">— eşleşmedi —</option>
                    {entityDesc.fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} {f.required ? '·zorunlu' : ''} {f.pii ? '·PII' : ''}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ───────────────────────────────────────────────────────
// Dry-run summary card
// ───────────────────────────────────────────────────────

function DryRunSummaryCard({
  dryRun,
  schema,
  selectedEntity,
}: {
  dryRun: Customer360DryRunResponse;
  schema: Customer360SchemaResponse;
  selectedEntity: Customer360EntityKey | null;
}) {
  const summary = dryRun.summary;
  const banner = dryRun.message;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800 dark:border-sky-700/40 dark:bg-sky-900/20 dark:text-sky-200">
          <CheckCircle2 size={14} className="mt-0.5" />
          <div>
            <strong>Dry-run yalnız Phase 2a.</strong> {banner} commitAvailable={String(dryRun.commitAvailable)}.
          </div>
        </div>

        {dryRun.code === 'tckn_import_blocked' && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
            <div className="font-semibold">TCKN import yasak</div>
            <ul className="ml-4 list-disc">
              {(dryRun.tcknLeaks ?? []).map((leak, i) => (
                <li key={i}>
                  <strong>{leak.entity}:</strong> {leak.columns.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dryRun.code === 'too_many_rows' && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
            <div className="font-semibold">Satır limiti aşıldı</div>
            <ul className="ml-4 list-disc">
              {(dryRun.tooManyRows ?? []).map((o, i) => (
                <li key={i}>
                  <strong>{o.entity}:</strong> {o.count} / {o.max}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {Object.entries(summary.byEntity).map(([ek, s]) => {
                const entityDesc = schema.entities.find((e) => e.entity === ek);
                return (
                  <div
                    key={ek}
                    className={cn(
                      'rounded-md border p-2 text-xs',
                      s.error > 0
                        ? 'border-rose-200 bg-rose-50 dark:border-rose-700/40 dark:bg-rose-900/20'
                        : s.warning > 0
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-900/20'
                          : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card',
                    )}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{entityDesc?.label ?? ek}</div>
                    <div className="text-base font-bold">{s.total}</div>
                    <div className="text-[10px] text-slate-600">
                      {s.create}+ · {s.update}↺ · {s.error}✗
                      {s.warning > 0 ? ` · ${s.warning}⚠` : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              {Object.entries(summary.completenessScore).map(([k, slice]) => (
                <div key={k} className="rounded-md border border-violet-200 bg-violet-50 p-2 text-xs text-violet-800 dark:border-violet-700/40 dark:bg-violet-900/20 dark:text-violet-200">
                  <div className="text-[10px] font-medium uppercase tracking-wider opacity-80">{k}</div>
                  <div className="text-base font-bold">%{slice.pct}</div>
                  <div className="text-[10px]">{slice.have} / {slice.total}</div>
                </div>
              ))}
            </div>

            {dryRun.skipErrorsPreview && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs dark:border-ndark-border dark:bg-ndark-surface">
                <div className="mb-1 font-semibold text-slate-700 dark:text-ndark-text">skipErrors önizleme (Phase 2b'de aktif olacak):</div>
                <div className="flex items-start gap-1.5 text-slate-700 dark:text-ndark-muted">
                  {dryRun.skipErrorsPreview.blockedIfSkipErrorsFalse ? (
                    <>
                      <AlertCircle size={12} className="mt-0.5 text-rose-500" />
                      <span>
                        <code>skipErrors=false</code> ile commit bloklanırdı (hatalı satırlar mevcut).
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={12} className="mt-0.5 text-emerald-500" />
                      <span><code>skipErrors=false</code> ile commit ilerleyebilirdi.</span>
                    </>
                  )}
                </div>
                <div className="mt-1 flex items-start gap-1.5 text-slate-700 dark:text-ndark-muted">
                  <AlertTriangle size={12} className="mt-0.5 text-amber-500" />
                  <span>
                    <code>skipErrors=true</code> ile cascading skip:
                    {' '}
                    {Object.entries(dryRun.skipErrorsPreview.cascadingSkipIfSkipErrorsTrue)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ') || 'hiçbir satır atlanmaz.'}
                  </span>
                </div>
              </div>
            )}

            {selectedEntity && dryRun.preview?.[selectedEntity] && (
              <div className="rounded-md border border-slate-200 dark:border-ndark-border">
                <div className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold dark:border-ndark-border dark:bg-ndark-surface">
                  {schema.entities.find((e) => e.entity === selectedEntity)?.label} — ilk {dryRun.preview[selectedEntity].length} satır
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-ndark-surface">
                      <tr className="text-left">
                        <th className="px-2 py-1">#</th>
                        <th className="px-2 py-1">Eylem</th>
                        <th className="px-2 py-1">Sorun</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dryRun.preview[selectedEntity].map((r) => (
                        <tr key={r.rowNumber} className="border-t border-slate-100 dark:border-ndark-border">
                          <td className="px-2 py-1 text-slate-500">{r.rowNumber}</td>
                          <td className="px-2 py-1">
                            <span
                              className={cn(
                                'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                                r.action === 'create' && 'bg-emerald-100 text-emerald-700',
                                r.action === 'update' && 'bg-sky-100 text-sky-700',
                                r.action === 'error' && 'bg-rose-100 text-rose-700',
                                r.action === 'skip' && 'bg-slate-100 text-slate-600',
                              )}
                            >
                              {r.action}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-slate-700">{r.errors[0]?.message ?? r.warnings[0]?.message ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
