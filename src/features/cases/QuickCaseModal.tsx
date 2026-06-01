/**
 * QuickCaseModal V2 — L1 Intake Foundation.
 *
 * Replaces the original "3 alan" Quick Case modal with a real L1
 * intake screen. Kept fast (single-shot Vakayı Aç) but no longer
 * opens cases blindly with hidden hardcoded defaults.
 *
 * Sections (left intake column):
 *   1. Şirket           — real lookup, auto-selects when user has one
 *   2. Müşteri          — AccountSearchPicker + customerless toggle
 *                          (gated by companySettings.requireCustomer
 *                          OnCaseCreate); right rail mounts
 *                          CustomerPulsePanel{kind:'account'} pre-create
 *   3. Proje            — AccountProject select when account+company
 *                          has active projects; required when
 *                          company.projectsRequired
 *   4. Vaka Tipi        — GeneralSupport / ProactiveTracking / Churn
 *   5. Vaka Konusu      — title + voice
 *   6. Açıklama (ops.)  — compact textarea + voice; triggers RUNA AI
 *                          suggest-category + suggest-title at ≥20 chars
 *   7. Sınıflandırma    — Category / SubCategory / RequestType (compact)
 *   8. Öncelik          — chip row (Low/Medium/High/Critical)
 *   9. Kanal            — chip row (Telefon/E-posta/Web/Chatbot/Diğer)
 *  10. Ürün / Paket     — when caseCatalog returns data for account
 *  11. RUNA AI önerileri — NewCaseForm pattern reused verbatim
 *                          (description ≥20 chars, 1500ms debounce,
 *                          stale-guard, Apply All writes ai* fields to
 *                          create payload, dismiss writes telemetry)
 *  12. Müşteriye denetilecek öneriler — placeholder card. External
 *                          KB /categorize wiring deferred to a follow-up
 *                          PR to keep scope tight; settings-status
 *                          gating + role checks land there.
 *  13. Kanıt / Dosyalar — local pending queue; addFile sequential
 *                          replay AFTER successful case create
 *  14. Devret hazırlığı  — collapsed by default; user-facing copy says
 *                          "Devret" (never "L2"); when toggled on the
 *                          orchestration calls caseService.transferCase
 *                          AFTER case create succeeds
 *
 * Orchestration (Vakayı Aç → handleSubmit):
 *   1. validate required fields
 *   2. caseService.create(input)  ← case is born; ai* telemetry fields
 *                                    persisted when user applied AI
 *   3. for each pending file: caseService.addFile sequential w/ progress
 *   4. if transferEnabled: caseService.transferCase(newCase.id, ...)
 *   5. summary toast (files X/Y, transfer ok/fail), onCreated(case)
 *   Case creation is NEVER rolled back if a downstream step fails;
 *   failures are surfaced in the summary so the user can recover from
 *   the case detail.
 *
 * Backend / schema: unchanged. No new endpoints, no new tables. The
 * route POST /api/cases accepts everything we send today; this PR
 * just stops hiding fields under QUICK_DEFAULTS.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Building2,
  CheckCircle2,
  Paperclip,
  Search,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, TextArea, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { useToast } from '@/components/ui/Toast';
import {
  caseService,
  lookupService,
  type NewCaseInput,
} from '@/services/caseService';
import { accountService } from '@/services/accountService';
import {
  aiService,
  aiErrorMessage,
  type CategorySuggestion,
  type TitleSuggestion,
  type TransferReasonCode,
} from '@/services/aiService';
import {
  CASE_FILE_MAX_COUNT,
  CASE_FILE_MAX_SIZE,
  CASE_ORIGINS,
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_REQUEST_TYPES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseCompany,
  type CaseOrigin,
  type CasePriority,
  type CaseRequestType,
  type CaseType,
} from './types';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import { CustomerPulsePanel } from './components/CustomerPulsePanel';
import { formatBytes } from '@/lib/format';

interface QuickCaseModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Case) => void;
  prefillAccountId?: string | null;
}

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 2000;
const DESCRIPTION_AI_THRESHOLD = 20;
const AI_DEBOUNCE_MS = 1500;
const MIN_REASON = 5;

const CASE_TYPE_HINTS: Record<CaseType, string> = {
  GeneralSupport: 'Destek, şikayet veya bilgi talebi',
  ProactiveTracking: 'Kullanım düşüşü veya finansal risk takibi',
  Churn: 'Müşteri iptal talebi yönetimi',
};

interface TransferReasonChip {
  code: TransferReasonCode;
  label: string;
}
const TRANSFER_REASON_CHIPS: TransferReasonChip[] = [
  { code: 'wrong_team', label: 'Yanlış Takım' },
  { code: 'expertise', label: 'Uzmanlık' },
  { code: 'workload', label: 'İş Yükü' },
  { code: 'escalation', label: 'Eskalasyon' },
  { code: 'customer_request', label: 'Müşteri Talebi' },
  { code: 'other', label: 'Diğer' },
];

interface PendingFile {
  file: File;
  id: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  percent: number;
  errorMessage?: string;
}

interface IntakeForm {
  companyId: string;
  companyName: string;
  accountId: string | null;
  accountName: string | null;
  accountProjectId: string;
  accountProjectName: string;
  customerless: boolean;
  caseType: CaseType;
  title: string;
  description: string;
  category: string;
  subCategory: string;
  requestType: CaseRequestType | '';
  priority: CasePriority;
  origin: CaseOrigin;
  originDescription: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
}

const emptyForm: IntakeForm = {
  companyId: '',
  companyName: '',
  accountId: null,
  accountName: null,
  accountProjectId: '',
  accountProjectName: '',
  customerless: false,
  caseType: 'GeneralSupport',
  title: '',
  description: '',
  category: '',
  subCategory: '',
  requestType: '',
  priority: 'Medium',
  origin: 'Diğer',
  originDescription: '',
  productId: '',
  productName: '',
  packageId: '',
  packageName: '',
};

type SubmitPhase = 'idle' | 'creating' | 'uploading' | 'transferring' | 'done';

export function QuickCaseModal({
  open,
  onClose,
  onCreated,
  prefillAccountId,
}: QuickCaseModalProps) {
  const [form, setForm] = useState<IntakeForm>(emptyForm);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Lookups (sync from bootstrap)
  const companies = useMemo<CaseCompany[]>(() => lookupService.companies(), []);
  const categories = useMemo(() => lookupService.categories(), []);
  const teams = useMemo(() => lookupService.teams(), []);

  // Per-company derived
  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === form.companyId) ?? null,
    [companies, form.companyId],
  );
  const requireCustomer = selectedCompany?.requireCustomerOnCaseCreate ?? false;
  const projectsEnabled = selectedCompany?.projectsEnabled ?? false;
  const projectsRequired = selectedCompany?.projectsRequired ?? false;

  // Categories — flat shape; cascade subCategories
  const subCategoriesForCategory = useMemo(() => {
    const found = categories.find((c) => c.category === form.category);
    return found?.subCategories ?? [];
  }, [categories, form.category]);

  // Account projects — fetched lazily when account+company chosen
  const [projects, setProjects] = useState<
    Array<{ id: string; code?: string | null; name: string }>
  >([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Catalog — fetched on (companyId, accountId)
  const [catalogPackages, setCatalogPackages] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [catalogProducts, setCatalogProducts] = useState<
    Array<{ id: string; code: string; name: string; productGroupId?: string | null }>
  >([]);
  const [catalogPackageItems, setCatalogPackageItems] = useState<Record<string, string[]>>({});

  // RUNA AI state
  const aiReqIdRef = useRef(0);
  const [aiSuggestion, setAiSuggestion] = useState<CategorySuggestion | null>(null);
  const [aiTitle, setAiTitle] = useState<TitleSuggestion | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [titleApplied, setTitleApplied] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);

  // Files pending queue (local; uploaded post-create)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // Transfer prep
  const [transferEnabled, setTransferEnabled] = useState(false);
  const [transferExpanded, setTransferExpanded] = useState(false);
  const [transferToTeamId, setTransferToTeamId] = useState('');
  const [transferToPersonId, setTransferToPersonId] = useState('');
  const [transferReasonCode, setTransferReasonCode] = useState<TransferReasonCode | ''>('');
  const [transferReasonText, setTransferReasonText] = useState('');

  // Team-filtered persons for the transfer picker
  const transferTeamsForCompany = useMemo(
    () => teams.filter((t) => t.companyId === form.companyId && t.isActive),
    [teams, form.companyId],
  );
  const transferPersonsForTeam = useMemo(
    () => (transferToTeamId ? lookupService.personsByTeam(transferToTeamId) : []),
    [transferToTeamId],
  );

  // ── Init / reset on open ──────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      // Reset everything on close
      setForm(emptyForm);
      setProjects([]);
      setCatalogPackages([]);
      setCatalogProducts([]);
      setCatalogPackageItems({});
      setAiSuggestion(null);
      setAiTitle(null);
      setAiSuggesting(false);
      setAiError(null);
      setAiApplied(false);
      setTitleApplied(false);
      setAiCollapsed(false);
      setPendingFiles([]);
      setTransferEnabled(false);
      setTransferExpanded(false);
      setTransferToTeamId('');
      setTransferToPersonId('');
      setTransferReasonCode('');
      setTransferReasonText('');
      setPhase('idle');
      setGlobalError(null);
      return;
    }
    // Auto-select company when only one is available
    setForm((f) => {
      if (f.companyId) return f;
      if (companies.length === 1) {
        const only = companies[0];
        return { ...f, companyId: only.id, companyName: only.name };
      }
      return f;
    });
    if (prefillAccountId) {
      void accountService.get(prefillAccountId).then((acc) => {
        if (acc) {
          setForm((f) => ({
            ...f,
            accountId: acc.id,
            accountName: acc.name,
            customerless: false,
          }));
        }
      });
    }
    const t = window.setTimeout(() => titleRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, prefillAccountId, companies]);

  // ── Account projects fetch ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (!projectsEnabled || !form.accountId || !form.companyId) {
      setProjects([]);
      setProjectsLoading(false);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void accountService.get(form.accountId).then((detail) => {
      if (cancelled) return;
      setProjectsLoading(false);
      if (!detail) {
        setProjects([]);
        return;
      }
      const company = detail.companies?.find((c) => c.companyId === form.companyId);
      const active =
        company?.projects?.filter(
          (p) => p.isActive && p.status === 'Active',
        ) ?? [];
      setProjects(active.map((p) => ({ id: p.id, code: p.code, name: p.name })));
      // Auto-select when single project
      if (active.length === 1) {
        setForm((f) => ({
          ...f,
          accountProjectId: active[0].id,
          accountProjectName: active[0].name,
        }));
      } else {
        // Clear stale project selection
        setForm((f) => ({ ...f, accountProjectId: '', accountProjectName: '' }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectsEnabled, form.accountId, form.companyId]);

  // ── Catalog fetch (packages + products) ───────────────────────────
  useEffect(() => {
    if (!open || !form.companyId || !form.accountId) {
      setCatalogPackages([]);
      setCatalogProducts([]);
      setCatalogPackageItems({});
      return;
    }
    let cancelled = false;
    void lookupService
      .caseCatalog({ companyId: form.companyId, accountId: form.accountId })
      .then((cat) => {
        if (cancelled || !cat) return;
        setCatalogPackages(cat.packages ?? []);
        setCatalogProducts(cat.products ?? []);
        setCatalogPackageItems(cat.packageItems ?? {});
        // Preselect suggestedPackage
        if (cat.suggestedPackage && !form.packageId) {
          const pkg = cat.packages?.find((p) => p.id === cat.suggestedPackage);
          if (pkg) {
            setForm((f) => ({ ...f, packageId: pkg.id, packageName: pkg.name }));
          }
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.companyId, form.accountId]);

  // ── Subcategory reconciliation when category changes ──────────────
  useEffect(() => {
    if (!form.subCategory) return;
    if (!subCategoriesForCategory.includes(form.subCategory)) {
      setForm((f) => ({ ...f, subCategory: '' }));
    }
  }, [form.subCategory, subCategoriesForCategory]);

  // ── RUNA AI — suggest-category + suggest-title (NewCaseForm pattern)
  useEffect(() => {
    if (!open || aiCollapsed) return;
    const desc = form.description.trim();
    if (desc.length < DESCRIPTION_AI_THRESHOLD) {
      setAiSuggestion(null);
      setAiTitle(null);
      setAiSuggesting(false);
      setAiError(null);
      return;
    }
    if (categories.length === 0) return; // backend rejects empty availableCategories
    const reqId = ++aiReqIdRef.current;
    setAiSuggesting(true);
    const handle = window.setTimeout(async () => {
      const [catR, titleR] = await Promise.all([
        aiService.suggestCategory({
          description: desc,
          caseType: form.caseType,
          companyName: form.companyName || undefined,
          availableCategories: categories,
          availableRequestTypes: CASE_REQUEST_TYPES,
        }),
        aiService.suggestTitle({
          description: desc,
          caseType: form.caseType,
          companyId: form.companyId || undefined,
        }),
      ]);
      // Stale request guard
      if (reqId !== aiReqIdRef.current) return;
      setAiSuggesting(false);
      if (catR.ok) {
        setAiSuggestion(catR.data);
        setAiError(null);
      } else {
        setAiError(aiErrorMessage(catR.error));
      }
      if (titleR.ok) {
        setAiTitle(titleR.data);
      }
    }, AI_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.description, form.caseType, form.companyId, aiCollapsed]);

  // ── Voice transcription helpers ───────────────────────────────────
  function appendVoiceToTitle(chunk: string) {
    setForm((f) => {
      const next = f.title ? `${f.title} ${chunk}` : chunk;
      return { ...f, title: next.length > TITLE_MAX ? next.slice(0, TITLE_MAX) : next };
    });
  }
  function appendVoiceToDescription(chunk: string) {
    setForm((f) => {
      const next = f.description ? `${f.description} ${chunk}` : chunk;
      return {
        ...f,
        description: next.length > DESCRIPTION_MAX ? next.slice(0, DESCRIPTION_MAX) : next,
      };
    });
  }

  // ── AI Apply / Dismiss handlers ───────────────────────────────────
  function applyAllFromAi() {
    if (!aiSuggestion) return;
    const validSubs =
      categories.find((c) => c.category === aiSuggestion.category)?.subCategories ?? [];
    const safeSub = validSubs.includes(aiSuggestion.subCategory) ? aiSuggestion.subCategory : '';
    setForm((f) => ({
      ...f,
      title: aiTitle?.title ?? f.title,
      category: aiSuggestion.category,
      subCategory: safeSub,
      requestType: aiSuggestion.requestType,
      priority: aiSuggestion.priority,
    }));
    setAiApplied(true);
    if (aiTitle?.title) {
      setTitleApplied(true);
      void aiService.markUsageAccepted(aiTitle.usageLogId, true);
    }
    setAiCollapsed(true);
    toast({ type: 'success', message: 'RUNA AI önerileri uygulandı.', duration: 2000 });
  }
  function dismissAiCard() {
    if (aiTitle && !titleApplied) {
      void aiService.markUsageAccepted(aiTitle.usageLogId, false);
    }
    setAiCollapsed(true);
  }

  // ── Pending files handlers ───────────────────────────────────────
  function pickFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const remaining = CASE_FILE_MAX_COUNT - pendingFiles.length;
    if (list.length > remaining) {
      toast({
        type: 'warn',
        message: `En fazla ${remaining} dosya daha eklenebilir (toplam limit ${CASE_FILE_MAX_COUNT}).`,
      });
      return;
    }
    const oversized = list.filter((f) => f.size > CASE_FILE_MAX_SIZE);
    if (oversized.length > 0) {
      const maxMb = Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024));
      toast({
        type: 'error',
        message: `${oversized.length} dosya ${maxMb} MB sınırını aşıyor.`,
      });
      return;
    }
    setPendingFiles((q) => [
      ...q,
      ...list.map((f, i) => ({
        file: f,
        id: `${Date.now()}-${i}-${f.name}`,
        status: 'queued' as const,
        percent: 0,
      })),
    ]);
  }
  function removePendingFile(id: string) {
    setPendingFiles((q) => q.filter((p) => p.id !== id));
  }

  // ── Validation ───────────────────────────────────────────────────
  const reasonOk =
    !transferEnabled ||
    (transferReasonCode !== '' &&
      (transferReasonCode === 'other'
        ? transferReasonText.trim().length >= MIN_REASON
        : transferReasonText.trim().length === 0 ||
          transferReasonText.trim().length >= MIN_REASON));

  const canSubmit =
    phase === 'idle' &&
    !!form.companyId &&
    !!form.title.trim() &&
    !!form.category &&
    !!form.subCategory &&
    !!form.requestType &&
    (!requireCustomer || !!form.accountId || form.customerless) &&
    (form.customerless || !!form.accountId) &&
    (!projectsRequired || !form.accountId || !!form.accountProjectId) &&
    (form.origin !== 'Diğer' || !!form.originDescription.trim()) &&
    (!transferEnabled || (!!transferToTeamId && reasonOk));

  // ── Submit orchestration ─────────────────────────────────────────
  async function handleSubmit() {
    if (!canSubmit) return;
    setGlobalError(null);
    setPhase('creating');

    const input: NewCaseInput = {
      title: form.title.trim(),
      description: form.description.trim() || '— Açıklama eklenmedi —',
      caseType: form.caseType,
      priority: form.priority,
      origin: form.origin,
      originDescription:
        form.origin === 'Diğer' ? form.originDescription.trim() : undefined,
      companyId: form.companyId,
      companyName: form.companyName,
      accountId: form.customerless ? undefined : form.accountId ?? undefined,
      accountName: form.customerless ? undefined : form.accountName ?? undefined,
      accountProjectId: form.accountProjectId || undefined,
      accountProjectName: form.accountProjectName || undefined,
      category: form.category,
      subCategory: form.subCategory,
      requestType: form.requestType as CaseRequestType,
      productId: form.productId || undefined,
      packageId: form.packageId || undefined,
      // AI telemetry — only when user applied a suggestion
      aiGeneratedFlag: aiApplied,
      aiCategoryPrediction: aiApplied ? aiSuggestion?.category : undefined,
      aiPriorityPrediction: aiApplied ? aiSuggestion?.priority : undefined,
      aiConfidenceScore: aiApplied ? aiSuggestion?.confidence : undefined,
    };

    let created: Case;
    try {
      created = await caseService.create(input);
    } catch {
      setPhase('idle');
      // apiFetch toast already surfaced; keep modal open for retry.
      return;
    }

    // ── Upload pending files (sequential, post-create) ───────────────
    let filesOk = 0;
    let filesFail = 0;
    if (pendingFiles.length > 0) {
      setPhase('uploading');
      for (const pf of pendingFiles) {
        setPendingFiles((q) =>
          q.map((p) => (p.id === pf.id ? { ...p, status: 'uploading', percent: 0 } : p)),
        );
        const result = await caseService.addFile(created.id, pf.file, (percent) => {
          setPendingFiles((q) =>
            q.map((p) => (p.id === pf.id ? { ...p, percent } : p)),
          );
        });
        if (!result || 'error' in result) {
          filesFail += 1;
          setPendingFiles((q) =>
            q.map((p) =>
              p.id === pf.id
                ? {
                    ...p,
                    status: 'error',
                    percent: 100,
                    errorMessage:
                      result && 'error' in result ? result.error : 'Yükleme başarısız',
                  }
                : p,
            ),
          );
        } else {
          filesOk += 1;
          created = result.caseUpdated;
          setPendingFiles((q) =>
            q.map((p) => (p.id === pf.id ? { ...p, status: 'done', percent: 100 } : p)),
          );
        }
      }
    }

    // ── Transfer (post-create) ────────────────────────────────────────
    let transferOk = false;
    let transferFail = false;
    if (transferEnabled && transferToTeamId && transferReasonCode) {
      setPhase('transferring');
      const reasonLabel =
        TRANSFER_REASON_CHIPS.find((c) => c.code === transferReasonCode)?.label ??
        'Devir gerekçesi';
      const finalReason =
        transferReasonText.trim().length >= MIN_REASON
          ? transferReasonText.trim()
          : reasonLabel;
      const updated = await caseService.transferCase(created.id, {
        toTeamId: transferToTeamId,
        toPersonId: transferToPersonId || undefined,
        reason: finalReason,
        reasonCode: transferReasonCode,
      });
      if (updated) {
        transferOk = true;
        created = updated;
      } else {
        transferFail = true;
      }
    }

    setPhase('done');

    // ── Summary toast + navigate ─────────────────────────────────────
    const summaryParts: string[] = [`${created.caseNumber} — ${created.title}`];
    if (pendingFiles.length > 0) {
      summaryParts.push(
        filesFail === 0
          ? `${filesOk} dosya yüklendi`
          : `${filesOk}/${pendingFiles.length} dosya yüklendi (${filesFail} hata)`,
      );
    }
    if (transferEnabled) {
      summaryParts.push(transferOk ? 'devir tamamlandı' : 'devir TAMAMLANAMADI');
    }

    const hasFailure = filesFail > 0 || transferFail;
    toast({
      type: hasFailure ? 'warn' : 'success',
      title: hasFailure ? 'Vaka açıldı — bazı adımlar başarısız' : 'Vaka oluşturuldu',
      message: summaryParts.join(' · '),
      duration: hasFailure ? 8000 : 5000,
      action: { label: 'Detayı Aç', onClick: () => onCreated(created) },
    });

    if (hasFailure) {
      // Keep modal open so user can see file errors / retry transfer.
      // Reset phase to idle so user can act.
      setPhase('idle');
      setGlobalError(
        transferFail
          ? 'Vaka açıldı ancak devir tamamlanamadı. "Detayı Aç" ile vakayı açıp tekrar deneyebilirsin.'
          : 'Vaka açıldı ancak bazı dosyalar yüklenemedi.',
      );
    } else {
      onClose();
      onCreated(created);
    }
  }

  // ── Header label / phase copy ─────────────────────────────────────
  const submitLabel =
    phase === 'creating'
      ? 'Açılıyor…'
      : phase === 'uploading'
        ? 'Dosyalar yükleniyor…'
        : phase === 'transferring'
          ? 'Devrediliyor…'
          : 'Vakayı Aç';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      bodyClassName="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin"
      title={
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          <span>Vaka Aç</span>
          <Badge tint="amber">L1 intake</Badge>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ndark-muted">
            <Sparkles size={11} />
            {globalError ? (
              <span className="text-amber-700 dark:text-amber-300">{globalError}</span>
            ) : (
              'Detaylar sonra Vaka Detayında düzenlenebilir.'
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={phase !== 'idle'}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ─── Left intake column ───────────────────────────────── */}
        <div className="space-y-4">
          {/* 1. Şirket */}
          {companies.length > 1 ? (
            <Field label="Şirket" required>
              <Select
                value={form.companyId}
                onChange={(e) => {
                  const id = e.target.value;
                  const c = companies.find((x) => x.id === id);
                  setForm((f) => ({
                    ...f,
                    companyId: id,
                    companyName: c?.name ?? '',
                    // Clear customer + project + catalog when company changes
                    accountId: null,
                    accountName: null,
                    accountProjectId: '',
                    accountProjectName: '',
                    customerless: false,
                    productId: '',
                    productName: '',
                    packageId: '',
                    packageName: '',
                  }));
                }}
              >
                <option value="">Şirket seç…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : companies.length === 1 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
              Şirket:{' '}
              <span className="font-medium text-slate-700 dark:text-ndark-text">
                {companies[0].name}
              </span>
            </div>
          ) : null}

          {/* 2. Müşteri */}
          <Field label="Müşteri" required={requireCustomer && !form.customerless}>
            {form.accountId && form.accountName ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-brand-300 bg-brand-50/40 px-3 py-2 dark:border-brand-700 dark:bg-brand-900/20">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 size={14} className="text-brand-600 dark:text-brand-300" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                    {form.accountName}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                  >
                    Değiştir
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        accountId: null,
                        accountName: null,
                        accountProjectId: '',
                        accountProjectName: '',
                      }))
                    }
                    aria-label="Müşteriyi temizle"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={!form.companyId || form.customerless}
                  className="flex flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-surface"
                >
                  <Search size={14} />
                  <span className="flex-1">
                    {form.companyId
                      ? form.customerless
                        ? 'Müşterisiz vaka — picker pasif'
                        : 'Müşteri ara…'
                      : 'Önce şirket seç'}
                  </span>
                </button>
                {!requireCustomer && (
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-600 dark:text-ndark-muted">
                    <input
                      type="checkbox"
                      checked={form.customerless}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          customerless: e.target.checked,
                          accountId: e.target.checked ? null : f.accountId,
                          accountName: e.target.checked ? null : f.accountName,
                          accountProjectId: e.target.checked ? '' : f.accountProjectId,
                          accountProjectName: e.target.checked ? '' : f.accountProjectName,
                        }))
                      }
                    />
                    Müşterisiz aç
                  </label>
                )}
              </div>
            )}
            {requireCustomer && form.customerless && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                Bu şirket müşteri seçimi olmadan vaka açılmasına izin vermiyor.
              </p>
            )}
          </Field>

          {/* 3. Proje — only when company has projectsEnabled */}
          {projectsEnabled && form.accountId && (
            <Field label="Proje" required={projectsRequired}>
              {projectsLoading ? (
                <p className="text-[11.5px] italic text-slate-500 dark:text-ndark-muted">
                  Projeler yükleniyor…
                </p>
              ) : projects.length === 0 ? (
                <p className="text-[11.5px] italic text-slate-500 dark:text-ndark-muted">
                  Bu müşteri için proje yok.
                </p>
              ) : (
                <Select
                  value={form.accountProjectId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const p = projects.find((x) => x.id === id);
                    setForm((f) => ({
                      ...f,
                      accountProjectId: id,
                      accountProjectName: p?.name ?? '',
                    }));
                  }}
                >
                  {!projectsRequired && <option value="">— Proje yok —</option>}
                  {projectsRequired && !form.accountProjectId && (
                    <option value="">Proje seç…</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `${p.code} — ${p.name}` : p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {/* 4. Vaka tipi */}
          <Field label="Vaka Tipi" required>
            <div className="flex flex-wrap gap-1.5">
              {CASE_TYPES.map((t) => {
                const active = form.caseType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, caseType: t }))}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                      active
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-surface'
                    }`}
                  >
                    {CASE_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-ndark-muted">
              {CASE_TYPE_HINTS[form.caseType]}
            </p>
          </Field>

          {/* 5. Title */}
          <Field
            label="Vaka Konusu"
            required
            actions={<VoiceNoteButton onTranscript={appendVoiceToTitle} />}
          >
            <TextInput
              ref={titleRef}
              placeholder="Kısa, özetleyici bir konu yaz…"
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <div className="flex justify-end text-[11px] text-slate-400 dark:text-ndark-dim">
              <span className={form.title.length > TITLE_MAX * 0.9 ? 'text-amber-600' : ''}>
                {form.title.length}/{TITLE_MAX}
              </span>
            </div>
          </Field>

          {/* 6. Optional description (AI trigger) */}
          <Field
            label="İlk Açıklama (opsiyonel)"
            hint="20+ karakter girersen RUNA AI önerileri devreye girer."
            actions={<VoiceNoteButton onTranscript={appendVoiceToDescription} />}
          >
            <TextArea
              rows={3}
              placeholder="Müşteri ne anlattı? Durumu kısaca yaz…"
              value={form.description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </Field>

          {/* 7. RUNA AI suggestion card */}
          {!aiCollapsed && (aiSuggesting || aiSuggestion || aiError || aiTitle) && (
            <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                  <Brain size={12} />
                  RUNA AI Önerileri
                </div>
                <button
                  type="button"
                  onClick={dismissAiCard}
                  className="rounded px-2 py-0.5 text-[11px] text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/30"
                >
                  Kapat
                </button>
              </div>
              {aiSuggesting && (
                <p className="mt-2 text-[12px] italic text-violet-700 dark:text-violet-300">
                  Öneriler hazırlanıyor…
                </p>
              )}
              {aiError && !aiSuggesting && (
                <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">
                  {aiError}
                </p>
              )}
              {!aiSuggesting && aiSuggestion && (
                <div className="mt-2 space-y-1.5 text-[12.5px] text-slate-700 dark:text-ndark-text">
                  {aiTitle?.title && (
                    <div>
                      <span className="text-slate-500 dark:text-ndark-muted">Başlık:</span>{' '}
                      <span className="font-medium">{aiTitle.title}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500 dark:text-ndark-muted">Kategori:</span>{' '}
                    <span className="font-medium">
                      {aiSuggestion.category} › {aiSuggestion.subCategory}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-ndark-muted">Talep:</span>{' '}
                    <span className="font-medium">{aiSuggestion.requestType}</span>{' '}
                    <span className="text-slate-400">·</span>{' '}
                    <span className="text-slate-500 dark:text-ndark-muted">Öncelik:</span>{' '}
                    <span className="font-medium">{aiSuggestion.priority}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
                    Güven: %{Math.round((aiSuggestion.confidence ?? 0) * 100)}
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={applyAllFromAi} leftIcon={<CheckCircle2 size={11} />}>
                      Uygula
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 8. Classification (Category / SubCategory / RequestType) */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Kategori" required>
              <Select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value,
                    subCategory: '',
                  }))
                }
              >
                <option value="">Seç…</option>
                {categories.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alt Kategori" required>
              <Select
                value={form.subCategory}
                onChange={(e) => setForm((f) => ({ ...f, subCategory: e.target.value }))}
                disabled={!form.category}
              >
                <option value="">Seç…</option>
                {subCategoriesForCategory.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Talep Türü" required>
              <Select
                value={form.requestType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requestType: e.target.value as CaseRequestType | '' }))
                }
              >
                <option value="">Seç…</option>
                {CASE_REQUEST_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {rt}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* 9. Priority + 10. Origin */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Öncelik">
              <div className="flex flex-wrap gap-1.5">
                {CASE_PRIORITIES.map((p) => {
                  const active = form.priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, priority: p }))}
                      className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ring-1 ring-inset transition ${
                        active
                          ? 'bg-brand-600 text-white ring-brand-600'
                          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border'
                      }`}
                    >
                      {CASE_PRIORITY_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field
              label="Kanal"
              hint={form.origin === 'Diğer' ? '"Diğer" seçildiğinde açıklama zorunlu.' : undefined}
            >
              <Select
                value={form.origin}
                onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value as CaseOrigin }))}
              >
                {CASE_ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
              {form.origin === 'Diğer' && (
                <TextInput
                  placeholder="Kanal açıklaması (ör. Faks, sahada)"
                  value={form.originDescription}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, originDescription: e.target.value }))
                  }
                  className="mt-1"
                />
              )}
            </Field>
          </div>

          {/* 11. Product / Package (when catalog has entries) */}
          {(catalogPackages.length > 0 || catalogProducts.length > 0) && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Paket">
                <Select
                  value={form.packageId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const pkg = catalogPackages.find((p) => p.id === id);
                    setForm((f) => ({
                      ...f,
                      packageId: id,
                      packageName: pkg?.name ?? '',
                      // Clear product if no longer in package items
                      productId:
                        id && catalogPackageItems[id]
                          ? catalogPackageItems[id].includes(f.productId)
                            ? f.productId
                            : ''
                          : f.productId,
                      productName:
                        id && catalogPackageItems[id]
                          ? catalogPackageItems[id].includes(f.productId)
                            ? f.productName
                            : ''
                          : f.productName,
                    }));
                  }}
                >
                  <option value="">— Paket yok —</option>
                  {catalogPackages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ürün">
                <Select
                  value={form.productId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const prod = catalogProducts.find((p) => p.id === id);
                    setForm((f) => ({
                      ...f,
                      productId: id,
                      productName: prod?.name ?? '',
                    }));
                  }}
                >
                  <option value="">— Ürün yok —</option>
                  {(form.packageId && catalogPackageItems[form.packageId]
                    ? catalogProducts.filter((p) =>
                        catalogPackageItems[form.packageId].includes(p.id),
                      )
                    : catalogProducts
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {/* 12. Müşteriye denetilecek öneriler (KB guidance — placeholder for now) */}
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
              <Sparkles size={12} />
              Müşteriye denetilecek öneriler
            </div>
            <p className="mt-2 text-[12px] italic text-slate-500 dark:text-ndark-muted">
              Kategori ve konu girildiğinde RUNA / Bilgi Bankası önerileri burada
              gösterilecek. (External KB entegrasyonu sonraki fazda.)
            </p>
          </div>

          {/* 13. Files pending queue */}
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
                <Paperclip size={12} />
                Kanıt / Dosyalar
                <span className="font-normal text-slate-400">
                  ({pendingFiles.length}/{CASE_FILE_MAX_COUNT})
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<UploadCloud size={11} />}
                onClick={() => filesInputRef.current?.click()}
                disabled={pendingFiles.length >= CASE_FILE_MAX_COUNT || phase !== 'idle'}
              >
                Dosya Ekle
              </Button>
              <input
                ref={filesInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) pickFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {pendingFiles.length === 0 ? (
              <p className="mt-2 text-[12px] italic text-slate-500 dark:text-ndark-muted">
                Dosyalar vaka açıldıktan sonra yüklenecek. (Maks{' '}
                {Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024))} MB / dosya)
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {pendingFiles.map((pf) => (
                  <li
                    key={pf.id}
                    className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50/60 px-2 py-1 text-[12px] dark:border-ndark-border/60 dark:bg-ndark-bg/30"
                  >
                    <Paperclip size={11} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-ndark-text">
                      {pf.file.name}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-slate-400">
                      {formatBytes(pf.file.size)}
                    </span>
                    {pf.status === 'uploading' && (
                      <span className="shrink-0 text-[10.5px] text-brand-600">
                        %{pf.percent}
                      </span>
                    )}
                    {pf.status === 'done' && (
                      <span className="shrink-0 text-[10.5px] text-emerald-600">
                        Yüklendi ✓
                      </span>
                    )}
                    {pf.status === 'error' && (
                      <span
                        className="shrink-0 text-[10.5px] text-rose-600"
                        title={pf.errorMessage}
                      >
                        Hata
                      </span>
                    )}
                    {pf.status === 'queued' && phase === 'idle' && (
                      <button
                        type="button"
                        onClick={() => removePendingFile(pf.id)}
                        aria-label="Çıkar"
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 14. Devret hazırlığı */}
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-ndark-text">
                <input
                  type="checkbox"
                  checked={transferEnabled}
                  onChange={(e) => {
                    setTransferEnabled(e.target.checked);
                    setTransferExpanded(e.target.checked);
                  }}
                />
                <UserPlus size={12} />
                Vaka açıldıktan sonra ilgili ekibe devret
              </label>
              {transferEnabled && (
                <button
                  type="button"
                  onClick={() => setTransferExpanded((v) => !v)}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-ndark-muted"
                >
                  {transferExpanded ? 'Gizle' : 'Aç'}
                </button>
              )}
            </div>
            {transferEnabled && transferExpanded && (
              <div className="mt-3 space-y-2.5">
                <Field label="Devredilecek Takım" required>
                  <Select
                    value={transferToTeamId}
                    onChange={(e) => {
                      setTransferToTeamId(e.target.value);
                      setTransferToPersonId('');
                    }}
                  >
                    <option value="">Takım seç…</option>
                    {transferTeamsForCompany.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {transferToTeamId && transferPersonsForTeam.length > 0 && (
                  <Field label="Devredilecek Kişi (opsiyonel)">
                    <Select
                      value={transferToPersonId}
                      onChange={(e) => setTransferToPersonId(e.target.value)}
                    >
                      <option value="">— Kişi seçimi yok —</option>
                      {transferPersonsForTeam.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isTeamLead ? ' (Lead)' : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Devir Nedeni" required>
                  <div className="flex flex-wrap gap-1.5">
                    {TRANSFER_REASON_CHIPS.map((chip) => {
                      const active = transferReasonCode === chip.code;
                      return (
                        <button
                          key={chip.code}
                          type="button"
                          onClick={() => setTransferReasonCode(chip.code)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
                            active
                              ? 'bg-brand-600 text-white ring-brand-600'
                              : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border'
                          }`}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field
                  label="Devir Notu / Denenenler ve eksik bilgi"
                  hint={
                    transferReasonCode === 'other'
                      ? `"Diğer" seçildi — en az ${MIN_REASON} karakter zorunlu.`
                      : `Opsiyonel; girilirse en az ${MIN_REASON} karakter.`
                  }
                >
                  <TextArea
                    rows={2}
                    placeholder="Devralacak ekip için kısa not…"
                    value={transferReasonText}
                    onChange={(e) => setTransferReasonText(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right context column ─────────────────────────────── */}
        <div className="space-y-3">
          {form.accountId && form.companyId && !form.customerless ? (
            <CustomerPulsePanel
              source={{
                kind: 'account',
                accountId: form.accountId,
                companyId: form.companyId,
              }}
            />
          ) : (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-6 text-center text-[12px] italic text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/30 dark:text-ndark-muted">
              Müşteri seç — bağlam burada görünecek.
            </div>
          )}

          {/* Submit phase indicator */}
          {phase !== 'idle' && (
            <div className="rounded-md border border-brand-200 bg-brand-50/40 px-3 py-2 text-[12px] text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-200">
              <Send size={11} className="mr-1 inline" />
              {phase === 'creating' && 'Vaka açılıyor…'}
              {phase === 'uploading' && 'Dosyalar yükleniyor…'}
              {phase === 'transferring' && 'Devir yapılıyor…'}
              {phase === 'done' && 'Tamamlandı.'}
            </div>
          )}
          {globalError && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle size={11} className="mr-1 inline" />
              {globalError}
            </div>
          )}
        </div>
      </div>

      <AccountSearchPicker
        open={pickerOpen}
        selectedAccountId={form.accountId}
        onClose={() => setPickerOpen(false)}
        onSelect={(account) => {
          setPickerOpen(false);
          if (account) {
            setForm((f) => ({
              ...f,
              accountId: account.id,
              accountName: account.name,
              customerless: false,
            }));
          }
        }}
      />
    </Modal>
  );
}

export default QuickCaseModal;
