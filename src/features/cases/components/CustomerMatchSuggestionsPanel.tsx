/**
 * CustomerMatchSuggestionsPanel — deterministik müşteri eşleştirme önerileri.
 *
 * 2026-07-06 — CaseDetailPage'den ayrı dosyaya çıkarıldı (kapanış kapısında
 * reuse). StatusTransitionPanel bunu import edince CaseDetailPage'e döngüsel
 * import oluşuyordu (CaseDetailPage → CompactStatusStepper →
 * StatusTransitionPanel → CaseDetailPage). Ayrı modül ikisini de besler.
 *
 * Self-contained: caseId'den kendi önerilerini çeker; onConfirmLink ile
 * seçilen öneri caller'a döner (linkAccount caller sorumluluğu). AI yok —
 * deterministik telefon/email/ad sinyalleri; manuel onay zorunlu.
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  caseService,
  type CustomerMatchSuggestion,
  type CustomerMatchSuggestionsResponse,
} from '@/services/caseService';

export function CustomerMatchSuggestionsPanel({
  caseId,
  onConfirmLink,
}: {
  caseId: string;
  onConfirmLink: (suggestion: CustomerMatchSuggestion) => Promise<void>;
}) {
  const [data, setData] = useState<CustomerMatchSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const out = await caseService.getCustomerMatchSuggestions(caseId);
    setLoading(false);
    if (!out) {
      setError('Öneriler yüklenemedi.');
      return;
    }
    setData(out);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-ndark-border">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-ndark-muted">
          <Sparkles size={11} /> Önerilen müşteriler
        </div>
        <div className="space-y-1.5">
          <Skeleton height={42} />
          <Skeleton height={42} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-600 dark:border-ndark-border dark:text-ndark-muted">
        <div className="flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
          >
            Tekrar dene
          </button>
        </div>
      </div>
    );
  }

  const suggestions = data?.suggestions ?? [];
  if (suggestions.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-600 dark:border-ndark-border dark:text-ndark-muted">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-500">
          <Sparkles size={11} /> Önerilen müşteriler
        </div>
        <div>Bu vaka için otomatik öneri bulunamadı. Manuel arama ile devam edebilirsin.</div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-ndark-border">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-ndark-muted">
        <Sparkles size={11} /> Önerilen müşteriler
      </div>
      <ul className="space-y-1.5">
        {suggestions.map((s) => {
          const tint = s.confidence === 'high' ? 'emerald' : s.confidence === 'medium' ? 'amber' : 'slate';
          const isSubmitting = submittingId === s.accountId;
          return (
            <li
              key={s.accountId}
              className="rounded border border-slate-200 px-2 py-1.5 dark:border-ndark-border"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-900 dark:text-ndark-text">
                    {s.accountName}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Badge tint={tint}>
                      {s.confidence === 'high' ? 'Yüksek sinyal' : s.confidence === 'medium' ? 'Orta sinyal' : 'Düşük sinyal'}
                      <span className="ml-1 opacity-70">{s.score}</span>
                    </Badge>
                    {s.openCaseCount > 0 && (
                      <span className="text-[10px] text-slate-500 dark:text-ndark-muted">
                        {s.openCaseCount} açık
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.reasons.map((r, i) => (
                      <span
                        key={`${r.type}-${i}`}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted"
                        title={r.valueMasked ?? undefined}
                      >
                        {r.label}
                        {r.valueMasked && (
                          <span className="font-mono opacity-75">{r.valueMasked}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={async () => {
                  setSubmittingId(s.accountId);
                  await onConfirmLink(s);
                  setSubmittingId(null);
                }}
                className="mt-2 w-full justify-center"
              >
                {isSubmitting ? 'Bağlanıyor…' : 'Bu müşteriye bağla'}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400 dark:text-ndark-dim">
        Öneriler deterministic sinyallere dayanır; AI değildir. Manuel onay zorunludur.
      </p>
    </div>
  );
}
