import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  aiErrorMessage,
  aiService,
  type AiError,
  type OperationsBaseRequest,
  type OperationsExplainResponse,
  type OperationsInsightBucket,
} from '@/services/aiService';
import type { DrilldownBucket } from '@/services/analyticsService';

interface ExplainMetricModalProps {
  open: boolean;
  metricKey: string | null;
  metricLabel: string;
  body: OperationsBaseRequest;
  onClose: () => void;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
}

/**
 * KPI tile "i" simgesi tıklandığında açılır. Aynı dashboard kapsamını
 * /api/ai/operations-explain-metric'e gönderir; formül/aciklama/öneri kartını
 * sunar. Önerilen drilldown butonları mevcut Phase 3 drawer'ı açar.
 */
export function ExplainMetricModal({
  open,
  metricKey,
  metricLabel,
  body,
  onClose,
  onOpenDrilldown,
}: ExplainMetricModalProps) {
  const [data, setData] = useState<OperationsExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AiError | null>(null);

  useEffect(() => {
    if (!open || !metricKey) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    void aiService.operationsExplainMetric({ ...body, metricKey }).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setData(r.data);
      } else {
        setError(r.error);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, metricKey, body]);

  function retry() {
    if (!metricKey) return;
    setLoading(true);
    setError(null);
    void aiService.operationsExplainMetric({ ...body, metricKey }).then((r) => {
      if (r.ok) setData(r.data);
      else setError(r.error);
      setLoading(false);
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={(
        <span className="inline-flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" />
          {metricLabel} — Açıklama
        </span>
      )}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Kapat</Button>
        </div>
      )}
    >
      {loading && (
        <div className="space-y-3">
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} />
        </div>
      )}

      {!loading && error && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
            <AlertTriangle size={14} className="mt-0.5" />
            <span>{aiErrorMessage(error)}</span>
          </div>
          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCw size={12} /> Tekrar dene
          </Button>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-4 text-sm">
          {data.explanation && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Açıklama</div>
              <p className="text-slate-700 dark:text-ndark-text">{data.explanation}</p>
            </div>
          )}

          {data.formula && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Formül</div>
              <code className="block whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-ndark-bg dark:text-ndark-text">
                {data.formula}
              </code>
            </div>
          )}

          {data.whatChanged && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Önceki döneme göre</div>
              <p className="text-slate-700 dark:text-ndark-text">{data.whatChanged}</p>
            </div>
          )}

          {data.watchouts.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Dikkat</div>
              <ul className="space-y-1">
                {data.watchouts.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-slate-700 dark:text-ndark-text">
                    <AlertTriangle size={11} className="mt-1 flex-shrink-0 text-amber-500" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.suggestedDrilldowns.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Önerilen drilldown</div>
              <div className="flex flex-wrap gap-2">
                {data.suggestedDrilldowns.map((sd, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const b = toDrilldownBucket(sd.bucket);
                      if (b) {
                        onOpenDrilldown(b, sd.label);
                        onClose();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-200 focus:outline-none focus:ring-brand-500 dark:bg-ndark-bg dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-card"
                  >
                    <ExternalLink size={11} />
                    {sd.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-400 dark:border-ndark-border dark:text-ndark-muted">
            Kapsam: {data.scope.narrative}
            {data.usageLogId && <> · usageLogId <code className="font-mono">{data.usageLogId}</code></>}
            {data.scope.kind === 'self' && (
              <Badge tint="slate" className="ml-2">Kişisel kapsam</Badge>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function toDrilldownBucket(b: OperationsInsightBucket): DrilldownBucket | null {
  if (!b || typeof b.kind !== 'string') return null;
  const keyless = new Set<DrilldownBucket['kind']>([
    'totalCases', 'createdInPeriod', 'resolvedInPeriod', 'openCases',
    'slaRiskCount', 'slaBreached', 'slaViolationRatePct', 'reopened',
    'reopenRatePct', 'escalationRatePct', 'transferRatePct', 'retentionSuccessPct',
  ]);
  const keyful = new Set<DrilldownBucket['kind']>(['status', 'priority', 'caseType', 'team', 'company', 'atRiskAccount']);
  if (keyless.has(b.kind as DrilldownBucket['kind'])) return { kind: b.kind as 'openCases', label: b.label };
  if (keyful.has(b.kind as DrilldownBucket['kind']) && typeof b.key === 'string' && b.key.length > 0) {
    return { kind: b.kind as 'status', key: b.key, label: b.label };
  }
  if (b.kind === 'category' && (typeof b.category === 'string' || typeof b.key === 'string')) {
    return {
      kind: 'category',
      category: (b.category ?? b.key) as string,
      subCategory: b.subCategory ?? null,
      label: b.label,
    };
  }
  return null;
}
