import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Lightbulb, ListChecks, RefreshCw, Search, Sparkles, Target, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  aiErrorMessage,
  aiService,
  type AiError,
  type DrilldownAssistAnswer,
  type DrilldownAssistMode,
  type DrilldownAssistResponse,
  type OperationsBaseRequest,
  type OperationsInsightBucket,
} from '@/services/aiService';
import type { DrilldownBucket } from '@/services/analyticsService';

interface DrilldownAssistantCardProps {
  /** Drawer'in mevcut bucket'i. Asistant aynisini AI'a iletecek. */
  bucket: DrilldownBucket | null;
  /** Dashboard'un guncel filtre body'si. */
  body: OperationsBaseRequest;
  /** Drawer'da goz onunde olan vaka numaralari — AI cevabindaki caseNumbers ile match icin parent kullanir. */
  onAnswerChange: (answer: DrilldownAssistAnswer | null) => void;
  /** Phase 3 drilldown navigation — evidence chip'leri buradan acilir. */
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
}

const MODE_BUTTONS: Array<{ key: DrilldownAssistMode; label: string; icon: React.ReactNode }> = [
  { key: 'summarize',  label: 'Özetle',         icon: <Sparkles size={12} /> },
  { key: 'prioritize', label: 'Önceliklendir',  icon: <ListChecks size={12} /> },
  { key: 'rootCause',  label: 'Kök neden',      icon: <Wrench size={12} /> },
  { key: 'nextAction', label: 'Aksiyon öner',   icon: <Target size={12} /> },
];

export function DrilldownAssistantCard({ bucket, body, onAnswerChange, onOpenDrilldown }: DrilldownAssistantCardProps) {
  const [answer, setAnswer] = useState<DrilldownAssistResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const [activeMode, setActiveMode] = useState<DrilldownAssistMode | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  function run(mode: DrilldownAssistMode, customPrompt?: string) {
    if (!bucket) return;
    setLoading(true);
    setError(null);
    setActiveMode(mode);
    void aiService
      .operationsDrilldownAssist({
        ...body,
        bucket: bucketToInsightBucket(bucket),
        mode,
        ...(customPrompt ? { customPrompt } : {}),
      })
      .then((r) => {
        if (r.ok) {
          setAnswer(r.data);
          onAnswerChange(r.data.answer);
        } else {
          setError(r.error);
          setAnswer(null);
          onAnswerChange(null);
        }
        setLoading(false);
      });
  }

  function clear() {
    setAnswer(null);
    setError(null);
    setActiveMode(null);
    setCustomText('');
    setCustomOpen(false);
    onAnswerChange(null);
  }

  function retryLast() {
    if (activeMode) run(activeMode, activeMode === 'custom' ? customText : undefined);
  }

  function submitCustom() {
    const trimmed = customText.trim();
    if (!trimmed) return;
    run('custom', trimmed.slice(0, 500));
  }

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2.5 dark:border-violet-800/40 dark:bg-violet-900/15">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          <Sparkles size={12} /> Runa AI · Drilldown
        </span>
        {MODE_BUTTONS.map((m) => (
          <Button
            key={m.key}
            size="sm"
            variant={activeMode === m.key ? 'primary' : 'outline'}
            onClick={() => run(m.key)}
            disabled={loading || !bucket}
          >
            {loading && activeMode === m.key ? <RefreshCw size={12} className="animate-spin" /> : m.icon}
            {m.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={customOpen ? 'primary' : 'outline'}
          onClick={() => setCustomOpen((v) => !v)}
          disabled={!bucket}
        >
          <Search size={12} />
          Soru sor
          {customOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </Button>
        {(answer || error) && (
          <button
            type="button"
            onClick={clear}
            className="ml-auto inline-flex items-center gap-1 rounded text-xs text-slate-500 hover:text-slate-700 dark:text-ndark-muted dark:hover:text-ndark-text"
            title="Asistant cevabini temizle"
          >
            <X size={12} /> Temizle
          </button>
        )}
      </div>

      {customOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value.slice(0, 500))}
            placeholder="Bu liste hakkinda kisa bir soru sor (max 500 karakter)…"
            className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCustom();
            }}
            disabled={loading}
          />
          <Button size="sm" variant="primary" onClick={submitCustom} disabled={loading || !customText.trim()}>
            {loading && activeMode === 'custom' ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Cevap üret
          </Button>
        </div>
      )}

      {loading && !answer && (
        <div className="mt-3 space-y-1.5">
          <Skeleton height={10} />
          <Skeleton height={10} />
          <Skeleton height={10} />
        </div>
      )}

      {!loading && error && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
          <AlertTriangle size={12} className="mt-0.5" />
          <span className="flex-1">{aiErrorMessage(error)}</span>
          <button type="button" onClick={retryLast} className="font-medium underline">
            Tekrar dene
          </button>
        </div>
      )}

      {!loading && answer && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{answer.answer.title}</div>
          {answer.answer.summary && (
            <p className="text-slate-700 dark:text-ndark-text">{answer.answer.summary}</p>
          )}

          {answer.answer.bullets.length > 0 && (
            <ul className="space-y-0.5">
              {answer.answer.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5 text-slate-700 dark:text-ndark-text">
                  <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-violet-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {(answer.answer.risks.length > 0 || answer.answer.recommendedActions.length > 0) && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {answer.answer.risks.length > 0 && (
                <div className="rounded bg-rose-50/60 px-2 py-1.5 dark:bg-rose-900/20">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-200">Riskler</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {answer.answer.risks.map((r, i) => (
                      <li key={i} className="text-rose-900 dark:text-rose-100">— {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {answer.answer.recommendedActions.length > 0 && (
                <div className="rounded bg-emerald-50/60 px-2 py-1.5 dark:bg-emerald-900/20">
                  <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    <Lightbulb size={10} /> Aksiyonlar
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {answer.answer.recommendedActions.map((a, i) => (
                      <li key={i} className="text-emerald-900 dark:text-emerald-100">— {a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {answer.answer.evidence.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                Evidence
              </div>
              <div className="flex flex-wrap gap-1.5">
                {answer.answer.evidence.map((ev, i) => (
                  <EvidenceChip
                    key={`ev-${i}`}
                    label={ev.label}
                    value={ev.value}
                    caseNumbers={ev.caseNumbers}
                    drilldown={ev.drilldown}
                    onOpenDrilldown={onOpenDrilldown}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-violet-200/60 pt-1.5 text-[10px] text-slate-500 dark:border-violet-800/30 dark:text-ndark-muted">
            <Badge tint="slate" className="font-normal">{answer.bucket.label ?? answer.bucket.kind}</Badge>
            <span>·</span>
            <span>{answer.total} vaka (örnek {answer.rowCount})</span>
            {answer.usageLogId && (
              <>
                <span>·</span>
                <span>usageLogId <code className="font-mono">{answer.usageLogId}</code></span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceChip({
  label,
  value,
  caseNumbers,
  drilldown,
  onOpenDrilldown,
}: {
  label: string;
  value: string;
  caseNumbers: string[];
  drilldown: OperationsInsightBucket | null;
  onOpenDrilldown: (b: DrilldownBucket, title: string) => void;
}) {
  const drill = drilldown ? toDrilldownBucket(drilldown) : null;
  const valueText = value || (caseNumbers.length > 0 ? `${caseNumbers.length}` : '');
  const tooltip = caseNumbers.length > 0 ? `Vakalar: ${caseNumbers.join(', ')}` : undefined;

  const content = (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-500 dark:text-ndark-muted">{label}</span>
      <span className="font-semibold text-slate-800 dark:text-ndark-text">{valueText}</span>
    </span>
  );

  if (drill) {
    return (
      <button
        type="button"
        onClick={() => onOpenDrilldown(drill, label)}
        title={tooltip}
        className="rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-inset ring-slate-200 transition hover:bg-slate-100 focus:outline-none focus:ring-brand-500 dark:bg-ndark-card dark:ring-ndark-border dark:hover:bg-ndark-bg"
      >
        {content}
      </button>
    );
  }
  return (
    <span
      className="rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-inset ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border"
      title={tooltip}
    >
      {content}
    </span>
  );
}

// ---- helpers ----

function bucketToInsightBucket(b: DrilldownBucket): OperationsInsightBucket {
  // DrilldownBucket discriminated union -> AI service'in kabul ettigi serbest bucket
  const out: OperationsInsightBucket = { kind: b.kind };
  if ('key' in b && b.key) out.key = b.key;
  if ('category' in b && b.category) out.category = b.category;
  if ('subCategory' in b && b.subCategory) out.subCategory = b.subCategory ?? undefined;
  if ('label' in b && b.label) out.label = b.label;
  return out;
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
