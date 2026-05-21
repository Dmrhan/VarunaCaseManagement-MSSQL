import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Database, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/services/AuthContext';
import { lookupService } from '@/services/caseService';
import {
  importService,
  type DryRunResponse,
  type ImportJob,
  type MappingItem,
  type MappingValidation,
  type TargetSchemaResponse,
} from '@/services/importService';
import { Stepper } from './dataImport/Stepper';
import { SourceStep } from './dataImport/SourceStep';
import { MappingStep } from './dataImport/MappingStep';
import { PreviewStep } from './dataImport/PreviewStep';
import { CommitStep } from './dataImport/CommitStep';
import { ResultStep } from './dataImport/ResultStep';
import { HistoryPanel } from './dataImport/HistoryPanel';
import { STEP_ORDER, type Step, type ParsedSource } from './dataImport/types';

/**
 * WR-A8 — Varuna Veri Aktarım Stüdyosu (Phase 1: Account only).
 *
 * Görsel ETL stilinde stepper UI:
 *   Kaynak Seç → Alanları Eşleştir → Doğrula → Ön İzleme → İçe Aktar → Sonuç
 *
 * Tüm operasyon BFF /api/admin/imports altından geçer; secret değerleri
 * BFF içinde resolve edilir, browser'a sızdırılmaz. Hard delete YOK.
 * Rollback: created → isActive=false, updated → beforeJson restore.
 */
export function AdminDataImportPage() {
  const { user } = useAuth();
  void user;

  const manageable = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState<string>('');
  const [schema, setSchema] = useState<TargetSchemaResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);

  const [step, setStep] = useState<Step>('source');
  const [completed, setCompleted] = useState<Set<Step>>(new Set());

  const [source, setSource] = useState<ParsedSource | null>(null);
  const [mapping, setMapping] = useState<MappingItem[]>([]);
  const [mappingValidation, setMappingValidation] = useState<MappingValidation | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [resultJob, setResultJob] = useState<ImportJob | null>(null);
  const [resultStats, setResultStats] = useState<{ createdCount: number; updatedCount: number; skippedCount: number; errorCount: number } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    if (!companyId && manageable.length > 0) {
      setCompanyId(manageable[0].id);
    }
  }, [companyId, manageable]);

  useEffect(() => {
    let alive = true;
    setSchemaLoading(true);
    void importService.schema().then((r) => {
      if (!alive) return;
      setSchema(r ?? null);
      setSchemaLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  function markCompleted(s: Step) {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(s);
      return next;
    });
  }

  function resetFlow() {
    setSource(null);
    setMapping([]);
    setMappingValidation(null);
    setDryRun(null);
    setResultJob(null);
    setResultStats(null);
    setStep('source');
    setCompleted(new Set());
  }

  // Source parsed → otomatik auto-map + adım 2'ye geç
  async function onSourceParsed(p: ParsedSource) {
    setSource(p);
    markCompleted('source');
    if (companyId && p.columns.length > 0) {
      const r = await importService.autoMap({ companyId, columns: p.columns });
      if (r) {
        setMapping(r.suggestions.filter((s) => s.targetKey !== null));
      }
    }
    setStep('map');
  }

  async function runDryRun() {
    if (!companyId || !source) return;
    setDryRunBusy(true);
    const r = await importService.dryRun({
      companyId,
      mapping,
      rows: source.rows,
      sourceMeta: {
        sourceType: source.sourceType,
        sourceName: source.sourceName,
        sourceUrlMasked: source.sourceUrlMasked,
        fileName: source.fileName,
        dataPath: source.dataPath,
      },
    });
    setDryRunBusy(false);
    if (!r) return;
    setDryRun(r);
    if (r.ok) {
      markCompleted('map');
      markCompleted('validate');
      setStep('preview');
    }
  }

  function onCommitDone(job: ImportJob, runStats: { createdCount: number; updatedCount: number; skippedCount: number; errorCount: number }) {
    setResultJob(job);
    setResultStats(runStats);
    markCompleted('preview');
    markCompleted('commit');
    setStep('result');
    setHistoryKey((k) => k + 1);
  }

  function openHistoryJob(j: ImportJob) {
    setResultJob(j);
    setResultStats(null);
    setStep('result');
    setCompleted(new Set(STEP_ORDER));
  }

  const canGoForward: Record<Step, boolean> = {
    source: !!source,
    map: !!source && (mappingValidation?.ok ?? false),
    validate: !!dryRun?.ok,
    preview: !!dryRun?.ok && (dryRun.summary?.errorCount ?? 0) < (dryRun.summary?.totalRows ?? 1),
    commit: !!resultJob,
    result: false,
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-ndark-text">
            <Database size={18} /> Veri Aktarım Stüdyosu
          </h2>
          <p className="text-xs text-slate-500 dark:text-ndark-muted">
            Müşteri verilerini Excel/CSV veya API üzerinden Varuna'ya güvenli, görsel ve geri alınabilir biçimde aktarın. Faz 1: müşteri (Account) hedefi.
          </p>
        </div>
        <Button variant="ghost" onClick={resetFlow}>
          <RefreshCcw size={12} />
          Sıfırla
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
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
                  ) : schemaLoading ? (
                    'Şema yükleniyor…'
                  ) : (
                    'Şema okunamadı.'
                  )}
                </div>
              </div>
              <Stepper
                current={step}
                completed={completed}
                onGo={(s) => setStep(s)}
              />
            </CardBody>
          </Card>

          {!companyId && (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-600 dark:text-ndark-muted">
                  Devam etmek için bir şirket seçin.
                </p>
              </CardBody>
            </Card>
          )}

          {companyId && schemaLoading && <Skeleton className="h-40 w-full" />}

          {companyId && schema && !schemaLoading && (
            <>
              {step === 'source' && (
                <SourceStep companyId={companyId} onParsed={onSourceParsed} />
              )}

              {step === 'map' && source && (
                <MappingStep
                  companyId={companyId}
                  schema={schema}
                  source={source}
                  mapping={mapping}
                  onChange={setMapping}
                  onValidationChange={setMappingValidation}
                />
              )}

              {step === 'validate' && source && (
                <MappingStep
                  companyId={companyId}
                  schema={schema}
                  source={source}
                  mapping={mapping}
                  onChange={setMapping}
                  onValidationChange={setMappingValidation}
                />
              )}

              {step === 'preview' && dryRun && (
                <PreviewStep dryRun={dryRun} onRerun={runDryRun} busy={dryRunBusy} />
              )}

              {step === 'commit' && dryRun && (
                <CommitStep companyId={companyId} dryRun={dryRun} onCompleted={onCommitDone} />
              )}

              {step === 'result' && resultJob && (
                <ResultStep
                  job={resultJob}
                  runStats={resultStats ?? undefined}
                  onNew={resetFlow}
                  onJobUpdated={(j) => {
                    setResultJob(j);
                    setHistoryKey((k) => k + 1);
                  }}
                />
              )}
            </>
          )}

          {/* Step nav footer */}
          {companyId && step !== 'source' && step !== 'result' && (
            <Card>
              <CardBody className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const i = STEP_ORDER.indexOf(step);
                    if (i > 0) setStep(STEP_ORDER[i - 1]);
                  }}
                >
                  <ArrowLeft size={12} />
                  Geri
                </Button>
                {step === 'map' && (
                  <Button onClick={runDryRun} disabled={dryRunBusy || !canGoForward.map}>
                    {dryRunBusy ? 'Doğrulanıyor…' : 'Doğrula ve Önizle'}
                    <ArrowRight size={12} />
                  </Button>
                )}
                {step === 'preview' && (
                  <Button
                    onClick={() => {
                      markCompleted('preview');
                      setStep('commit');
                    }}
                    disabled={!canGoForward.preview}
                  >
                    İçe Aktarım Adımına Geç
                    <ArrowRight size={12} />
                  </Button>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-3">
          {companyId && (
            <HistoryPanel
              companyId={companyId}
              onOpenJob={openHistoryJob}
              refreshKey={historyKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}
