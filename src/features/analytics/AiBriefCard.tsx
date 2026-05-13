import { AlertTriangle, Lightbulb, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { aiErrorMessage, type AiError, type OperationsBriefResponse } from '@/services/aiService';

interface AiBriefCardProps {
  data: OperationsBriefResponse | null;
  loading: boolean;
  error: AiError | null;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * Yönetici özetini dashboard'da inline render eden kart.
 * RunaCommandStrip butonundan tetiklenir; veri gelene kadar skeleton,
 * hata durumunda tekrar dene + dismiss.
 */
export function AiBriefCard({ data, loading, error, onRetry, onDismiss }: AiBriefCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
            {data?.brief.title ?? 'Yönetici Özeti'}
          </h2>
          {data && <Badge tint="violet" className="font-normal">Runa AI</Badge>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-ndark-muted dark:hover:bg-ndark-bg"
          aria-label="Özeti kapat"
        >
          <X size={14} />
        </button>
      </CardHeader>
      <CardBody>
        {loading && (
          <div className="space-y-2">
            <Skeleton height={12} />
            <Skeleton height={12} />
            <Skeleton height={12} />
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
              <AlertTriangle size={14} className="mt-0.5" />
              <span>{aiErrorMessage(error)}</span>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw size={12} /> Tekrar dene
            </Button>
          </div>
        )}

        {!loading && data && (
          <div className="space-y-3 text-sm">
            {data.brief.summary && (
              <p className="text-slate-700 dark:text-ndark-text">{data.brief.summary}</p>
            )}

            {data.brief.bullets.length > 0 && (
              <ul className="space-y-1">
                {data.brief.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-slate-700 dark:text-ndark-text">
                    <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-violet-400" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            {(data.brief.risks.length > 0 || data.brief.recommendedActions.length > 0) && (
              <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2">
                {data.brief.risks.length > 0 && (
                  <div className="rounded-md bg-rose-50/60 px-3 py-2 dark:bg-rose-900/20">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-200">
                      <ShieldAlert size={11} /> Riskler
                    </div>
                    <ul className="space-y-1">
                      {data.brief.risks.map((r, i) => (
                        <li key={i} className="text-xs text-rose-900 dark:text-rose-100">— {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.brief.recommendedActions.length > 0 && (
                  <div className="rounded-md bg-emerald-50/60 px-3 py-2 dark:bg-emerald-900/20">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                      <Lightbulb size={11} /> Önerilen aksiyonlar
                    </div>
                    <ul className="space-y-1">
                      {data.brief.recommendedActions.map((a, i) => (
                        <li key={i} className="text-xs text-emerald-900 dark:text-emerald-100">— {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-ndark-border dark:text-ndark-muted">
              Kapsam: {data.scope.narrative} · Formül {data.formulaVersion}
              {data.usageLogId && <> · usageLogId <code className="font-mono">{data.usageLogId}</code></>}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
