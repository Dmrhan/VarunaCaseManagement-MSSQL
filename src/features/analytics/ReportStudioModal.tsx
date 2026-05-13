import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Printer, RefreshCw, Sparkles, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  aiErrorMessage,
  aiService,
  type AiError,
  type OperationsBaseRequest,
  type OperationsReportResponse,
} from '@/services/aiService';
import type { OperationsOverviewResponse } from '@/services/analyticsService';
import { ReportPreview } from './ReportPreview';
import {
  buildReportMarkdown,
  type ReportFilterSummary,
  type ReportSectionToggles,
} from './reportMarkdownBuilder';

interface ReportStudioModalProps {
  open: boolean;
  overview: OperationsOverviewResponse | null;
  body: OperationsBaseRequest;
  statusLabels: Record<string, string>;
  priorityLabels: Record<string, string>;
  caseTypeLabels: Record<string, string>;
  /** Phase 4a'da çağrılmış AI rapor draft (varsa); studio AI section default'u olarak kullanır. */
  seedReport: OperationsReportResponse | null;
  onClose: () => void;
}

const DEFAULT_SECTIONS: ReportSectionToggles = {
  kpis: true,
  timeSeries: true,
  breakdowns: true,
  riskAccounts: true,
  aiNarrative: true,
  appendix: true,
};

export function ReportStudioModal({
  open,
  overview,
  body,
  statusLabels,
  priorityLabels,
  caseTypeLabels,
  seedReport,
  onClose,
}: ReportStudioModalProps) {
  const [title, setTitle] = useState('Operasyon Raporu');
  const [sections, setSections] = useState<ReportSectionToggles>(DEFAULT_SECTIONS);
  const [ai, setAi] = useState<OperationsReportResponse | null>(seedReport);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<AiError | null>(null);
  const [copied, setCopied] = useState(false);

  // Modal acildiginda seed'i tazele; filtre degistiginde modal'i kapatip
  // tekrar acmak temiz state verir, ama acikken filtre degisirse de seed yenilenir.
  useEffect(() => {
    setAi(seedReport);
    setAiError(null);
  }, [seedReport, body.from, body.to]);

  const filters: ReportFilterSummary = useMemo(() => ({
    from: body.from,
    to: body.to,
    statuses: body.statuses ?? null,
    caseTypes: body.caseTypes ?? null,
    productGroups: body.productGroups ?? null,
  }), [body.from, body.to, body.statuses, body.caseTypes, body.productGroups]);

  function toggle(section: keyof ReportSectionToggles) {
    setSections((cur) => ({ ...cur, [section]: !cur[section] }));
  }

  function regenerateAi() {
    if (!overview) return;
    setAiLoading(true);
    setAiError(null);
    void aiService.operationsReportDraft(body).then((r) => {
      if (r.ok) setAi(r.data);
      else setAiError(r.error);
      setAiLoading(false);
    });
  }

  async function copyMarkdown() {
    if (!overview) return;
    const md = buildReportMarkdown({
      title,
      overview,
      ai,
      sections,
      filters,
      statusLabels,
      priorityLabels,
      caseTypeLabels,
    });
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sessiz fallback
    }
  }

  function printReport() {
    window.print();
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      height="92vh"
      bodyClassName="report-no-print flex min-h-0 flex-1 flex-col p-0"
      title={(
        <span className="inline-flex items-center gap-2">
          <FileText size={14} className="text-violet-500" />
          Rapor Studio
        </span>
      )}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2 report-no-print">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
            {overview && (
              <>
                <Badge tint="slate" className="font-normal">{overview.scope.narrative}</Badge>
                <span>·</span>
                <span>Formül {overview.formulaVersion}</span>
                {overview.metricAuditId && (
                  <>
                    <span>·</span>
                    <span>Audit <code className="font-mono">{overview.metricAuditId}</code></span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={copyMarkdown} disabled={!overview}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Kopyalandı' : 'Markdown kopyala'}
            </Button>
            <Button size="sm" variant="outline" onClick={printReport} disabled={!overview}>
              <Printer size={12} /> Yazdır / PDF
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              <X size={12} /> Kapat
            </Button>
          </div>
        </div>
      )}
    >
      {!overview ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500 dark:text-ndark-muted">
          Dashboard verisi henüz yüklenmedi.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="w-60 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/40 p-4 dark:border-ndark-border dark:bg-ndark-bg/30">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                  Rapor başlığı
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                />
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                  Bölümler
                </div>
                <ul className="mt-1 space-y-1.5">
                  <SectionToggle label="Anahtar metrikler" checked={sections.kpis} onChange={() => toggle('kpis')} />
                  <SectionToggle label="Günlük trend" checked={sections.timeSeries} onChange={() => toggle('timeSeries')} />
                  <SectionToggle label="Kırılımlar" checked={sections.breakdowns} onChange={() => toggle('breakdowns')} />
                  <SectionToggle label="Riskli müşteriler" checked={sections.riskAccounts} onChange={() => toggle('riskAccounts')} />
                  <SectionToggle label="AI özet" checked={sections.aiNarrative} onChange={() => toggle('aiNarrative')} />
                  <SectionToggle label="Ek (appendix)" checked={sections.appendix} onChange={() => toggle('appendix')} />
                </ul>
              </div>

              {sections.aiNarrative && (
                <div className="rounded-md bg-violet-50 px-3 py-2 text-xs dark:bg-violet-900/20">
                  <div className="mb-1 flex items-center gap-1 font-semibold text-violet-800 dark:text-violet-200">
                    <Sparkles size={11} /> AI Özet
                  </div>
                  <Button size="sm" variant="outline" onClick={regenerateAi} disabled={aiLoading}>
                    {aiLoading ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {ai ? 'Yenile' : 'Üret'}
                  </Button>
                  {aiError && (
                    <div className="mt-2 text-rose-700 dark:text-rose-300">{aiErrorMessage(aiError)}</div>
                  )}
                </div>
              )}

              <div className="rounded-md bg-slate-100/80 px-3 py-2 text-[11px] text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted">
                Sayılar deterministic kaynak metriklerden gelir. AI yalnızca anlatım üretir; sayısal değer kullanılan dashboard verisinden bağımsız değildir.
              </div>
            </div>
          </aside>

          <div className="flex-1 overflow-y-auto bg-slate-100/40 p-4 dark:bg-ndark-bg/30">
            <ReportPreview
              title={title}
              overview={overview}
              ai={ai}
              aiLoading={aiLoading}
              aiError={aiError ? aiErrorMessage(aiError) : null}
              sections={sections}
              filters={filters}
              statusLabels={statusLabels}
              priorityLabels={priorityLabels}
              caseTypeLabels={caseTypeLabels}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function SectionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border"
        />
        {label}
      </label>
    </li>
  );
}
