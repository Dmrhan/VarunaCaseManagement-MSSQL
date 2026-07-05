import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Users2,
  X,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { cn } from '@/components/ui/cn';
import { useToast } from '@/components/ui/Toast';
import {
  caseService,
  type CaseSolutionStep,
  type CaseSolutionStepStatus,
} from '@/services/caseService';
import { formatRelative } from '@/lib/format';
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
 *   - Üç aksiyonun hepsi tıklayınca önce inline yorum kutusu açılır;
 *     Kaydet'e basılınca status yazılır. Yorum opsiyoneldir.
 *   - Vaka otomatik kapatılmaz / aktarılmaz / closure metadata
 *     yazılmaz — bu aksiyonlar bilinçle dışarda.
 */

interface CaseSolutionStepsPanelProps {
  item: Case;
  /** Üst component'a değişiklik haber ver (CaseDetailPage cache invalidation). */
  onChange?: () => void;
  /**
   * L2-Smart-Flow FAZ 1 — tenant KB kapısı. false ise "AI Önerilen Adımlar Al"
   * butonu GİZLENİR (KB'siz kiracıda — örn. PARAM — hata + kafa karışıklığı
   * olmasın). undefined/null = eski davranış (görünür; geriye uyum).
   */
  kbEnabled?: boolean | null;
}

type PendingOutcome = 'worked' | 'not_worked' | 'skipped' | null;

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

export function CaseSolutionStepsPanel({ item, onChange, kbEnabled }: CaseSolutionStepsPanelProps) {
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

  // Codex PR-2c review P2 fix — stale async response guard.
  //
  // Kullanıcı case A'dan B'ye geçince listSolutionSteps(A) hala in-flight
  // olabilir. Önceki implementation A'nın geç yanıtı geldiğinde state'i
  // overwrite ediyor, A'nın adımları B panelinde görünüyordu. İki katmanlı
  // korunma:
  //
  //   1. `reqIdRef` — her async refresh çağrısı kendi token'ını snapshot
  //      eder; uygulama anında current ref'ten farklıysa setState atlar.
  //   2. `caseIdRef` — Case Detail item.id değişimini in-flight token'larını
  //      ilgisiz kılmak için ref bumple bir tetikleyici olarak kullanır;
  //      ayrıca handler'ların kapanışta yakaladığı item.id ile aktif ID'yi
  //      karşılaştırmak için kullanılır.
  //
  // Case değişince adımlar/loading/yorum/manuel form state'i hemen
  // sıfırlanır: önceki case'in row'ları yeni case panelinde görünmez.
  const reqIdRef = useRef(0);
  const caseIdRef = useRef(item.id);

  async function refresh(silent = false) {
    const reqId = ++reqIdRef.current;
    const startCaseId = item.id;
    if (!silent) setLoading(true);
    try {
      const list = await caseService.listSolutionSteps(startCaseId);
      // Stale guard — yanıt geldiğinde aktif case veya request değiştiyse
      // setState atla. Eşit ID'li yarış (aynı case için 2 sıralı çağrı)
      // ihtimaline karşı token kontrolü tek başına yeterli olur, caseId
      // farkı ek defense-in-depth katmanıdır.
      if (reqId !== reqIdRef.current || caseIdRef.current !== startCaseId) return;
      setSteps(list);
      setError(null);
    } catch (e) {
      if (reqId !== reqIdRef.current || caseIdRef.current !== item.id) return;
      setError((e as Error)?.message ?? 'Çözüm adımları yüklenemedi.');
    } finally {
      if (reqId === reqIdRef.current && !silent) setLoading(false);
    }
  }

  useEffect(() => {
    // 1) In-flight token'ları geçersizleştir.
    reqIdRef.current += 1;
    caseIdRef.current = item.id;
    // 2) Önceki case state'ini hemen temizle — overlap riskini sıfırla.
    setSteps([]);
    setError(null);
    setPending(null);
    setManualOpen(false);
    setManualTitle('');
    setManualDesc('');
    setRowBusy(null);
    // 3) Yeni case için fetch et.
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function handleImportAi() {
    setImporting(true);
    const targetCaseId = item.id;
    try {
      const r = await caseService.importAiSuggestedSolutionSteps(targetCaseId, {
        freeText: item.description,
      });
      // Stale guard — case değiştiyse hiçbir yan etkiyi uygulama.
      if (caseIdRef.current !== targetCaseId) return;
      if (!r) {
        toast({ type: 'error', message: 'AI önerileri alınamadı.' });
        return;
      }
      // Mevcut görünen adımlar korunur (backend dedup'lar); listeyi yenile.
      await refresh(true);
      // refresh kendi stale guard'ıyla yeni case'in state'ini bozmaz; toast
      // mesajını sadece hala aynı case'deyken göster.
      if (caseIdRef.current !== targetCaseId) return;
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
      if (caseIdRef.current !== targetCaseId) return;
      toast({ type: 'error', message: (e as Error)?.message ?? 'AI önerileri alınamadı.' });
    } finally {
      if (caseIdRef.current === targetCaseId) setImporting(false);
    }
  }

  async function handleAddManual() {
    if (!manualTitle.trim()) return;
    setManualSaving(true);
    const targetCaseId = item.id;
    try {
      const created = await caseService.createSolutionStep(targetCaseId, {
        title: manualTitle.trim(),
        description: manualDesc.trim() || undefined,
      });
      // Stale guard — yanıt geldiğinde case değiştiyse state'e uygulama.
      if (caseIdRef.current !== targetCaseId) return;
      if (!created) {
        toast({ type: 'error', message: 'Adım eklenemedi.' });
        return;
      }
      // Optimistic append + silent refresh ile final state.
      setSteps((arr) => [...arr, created]);
      await refresh(true);
      if (caseIdRef.current !== targetCaseId) return;
      setManualTitle('');
      setManualDesc('');
      setManualOpen(false);
      toast({ type: 'success', message: 'Manuel adım eklendi.', duration: 1800 });
      onChange?.();
    } catch (e) {
      if (caseIdRef.current !== targetCaseId) return;
      toast({ type: 'error', message: (e as Error)?.message ?? 'Adım eklenemedi.' });
    } finally {
      if (caseIdRef.current === targetCaseId) setManualSaving(false);
    }
  }

  // Row outcome handlers — 3 buton, üçü de önce inline yorum kutusu açar.
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
    const targetCaseId = item.id;
    try {
      const updated = await caseService.setSolutionStepStatus(targetCaseId, stepId, status, note);
      // Stale guard — case değiştiyse yanıtı yeni case panelinde işlemeyiz.
      if (caseIdRef.current !== targetCaseId) return;
      if (!updated) {
        toast({ type: 'error', message: 'Durum güncellenemedi.' });
        return;
      }
      // Local state update (round-trip değil — UX akıcılığı).
      setSteps((arr) => arr.map((s) => (s.id === stepId ? updated : s)));
      if (pending && pending.stepId === stepId) setPending(null);
      onChange?.();
    } catch (e) {
      if (caseIdRef.current !== targetCaseId) return;
      toast({ type: 'error', message: (e as Error)?.message ?? 'Durum güncellenemedi.' });
    } finally {
      if (caseIdRef.current === targetCaseId) setRowBusy(null);
    }
  }

  const hasSteps = steps.length > 0;
  const showLoader = loading && !hasSteps;

  // Madde 3 — Header outcome progress bar. Renkler mevcut step status
  // tint paleti ile aynı: worked=emerald, not_worked=rose, skipped=slate,
  // pending=amber. Tek satır oranlı bar, üzerinde sayım rozetleri.
  const outcomeCounts = {
    worked: steps.filter((s) => s.status === 'worked').length,
    not_worked: steps.filter((s) => s.status === 'not_worked').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    pending: steps.filter((s) => s.status === 'suggested' || s.status === 'tried').length,
  };
  const total = steps.length;

  return (
    <div className="space-y-3">
      <L1TransferSummaryCard item={item} />
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
            {kbEnabled !== false && (
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
            )}
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

        {/* Madde 3 — Outcome progress bar (yalnız step varsa). Tek satırda
            oranlı renkli segment'ler; üzerinde sayım rozetleri. */}
        {total > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-500 dark:text-ndark-muted">
                {total} adım
              </span>
              {outcomeCounts.worked > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Check size={9} /> {outcomeCounts.worked}
                </span>
              )}
              {outcomeCounts.not_worked > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <X size={9} /> {outcomeCounts.not_worked}
                </span>
              )}
              {outcomeCounts.skipped > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0 text-slate-600 dark:bg-ndark-card dark:text-ndark-muted">
                  ↷ {outcomeCounts.skipped}
                </span>
              )}
              {outcomeCounts.pending > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  · {outcomeCounts.pending}
                </span>
              )}
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-bg/40">
              {outcomeCounts.worked > 0 && (
                <span
                  className="block bg-emerald-500"
                  style={{ width: `${(outcomeCounts.worked / total) * 100}%` }}
                />
              )}
              {outcomeCounts.not_worked > 0 && (
                <span
                  className="block bg-rose-500"
                  style={{ width: `${(outcomeCounts.not_worked / total) * 100}%` }}
                />
              )}
              {outcomeCounts.skipped > 0 && (
                <span
                  className="block bg-slate-400"
                  style={{ width: `${(outcomeCounts.skipped / total) * 100}%` }}
                />
              )}
              {outcomeCounts.pending > 0 && (
                <span
                  className="block bg-amber-400"
                  style={{ width: `${(outcomeCounts.pending / total) * 100}%` }}
                />
              )}
            </div>
          </div>
        )}

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
              />
            ))}
          </ul>
        )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// WR-Smart-Ticket Phase T3 — L1 Devir Özeti kartı.
//
// L2 personası vakayı açtığında L1'in neyi denediğini, hangi takıma
// devrettiğini ve devir notunu tek bakışta görsün. Veri kaynağı
// PR-T1'de persist edilen customFields.smartTicket.transferContext;
// ek API çağrısı YOK. Klasik (non-Smart-Ticket veya henüz devredilmemiş)
// vakalarda render edilmez.
// ─────────────────────────────────────────────────────────────────

interface TransferContextShape {
  version?: number;
  transferredAt?: string;
  fromTeamId?: string;
  fromTeamName?: string;
  toTeamId?: string;
  toTeamName?: string;
  toPersonId?: string;
  toPersonName?: string;
  transferNote?: string;
  composedSummary?: string;
  attemptedStepIds?: string[];
  openingTaxonomySnapshot?: {
    platform?: string;
    platformLabel?: string;
    businessProcess?: string;
    businessProcessLabel?: string;
    operationType?: string;
    operationTypeLabel?: string;
    affectedObject?: string;
    affectedObjectLabel?: string;
    impact?: string;
    impactLabel?: string;
  };
  stepOutcomesSummary?: {
    worked?: number;
    notWorked?: number;
    skipped?: number;
    pending?: number;
    total?: number;
  };
}

function readTransferContext(item: Case): TransferContextShape | null {
  const cf = item.customFields;
  if (!cf || typeof cf !== 'object') return null;
  const st = (cf as Record<string, unknown>).smartTicket;
  if (!st || typeof st !== 'object') return null;
  const ctx = (st as Record<string, unknown>).transferContext;
  if (!ctx || typeof ctx !== 'object') return null;
  return ctx as TransferContextShape;
}

function L1TransferSummaryCard({ item }: { item: Case }) {
  const ctx = readTransferContext(item);
  if (!ctx) return null;

  const snap = ctx.openingTaxonomySnapshot ?? {};
  const snapChips: Array<{ key: string; label: string; value: string }> = [
    { key: 'platform', label: 'Platform', value: snap.platformLabel || snap.platform || '' },
    { key: 'businessProcess', label: 'İş Süreci', value: snap.businessProcessLabel || snap.businessProcess || '' },
    { key: 'operationType', label: 'İşlem Tipi', value: snap.operationTypeLabel || snap.operationType || '' },
    { key: 'affectedObject', label: 'Etkilenen Nesne', value: snap.affectedObjectLabel || snap.affectedObject || '' },
    { key: 'impact', label: 'Etki', value: snap.impactLabel || snap.impact || '' },
  ].filter((c) => c.value);

  const o = ctx.stepOutcomesSummary;
  const hasOutcomes = !!o && (o.total ?? 0) > 0;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
              <ArrowRightLeft size={14} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
                L1 Devir Özeti
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
                Smart Ticket akışıyla L1 → L2 devri.
                {ctx.transferredAt ? ` ${formatRelative(ctx.transferredAt)}` : ''}
              </p>
            </div>
          </div>
          {ctx.toTeamName && (
            <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-ndark-muted">→</span>
              <span className="font-semibold text-slate-800 dark:text-ndark-text">
                {ctx.toTeamName}
              </span>
              {ctx.toPersonName && (
                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-ndark-muted">
                  <Users2 size={11} />
                  {ctx.toPersonName}
                </span>
              )}
            </div>
          )}
        </div>

        {hasOutcomes && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Toplam {o?.total ?? 0} adım:
            </span>
            <Badge tint="emerald">İşe yaradı {o?.worked ?? 0}</Badge>
            <Badge tint="rose">İşe yaramadı {o?.notWorked ?? 0}</Badge>
            <Badge tint="slate">Uygun değil {o?.skipped ?? 0}</Badge>
            <Badge tint="amber">Beklemede {o?.pending ?? 0}</Badge>
          </div>
        )}

        {ctx.transferNote && (
          <div className="rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
            <div className="text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
              L1 Notu
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-ndark-text">
              {ctx.transferNote}
            </p>
          </div>
        )}

        {ctx.composedSummary && (
          <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-ndark-border dark:bg-ndark-bg/40">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
              Denenen Adımlar Özeti
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700 dark:text-ndark-muted">
              {ctx.composedSummary}
            </p>
          </div>
        )}

        {snapChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Açılış sınıflandırması:
            </span>
            {snapChips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-baseline gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted"
              >
                <span className="text-slate-400">{c.label}:</span>
                <span className="font-medium">{c.value}</span>
              </span>
            ))}
          </div>
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
}

function SolutionStepRow({
  step,
  isBusy,
  pending,
  onIntent,
  onCancelComment,
  onCommentChange,
  onSaveOutcome,
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

  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el || !step.description) {
      setIsOverflowing(false);
      return;
    }

    const measure = () => {
      // Ölçüm collapsed durumda yapılmalı; line-clamp-2 aktifken
      // scrollHeight > clientHeight ise metin kırpılıyor demektir.
      if (!expanded) {
        setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, [step.description, expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [step.description]);

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
            <div>
              <p
                ref={descriptionRef}
                className={cn(
                  'mt-1 break-words text-xs text-slate-600 dark:text-ndark-muted',
                  !expanded && 'line-clamp-2',
                )}
              >
                {step.description}
              </p>

              {isOverflowing && (
                <button
                  type="button"
                  onClick={() => setExpanded((current) => !current)}
                  aria-expanded={expanded}
                  className="mt-0.5 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {expanded ? 'Daralt' : 'Devamını oku'}
                </button>
              )}
            </div>
          )}
          {step.note && (
            <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600 dark:bg-ndark-bg/40 dark:text-ndark-muted">
              Not: {step.note}
            </p>
          )}
        </div>
      </div>

      {/* Inline yorum kutusu — worked / not_worked / skipped için */}
      {pending && pending.intent && (
        <div className="mt-2 rounded-md border border-brand-100 bg-brand-50/40 p-2 dark:border-brand-900/30 dark:bg-brand-950/20">
          <div className="mb-1 text-[11px] font-medium text-brand-800 dark:text-brand-200">
            {pending.intent === 'worked'
              ? 'Bu adım nasıl çözdü?'
              : pending.intent === 'not_worked'
                ? 'Ne denendi, neden işe yaramadı?'
                : 'Bu adım neden uygun değil?'}
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
                onSaveOutcome(pending.intent!, pending.comment.trim() || undefined)
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
            onClick={() => onIntent('skipped')}
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
