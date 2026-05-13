import { AlertTriangle, Info, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, type BadgeTint } from '@/components/ui/Badge';
import type {
  OperationsInsight,
  OperationsInsightBucket,
  OperationsInsightSeverity,
} from '@/services/aiService';
import type { DrilldownBucket } from '@/services/analyticsService';

interface RunaInsightCardProps {
  insight: OperationsInsight;
  onOpenDrilldown: (bucket: DrilldownBucket, title: string) => void;
}

const SEVERITY_TINT: Record<OperationsInsightSeverity, BadgeTint> = {
  info:     'sky',
  warning:  'amber',
  critical: 'rose',
};
const SEVERITY_LABEL: Record<OperationsInsightSeverity, string> = {
  info:     'Bilgi',
  warning:  'Uyarı',
  critical: 'Kritik',
};

const TYPE_LABEL: Record<string, string> = {
  'sla-anomaly':          'SLA Anomalisi',
  'backlog-buildup':      'Birikme',
  'repeated-issue':       'Tekrar Eden Sorun',
  'customer-risk-cluster':'Müşteri Risk Kümesi',
  'workload-imbalance':   'Yük Dengesizliği',
};

const SEVERITY_ICON: Record<OperationsInsightSeverity, React.ReactNode> = {
  info:     <Info size={14} />,
  warning:  <AlertTriangle size={14} />,
  critical: <ShieldAlert size={14} />,
};

export function RunaInsightCard({ insight, onOpenDrilldown }: RunaInsightCardProps) {
  const tint = SEVERITY_TINT[insight.severity];
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-md p-1.5 text-${tint === 'sky' ? 'sky' : tint}-700 bg-${tint}-50 dark:bg-${tint}-900/30 dark:text-${tint}-200`}>
            {SEVERITY_ICON[insight.severity]}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tint={tint}>{SEVERITY_LABEL[insight.severity]}</Badge>
              <Badge tint="slate">{TYPE_LABEL[insight.type] ?? insight.type}</Badge>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{insight.title}</h3>
            </div>
            {insight.narrative && (
              <p className="text-xs text-slate-600 dark:text-ndark-muted">{insight.narrative}</p>
            )}
            {insight.evidence.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {insight.evidence.map((ev, i) => (
                  <EvidenceChip
                    key={`${insight.id}-ev-${i}`}
                    label={ev.label}
                    value={ev.value}
                    bucket={ev.bucket}
                    onOpenDrilldown={onOpenDrilldown}
                  />
                ))}
              </div>
            )}
            {insight.suggestedAction && (
              <div className="flex items-start gap-1.5 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-700 dark:bg-ndark-bg/40 dark:text-ndark-text">
                <Lightbulb size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
                <span>{insight.suggestedAction}</span>
              </div>
            )}
            {insight.drilldown && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const bucket = toDrilldownBucket(insight.drilldown!);
                    if (bucket) onOpenDrilldown(bucket, insight.title);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-brand-300"
                >
                  <Sparkles size={11} />
                  Vakaları gör
                </button>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function EvidenceChip({
  label,
  value,
  bucket,
  onOpenDrilldown,
}: {
  label: string;
  value: string;
  bucket: OperationsInsightBucket | null;
  onOpenDrilldown: (b: DrilldownBucket, title: string) => void;
}) {
  const drill = bucket ? toDrilldownBucket(bucket) : null;
  const content = (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-500 dark:text-ndark-muted">{label}</span>
      <span className="font-semibold text-slate-800 dark:text-ndark-text">{value}</span>
    </span>
  );
  if (drill) {
    return (
      <button
        type="button"
        onClick={() => onOpenDrilldown(drill, label)}
        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs ring-1 ring-inset ring-slate-200 transition hover:bg-slate-200 focus:outline-none focus:ring-brand-500 dark:bg-ndark-bg dark:ring-ndark-border dark:hover:bg-ndark-card"
        title="Vakaları gör"
      >
        {content}
      </button>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs ring-1 ring-inset ring-slate-200 dark:bg-ndark-bg dark:ring-ndark-border">
      {content}
    </span>
  );
}

/**
 * AI'dan gelen "soft" bucket'i Phase 3 DrilldownBucket discriminated union'a daralt.
 */
function toDrilldownBucket(b: OperationsInsightBucket): DrilldownBucket | null {
  if (!b || typeof b.kind !== 'string') return null;
  const keylessKinds = new Set<DrilldownBucket['kind']>([
    'totalCases', 'createdInPeriod', 'resolvedInPeriod', 'openCases',
    'slaRiskCount', 'slaBreached', 'slaViolationRatePct', 'reopened',
    'reopenRatePct', 'escalationRatePct', 'transferRatePct', 'retentionSuccessPct',
  ]);
  const keyKinds = new Set<DrilldownBucket['kind']>(['status', 'priority', 'caseType', 'team', 'company', 'atRiskAccount']);
  if (keylessKinds.has(b.kind as DrilldownBucket['kind'])) {
    return { kind: b.kind as 'openCases', label: b.label };
  }
  if (keyKinds.has(b.kind as DrilldownBucket['kind']) && typeof b.key === 'string' && b.key.length > 0) {
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
