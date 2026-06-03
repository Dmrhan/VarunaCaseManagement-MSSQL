import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Upload, Download, FileSpreadsheet, Globe2, RefreshCcw, ArrowRight, AlertCircle, AlertTriangle, CheckCircle2, Check } from 'lucide-react';
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
  type Customer360CommitResponse,
  type Customer360RollbackResponse,
  type MappingItem,
  CUSTOMER_360_ENTITY_KEYS,
} from '@/services/importService';
import { useToast } from '@/components/ui/Toast';
import { Rocket, Undo2 } from 'lucide-react';
import {
  buildCustomer360BundleFromMappings,
  flattenCustomer360Json,
  readCustomer360Workbook,
  suggestSheetMappings,
  type AutoSuggestResult,
  type Customer360Bundle,
  type LegacyInfo,
  type RawSheet,
  type SheetMappingChoice,
} from './parsers';
import { SheetMappingStep } from './SheetMappingStep';
import { downloadCustomer360Template } from './templateGenerator';
import { RelationshipGraph } from './RelationshipGraph';
import { MappingFieldSelect } from '../MappingFieldSelect';
import { HistoryPanel } from '../HistoryPanel';
import { cn } from '@/components/ui/cn';
import type { ImportJob } from '@/services/importService';

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
 * WR-A8 — Customer 360 import workspace.
 *
 * Source → entity-aware mapping → dry-run preview → confirm → commit
 * (dependency-ordered) → result panel + rollback action. Dry-run is
 * always required before commit; commit/rollback semantics live in
 * server/lib/import/customer360CommitEngine.js.
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
    legacy?: LegacyInfo;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Sheet Mapping Wizard state — populated for XLSX uploads. API source
  // skips this stage and produces a bundle directly.
  const [rawSheets, setRawSheets] = useState<RawSheet[] | null>(null);
  const [sheetSuggested, setSheetSuggested] = useState<AutoSuggestResult | null>(null);
  const [sheetMappings, setSheetMappings] = useState<Record<string, SheetMappingChoice>>({});

  const [mappingByEntity, setMappingByEntity] = useState<Record<string, MappingItem[]>>({});
  const [selectedEntity, setSelectedEntity] = useState<Customer360EntityKey | null>('account');
  const [dryRun, setDryRun] = useState<Customer360DryRunResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // WR-A8 Phase 2b — commit + rollback state.
  const [skipErrors, setSkipErrors] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commitResult, setCommitResult] = useState<Customer360CommitResponse | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<Customer360RollbackResponse | null>(null);
  // Customer 360 import geçmişi (Phase 2b sonrası eklendi).
  // Aynı oturumdaki commitResult'a ek olarak ESKİ Customer 360 job'ları
  // listelenir ve completed/partial olanlar için "Geri Al" aksiyonu
  // sunulur. Backend `POST /customer360/jobs/:id/rollback` kullanılır;
  // Phase 1 account import'tan ayrı (targetType=customer360 filtreli).
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyRollbackJob, setHistoryRollbackJob] = useState<ImportJob | null>(null);
  const [historyRollbackBusy, setHistoryRollbackBusy] = useState(false);
  const [historyRollbackResult, setHistoryRollbackResult] = useState<Customer360RollbackResponse | null>(null);
  const { toast } = useToast();

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
    setCommitResult(null);
    setRollbackResult(null);
    setConfirmCommit(false);
    setConfirmRollback(false);
    setRawSheets(null);
    setSheetSuggested(null);
    setSheetMappings({});
  }

  // WR-A8 Phase 2b — commit / rollback handlers
  async function runCommit() {
    if (!companyId || !sourceMeta) return;
    setCommitting(true);
    const payload: Record<string, { columns: string[]; mapping: MappingItem[]; rows: Array<Record<string, unknown>> }> = {};
    for (const e of CUSTOMER_360_ENTITY_KEYS) {
      payload[e] = {
        columns: bundle[e].columns,
        mapping: mappingByEntity[e] ?? [],
        rows: bundle[e].rows,
      };
    }
    const r = await importService.customer360Commit({
      companyId,
      entities: payload,
      sourceMeta,
      options: { skipErrors },
    });
    setCommitting(false);
    setConfirmCommit(false);
    if (!r) return;
    setCommitResult(r);
    setRollbackResult(null);
    // Codex P2 — Customer 360 commit yeni bir job yaratır; history paneli
    // o job'ı görsün diye refreshKey'i bump et. Rollback yollarında zaten
    // bump var; commit yolu da artık simetrik.
    setHistoryRefreshKey((k) => k + 1);
    const stats = r.runStats;
    toast({
      type: r.job.status === 'completed' ? 'success' : r.job.status === 'partial' ? 'warn' : 'error',
      message: `İçe aktarım ${r.job.status === 'completed' ? 'tamamlandı' : r.job.status === 'partial' ? 'kısmen tamamlandı' : 'başarısız'} · ${stats.created} oluşturuldu, ${stats.updated} güncellendi${stats.error > 0 ? `, ${stats.error} hata` : ''}`,
      duration: 6000,
    });
  }

  async function runRollback() {
    if (!commitResult?.job?.id) return;
    setRollbackBusy(true);
    const r = await importService.customer360Rollback(commitResult.job.id);
    setRollbackBusy(false);
    setConfirmRollback(false);
    if (!r) return;
    setRollbackResult(r);
    setHistoryRefreshKey((k) => k + 1);
    const failed = r.report.failedCount;
    toast({
      type: failed === 0 ? 'success' : 'warn',
      message: failed === 0
        ? 'Customer 360 aktarımı geri alındı.'
        : `Customer 360 geri alma kısmi — ${failed} satır geri alınamadı.`,
      duration: failed === 0 ? 4500 : 7000,
    });
  }

  // Geçmiş listesinden rollback. Aynı backend endpoint kullanılır
  // (POST /api/admin/imports/customer360/jobs/:id/rollback). Phase 1
  // rollback fonksiyonu (importService.rollback) ÇAĞRILMAZ.
  async function runHistoryRollback() {
    const job = historyRollbackJob;
    if (!job) return;
    setHistoryRollbackBusy(true);
    const r = await importService.customer360Rollback(job.id);
    setHistoryRollbackBusy(false);
    if (!r) return;
    setHistoryRollbackResult(r);
    setHistoryRefreshKey((k) => k + 1);
    const failed = r.report.failedCount;
    toast({
      type: failed === 0 ? 'success' : 'warn',
      message: failed === 0
        ? `Customer 360 aktarımı geri alındı (${job.fileName ?? job.sourceName ?? job.id}).`
        : `Customer 360 geri alma kısmi — ${failed} satır geri alınamadı.`,
      duration: failed === 0 ? 4500 : 7000,
    });
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

  function resetWizardDownstream() {
    setMappingByEntity({});
    setSelectedEntity('account');
    setDryRun(null);
    setCommitResult(null);
    setRollbackResult(null);
    setConfirmCommit(false);
    setConfirmRollback(false);
  }

  function onSheetsParsed(
    sheets: RawSheet[],
    meta: {
      sourceType: 'file' | 'api';
      fileName: string | null;
      sourceUrlMasked: string | null;
      dataPath: string | null;
    },
    suggested: AutoSuggestResult,
  ) {
    setRawSheets(sheets);
    setSheetSuggested(suggested);
    setSheetMappings(suggested.perSheet);
    setSourceMeta(meta);
    setBundle(emptyBundle());
    setParseInfo(null);
    resetWizardDownstream();
  }

  async function onSheetMappingConfirm() {
    if (!rawSheets) return;
    const { bundle: b, perEntityOverflow, legacyInfo } = buildCustomer360BundleFromMappings(
      rawSheets,
      sheetMappings,
      ROW_CAPS,
    );
    // Sheets the user left without entities AND without "Atla" → unmapped.
    const unmappedSheets = rawSheets
      .filter((s) => {
        const m = sheetMappings[s.sheetName];
        return !m || (!m.skip && m.entities.length === 0);
      })
      .map((s) => s.sheetName);
    setBundle(b);
    setParseInfo({
      unmappedSheets,
      overflow: perEntityOverflow,
      legacy: legacyInfo ?? undefined,
    });
    // Clear the wizard so the field-mapping panels take over. Keep
    // sheetSuggested/sheetMappings for "Geri" later (not used yet).
    setRawSheets(null);
    resetWizardDownstream();
    await autoMapAll(b);
  }

  function onResetSheetSuggestions() {
    if (!rawSheets) return;
    const fresh = suggestSheetMappings(rawSheets);
    setSheetSuggested(fresh);
    setSheetMappings(fresh.perSheet);
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
      legacy?: LegacyInfo;
    },
  ) {
    setBundle(b);
    setSourceMeta(meta);
    setParseInfo(info);
    setRawSheets(null);
    setSheetSuggested(null);
    setSheetMappings({});
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
            Müşteri ana kartı, ilişkili şirket, iletişim, adres ve proje verisini birlikte yükleyin. Dry-run sonrası güvenli commit ve rollback desteklenir.
          </p>
        </div>
        <Button variant="ghost" onClick={resetFlow}>
          <RefreshCcw size={12} />
          Sıfırla
        </Button>
      </header>

      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-700/40 dark:bg-sky-900/20 dark:text-sky-200">
        Önce dry-run ile etkiyi doğrulayın. Uygun satırlar commit edilebilir; commit sonrası rollback ile geri alınabilir.
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
              <FileSourcePanel onSheets={onSheetsParsed} />
            ) : (
              <ApiSourcePanel companyId={companyId} onBundle={onBundleParsed} />
            )}

            {rawSheets && sheetSuggested && (
              <SheetMappingStep
                sheets={rawSheets}
                suggested={sheetSuggested}
                mappings={sheetMappings}
                onChange={setSheetMappings}
                onReset={onResetSheetSuggestions}
                onConfirm={() => void onSheetMappingConfirm()}
              />
            )}

            {parseError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
                {parseError}
              </div>
            )}
            {parseInfo?.legacy && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200">
                <div>
                  <strong>Eski müşteri listesi formatı algılandı ve Customer 360 formatına dönüştürüldü.</strong>
                </div>
                <div className="mt-1">
                  {parseInfo.legacy.accountsSource} → Accounts/Companies, Detaylar → Contacts/Projects
                </div>
                <div className="mt-1 text-[11px] text-emerald-700/90 dark:text-emerald-200/90">
                  Üretilen kayıtlar: Accounts {parseInfo.legacy.generatedCounts.account} · Companies{' '}
                  {parseInfo.legacy.generatedCounts.accountCompany} · Contacts{' '}
                  {parseInfo.legacy.generatedCounts.accountContact} · Projects{' '}
                  {parseInfo.legacy.generatedCounts.accountProject} · Addresses{' '}
                  {parseInfo.legacy.generatedCounts.accountAddress}
                </div>
                {parseInfo.legacy.ignoredFallback && (
                  <div className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-200/80">
                    Not: "{parseInfo.legacy.ignoredFallback}" sayfası göz ardı edildi ("
                    {parseInfo.legacy.accountsSource}" tercih edildi).
                  </div>
                )}
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

            {/* WR-A8 Phase 2b — Commit panel */}
            {dryRun && dryRun.commitAvailable && !commitResult && (
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex items-start gap-2">
                    <Rocket size={18} className="mt-0.5 text-brand-500" />
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
                        Customer 360 Aktarımına Hazır
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-ndark-muted">
                        {dryRun.summary && (
                          <>
                            Toplam {dryRun.summary.totalRows} satır:
                            {' '}
                            <strong>{dryRun.summary.byEntity?.account?.total ?? 0}</strong> müşteri,
                            {' '}
                            <strong>{dryRun.summary.byEntity?.accountCompany?.total ?? 0}</strong> şirket ilişkisi,
                            {' '}
                            <strong>{dryRun.summary.byEntity?.accountContact?.total ?? 0}</strong> iletişim,
                            {' '}
                            <strong>{dryRun.summary.byEntity?.accountAddress?.total ?? 0}</strong> adres,
                            {' '}
                            <strong>{dryRun.summary.byEntity?.accountProject?.total ?? 0}</strong> proje.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  {(dryRun.summary?.totalErrors ?? 0) > 0 && (
                    <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                      <input
                        type="checkbox"
                        checked={skipErrors}
                        onChange={(e) => setSkipErrors(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Hatalı satırları atla ve geçerli olanları aktar.</strong>{' '}
                        {dryRun.summary?.totalErrors} hatalı satır mevcut. İşaretsiz bırakırsanız aktarım bloklanır.
                      </span>
                    </label>
                  )}
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted">
                    <AlertTriangle size={12} className="mr-1 inline" />
                    Bu işlem müşteri ilişkileri, kişiler, adresler ve projeler üzerinde değişiklik yapar.
                    Aktarım sonrası tek tıkla geri alınabilir (rollback).
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setConfirmCommit(true)} disabled={committing}>
                      <Rocket size={12} />
                      Customer 360 Aktarımını Başlat
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}

            {confirmCommit && !commitResult && (
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex items-start gap-2 text-xs text-slate-700 dark:text-ndark-muted">
                    <AlertCircle size={16} className="mt-0.5 text-amber-500" />
                    <span>
                      Onayladığınızda Customer 360 aktarımı başlar. Aktarım sonucu sayfada gösterilir.{' '}
                      İhtiyaç olursa "Bu Aktarımı Geri Al" butonu kullanılabilir.
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => setConfirmCommit(false)} disabled={committing}>
                      Vazgeç
                    </Button>
                    <Button onClick={runCommit} disabled={committing}>
                      {committing ? 'Aktarılıyor…' : 'Evet, Başlat'}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}

            {commitResult && (
              <CommitResultCard
                commit={commitResult}
                rollback={rollbackResult}
                onRollbackClick={() => setConfirmRollback(true)}
                onConfirmRollback={runRollback}
                rollbackBusy={rollbackBusy}
                confirming={confirmRollback}
                onCancelConfirm={() => setConfirmRollback(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Customer 360 import history — targetType=customer360 filtered;
          Phase 1 account history is rendered separately in
          AdminDataImportPage and never appears here. */}
      {companyId && (
        <HistoryPanel
          companyId={companyId}
          targetType="customer360"
          title="Customer 360 Aktarım Geçmişi"
          refreshKey={historyRefreshKey}
          onOpenJob={() => {
            /* placeholder — Customer 360'ta job detayı henüz ayrı sayfa
               olarak yok; satır click no-op. Rollback action butonu
               üzerinden tetiklenir. */
          }}
          renderActions={(j) => {
            const status = j.status;
            const canRollback = status === 'completed' || status === 'partial';
            if (canRollback) {
              return (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryRollbackJob(j);
                    setHistoryRollbackResult(null);
                  }}
                  className="flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-700/40 dark:bg-ndark-card dark:text-rose-300 dark:hover:bg-rose-900/20"
                >
                  <Undo2 size={11} />
                  Geri Al
                </button>
              );
            }
            if (status === 'rolled_back') {
              return (
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted">
                  Geri alındı
                </span>
              );
            }
            if (status === 'rollback_partial') {
              return (
                <span
                  title={
                    j.errorCount > 0
                      ? `${j.errorCount} satır geri alınamadı`
                      : 'Kısmi geri alma — bazı satırlar geri alınamadı'
                  }
                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200"
                >
                  Kısmi geri alma{j.errorCount > 0 ? ` · ${j.errorCount} satır` : ''}
                </span>
              );
            }
            // draft / validated / running / failed → aksiyon yok
            return null;
          }}
        />
      )}

      {historyRollbackJob && (
        <HistoryRollbackConfirmCard
          job={historyRollbackJob}
          companyName={manageable.find((c) => c.id === historyRollbackJob.companyId)?.name}
          busy={historyRollbackBusy}
          result={historyRollbackResult}
          onCancel={() => {
            setHistoryRollbackJob(null);
            setHistoryRollbackResult(null);
          }}
          onConfirm={runHistoryRollback}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Commit result card (with rollback)
// ─────────────────────────────────────────────────────────────────

function CommitResultCard({
  commit,
  rollback,
  onRollbackClick,
  onConfirmRollback,
  rollbackBusy,
  confirming,
  onCancelConfirm,
}: {
  commit: Customer360CommitResponse;
  rollback: Customer360RollbackResponse | null;
  onRollbackClick: () => void;
  onConfirmRollback: () => void;
  rollbackBusy: boolean;
  confirming: boolean;
  onCancelConfirm: () => void;
}) {
  const job = commit.job;
  const entityCounts = commit.entityCounts;
  const canRollback = (job.status === 'completed' || job.status === 'partial') && !rollback;

  const STATUS_TONE: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    failed: 'bg-rose-100 text-rose-700',
    rolled_back: 'bg-slate-200 text-slate-700',
    rollback_partial: 'bg-amber-100 text-amber-700',
  };
  const STATUS_LABEL: Record<string, string> = {
    completed: 'Tamamlandı',
    partial: 'Kısmen tamamlandı',
    failed: 'Başarısız',
    rolled_back: 'Geri alındı',
    rollback_partial: 'Geri alma kısmi',
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
              Customer 360 Aktarım Sonucu
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Job <code className="font-mono">{job.id}</code>
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[job.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {(Object.entries(entityCounts) as Array<[string, Customer360EntityStatsLocal]>).map(([ek, s]) => (
            <div
              key={ek}
              className={cn(
                'rounded-md border p-2 text-xs',
                s.error > 0
                  ? 'border-rose-200 bg-rose-50 dark:border-rose-700/40 dark:bg-rose-900/20'
                  : 'border-emerald-200 bg-emerald-50 dark:border-emerald-700/40 dark:bg-emerald-900/20',
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-ndark-muted">{ek}</div>
              <div className="text-base font-bold">
                {s.created}+ {s.updated}↺
              </div>
              <div className="text-[10px] text-slate-600">
                toplam {s.total}{s.skipped > 0 ? ` · ${s.skipped} atlandı` : ''}{s.error > 0 ? ` · ${s.error} hata` : ''}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canRollback && (
            <Button variant="danger" onClick={onRollbackClick} disabled={rollbackBusy}>
              <Undo2 size={12} />
              Bu Aktarımı Geri Al
            </Button>
          )}
          {rollback && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
              <Check size={12} />
              Geri alındı: {job.rolledBackAt ? new Date(job.rolledBackAt).toLocaleString('tr-TR') : 'şimdi'}
            </span>
          )}
        </div>

        {confirming && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs dark:border-rose-700/40 dark:bg-rose-900/20">
            <div className="mb-2 flex items-start gap-2 text-rose-800 dark:text-rose-200">
              <AlertCircle size={14} className="mt-0.5" />
              <div>
                <div className="text-sm font-semibold">
                  Bu işlem yalnız aşağıdaki Customer 360 import job'ını geri alır.
                </div>
                <div className="mt-0.5">
                  Account/AccountCompany güncellemeleri eski değerlerine döner; oluşturulan iletişim, adres ve projeler pasife alınır. Başka bir job etkilenmez.
                </div>
              </div>
            </div>

            <div className="mb-2 rounded-md border border-rose-200 bg-white/80 p-2.5 text-[11px] text-slate-700 dark:border-rose-700/40 dark:bg-ndark-card dark:text-ndark-muted">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div>
                  <span className="font-medium">Job:</span>{' '}
                  <code className="font-mono">{job.id}</code>
                </div>
                <div>
                  <span className="font-medium">Şirket:</span>{' '}
                  <code className="font-mono">{job.companyId}</code>
                </div>
                <div>
                  <span className="font-medium">Kaynak:</span>{' '}
                  {job.fileName ?? job.sourceName ?? (job.sourceUrlMasked ? 'API' : '—')}
                </div>
                <div>
                  <span className="font-medium">Durum:</span>{' '}
                  {STATUS_LABEL[job.status] ?? job.status}
                </div>
                <div>
                  <span className="font-medium">Commit:</span>{' '}
                  {job.completedAt ? new Date(job.completedAt).toLocaleString('tr-TR') : '—'}
                </div>
                <div>
                  <span className="font-medium">Toplam satır:</span>{' '}
                  {job.totalRows}
                </div>
              </div>
              <div className="mt-1.5">
                <span className="font-medium">Entity sayıları:</span>{' '}
                {(Object.entries(entityCounts) as Array<[string, Customer360EntityStatsLocal]>)
                  .map(([ek, s]) => `${ek} +${s.created} ↺${s.updated}`)
                  .join(' · ')}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onCancelConfirm} disabled={rollbackBusy}>
                Vazgeç
              </Button>
              <Button variant="danger" onClick={onConfirmRollback} disabled={rollbackBusy}>
                {rollbackBusy ? 'Geri alınıyor…' : 'Evet, Geri Al'}
              </Button>
            </div>
          </div>
        )}

        {rollback && rollback.report.failedCount > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
            <div className="mb-1 font-semibold">
              {rollback.report.failedCount} satır geri alınamadı (rollback_error)
            </div>
            <ul className="ml-3 list-disc">
              {rollback.report.failedRows.slice(0, 10).map((fr, i) => (
                <li key={i}>
                  <strong>{fr.entity} #{fr.rowNumber}:</strong> {fr.errors[0]?.message ?? 'Bilinmeyen hata'}
                </li>
              ))}
              {rollback.report.failedRows.length > 10 && (
                <li className="text-[10px]">… ve {rollback.report.failedRows.length - 10} satır daha</li>
              )}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

interface Customer360EntityStatsLocal {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  error: number;
}

// ───────────────────────────────────────────────────────
// File source (multi-sheet XLSX)
// ───────────────────────────────────────────────────────

function FileSourcePanel({
  onSheets,
}: {
  onSheets: (
    sheets: RawSheet[],
    meta: { sourceType: 'file' | 'api'; fileName: string | null; sourceUrlMasked: string | null; dataPath: string | null },
    suggested: AutoSuggestResult,
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  async function handleDownloadTemplate() {
    setTemplateError(null);
    setTemplateBusy(true);
    try {
      await downloadCustomer360Template();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Şablon oluşturulamadı.');
    } finally {
      setTemplateBusy(false);
    }
  }

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
      const { sheets, suggested } = await readCustomer360Workbook(file);
      onSheets(
        sheets,
        { sourceType: 'file', fileName: file.name, sourceUrlMasked: null, dataPath: null },
        suggested,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya okunamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
          Doldurulmuş şablon ile başlamak ister misiniz?
        </div>
        <button
          type="button"
          onClick={() => void handleDownloadTemplate()}
          disabled={templateBusy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
        >
          <Download size={12} />
          {templateBusy ? 'Hazırlanıyor…' : 'Şablon İndir'}
        </button>
      </div>
      {templateError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
          {templateError}
        </div>
      )}
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
    info: {
      unmappedSheets?: string[];
      overflow?: Array<{ entity: Customer360EntityKey; count: number; max: number }>;
      legacy?: LegacyInfo;
    },
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
                  <MappingFieldSelect
                    value={cur}
                    onChange={(v) => onUpdate(col, v)}
                    options={entityDesc.fields.map((f) => ({
                      value: f.key,
                      label: f.label,
                      required: !!f.required,
                      pii: !!f.pii,
                      description: f.description,
                    }))}
                  />
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
  const commitReady = dryRun.commitAvailable === true;
  const hasErrors = (summary?.totalErrors ?? 0) > 0;

  return (
    <Card>
      <CardBody className="space-y-3">
        {commitReady ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200">
            <CheckCircle2 size={14} className="mt-0.5" />
            <div>
              <strong>Commit hazır.</strong> Dry-run tamamlandı. Aşağıdaki "Customer 360 Aktarımını Başlat" butonunu kullanın.
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertCircle size={14} className="mt-0.5" />
            <div>
              {hasErrors
                ? 'Commit için dry-run hataları giderilmeli.'
                : (banner || 'Dry-run sonucu commit için uygun değil.')}
            </div>
          </div>
        )}

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

// ─────────────────────────────────────────────────────────────────
// History rollback confirmation card
// ─────────────────────────────────────────────────────────────────
//
// Geçmiş listesinden seçilen Customer 360 job'ı için onay paneli +
// rollback sonucu özeti. Backend `POST /customer360/jobs/:id/rollback`
// endpoint'ini importService.customer360Rollback üzerinden çağırır.

function HistoryRollbackConfirmCard({
  job,
  companyName,
  busy,
  result,
  onCancel,
  onConfirm,
}: {
  job: ImportJob;
  companyName: string | undefined;
  busy: boolean;
  result: Customer360RollbackResponse | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sourceLabel = job.fileName ?? job.sourceName ?? 'aktarım';
  const dateLabel = new Date(job.createdAt).toLocaleString('tr-TR');
  const finalStatus = result?.job?.status ?? null;
  const failed = result?.report?.failedCount ?? 0;
  const failedRows = result?.report?.failedRows ?? [];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-700/40 dark:bg-rose-900/20">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" />
          <div className="space-y-1 text-xs text-rose-900 dark:text-rose-200">
            <div className="font-semibold">Customer 360 aktarımını geri al</div>
            <div>
              Bu işlem yalnız bu Customer 360 aktarım job'ını geri alır.
              Aynı şirketteki diğer aktarımlar ve Phase 1 Müşteri Ana Kartı
              aktarımları etkilenmez.
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Job ID</dt>
            <dd className="truncate font-mono text-slate-800 dark:text-ndark-text">{job.id}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Kaynak</dt>
            <dd className="truncate text-slate-800 dark:text-ndark-text">{sourceLabel}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Tarih</dt>
            <dd className="text-slate-800 dark:text-ndark-text">{dateLabel}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Şirket</dt>
            <dd className="truncate text-slate-800 dark:text-ndark-text">
              {companyName ?? job.companyId}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Oluşturulan</dt>
            <dd className="text-slate-800 dark:text-ndark-text">{job.createCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Güncellenen</dt>
            <dd className="text-slate-800 dark:text-ndark-text">{job.updateCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Atlanan</dt>
            <dd className="text-slate-800 dark:text-ndark-text">{job.skippedCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-ndark-muted">Hatalı</dt>
            <dd className="text-slate-800 dark:text-ndark-text">{job.errorCount}</dd>
          </div>
        </dl>

        {!result && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={busy}>
              <Undo2 size={12} />
              {busy ? 'Geri alınıyor…' : 'Evet, Geri Al'}
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-xs',
                finalStatus === 'rolled_back'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200',
              )}
            >
              {finalStatus === 'rolled_back'
                ? 'Customer 360 aktarımı tamamen geri alındı.'
                : `Customer 360 geri alma kısmi tamamlandı — ${failed} satır geri alınamadı.`}
            </div>
            {failedRows.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] dark:border-rose-700/40 dark:bg-rose-900/20">
                <div className="mb-1 font-semibold text-rose-900 dark:text-rose-200">
                  İlk {Math.min(10, failedRows.length)} hatalı satır
                </div>
                <ul className="space-y-1 text-rose-900 dark:text-rose-200">
                  {failedRows.slice(0, 10).map((r, i) => (
                    <li key={`${r.entity}-${r.rowNumber}-${i}`}>
                      <span className="font-mono">[{r.entity} #{r.rowNumber}]</span>{' '}
                      {(r.errors[0]?.message) ?? 'hata'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onCancel}>
                Kapat
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
