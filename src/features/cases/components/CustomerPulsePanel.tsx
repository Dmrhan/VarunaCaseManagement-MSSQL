import { useEffect, useState } from 'react';
import { HeartPulse, ShieldAlert, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { caseService } from '@/services/caseService';
import { aiService } from '@/services/aiService';
import type { CustomerPulse, CustomerPulseState } from '@/features/cases/types';

/**
 * Customer Pulse — shared component (CaseDetailPage + NewCaseForm).
 *
 * Source variants:
 *  - `{ kind: 'case', caseId }` — case-based; AI upgrade default-on
 *  - `{ kind: 'account', accountId, companyId }` — yeni vaka açılışında;
 *    deterministic only (caseId yok, AI route caseId-bound log yapıyor)
 *
 * `skipAi` ile zorla deterministic kalınabilir (account variant'ta default true).
 *
 * Davranış:
 *  - Self-fetch via caseService
 *  - AI upgrade non-blocking (case-only)
 *  - Fail edince panel gizlenir (apiFetch zaten toast atar)
 *  - "Standart özet (AI önerisi alınamadı)" amber rozet AI fail durumunda
 */

type Source =
  | { kind: 'case'; caseId: string }
  | { kind: 'account'; accountId: string; companyId: string };

interface CustomerPulsePanelProps {
  source: Source;
  /** AI upgrade'i devre dışı bırak (account variant'ta zaten devre dışı). */
  skipAi?: boolean;
  /**
   * Sayısal metric chip'leri render etme şekli.
   *  - 'chips' (default): MetricChip pill'leri (Açık 2 · SLA 1 · Eskale 1 …)
   *  - 'summary': Tek satır sönük metin (LBD baseline — Case Detail kullanımı).
   * Diğer çağrı yerleri (Smart Ticket drawer) default 'chips' ile korunur.
   */
  metricsLayout?: 'chips' | 'summary';
}

const PULSE_STATE_META: Record<
  CustomerPulseState,
  { label: string; pill: string; dot: string; ringClass: string }
> = {
  Stable: {
    label: 'Stabil',
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    ringClass: 'ring-slate-200 dark:ring-ndark-border',
  },
  Watch: {
    label: 'İzlemede',
    pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    dot: 'bg-blue-500',
    ringClass: 'ring-slate-200 dark:ring-ndark-border',
  },
  Risky: {
    label: 'Riskli',
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    dot: 'bg-amber-500',
    ringClass: 'ring-amber-200 dark:ring-amber-900/40',
  },
  Critical: {
    label: 'Kritik',
    pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    dot: 'bg-rose-500',
    ringClass: 'ring-rose-200 dark:ring-rose-900/40',
  },
};

function PanelShell({
  ringClass,
  badge,
  children,
}: {
  ringClass: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg bg-white p-3 ring-1 ring-inset dark:bg-ndark-card ${ringClass}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
          <HeartPulse size={12} />
          Müşteri Durumu
        </h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function MetricChip({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'slate' | 'amber' | 'rose';
}) {
  const cls =
    tint === 'rose'
      ? 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40'
      : tint === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40'
        : 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-ndark-bg dark:text-ndark-muted dark:ring-ndark-border';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${cls}`}
    >
      <span className="font-medium">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

export function CustomerPulsePanel({ source, skipAi, metricsLayout = 'chips' }: CustomerPulsePanelProps) {
  const [pulse, setPulse] = useState<CustomerPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [aiFailed, setAiFailed] = useState(false);

  // Account source AI'yı default skip — caseId-bound endpoint, log gereksiz.
  const effectiveSkipAi = skipAi ?? source.kind === 'account';

  // Source kimliğini bir string'e indir — useEffect deps için.
  const sourceKey =
    source.kind === 'case' ? `case:${source.caseId}` : `acc:${source.accountId}:${source.companyId}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErrored(false);
    setAiFailed(false);
    setPulse(null);

    const fetchPulse = async () => {
      if (source.kind === 'case') {
        return caseService.getCustomerPulse(source.caseId);
      }
      return caseService.getCustomerPulseByAccount(source.accountId, source.companyId);
    };

    void fetchPulse()
      .then(async (r) => {
        if (!alive) return;
        if (!r) {
          setErrored(true);
          return;
        }
        setPulse(r);
        if (effectiveSkipAi) return;
        // AI upgrade — sessiz, non-blocking. Case-based only.
        if (source.kind !== 'case' || !r.caseId) return;
        const ai = await aiService.customerPulseSummary({
          caseId: r.caseId,
          accountName: r.accountName,
          state: r.state,
          metrics: r.metrics as unknown as Record<string, number>,
          repeatedIssues: r.repeatedIssues.map((i) => ({
            category: i.category,
            subCategory: i.subCategory,
            count: i.count,
          })),
          evidence: r.summary.evidence,
        });
        if (!alive) return;
        if (ai.ok) {
          setPulse({
            ...r,
            summary: {
              text: ai.data.summary || r.summary.text,
              recommendedAction: ai.data.recommendedAction || r.summary.recommendedAction,
              evidence: ai.data.evidence.length > 0 ? ai.data.evidence : r.summary.evidence,
              source: 'ai',
            },
          });
        } else {
          setAiFailed(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, effectiveSkipAi]);

  if (errored && !loading) return null;

  if (loading) {
    return (
      <PanelShell ringClass="ring-slate-200 dark:ring-ndark-border">
        <div className="space-y-2">
          <Skeleton height={18} width="40%" />
          <Skeleton height={12} width="100%" />
          <Skeleton height={12} width="85%" />
        </div>
      </PanelShell>
    );
  }

  if (!pulse) return null;
  const meta = PULSE_STATE_META[pulse.state];

  return (
    <PanelShell
      ringClass={meta.ringClass}
      badge={
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      }
    >
      <div className="space-y-2.5">
        {/* LBD baseline 1 — Case Detail kullanımında sayısal metric chip'leri
            tek satır sönük metne indir. Diğer çağrı yerleri (Smart Ticket
            drawer) default 'chips' modunda kalır. */}
        {metricsLayout === 'summary' ? (
          <div className="text-xs text-slate-500 dark:text-ndark-muted">
            {(() => {
              const parts: string[] = [];
              parts.push(`${pulse.metrics.openCases} açık vaka`);
              if (pulse.metrics.slaViolations > 0) parts.push(`${pulse.metrics.slaViolations} SLA ihlali`);
              if (pulse.metrics.criticalCases > 0) parts.push(`${pulse.metrics.criticalCases} kritik`);
              if (pulse.metrics.escalatedCases > 0) parts.push(`${pulse.metrics.escalatedCases} eskale edilmiş`);
              parts.push(`son 30g ${pulse.metrics.recent30d}`);
              return parts.join(' · ');
            })()}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <MetricChip
              label="Açık"
              value={pulse.metrics.openCases}
              tint={pulse.metrics.openCases > 0 ? 'amber' : 'slate'}
            />
            <MetricChip label="Son 30g" value={pulse.metrics.recent30d} tint="slate" />
            {pulse.metrics.slaViolations > 0 && (
              <MetricChip label="SLA ihlali" value={pulse.metrics.slaViolations} tint="rose" />
            )}
            {pulse.metrics.criticalCases > 0 && (
              <MetricChip label="Kritik" value={pulse.metrics.criticalCases} tint="rose" />
            )}
            {pulse.metrics.escalatedCases > 0 && (
              <MetricChip label="Eskale Edildi" value={pulse.metrics.escalatedCases} tint="amber" />
            )}
          </div>
        )}

        {pulse.repeatedIssues.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              Tekrar eden konu
            </div>
            <ul className="space-y-0.5">
              {pulse.repeatedIssues.slice(0, 2).map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-slate-700 dark:text-ndark-text">
                    {r.category}
                    {r.subCategory ? ` / ${r.subCategory}` : ''}
                  </span>
                  <span className="shrink-0 text-slate-500 dark:text-ndark-muted">{r.count}×</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          {pulse.summary.text}
        </p>

        <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200 dark:bg-ndark-bg dark:text-ndark-muted dark:ring-ndark-border">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Öneri
          </div>
          {pulse.summary.recommendedAction}
        </div>

        {pulse.summary.evidence.length > 0 && (
          <details className="text-[11px] text-slate-600 dark:text-ndark-muted">
            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700 dark:hover:text-ndark-text">
              Kanıt ({pulse.summary.evidence.length})
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {pulse.summary.evidence.map((e, i) => (
                <li key={i} className="list-disc">
                  {e}
                </li>
              ))}
            </ul>
          </details>
        )}

        {pulse.summary.source === 'ai' && (
          <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400">
            <Sparkles size={10} />
            RUNA AI özet
          </div>
        )}
        {pulse.summary.source !== 'ai' && aiFailed && (
          <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <ShieldAlert size={10} />
            Standart özet (AI önerisi alınamadı)
          </div>
        )}
      </div>
    </PanelShell>
  );
}
