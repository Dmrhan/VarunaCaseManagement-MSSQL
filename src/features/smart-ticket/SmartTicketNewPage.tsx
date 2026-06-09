import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CornerUpLeft,
  ExternalLink,
  Loader2,
  Sparkles,
  Users2,
  Wand2,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import {
  caseService,
  lookupService,
  type SmartTicketTaxonomyItem,
  type SmartTicketRootCauseGroup,
  type SmartTicketTaxonomyResponse,
  type SuggestClassificationResponse,
  type SuggestClassificationField,
} from '@/services/caseService';
import { accountService, type AccountListItem } from '@/services/accountService';
import type { Case } from '@/features/cases/types';
import { CaseSolutionStepsPanel } from '@/features/cases/CaseSolutionStepsPanel';
import { resolveSmartTicketMapping } from './mapping';

/**
 * WR-Smart-Ticket Primary UX — One-Screen 3-Stage L1 Flow.
 *
 * Sol 1/3: opening + classification (sürekli görünür)
 * Sağ 2/3: stage-based
 *   - Stage 1 (opening): placeholder + "Sol taraftaki formu doldur" rehberi
 *   - Stage 2 (solution): CaseSolutionStepsPanel embed + "Kapanışa / L2'ye / Detay" navigation
 *   - Stage 3 closure: 4 dropdown (rcg/rcd/rt/pp) + resolution note + "Vakayı Kapat"
 *   - Stage 3 transfer: placeholder + Case Detail escape (gap: full transfer
 *     integration PR-3 veya ileri PR'da; UI bilinçle placeholder)
 *
 * KORUNAN DAVRANIŞ
 *  - Backend / schema / migration YOK.
 *  - Mevcut endpoint'ler aynen kullanılır:
 *      lookupService.suggestSmartTicketClassification (PR-2b)
 *      caseService.create (mevcut)
 *      caseService.importAiSuggestedSolutionSteps (PR-2a)
 *      caseService.transitionStatus + smartTicketClosure (PR-1e)
 *      lookupService.smartTicketTaxonomies (PR-1a)
 *  - Quick Case / New Case / Case Detail / SLA / approval guard dokunulmadı.
 *  - Auto-close YOK. Auto-transfer YOK.
 *
 * TEK USER-FACING ANALYZE ACTION
 *  - Stage 1'de iki sıralı buton var:
 *      1) "KB ile Analiz Et" → suggestClassification, 5 taxonomy alanını
 *         BOŞ olanları otomatik doldur.
 *      2) "Vaka Oluştur ve Çözüm Adımlarına Geç" → caseService.create +
 *         importAiSuggestedSolutionSteps + stage→solution.
 *  - Eski iki ayrı user-facing aksiyon (PR-2b classification + PR-2c
 *    AI step import) BU EKRANDA tekleştirildi. AI önerilen adımlar Case
 *    create ile birlikte tek tıkta gelir; classification ayrı bir
 *    "analiz" adımı olarak kullanıcı override edebilsin diye sırada önde.
 */

type Stage = 'opening' | 'solution' | 'closure' | 'transfer';

const TAXONOMY_FIELDS: Array<{
  key: 'platform' | 'businessProcess' | 'operationType' | 'affectedObject' | 'impact';
  label: string;
  hint?: string;
}> = [
  { key: 'platform',        label: 'Platform' },
  { key: 'businessProcess', label: 'İş Süreci' },
  { key: 'operationType',   label: 'İşlem Tipi' },
  { key: 'affectedObject',  label: 'Etkilenen Nesne' },
  { key: 'impact',          label: 'Etki' },
];

interface SmartTicketProjectOption {
  id: string;
  name: string;
}

interface SmartTicketFormState {
  companyId: string;
  accountId: string;
  accountName: string;
  accountProjectId: string;
  accountProjectName: string;
  title: string;
  description: string;
  platform: string;
  businessProcess: string;
  operationType: string;
  affectedObject: string;
  impact: string;
}

interface ClosureFormState {
  rootCauseGroup: string;
  rootCauseDetail: string;
  resolutionType: string;
  permanentPrevention: string;
  resolutionNote: string;
}

const emptyForm = (companyId: string): SmartTicketFormState => ({
  companyId,
  accountId: '',
  accountName: '',
  accountProjectId: '',
  accountProjectName: '',
  title: '',
  description: '',
  platform: '',
  businessProcess: '',
  operationType: '',
  affectedObject: '',
  impact: '',
});

const emptyClosure = (): ClosureFormState => ({
  rootCauseGroup: '',
  rootCauseDetail: '',
  resolutionType: '',
  permanentPrevention: '',
  resolutionNote: '',
});

export function SmartTicketNewPage({
  onCreated,
  onCancel,
}: {
  /**
   * Kullanıcı bilinçli olarak Case Detail'e gitmek isterse caller bunu
   * yönlendirir. **Birincil akışta otomatik çağrılmaz**: Case create
   * sonrası kullanıcı Smart Ticket ekranında kalır (Stage 2).
   */
  onCreated: (caseId: string) => void;
  onCancel: () => void;
}) {
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const [form, setForm] = useState<SmartTicketFormState>(() => emptyForm(defaultCompanyId));
  const [stage, setStage] = useState<Stage>('opening');
  const [createdCase, setCreatedCase] = useState<Case | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === form.companyId) ?? null,
    [companies, form.companyId],
  );
  const projectsEnabled = !!selectedCompany?.projectsEnabled;
  const projectsRequired = !!selectedCompany?.projectsRequired;

  const [taxonomies, setTaxonomies] = useState<SmartTicketTaxonomyResponse['taxonomies'] | null>(null);
  const [taxonomiesLoading, setTaxonomiesLoading] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [projects, setProjects] = useState<SmartTicketProjectOption[]>([]);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Phase 2b — classification suggestion state.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestClassificationResponse | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [appliedSuggestionFields, setAppliedSuggestionFields] = useState<Set<SuggestClassificationField>>(
    () => new Set(),
  );

  // Stage 3 closure form state.
  const [closure, setClosure] = useState<ClosureFormState>(emptyClosure());
  const [closing, setClosing] = useState(false);
  const [closureError, setClosureError] = useState<string | null>(null);

  // Taxonomy lookup — companyId değişince yeniden çek.
  useEffect(() => {
    let alive = true;
    if (!form.companyId) {
      setTaxonomies(null);
      return;
    }
    setTaxonomiesLoading(true);
    setTaxonomyError(null);
    void lookupService
      .smartTicketTaxonomies(form.companyId)
      .then((res: SmartTicketTaxonomyResponse) => {
        if (!alive) return;
        setTaxonomies(res.taxonomies);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setTaxonomyError((e as Error)?.message ?? 'Taxonomy çekilemedi');
      })
      .finally(() => {
        if (alive) setTaxonomiesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [form.companyId]);

  // Müşteri seçilince proje listesini doldur (opsiyonel).
  useEffect(() => {
    let alive = true;
    if (!form.accountId || !form.companyId) {
      setProjects([]);
      return;
    }
    void accountService.get(form.accountId).then((detail) => {
      if (!alive) return;
      if (!detail) {
        setProjects([]);
        return;
      }
      const company = detail.companies.find((c) => c.companyId === form.companyId);
      const list: SmartTicketProjectOption[] = (company?.projects ?? [])
        .filter((p) => p.isActive && p.status === 'Active')
        .map((p) => ({ id: p.id, name: p.name }));
      setProjects(list);
      setForm((f) =>
        f.accountProjectId && !list.some((p) => p.id === f.accountProjectId)
          ? { ...f, accountProjectId: '', accountProjectName: '' }
          : f,
      );
    });
    return () => {
      alive = false;
    };
  }, [form.accountId, form.companyId]);

  // Şirket değişince müşteri/proje + Smart Ticket taxonomy seçimlerini sıfırla.
  // Sadece Stage 1'de geçerli — Case create sonrası şirket değişmez.
  useEffect(() => {
    if (stage !== 'opening') return;
    setForm((f) => ({
      ...f,
      accountId: '',
      accountName: '',
      accountProjectId: '',
      accountProjectName: '',
      platform: '',
      businessProcess: '',
      operationType: '',
      affectedObject: '',
      impact: '',
    }));
    setSuggestion(null);
    setSuggestionError(null);
    setAppliedSuggestionFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId]);

  function handleSelectAccount(item: AccountListItem | null) {
    setAccountPickerOpen(false);
    if (!item) return;
    setForm((f) => ({
      ...f,
      accountId: item.id,
      accountName: item.name ?? '',
    }));
  }

  function handleSelectProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setForm((f) => ({
      ...f,
      accountProjectId: id,
      accountProjectName: project?.name ?? '',
    }));
  }

  function selectedCompanyName(): string {
    return companies.find((c) => c.id === form.companyId)?.name ?? '';
  }

  const projectRequirementSatisfied =
    !projectsEnabled || !projectsRequired || !form.accountId || !!form.accountProjectId;

  const canCreate =
    stage === 'opening' &&
    !!form.companyId &&
    !!form.accountId &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    projectRequirementSatisfied &&
    !creating;

  const canSuggest =
    stage === 'opening' && !!form.companyId && form.description.trim().length >= 5 && !suggesting;

  // ── Phase 2b — sınıflandırma önerisi (yalnız taxonomy auto-fill) ────
  async function handleSuggestClassification() {
    if (!canSuggest) return;
    setSuggesting(true);
    setSuggestionError(null);
    setSuggestion(null);
    try {
      const res = await lookupService.suggestSmartTicketClassification({
        companyId: form.companyId,
        description: form.description.trim(),
        accountId: form.accountId || undefined,
        ...(form.accountProjectId ? { projectId: form.accountProjectId } : {}),
      });
      if (!res) {
        setSuggestionError('Sınıflandırma önerisi alınamadı.');
        return;
      }
      setSuggestion(res);
      const applied = new Set<SuggestClassificationField>();
      setForm((f) => {
        const next = { ...f };
        for (const key of [
          'platform',
          'businessProcess',
          'operationType',
          'affectedObject',
          'impact',
        ] as const) {
          const s = res.suggestions[key];
          if (s && !next[key]) {
            next[key] = s.code;
            applied.add(key);
          }
        }
        return next;
      });
      setAppliedSuggestionFields(applied);
      const total = Object.keys(res.suggestions).length;
      const unmatchedCount = res.unmatched.length;
      toast({
        type: total > 0 ? 'success' : 'info',
        message:
          total > 0
            ? `${total} alan eşleşti; ${applied.size} alan boştu, otomatik dolduruldu.${
                unmatchedCount > 0 ? ` ${unmatchedCount} alan eşleşmedi.` : ''
              }`
            : 'KB cevabında eşleşen sınıflandırma alanı yok.',
        duration: 3500,
      });
    } catch (e) {
      setSuggestionError((e as Error)?.message ?? 'Sınıflandırma önerisi alınamadı.');
    } finally {
      setSuggesting(false);
    }
  }

  function handleApplyAllSuggestions() {
    if (!suggestion) return;
    const applied = new Set<SuggestClassificationField>();
    setForm((f) => {
      const next = { ...f };
      for (const key of [
        'platform',
        'businessProcess',
        'operationType',
        'affectedObject',
        'impact',
      ] as const) {
        const s = suggestion.suggestions[key];
        if (s) {
          next[key] = s.code;
          applied.add(key);
        }
      }
      return next;
    });
    setAppliedSuggestionFields(applied);
  }

  function handleTaxonomyChange(
    key: 'platform' | 'businessProcess' | 'operationType' | 'affectedObject' | 'impact',
    value: string,
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    setAppliedSuggestionFields((prev) => {
      if (!prev.has(key as SuggestClassificationField)) return prev;
      const next = new Set(prev);
      next.delete(key as SuggestClassificationField);
      return next;
    });
  }

  // ── Stage 1 → 2 transition: Case create + AI suggested steps import ─
  async function handleCreateAndContinue() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);

    const mapping = resolveSmartTicketMapping(taxonomies, {
      platform: form.platform || undefined,
      businessProcess: form.businessProcess || undefined,
      operationType: form.operationType || undefined,
      affectedObject: form.affectedObject || undefined,
      impact: form.impact || undefined,
    });

    const smartTicket: Record<string, unknown> = {};
    for (const f of TAXONOMY_FIELDS) {
      const v = form[f.key];
      if (!v) continue;
      smartTicket[f.key] = v;
      const list = taxonomies?.[f.key] ?? [];
      const item = list.find((it) => it.code === v);
      if (item?.label) smartTicket[`${f.key}Label`] = item.label;
    }
    smartTicket.appliedMapping = {
      source: mapping.source,
      category: mapping.category,
      subCategory: mapping.subCategory,
      requestType: mapping.requestType,
      trace: mapping.trace,
    };

    if (suggestion) {
      const perField: Record<string, { matchedBy: string; confidence: number; suggestedCode: string }> = {};
      for (const key of [
        'platform',
        'businessProcess',
        'operationType',
        'affectedObject',
        'impact',
      ] as const) {
        if (!appliedSuggestionFields.has(key as SuggestClassificationField)) continue;
        const s = suggestion.suggestions[key as SuggestClassificationField];
        if (s) {
          perField[key] = {
            matchedBy: s.matchedBy,
            confidence: s.confidence,
            suggestedCode: s.code,
          };
        }
      }
      smartTicket.classificationSuggestion = {
        source: 'external_kb',
        appliedAt: new Date().toISOString(),
        appliedFields: Object.keys(perField),
        perField,
        unmatched: suggestion.unmatched.map((u) => ({
          taxonomyType: u.taxonomyType,
          rawValue: u.rawValue,
        })),
      };
    }

    try {
      const created: Case = await caseService.create({
        title: form.title.trim(),
        description: form.description.trim(),
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Web',
        companyId: form.companyId,
        companyName: selectedCompanyName(),
        accountId: form.accountId,
        accountName: form.accountName || undefined,
        ...(form.accountProjectId
          ? {
              accountProjectId: form.accountProjectId,
              accountProjectName: form.accountProjectName || undefined,
            }
          : {}),
        category: mapping.category,
        subCategory: mapping.subCategory,
        requestType: mapping.requestType,
        customFields: { smartTicket },
      });
      setCreatedCase(created);
      // Çözüm Adımlarını çağırma asynchronous — başarısız olsa bile
      // kullanıcı manuel adım ekleyebilir. Hata bilgilendirme toast'unda.
      try {
        const importResult = await caseService.importAiSuggestedSolutionSteps(created.id, {
          freeText: form.description.trim(),
        });
        if (importResult && importResult.summary.importedCount > 0) {
          toast({
            type: 'success',
            message: `Vaka açıldı (${created.caseNumber}) · ${importResult.summary.importedCount} AI önerisi eklendi.`,
            duration: 3000,
          });
        } else {
          toast({
            type: 'success',
            message: `Vaka açıldı (${created.caseNumber}).`,
            duration: 2500,
          });
        }
      } catch (importErr) {
        toast({
          type: 'warn',
          message: `Vaka açıldı (${created.caseNumber}) ama AI önerileri alınamadı: ${(importErr as Error)?.message ?? ''} Manuel adım ekleyebilirsiniz.`,
          duration: 4500,
        });
      }
      setStage('solution');
    } catch (e) {
      setError((e as Error)?.message ?? 'Vaka oluşturulamadı.');
    } finally {
      setCreating(false);
    }
  }

  // ── Stage 3 closure: transitionStatus + smartTicketClosure ──────────
  const closureLists = useMemo(() => {
    const rcgList: SmartTicketRootCauseGroup[] = taxonomies?.rootCauseGroup ?? [];
    const rcdList: SmartTicketTaxonomyItem[] =
      rcgList.find((g) => g.code === closure.rootCauseGroup)?.children ?? [];
    const rtList: SmartTicketTaxonomyItem[] = taxonomies?.resolutionType ?? [];
    const ppList: SmartTicketTaxonomyItem[] = taxonomies?.permanentPrevention ?? [];
    return { rcgList, rcdList, rtList, ppList };
  }, [taxonomies, closure.rootCauseGroup]);

  // Kök Neden Grubu değişince Detay seçimini sıfırla.
  useEffect(() => {
    setClosure((c) => ({ ...c, rootCauseDetail: '' }));
  }, [closure.rootCauseGroup]);

  // Codex PR review P1 — checklist gating. StatusTransitionPanel (mevcut
  // Case Detail close akışı) Cozuldu transition'ı için tamamlanmamış
  // zorunlu kontrol listesi maddelerini kapanışa engel olarak kullanır.
  // Backend transitionStatus checklist'i enforce etmiyor (yalnız
  // ResolutionApprovalPolicy guard'ı var) → bu ekran da aynı UI gating'i
  // yapmalı, aksi takdirde Smart Ticket akışı checklist atlanabilir.
  const requiredChecklistPending = useMemo(
    () =>
      (createdCase?.checklistItems ?? []).filter(
        (it) => it.required && !it.checked,
      ),
    [createdCase],
  );

  async function handleCloseCase() {
    if (!createdCase || closing) return;
    if (!closure.resolutionNote.trim()) {
      setClosureError('Çözüm notu zorunlu.');
      return;
    }
    if (requiredChecklistPending.length > 0) {
      setClosureError(
        `Vaka çözülmeden önce ${requiredChecklistPending.length} zorunlu kontrol maddesi tamamlanmalı. Vaka Detayı → Kontrol Listesi'nden işaretleyin.`,
      );
      return;
    }
    setClosing(true);
    setClosureError(null);

    const findLabel = (list: { code: string; label: string }[], code: string) =>
      list.find((x) => x.code === code)?.label;

    const closurePayload = {
      rootCauseGroup: closure.rootCauseGroup || undefined,
      rootCauseGroupLabel: findLabel(closureLists.rcgList, closure.rootCauseGroup),
      rootCauseDetail: closure.rootCauseDetail || undefined,
      rootCauseDetailLabel: findLabel(closureLists.rcdList, closure.rootCauseDetail),
      resolutionType: closure.resolutionType || undefined,
      resolutionTypeLabel: findLabel(closureLists.rtList, closure.resolutionType),
      permanentPrevention: closure.permanentPrevention || undefined,
      permanentPreventionLabel: findLabel(closureLists.ppList, closure.permanentPrevention),
    };

    try {
      const updated = await caseService.transitionStatus(createdCase.id, 'Çözüldü', {
        resolutionNote: closure.resolutionNote.trim(),
        smartTicketClosure: closurePayload,
      });
      if (!updated) {
        setClosureError('Vaka kapatılamadı.');
        return;
      }
      setCreatedCase(updated);
      toast({
        type: 'success',
        message: `Vaka kapatıldı (${updated.caseNumber}).`,
        duration: 2500,
      });
      // Kapama sonrası kullanıcıyı Case Detail'e götür — Akıllı Ticket akışı bitti.
      onCreated(updated.id);
    } catch (e) {
      setClosureError((e as Error)?.message ?? 'Vaka kapatılamadı.');
    } finally {
      setClosing(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full space-y-4 px-4 py-4">
      {/* Header — geri buton + başlık + Case number badge */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="mb-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text"
          >
            <ArrowLeft size={12} />
            <span>Vakalara dön</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
              Akıllı Ticket
            </h1>
            {createdCase && (
              <Badge tint="violet">
                {createdCase.caseNumber} · {createdCase.status}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
            L1 akışı: açılış · çözüm denemesi · kapanış (veya L2 devir). Tek ekranda.
          </p>
        </div>
        <StageIndicator stage={stage} hasCase={!!createdCase} />
      </div>

      {/* 2-column staged screen */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sol 1/3 — opening + classification (sürekli görünür) */}
        <div className="lg:col-span-1">
          <Card>
            <CardBody className="space-y-4">
              <SectionTitle text="1. Açılış / Sınıflandırma" />
              <CompanySelector
                label="Şirket"
                value={form.companyId || null}
                onChange={(id) => setForm((f) => ({ ...f, companyId: id ?? '' }))}
                required
                disabled={stage !== 'opening'}
              />
              <Field label="Müşteri" required>
                <button
                  type="button"
                  onClick={() => setAccountPickerOpen(true)}
                  disabled={stage !== 'opening'}
                  className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ndark-border dark:bg-ndark-card"
                >
                  <span className={form.accountName ? 'text-slate-800 dark:text-ndark-text' : 'text-slate-400'}>
                    {form.accountName || 'Müşteri seçin…'}
                  </span>
                  <Users2 size={14} className="text-slate-400" />
                </button>
              </Field>
              {((projectsEnabled && !!form.accountId) || projects.length > 0) && (
                <Field
                  label="Proje"
                  required={projectsEnabled && projectsRequired && !!form.accountId}
                  hint={
                    projectsEnabled && projectsRequired && !!form.accountId
                      ? 'Bu şirket için proje zorunlu.'
                      : 'Opsiyonel.'
                  }
                >
                  <Select
                    value={form.accountProjectId}
                    onChange={(e) => handleSelectProject(e.target.value)}
                    disabled={stage !== 'opening'}
                  >
                    <option value="">
                      {projectsRequired ? 'Proje seç…' : '— Proje yok —'}
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Başlık" required>
                <TextInput
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="ör. Ürün kartı kaydı sırasında hata"
                  disabled={stage !== 'opening'}
                />
              </Field>
              <Field label="Açıklama" required>
                <TextArea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Problemi kısa ve net anlat. Hangi platform? Hangi işlem? Hangi etki?"
                  disabled={stage !== 'opening'}
                />
              </Field>

              {/* Smart Ticket taxonomy alanları */}
              <div className="rounded-md border border-brand-100 bg-brand-50/40 p-3 dark:border-brand-900/30 dark:bg-brand-950/20">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={12} className="text-brand-500" />
                    <span className="text-xs font-medium text-brand-700 dark:text-brand-200">
                      Akıllı Tanımlar
                    </span>
                    {taxonomiesLoading && (
                      <span className="text-[11px] text-slate-500 dark:text-ndark-muted">yükleniyor…</span>
                    )}
                  </div>
                  {/* TEK USER-FACING ANALİZ ADIMI — classification */}
                  {stage === 'opening' && (
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Wand2 size={11} />}
                      disabled={!canSuggest}
                      onClick={() => void handleSuggestClassification()}
                      title={
                        !form.companyId
                          ? 'Önce şirket seçin'
                          : form.description.trim().length < 5
                            ? 'En az 5 karakter açıklama girin'
                            : 'KB üzerinden 5 sınıflandırma alanı önerilir'
                      }
                    >
                      {suggesting ? 'Analiz…' : 'KB ile Analiz Et'}
                    </Button>
                  )}
                </div>
                {taxonomyError && (
                  <p className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                    {taxonomyError}
                  </p>
                )}
                {suggestionError && (
                  <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    {suggestionError} Manuel seçim yapabilirsiniz.
                  </p>
                )}
                {suggestion && (
                  <div className="mb-2 rounded-md border border-violet-200 bg-violet-50/60 px-2 py-1.5 dark:border-violet-900/40 dark:bg-violet-950/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-violet-800 dark:text-violet-200">
                        KB: {Object.keys(suggestion.suggestions).length} eşleşti
                        {suggestion.unmatched.length > 0 && `, ${suggestion.unmatched.length} eşleşmedi`}
                      </span>
                      {stage === 'opening' && Object.keys(suggestion.suggestions).length > 0 && (
                        <Button size="sm" variant="ghost" onClick={handleApplyAllSuggestions}>
                          Tümünü uygula
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {TAXONOMY_FIELDS.map((f) => {
                    const items = (taxonomies?.[f.key] ?? []) as SmartTicketTaxonomyItem[];
                    const isFromSuggestion = appliedSuggestionFields.has(f.key as SuggestClassificationField);
                    const suggested = suggestion?.suggestions?.[f.key as SuggestClassificationField];
                    return (
                      <Field
                        key={f.key}
                        label={f.label}
                        hint={
                          isFromSuggestion && suggested
                            ? `KB önerisi (${suggested.matchedBy}, %${Math.round(suggested.confidence * 100)})`
                            : undefined
                        }
                      >
                        <Select
                          value={form[f.key]}
                          onChange={(e) => handleTaxonomyChange(f.key, e.target.value)}
                          disabled={stage !== 'opening' || taxonomiesLoading || items.length === 0}
                        >
                          <option value="">— Seçim yok —</option>
                          {items.map((it) => (
                            <option key={it.code} value={it.code}>
                              {it.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </div>
              )}

              {stage === 'opening' && (
                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
                  <Button variant="outline" onClick={onCancel} disabled={creating} size="sm">
                    Vazgeç
                  </Button>
                  <Button
                    onClick={() => void handleCreateAndContinue()}
                    disabled={!canCreate}
                    leftIcon={creating ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                  >
                    {creating ? 'Açılıyor…' : 'Vaka Oluştur ve Çözüm Adımlarına Geç'}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Sağ 2/3 — stage-based */}
        <div className="space-y-4 lg:col-span-2">
          {stage === 'opening' && <Stage1Placeholder />}

          {stage === 'solution' && createdCase && (
            <Stage2Solution
              createdCase={createdCase}
              onCaseChanged={(c) => setCreatedCase(c)}
              onGoToClosure={() => setStage('closure')}
              onGoToTransfer={() => setStage('transfer')}
              onGoToCaseDetail={() => onCreated(createdCase.id)}
            />
          )}

          {stage === 'closure' && createdCase && (
            <Stage3Closure
              closure={closure}
              setClosure={setClosure}
              closureLists={closureLists}
              closing={closing}
              closureError={closureError}
              requiredChecklistPending={requiredChecklistPending}
              onClose={() => void handleCloseCase()}
              onBack={() => {
                setStage('solution');
                setClosureError(null);
              }}
              onGoToCaseDetail={() => onCreated(createdCase.id)}
            />
          )}

          {stage === 'transfer' && createdCase && (
            <Stage3TransferPlaceholder
              caseNumber={createdCase.caseNumber}
              onBack={() => setStage('solution')}
              onGoToCaseDetail={() => onCreated(createdCase.id)}
            />
          )}
        </div>
      </div>

      <AccountSearchPicker
        open={accountPickerOpen}
        companyId={form.companyId || null}
        selectedAccountId={form.accountId || null}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={handleSelectAccount}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage indicator
// ─────────────────────────────────────────────────────────────────

function StageIndicator({ stage, hasCase }: { stage: Stage; hasCase: boolean }) {
  const items: Array<{ key: Stage | 'closure-or-transfer'; label: string }> = [
    { key: 'opening', label: '1 Açılış' },
    { key: 'solution', label: '2 Çözüm' },
    { key: 'closure-or-transfer', label: '3 Kapanış / Devir' },
  ];
  const active =
    stage === 'opening'
      ? 'opening'
      : stage === 'solution'
        ? 'solution'
        : 'closure-or-transfer';
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      {items.map((it, i) => {
        const isActive = it.key === active;
        const isPast =
          (it.key === 'opening' && hasCase) ||
          (it.key === 'solution' && (stage === 'closure' || stage === 'transfer'));
        return (
          <div key={it.key} className="flex items-center gap-1.5">
            <span
              className={
                isActive
                  ? 'rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                  : isPast
                    ? 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500 dark:bg-ndark-bg dark:text-ndark-muted'
              }
            >
              {it.label}
            </span>
            {i < items.length - 1 && <span className="text-slate-300">›</span>}
          </div>
        );
      })}
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-dim">
      {text}
    </h3>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage 1 placeholder (right column)
// ─────────────────────────────────────────────────────────────────

function Stage1Placeholder() {
  return (
    <Card>
      <CardBody>
        <SectionTitle text="2. Çözüm Denemesi" />
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center dark:border-ndark-border dark:bg-ndark-bg/40">
          <Sparkles size={20} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-ndark-muted">
            Sol taraftaki formu doldur, isteğe bağlı "KB ile Analiz Et" ile sınıflandırma önerisi al.
            <br />
            Sonra <strong>"Vaka Oluştur ve Çözüm Adımlarına Geç"</strong> tıklayınca AI önerilen
            adımlar burada görünecek.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage 2 — Solution (embed CaseSolutionStepsPanel)
// ─────────────────────────────────────────────────────────────────

function Stage2Solution({
  createdCase,
  onCaseChanged,
  onGoToClosure,
  onGoToTransfer,
  onGoToCaseDetail,
}: {
  createdCase: Case;
  onCaseChanged: (c: Case) => void;
  onGoToClosure: () => void;
  onGoToTransfer: () => void;
  onGoToCaseDetail: () => void;
}) {
  // Çözüm Adımları paneli mevcut CaseSolutionStepsPanel — reuse.
  // Panel kendi yarış kontrolünü (stale guard) item.id üzerinden yapıyor;
  // burada item her zaman createdCase olduğundan ek bir guard gerekmez.
  return (
    <div className="space-y-3">
      <CaseSolutionStepsPanel
        item={createdCase}
        onChange={() => {
          // Panel local state'ini yönetiyor; biz Case object'i yenileyelim
          // ki closure'a girerken güncel olsun.
          void caseService.get(createdCase.id).then((c) => {
            if (c) onCaseChanged(c);
          });
        }}
      />
      <Card>
        <CardBody>
          <SectionTitle text="3. Kapanış · Devir · Detay" />
          <p className="mt-2 text-xs text-slate-500 dark:text-ndark-muted">
            L1 denemeleri tamamlandı mı? Sonraki adımı seç. Vaka otomatik kapatılmaz.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button leftIcon={<Check size={12} />} onClick={onGoToClosure}>
              Kapanışa Geç
            </Button>
            <Button variant="outline" onClick={onGoToTransfer}>
              L2'ye Devret
            </Button>
            <Button variant="ghost" leftIcon={<ExternalLink size={12} />} onClick={onGoToCaseDetail}>
              Vaka Detayına Git
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage 3 — Closure form
// ─────────────────────────────────────────────────────────────────

interface ClosureListsRef {
  rcgList: SmartTicketRootCauseGroup[];
  rcdList: SmartTicketTaxonomyItem[];
  rtList: SmartTicketTaxonomyItem[];
  ppList: SmartTicketTaxonomyItem[];
}

function Stage3Closure({
  closure,
  setClosure,
  closureLists,
  closing,
  closureError,
  requiredChecklistPending,
  onClose,
  onBack,
  onGoToCaseDetail,
}: {
  closure: ClosureFormState;
  setClosure: (fn: (c: ClosureFormState) => ClosureFormState) => void;
  closureLists: ClosureListsRef;
  closing: boolean;
  closureError: string | null;
  /**
   * Codex PR review P1 — StatusTransitionPanel'deki checklist gating
   * burada da uygulanır. Tamamlanmamış zorunlu kontrol listesi maddeleri
   * varsa "Vakayı Kapat" disabled olur ve banner görünür.
   */
  requiredChecklistPending: { id: string; label: string }[];
  onClose: () => void;
  onBack: () => void;
  onGoToCaseDetail: () => void;
}) {
  const checklistBlocked = requiredChecklistPending.length > 0;
  const canSave =
    closure.resolutionNote.trim().length > 0 && !closing && !checklistBlocked;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle text="3. Kapanış" />
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<CornerUpLeft size={11} />}
            onClick={onBack}
            disabled={closing}
          >
            Çözüm Adımlarına Geri Dön
          </Button>
        </div>
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          Vakanın nasıl çözüldüğünü kayıt altına alın. Onay politikası geçerliyse mevcut çözüm onayı
          akışı çalışır; otomatik bypass yok.
        </p>
        {checklistBlocked && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <div className="mb-1 font-semibold">
              Vaka çözülmeden önce {requiredChecklistPending.length} zorunlu kontrol maddesi
              tamamlanmalı:
            </div>
            <ul className="ml-4 list-disc space-y-0.5">
              {requiredChecklistPending.map((it) => (
                <li key={it.id}>{it.label}</li>
              ))}
            </ul>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-rose-700 dark:text-rose-300">
              <span>
                Vaka Detayı → <strong>Kontrol Listesi</strong> bölümünden işaretleyin.
              </span>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<ExternalLink size={11} />}
                onClick={onGoToCaseDetail}
              >
                Vaka Detayına Git
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Kök Neden Grubu">
            <Select
              value={closure.rootCauseGroup}
              onChange={(e) => setClosure((c) => ({ ...c, rootCauseGroup: e.target.value }))}
              disabled={closureLists.rcgList.length === 0}
            >
              <option value="">— Seçim yok —</option>
              {closureLists.rcgList.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Kök Neden Detayı"
            hint={
              closure.rootCauseGroup && closureLists.rcdList.length === 0
                ? 'Bu grubun detay satırı yok.'
                : undefined
            }
          >
            <Select
              value={closure.rootCauseDetail}
              onChange={(e) => setClosure((c) => ({ ...c, rootCauseDetail: e.target.value }))}
              disabled={!closure.rootCauseGroup || closureLists.rcdList.length === 0}
            >
              <option value="">— Seçim yok —</option>
              {closureLists.rcdList.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Çözüm Tipi">
            <Select
              value={closure.resolutionType}
              onChange={(e) => setClosure((c) => ({ ...c, resolutionType: e.target.value }))}
              disabled={closureLists.rtList.length === 0}
            >
              <option value="">— Seçim yok —</option>
              {closureLists.rtList.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kalıcı Önlem">
            <Select
              value={closure.permanentPrevention}
              onChange={(e) => setClosure((c) => ({ ...c, permanentPrevention: e.target.value }))}
              disabled={closureLists.ppList.length === 0}
            >
              <option value="">— Seçim yok —</option>
              {closureLists.ppList.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Çözüm Açıklaması" required>
          <TextArea
            rows={4}
            value={closure.resolutionNote}
            onChange={(e) => setClosure((c) => ({ ...c, resolutionNote: e.target.value }))}
            placeholder="Sorun nasıl çözüldü? Müşteriye ne anlatıldı?"
          />
        </Field>
        {closureError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {closureError}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
          <Button variant="outline" onClick={onBack} disabled={closing}>
            Vazgeç
          </Button>
          <Button onClick={onClose} disabled={!canSave} leftIcon={closing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}>
            {closing ? 'Kapatılıyor…' : 'Vakayı Kapat'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage 3 — L2 transfer placeholder
// Spec G/F: tam transfer integration çok geniş; bu PR'da placeholder +
// Case Detail escape ile gap raporlanır. Mevcut transferCase akışı
// (caseRepository.transferToTeam) Case Detail tarafında zaten çalışıyor.
// ─────────────────────────────────────────────────────────────────

function Stage3TransferPlaceholder({
  caseNumber,
  onBack,
  onGoToCaseDetail,
}: {
  caseNumber: string;
  onBack: () => void;
  onGoToCaseDetail: () => void;
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle text="3. L2'ye Devir" />
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<CornerUpLeft size={11} />}
            onClick={onBack}
          >
            Çözüm Adımlarına Geri Dön
          </Button>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">L2 devir formu bu sürümde Smart Ticket ekranında YOK.</p>
          <p className="mt-1 text-[12px]">
            Mevcut "Vaka Aktarımı" akışı Case Detail içinde tam fonksiyonel — hedef takım, gerekçe,
            otomatik özet çalışıyor. Bu PR placeholder sunar; Smart Ticket ekranına gömülü transfer
            formu sonraki PR'da gelir.
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
          <p className="font-medium">Şimdi ne yapabilirsin:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>"Vaka Detayına Git" tıkla → mevcut Devret modal'ı ile L2 aktarımı yap.</li>
            <li>Veya çözüm adımlarına dön, son bir deneme yap.</li>
          </ul>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
          <Button variant="outline" onClick={onBack}>
            Geri Dön
          </Button>
          <Button leftIcon={<ExternalLink size={12} />} onClick={onGoToCaseDetail}>
            Vaka Detayına Git ({caseNumber})
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
