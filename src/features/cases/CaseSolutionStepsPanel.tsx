import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  caseService,
  type CaseSolutionStep,
  type CaseSolutionStepStatus,
} from '@/services/caseService';
import type { Case } from './types';

/**
 * WR-Smart-Ticket Phase 2c — CaseSolutionStep panel for Case Detail.
 *
 * UI binding only — backend (PR-2a) ve KB classification (PR-2b) zaten
 * hazır. Panel YALNIZ Smart Ticket vakalarında render edilir; caller
 * tarafında `isSmartTicket` ile gate edilir.
 *
 * Business sözleşmesi (Phase 2c kararı):
 *   - 3 outcome aksiyonu: "İşe yaradı" / "İşe yaramadı" / "Uygun değil"
 *   - "Denedim" aksiyonu UI'da YOKTUR (backend 'tried' status'unu hala
 *     destekler, ama bu PR'da kullanılmaz).
 *   - "İşe yaradı" ve "İşe yaramadı" tıklayınca önce inline yorum kutusu
 *     açılır; Kaydet'e basılınca status yazılır.
 *   - "Uygun değil" doğrudan yazar.
 *   - Vaka otomatik kapatılmaz / aktarılmaz / closure metadata
 *     yazılmaz — bu aksiyonlar bilinçle dışarda.
 */

interface CaseSolutionStepsPanelProps {
  item: Case;
  /** Üst component'a değişiklik haber ver (CaseDetailPage cache invalidation). */
  onChange?: () => void;
}

type PendingOutcome = 'worked' | 'not_worked' | null;

const STATUS_LABEL: Record<CaseSolutionStepStatus, string> = {
  suggested: 'Önerildi',
  tried: 'Denendi',
  worked: 'İşe yaradı',
  not_worked: 'İşe yaramadı',
  skipped: 'Uygun değil',
};

const STATUS_TINT: Record<
  CaseSolutionStepStatus,
  'slate' | 'amber' | 'emerald' | 'rose'
> = {
  suggested: 'slate',
  tried: 'amber',
  worked: 'emerald',
  not_worked: 'rose',
  skipped: 'slate',
};

export function CaseSolutionStepsPanel({ item, onChange }: CaseSolutionStepsPanelProps) {
  const [steps, setSteps] = useState<CaseSolutionStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Manuel adım inline form state.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  // Outcome (worked/not_worked) inline yorum kutusu — { stepId, intent, comment }
  const [pending, setPending] = useState<{
    stepId: string;
    intent: PendingOutcome;
    comment: string;
  } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const list = await caseService.listSolutionSteps(item.id);
      setSteps(list);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? 'Çözüm adımları yüklenemedi.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function handleImportAi() {
    setImporting(true);
    try {
      const r = await caseService.importAiSuggestedSolutionSteps(item.id, {
        freeText: item.description,
      });
      if (!r) {
        toast({ type: 'error', message: 'AI önerileri alınamadı.' });
        return;
      }
      // Mevcut görünen adımlar korunur (backend dedup'lar); listeyi yenile.
      await refresh(true);
      const { importedCount, skippedCount } = r.summary;
      if (importedCount > 0) {
        toast({
          type: 'success',
          message: `${importedCount} yeni AI adım eklendi${skippedCount > 0 ? `, ${skippedCount} zaten mevcuttu` : ''}.`,
          duration: 2500,
        });
      } else if (skippedCount > 0) {
        toast({
          type: 'info',
          message: 'Yeni AI önerisi yok — mevcut adımlar korunuyor.',
          duration: 2500,
        });
      } else {
        toast({
          type: 'info',
          message: 'KB cevabında öneri bulunamadı. Manuel adım ekleyebilirsiniz.',
          duration: 2500,
        });
      }
      onChange?.();
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message ?? 'AI önerileri alınamadı.' });
    } finally {
      setImporting(false);
    }
  }

  async function handleAddManual() {
    if (!manualTitle.trim()) return;
    setManualSaving(true);
    try {
      const created = await caseService.createSolutionStep(item.id, {
        title: manualTitle.trim(),
        description: manualDesc.trim() || undefined,
      });
      if (!created) {
        toast({ type: 'error', message: 'Adım eklenemedi.' });
        return;
      }
      // Optimistic append + silent refresh ile final state.
      setSteps((arr) => [...arr, created]);
      await refresh(true);
      setManualTitle('');
      setManualDesc('');
      setManualOpen(false);
      toast({ type: 'success', message: 'Manuel adım eklendi.', duration: 1800 });
      onChange?.();
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message ?? 'Adım eklenemedi.' });
    } finally {
      setManualSaving(false);
    }
  }

  // Row outcome handlers — 3 buton.
  // "İşe yaradı" / "İşe yaramadı": önce yorum kutusu aç.
  // "Uygun değil": doğrudan yaz.
  function openComment(stepId: string, intent: PendingOutcome) {
    if (!intent) return;
    setPending({ stepId, intent, comment: '' });
  }
  function cancelComment() {
    setPending(null);
  }

  async function saveOutcome(
    stepId: string,
    status: CaseSolutionStepStatus,
    note: string | undefined,
  ) {
    setRowBusy(stepId);
    try {
      const updated = await caseService.setSolutionStepStatus(item.id, stepId, status, note);
      if (!updated) {
        toast({ type: 'error', message: 'Durum güncellenemedi.' });
        return;
      }
      // Local state update (round-trip değil — UX akıcılığı).
      setSteps((arr) => arr.map((s) => (s.id === stepId ? updated : s)));
      if (pending && pending.stepId === stepId) setPending(null);
      onChange?.();
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message ?? 'Durum güncellenemedi.' });
    } finally {
      setRowBusy(null);
    }
  }

  const hasSteps = steps.length > 0;
  const showLoader = loading && !hasSteps;

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
              Çözüm Adımları
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
              Müşteriye denenen çözüm adımlarını burada takip edin.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Sparkles size={12} className="text-brand-500" />}
              onClick={() => void handleImportAi()}
              disabled={importing}
              title="External KB'den AI Önerilen Adımlar al"
            >
              {importing ? 'Alınıyor…' : 'AI Önerilen Adımlar Al'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus size={12} />}
              onClick={() => setManualOpen((v) => !v)}
              disabled={manualOpen}
            >
              Manuel Adım Ekle
            </Button>
          </div>
        </div>

        {/* Manuel adım inline form */}
        {manualOpen && (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-ndark-border dark:bg-ndark-bg/40">
            <div className="space-y-2">
              <Field label="Adım Başlığı" required>
                <TextInput
                  autoFocus
                  placeholder="ör. Müşteriden ekran görüntüsü iste"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                />
              </Field>
              <Field label="Açıklama" hint="Opsiyonel">
                <TextArea
                  rows={2}
                  placeholder="Adımın detayı…"
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                />
              </Field>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setManualOpen(false);
                    setManualTitle('');
                    setManualDesc('');
                  }}
                  disabled={manualSaving}
                >
                  Vazgeç
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleAddManual()}
                  disabled={!manualTitle.trim() || manualSaving}
                >
                  {manualSaving ? 'Kaydediliyor…' : 'Adım Ekle'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Loading / error / empty / list */}
        {showLoader && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-ndark-muted">
            <Loader2 size={14} className="animate-spin text-brand-500" />
            Adımlar yükleniyor…
          </div>
        )}

        {error && !showLoader && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
            <span>{error}</span>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<RefreshCw size={11} />}
              onClick={() => void refresh()}
            >
              Tekrar dene
            </Button>
          </div>
        )}

        {!showLoader && !error && !hasSteps && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center text-xs text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
            Henüz çözüm adımı yok. AI önerilerini alabilir veya manuel adım ekleyebilirsiniz.
          </div>
        )}

        {!showLoader && hasSteps && (
          <ul className="space-y-2">
            {steps.map((step) => (
              <SolutionStepRow
                key={step.id}
                step={step}
                isBusy={rowBusy === step.id}
                pending={pending && pending.stepId === step.id ? pending : null}
                onIntent={(intent) => openComment(step.id, intent)}
                onCancelComment={cancelComment}
                onCommentChange={(comment) =>
                  setPending((p) => (p && p.stepId === step.id ? { ...p, comment } : p))
                }
                onSaveOutcome={(status, note) => void saveOutcome(step.id, status, note)}
                onSkipDirect={() => void saveOutcome(step.id, 'skipped', undefined)}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step row
// ─────────────────────────────────────────────────────────────────

interface SolutionStepRowProps {
  step: CaseSolutionStep;
  isBusy: boolean;
  pending: { stepId: string; intent: PendingOutcome; comment: string } | null;
  onIntent: (intent: PendingOutcome) => void;
  onCancelComment: () => void;
  onCommentChange: (comment: string) => void;
  onSaveOutcome: (status: CaseSolutionStepStatus, note: string | undefined) => void;
  onSkipDirect: () => void;
}

function SolutionStepRow({
  step,
  isBusy,
  pending,
  onIntent,
  onCancelComment,
  onCommentChange,
  onSaveOutcome,
  onSkipDirect,
}: SolutionStepRowProps) {
  const sourcePill = useMemo(() => {
    if (step.source === 'ai_suggested_step') return { label: 'AI Önerisi', tint: 'violet' as const };
    if (step.source === 'manual') return { label: 'Manuel', tint: 'sky' as const };
    if (step.source === 'external_kb') return { label: 'KB', tint: 'indigo' as const };
    if (step.source === 'similar_case') return { label: 'Benzer Vaka', tint: 'teal' as const };
    return { label: step.source, tint: 'slate' as const };
  }, [step.source]);

  const isTerminal =
    step.status === 'worked' || step.status === 'not_worked' || step.status === 'skipped';

  return (
    <li className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted">
          {step.stepIndex}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-slate-800 dark:text-ndark-text">
              {step.title}
            </span>
            <Badge tint={sourcePill.tint}>{sourcePill.label}</Badge>
            <Badge tint={STATUS_TINT[step.status]}>{STATUS_LABEL[step.status]}</Badge>
          </div>
          {step.description && (
            <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-ndark-muted">
              {step.description}
            </p>
          )}
          {step.note && (
            <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600 dark:bg-ndark-bg/40 dark:text-ndark-muted">
              Not: {step.note}
            </p>
          )}
        </div>
      </div>

      {/* Inline yorum kutusu — worked / not_worked için */}
      {pending && pending.intent && (
        <div className="mt-2 rounded-md border border-brand-100 bg-brand-50/40 p-2 dark:border-brand-900/30 dark:bg-brand-950/20">
          <div className="mb-1 text-[11px] font-medium text-brand-800 dark:text-brand-200">
            {pending.intent === 'worked'
              ? 'Bu adım nasıl çözdü?'
              : 'Ne denendi, neden işe yaramadı?'}
          </div>
          <TextArea
            autoFocus
            rows={2}
            placeholder="Kısa açıklama yazın…"
            value={pending.comment}
            onChange={(e) => onCommentChange(e.target.value)}
          />
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={onCancelComment} disabled={isBusy}>
              Vazgeç
            </Button>
            <Button
              size="sm"
              onClick={() =>
                onSaveOutcome(
                  pending.intent === 'worked' ? 'worked' : 'not_worked',
                  pending.comment.trim() || undefined,
                )
              }
              disabled={isBusy}
            >
              {isBusy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      )}

      {/* Outcome aksiyonları — yorum açıkken gizlenir */}
      {!pending && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Check size={11} className="text-emerald-600" />}
            onClick={() => onIntent('worked')}
            disabled={isBusy || step.status === 'worked'}
            title="Bu adım sorunu çözdü"
          >
            İşe yaradı
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<X size={11} className="text-rose-600" />}
            onClick={() => onIntent('not_worked')}
            disabled={isBusy || step.status === 'not_worked'}
            title="Denedik ama sorun devam ediyor"
          >
            İşe yaramadı
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onSkipDirect}
            disabled={isBusy || step.status === 'skipped'}
            title="Bu adım bu vaka için uygun değil"
          >
            Uygun değil
          </Button>
          {isBusy && <Loader2 size={12} className="ml-1 animate-spin text-brand-500" />}
        </div>
      )}

      {isTerminal && !pending && (
        <p className="mt-1.5 text-right text-[10px] text-slate-400 dark:text-ndark-dim">
          {step.outcomeAt
            ? `Sonuç: ${new Date(step.outcomeAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`
            : null}
        </p>
      )}
    </li>
  );
}
