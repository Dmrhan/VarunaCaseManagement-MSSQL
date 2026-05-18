import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ExternalLink,
  HeadphonesIcon,
  History,
  LineChart,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  UserX,
  X,
  Zap,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { CustomFieldsSection, validateCustomFields } from '@/components/CustomFieldRenderer';
import { useToast } from '@/components/ui/Toast';
import { CustomerPulsePanel } from './components/CustomerPulsePanel';
import { caseService, lookupService, type NewCaseInput } from '@/services/caseService';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import {
  aiService,
  aiErrorMessage,
  type CategorySuggestion,
  type TitleSuggestion,
} from '@/services/aiService';
import {
  CASE_ORIGINS,
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_REQUEST_TYPES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  FINANCIAL_STATUSES,
  OFFER_OUTCOMES,
  PRODUCT_USAGES,
  RESPONSE_LEVELS,
  USAGE_CHANGE_ALERTS,
  type Case,
  type CaseOrigin,
  type CasePriority,
  type CaseRequestType,
  type CaseType,
  type FinancialStatus,
  type OfferOutcome,
  type ProductUsage,
  type ResponseLevel,
  type UsageChangeAlert,
} from './types';

interface NewCaseFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Case) => void;
  onShowExisting?: (caseId: string) => void;
}

const emptyForm = {
  title: '',
  description: '',
  caseType: 'GeneralSupport' as CaseType,
  priority: 'Medium' as CasePriority,
  origin: 'Telefon' as CaseOrigin,
  originDescription: '',
  companyId: '',
  accountId: '',
  accountName: '',
  // Phase D Step 2 — opsiyonel başvuran bilgileri (müşterisiz vakada eşleştirme sinyali)
  customerContactName: '',
  customerContactPhone: '',
  customerContactEmail: '',
  customerCompanyName: '',
  category: '',
  subCategory: '',
  requestType: '' as '' | CaseRequestType,
  productGroup: '',
  assignedTeamId: '',
  assignedPersonId: '',

  // Spec 5.2 — ProactiveTracking
  financialStatus:    '' as '' | FinancialStatus,
  productUsage:       '' as '' | ProductUsage,
  usageChangeAlert:   '' as '' | UsageChangeAlert,
  responseLevel:      '' as '' | ResponseLevel,

  // Spec 5.3 — Churn
  cancellationRequest: false,
  offeredSolutions:    [] as string[],
  offerExpiryDate:     '',
  offerOutcome:        '' as '' | OfferOutcome,
  offerRejectionReason:'',
  actionTaken:         '',
  followUpDate:        '',
};

const DESCRIPTION_AI_THRESHOLD = 20;
const AI_DEBOUNCE_MS = 1500;

// SLA tahmin tablosu — gerçek SLAPolicy lookup FAZ 3'te
const SLA_BY_PRIORITY: Record<CasePriority, [number, number]> = {
  Low:      [12, 72],
  Medium:   [8, 48],
  High:     [4, 24],
  Critical: [1, 6],
};

const PRIORITY_CHIP_STYLE: Record<CasePriority, string> = {
  Low:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted',
  Medium:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
  High:
    'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-300',
  Critical:
    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300',
};

const PRIORITY_CHIP_DOT: Record<CasePriority, string> = {
  Low: 'bg-slate-400',
  Medium: 'bg-amber-500',
  High: 'bg-orange-500',
  Critical: 'bg-rose-500',
};

const TYPE_CARD_META: Record<CaseType, { label: string; icon: React.ReactNode; tint: string; tintActive: string }> = {
  GeneralSupport: {
    label: 'Genel Destek',
    icon: <HeadphonesIcon size={18} />,
    tint: 'border-slate-200 hover:border-slate-300 text-slate-700 dark:border-ndark-border dark:text-ndark-text',
    tintActive: 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200',
  },
  Churn: {
    label: 'Churn Yönetimi',
    icon: <TrendingDown size={18} />,
    tint: 'border-slate-200 hover:border-slate-300 text-slate-700 dark:border-ndark-border dark:text-ndark-text',
    tintActive: 'border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200',
  },
  ProactiveTracking: {
    label: 'Proaktif Takip',
    icon: <LineChart size={18} />,
    tint: 'border-slate-200 hover:border-slate-300 text-slate-700 dark:border-ndark-border dark:text-ndark-text',
    tintActive: 'border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-200',
  },
};

export function NewCaseForm({ open, onClose, onCreated, onShowExisting }: NewCaseFormProps) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [duplicateCase, setDuplicateCase] = useState<Case | undefined>(undefined);
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  // RUNA AI — kategori + başlık önerileri
  const [aiSuggestion, setAiSuggestion] = useState<CategorySuggestion | null>(null);
  const [aiTitle, setAiTitle] = useState<TitleSuggestion | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCardCollapsed, setAiCardCollapsed] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [titleApplied, setTitleApplied] = useState(false);
  const aiReqIdRef = useRef(0);
  const { toast } = useToast();

  const companies = useMemo(() => lookupService.companies(), []);
  // Phase C2: müşteri seçimi artık AccountSearchPicker (real API). Bootstrap
  // cache'inden account listesi okunmuyor.
  const categories = useMemo(() => lookupService.categories(), []);
  // Phase D — seçili şirketin CompanySettings.requireCustomerOnCaseCreate flag'i.
  // Bootstrap'tan flatten geliyor; false ise "Müşterisiz devam et" görünür,
  // true ise müşteri zorunlu (picker'da null seçim gizli + validation).
  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === form.companyId),
    [companies, form.companyId],
  );
  const requireCustomer = !!selectedCompany?.requireCustomerOnCaseCreate;
  const teams = useMemo(() => lookupService.teams(), []);
  const requestTypes = useMemo(() => lookupService.requestTypes(), []);
  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);
  const allFieldDefinitions = useMemo(() => lookupService.fieldDefinitions(), []);

  // Şirkete göre filtrelenmiş custom field tanımları
  const customFieldDefs = useMemo(
    () => allFieldDefinitions.filter((f) => f.companyId === form.companyId),
    [allFieldDefinitions, form.companyId],
  );

  const teamsForCompany = useMemo(
    () => (form.companyId ? teams.filter((t) => t.companyId === form.companyId) : []),
    [teams, form.companyId],
  );

  const subCategories = useMemo(
    () => categories.find((c) => c.category === form.category)?.subCategories ?? [],
    [categories, form.category],
  );
  const personsForTeam = useMemo(
    () => (form.assignedTeamId ? lookupService.personsByTeam(form.assignedTeamId) : []),
    [form.assignedTeamId],
  );

  // ── State reset effects ──
  useEffect(() => {
    if (!open) {
      setForm(emptyForm);
      setCustomFields({});
      setErrors({});
      setDuplicateCase(undefined);
      setOverrideDuplicate(false);
      setAiSuggestion(null);
      setAiTitle(null);
      setAiSuggesting(false);
      setAiError(null);
      setAiCardCollapsed(false);
      setAiApplied(false);
      setTitleApplied(false);
    }
  }, [open]);

  // Şirket değişince müşteri seçimini sıfırla. Picker yeni şirketin müşterilerini
  // canlı API'den çeker; cross-tenant veri kalmasın.
  useEffect(() => {
    setForm((f) => {
      if (!f.accountId && !f.accountName) return f;
      return { ...f, accountId: '', accountName: '' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId]);

  // Takım şirket dışındaysa sıfırla
  useEffect(() => {
    if (form.assignedTeamId && !teamsForCompany.some((t) => t.id === form.assignedTeamId)) {
      setForm((f) => ({ ...f, assignedTeamId: '', assignedPersonId: '' }));
    }
  }, [teamsForCompany, form.assignedTeamId]);

  // Kategori değişirse alt kategori geçersizleşebilir
  useEffect(() => {
    if (form.subCategory && !subCategories.includes(form.subCategory)) {
      setForm((f) => ({ ...f, subCategory: '' }));
    }
  }, [subCategories, form.subCategory]);

  // Takım değişirse kişi sıfırla
  useEffect(() => {
    if (form.assignedPersonId && !personsForTeam.find((p) => p.id === form.assignedPersonId)) {
      setForm((f) => ({ ...f, assignedPersonId: '' }));
    }
  }, [personsForTeam, form.assignedPersonId]);

  // Aynı tipte açık vaka var mı?
  useEffect(() => {
    let alive = true;
    setOverrideDuplicate(false);
    if (!form.accountId || !form.caseType) {
      setDuplicateCase(undefined);
      return;
    }
    void caseService.findOpenCaseFor(form.accountId, form.caseType).then((found) => {
      if (alive) setDuplicateCase(found);
    });
    return () => {
      alive = false;
    };
  }, [form.accountId, form.caseType]);

  // Müşteri geçmişi artık CustomerPulsePanel içinde self-fetch ediliyor —
  // burada manuel state tutmaya gerek yok. (Roadmap A1 / Phase 5+)

  // RUNA AI — açıklama 20+ karakter, debounce, kategori + başlık paralel
  useEffect(() => {
    if (!open) return;
    if (aiCardCollapsed) return;
    const desc = form.description.trim();
    if (desc.length < DESCRIPTION_AI_THRESHOLD) {
      setAiSuggestion(null);
      setAiTitle(null);
      setAiSuggesting(false);
      setAiError(null);
      return;
    }
    const reqId = ++aiReqIdRef.current;
    setAiSuggesting(true);
    const handle = window.setTimeout(async () => {
      const [catR, titleR] = await Promise.all([
        aiService.suggestCategory({
          description: desc,
          caseType: form.caseType,
          companyName: companies.find((c) => c.id === form.companyId)?.name,
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
  }, [open, form.description, form.caseType, form.companyId, aiCardCollapsed]);

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
    if (aiTitle?.title) setTitleApplied(true);
    setAiCardCollapsed(true);
    toast({ type: 'success', message: 'RUNA AI önerileri uygulandı.', duration: 2000 });
  }

  function applyTitleOnly() {
    if (!aiTitle) return;
    setForm((f) => ({ ...f, title: aiTitle.title }));
    setTitleApplied(true);
  }

  function dismissAiCard() {
    setAiCardCollapsed(true);
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Başlık zorunlu';
    if (!form.description.trim()) e.description = 'Açıklama zorunlu';
    if (!form.companyId) e.companyId = 'Şirket seçilmeli';
    // Phase C2: accountId opsiyonel — müşteri bulunamazsa "Müşterisiz devam et"
    // ile boş bırakılabilir. accountName de buna paralel olarak boş kalır.
    // Phase D: seçili şirkette requireCustomerOnCaseCreate=true ise müşteri zorunlu.
    if (requireCustomer && !form.accountId) {
      e.accountId = 'Bu şirkette müşteri seçimi zorunlu.';
    }
    if (!form.category) e.category = 'Kategori seçilmeli';
    if (!form.subCategory) e.subCategory = 'Alt kategori seçilmeli';
    if (!form.requestType) e.requestType = 'Talep türü seçilmeli';
    if (form.origin === 'Diğer' && !form.originDescription.trim())
      e.originDescription = 'Origin "Diğer" seçildiğinde açıklama zorunlu';
    if (form.caseType === 'Churn') {
      if (form.offerOutcome === 'Reddedildi' && !form.offerRejectionReason.trim()) {
        e.offerRejectionReason = 'Reddedildi seçildiğinde gerekçe zorunludur';
      }
      if (form.offerOutcome === 'Beklemede' && !form.followUpDate) {
        e.followUpDate = 'Beklemede outcome\'da takip tarihi zorunludur';
      }
    }
    const cfCheck = validateCustomFields(customFieldDefs, form.caseType, customFields);
    if (!cfCheck.ok) {
      e.customFields = `Zorunlu alanlar boş: ${cfCheck.missing.join(', ')}`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (duplicateCase && !overrideDuplicate) return;
    setSubmitting(true);
    // Phase C2: accountId picker'dan gelir; null kabul edilir (müşterisiz vaka).
    const company = companies.find((c) => c.id === form.companyId)!;
    const team = teamsForCompany.find((t) => t.id === form.assignedTeamId);
    const person = personsForTeam.find((p) => p.id === form.assignedPersonId);

    const input: NewCaseInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      caseType: form.caseType,
      priority: form.priority,
      origin: form.origin,
      originDescription: form.origin === 'Diğer' ? form.originDescription.trim() : undefined,
      companyId: company.id,
      companyName: company.name,
      accountId: form.accountId || undefined,
      // accountId yoksa accountName "Müşterisiz vaka" sentinel'i sadece UI'da; backend'e gönderme.
      accountName: form.accountId ? form.accountName : undefined,
      // Phase D Step 2 — opsiyonel başvuran bilgileri.
      customerContactName: form.customerContactName.trim() || undefined,
      customerContactPhone: form.customerContactPhone.trim() || undefined,
      customerContactEmail: form.customerContactEmail.trim() || undefined,
      customerCompanyName: form.customerCompanyName.trim() || undefined,
      category: form.category,
      subCategory: form.subCategory,
      requestType: form.requestType as CaseRequestType,
      productGroup: form.productGroup || undefined,
      assignedTeamId: team?.id,
      assignedTeamName: team?.name,
      assignedPersonId: person?.id,
      assignedPersonName: person?.name,
      financialStatus:    form.financialStatus    || undefined,
      productUsage:       form.productUsage       || undefined,
      usageChangeAlert:   form.usageChangeAlert   || undefined,
      responseLevel:      form.responseLevel      || undefined,
      cancellationRequest: form.cancellationRequest,
      offeredSolutions:    form.offeredSolutions.length ? form.offeredSolutions : undefined,
      offerExpiryDate:     form.offerExpiryDate || undefined,
      offerOutcome:        form.offerOutcome    || undefined,
      offerRejectionReason: form.offerRejectionReason.trim() || undefined,
      actionTaken:         form.actionTaken.trim() || undefined,
      followUpDate:        form.followUpDate    || undefined,
      aiGeneratedFlag:      aiApplied || titleApplied || undefined,
      aiCategoryPrediction: aiApplied && aiSuggestion ? aiSuggestion.category : undefined,
      aiPriorityPrediction: aiApplied && aiSuggestion ? aiSuggestion.priority : undefined,
      aiConfidenceScore:    aiApplied && aiSuggestion ? aiSuggestion.confidence : undefined,
      aiRejectReason:       aiCardCollapsed && !aiApplied ? 'Kullanıcı reddetti' : undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    };
    try {
      const created = await caseService.create(input);
      setSubmitting(false);
      onCreated(created);
    } catch {
      setSubmitting(false);
    }
  }

  // Submit aktif mi?
  // Phase D Step 2 fix: müşteri zorunluluğu CompanySettings.requireCustomerOnCaseCreate'a
  // bağlı. requireCustomer=false ise "Müşterisiz devam et" akışı submit'i bloklamamalı —
  // önceki davranış (form.accountId her zaman zorunlu) bug'dı.
  const canSubmit =
    !submitting &&
    form.companyId &&
    (!requireCustomer || !!form.accountId) &&
    form.description.trim() &&
    form.title.trim() &&
    form.category &&
    !(duplicateCase && !overrideDuplicate);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      title={
        <div className="flex items-center gap-2">
          <span>Yeni Vaka</span>
          {(aiApplied || titleApplied) && (
            <Badge tint="violet" icon={<Sparkles size={11} />}>RUNA AI</Badge>
          )}
        </div>
      }
      bodyClassName="max-h-[calc(92vh-7rem)] overflow-y-auto px-5 py-5"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-ndark-muted">
            {duplicateCase && !overrideDuplicate ? (
              <span className="text-amber-700 dark:text-amber-400">
                Açık vaka mevcut — devam etmek için "Yine de Devam Et" gerekli.
              </span>
            ) : (
              <>Vaka oluşturulduğunda statü <strong>Açık</strong> olarak başlar.</>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} leftIcon={<Check size={14} />}>
              {submitting ? 'Oluşturuluyor…' : 'Vakayı Oluştur'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ═══════════ SOL: FORM ═══════════ */}
        <div className="min-w-0 space-y-6">
          {/* Duplicate uyarısı */}
          {duplicateCase && (
            <DuplicateBanner
              caseItem={duplicateCase}
              overrideActive={overrideDuplicate}
              onOverride={() => setOverrideDuplicate(true)}
              onClearOverride={() => setOverrideDuplicate(false)}
              onShowExisting={
                onShowExisting
                  ? () => {
                      onShowExisting(duplicateCase.id);
                      onClose();
                    }
                  : undefined
              }
            />
          )}

          {/* ── BÖLÜM 1: MÜŞTERİ KİM? ── */}
          <Section title="Müşteri Kim?" subtitle="Şirket ve müşteriyi seçerek başlayın">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Şirket" required error={errors.companyId}>
                <Select
                  value={form.companyId}
                  onChange={(e) => update('companyId', e.target.value)}
                >
                  <option value="">Şirket seçin…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Müşteri"
                required={requireCustomer}
                error={errors.accountId}
                hint={
                  !form.companyId
                    ? 'Önce şirket seçin'
                    : requireCustomer
                      ? 'Bu şirkette müşteri seçimi zorunlu.'
                      : 'Müşteriyi bulamazsan müşterisiz devam edebilirsin.'
                }
              >
                {form.accountId ? (
                  <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ndark-border dark:bg-ndark-card">
                    <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-ndark-text">
                      {form.accountName}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAccountPickerOpen(true)}
                      disabled={!form.companyId}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                    >
                      Değiştir
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, accountId: '', accountName: '' }))}
                      aria-label="Müşteri seçimini kaldır"
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : form.accountName ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-amber-900/20">
                    <UserX size={14} className="text-amber-700 dark:text-amber-300" />
                    <span className="min-w-0 flex-1 truncate text-amber-900 dark:text-amber-200">
                      {form.accountName}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAccountPickerOpen(true)}
                      disabled={!form.companyId}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/30"
                    >
                      Müşteri Seç
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAccountPickerOpen(true)}
                    disabled={!form.companyId}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-surface"
                  >
                    <Search size={14} />
                    <span className="flex-1">
                      {form.companyId ? 'Müşteri ara…' : 'Önce şirket seçin'}
                    </span>
                  </button>
                )}
              </Field>
            </div>

            {/* Phase D Step 2 — Müşterisiz vaka akışında başvuran bilgileri.
                Sadece müşterisiz seçilmişse default görünür; müşteri seçilmişse
                gizli (Field zorunlu değildir). */}
            {!form.accountId && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-3 dark:border-ndark-border dark:bg-ndark-surface/40">
                <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-ndark-text">
                  Ulaşan kişi bilgileri
                </div>
                <p className="mb-3 text-[11px] text-slate-500 dark:text-ndark-muted">
                  Müşteri kaydı bulunamadığında eşleştirme için yardımcı olur. Zorunlu değildir.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Ad Soyad">
                    <TextInput
                      value={form.customerContactName}
                      onChange={(e) => update('customerContactName', e.target.value)}
                      maxLength={120}
                      placeholder="Örn. Ali Yılmaz"
                    />
                  </Field>
                  <Field label="Telefon">
                    <TextInput
                      value={form.customerContactPhone}
                      onChange={(e) => update('customerContactPhone', e.target.value)}
                      maxLength={40}
                      placeholder="+90 5XX XXX XX XX"
                    />
                  </Field>
                  <Field label="E-posta">
                    <TextInput
                      type="email"
                      value={form.customerContactEmail}
                      onChange={(e) => update('customerContactEmail', e.target.value)}
                      maxLength={160}
                      placeholder="ad.soyad@firma.com"
                    />
                  </Field>
                  <Field label="Firma Ünvanı">
                    <TextInput
                      value={form.customerCompanyName}
                      onChange={(e) => update('customerCompanyName', e.target.value)}
                      maxLength={180}
                      placeholder="Örn. Akar Gıda A.Ş."
                    />
                  </Field>
                </div>
              </div>
            )}
          </Section>

          {/* ── BÖLÜM 2: NE OLDU? ── */}
          <Section title="Ne Oldu?" subtitle="RUNA AI geri kalanını önerecek">
            <Field
              label="Açıklama"
              required
              error={errors.description}
              actions={
                <VoiceNoteButton
                  onTranscript={(chunk) =>
                    update('description', form.description ? `${form.description} ${chunk}` : chunk)
                  }
                />
              }
            >
              <TextArea
                placeholder="Müşteri ne dedi, ne istedi? Kısaca yazın — RUNA AI geri kalanını önerecek."
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={5}
              />
            </Field>

            {/* AI öneri kartı (inline) */}
            {form.description.trim().length >= DESCRIPTION_AI_THRESHOLD && !aiCardCollapsed && (
              <div className="animate-fade-slide mt-3">
                <AiSuggestionCard
                  loading={aiSuggesting}
                  category={aiSuggestion}
                  title={aiTitle}
                  error={aiError}
                  onApplyAll={applyAllFromAi}
                  onCollapse={dismissAiCard}
                />
              </div>
            )}
            {(aiApplied || titleApplied) && aiCardCollapsed && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                <Check size={14} />
                <span>
                  RUNA AI önerileri uygulandı. Aşağıdaki alanları istediğiniz gibi düzenleyebilirsiniz.
                </span>
              </div>
            )}
          </Section>

          {/* ── BÖLÜM 4: VAKA BİLGİLERİ ── */}
          <Section title="Vaka Bilgileri">
            <div className="space-y-3">
              {/* Başlık */}
              <Field label="Vaka Başlığı" required error={errors.title}>
                <TextInput
                  placeholder="Kısa, özetleyici bir başlık"
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                />
              </Field>
              {aiTitle && !titleApplied && form.title !== aiTitle.title && (
                <div className="-mt-1 flex flex-wrap items-center gap-2 text-xs text-violet-700 dark:text-violet-300">
                  <Bot size={12} />
                  <span className="italic">"{aiTitle.title}"</span>
                  <button
                    type="button"
                    onClick={applyTitleOnly}
                    className="rounded-md bg-violet-100 px-2 py-0.5 font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60"
                  >
                    Uygula
                  </button>
                </div>
              )}

              {/* Vaka tipi — 3 horizontal cards */}
              <Field label="Vaka Tipi" required>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {CASE_TYPES.map((t) => {
                    const meta = TYPE_CARD_META[t];
                    const active = form.caseType === t;
                    const aiTagged = aiApplied && aiSuggestion && form.caseType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => update('caseType', t)}
                        className={
                          'flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition ' +
                          (active ? meta.tintActive : meta.tint)
                        }
                      >
                        {meta.icon}
                        <span className="flex-1 text-left">{meta.label}</span>
                        {aiTagged && (
                          <Bot size={12} className="text-violet-500 dark:text-violet-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Kategori" required error={errors.category}>
                  <Select value={form.category} onChange={(e) => update('category', e.target.value)}>
                    <option value="">Seçin…</option>
                    {categories.map((c) => (
                      <option key={c.category} value={c.category}>
                        {c.category}
                      </option>
                    ))}
                  </Select>
                  {aiApplied && aiSuggestion && form.category === aiSuggestion.category && (
                    <AiBadge />
                  )}
                </Field>
                <Field label="Alt Kategori" required error={errors.subCategory}>
                  <Select
                    value={form.subCategory}
                    onChange={(e) => update('subCategory', e.target.value)}
                    disabled={!form.category}
                  >
                    <option value="">Seçin…</option>
                    {subCategories.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  {aiApplied && aiSuggestion && form.subCategory === aiSuggestion.subCategory && (
                    <AiBadge />
                  )}
                </Field>
              </div>

              <Field label="Talep Türü" required error={errors.requestType}>
                <Select
                  value={form.requestType}
                  onChange={(e) => update('requestType', e.target.value as '' | CaseRequestType)}
                >
                  <option value="">Seçin…</option>
                  {requestTypes.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                {aiApplied && aiSuggestion && form.requestType === aiSuggestion.requestType && (
                  <AiBadge />
                )}
              </Field>
            </div>
          </Section>

          {/* ── BÖLÜM 5: TYPE-SPECIFIC ── */}
          {form.caseType === 'ProactiveTracking' && (
            <Section
              title="Proaktif Takip Bilgileri"
              accent="violet"
              icon={<LineChart size={14} />}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Finansal Risk Seviyesi" hint="Müşteri finansal sağlık skoru">
                  <Select
                    value={form.financialStatus}
                    onChange={(e) => update('financialStatus', e.target.value as '' | FinancialStatus)}
                  >
                    <option value="">Seçin…</option>
                    {FINANCIAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ürün Kullanımı" hint="Kullanım yoğunluğu">
                  <Select
                    value={form.productUsage}
                    onChange={(e) => update('productUsage', e.target.value as '' | ProductUsage)}
                  >
                    <option value="">Seçin…</option>
                    {PRODUCT_USAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Kullanım Trendi">
                  <Select
                    value={form.usageChangeAlert}
                    onChange={(e) => update('usageChangeAlert', e.target.value as '' | UsageChangeAlert)}
                  >
                    <option value="">Seçin…</option>
                    {USAGE_CHANGE_ALERTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Müdahale Önceliği">
                  <Select
                    value={form.responseLevel}
                    onChange={(e) => update('responseLevel', e.target.value as '' | ResponseLevel)}
                  >
                    <option value="">Seçin…</option>
                    {RESPONSE_LEVELS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Section>
          )}

          {form.caseType === 'Churn' && (
            <Section title="Churn Yönetimi" accent="rose" icon={<TrendingDown size={14} />}>
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
                  <input
                    type="checkbox"
                    checked={form.cancellationRequest}
                    onChange={(e) => update('cancellationRequest', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  Müşteri iptal talebinde bulundu
                </label>

                <Field label="Önerilen Teklifler" hint="Birden fazla seçilebilir">
                  <div className="grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-ndark-border dark:bg-ndark-card sm:grid-cols-2">
                    {offeredSolutions.map((o) => {
                      const checked = form.offeredSolutions.includes(o.id);
                      return (
                        <label key={o.id} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...form.offeredSolutions, o.id]
                                : form.offeredSolutions.filter((id) => id !== o.id);
                              update('offeredSolutions', next);
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                          />
                          <span className="flex-1">
                            <span className="font-medium text-slate-800 dark:text-ndark-text">
                              {o.name}
                            </span>
                            {o.description && (
                              <span className="ml-1 text-xs text-slate-500 dark:text-ndark-muted">
                                — {o.description}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Teklif Geçerlilik Tarihi">
                    <TextInput
                      type="date"
                      value={form.offerExpiryDate}
                      onChange={(e) => update('offerExpiryDate', e.target.value)}
                    />
                  </Field>
                  <Field label="Teklif Sonucu">
                    <Select
                      value={form.offerOutcome}
                      onChange={(e) => update('offerOutcome', e.target.value as '' | OfferOutcome)}
                    >
                      <option value="">Henüz cevap yok</option>
                      {OFFER_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {form.offerOutcome === 'Reddedildi' && (
                  <Field label="Red Gerekçesi" required error={errors.offerRejectionReason}>
                    <TextArea
                      rows={2}
                      placeholder="Müşteri neden teklifi reddetti?"
                      value={form.offerRejectionReason}
                      onChange={(e) => update('offerRejectionReason', e.target.value)}
                    />
                  </Field>
                )}

                <Field label="Yapılan Aksiyon" hint="Süreçte alınan ana aksiyon notu">
                  <TextArea
                    rows={3}
                    placeholder="ör. İndirim teklifi sunuldu, takip görüşmesi planlandı…"
                    value={form.actionTaken}
                    onChange={(e) => update('actionTaken', e.target.value)}
                  />
                </Field>

                <Field
                  label="Takip Tarihi"
                  hint="Teklif sonrası ~7 gün önerilir — outcome 'Beklemede' ise zorunlu"
                  required={form.offerOutcome === 'Beklemede'}
                  error={errors.followUpDate}
                >
                  <TextInput
                    type="date"
                    value={form.followUpDate}
                    onChange={(e) => update('followUpDate', e.target.value)}
                  />
                </Field>
              </div>
            </Section>
          )}

          {/* Custom Fields */}
          {customFieldDefs.length > 0 && (
            <Section title="Özel Alanlar">
              <CustomFieldsSection
                definitions={customFieldDefs}
                caseType={form.caseType}
                values={customFields}
                onChange={(key, val) => setCustomFields((cf) => ({ ...cf, [key]: val }))}
                disabled={submitting}
              />
              {errors.customFields && (
                <p className="mt-1 text-xs text-rose-600">{errors.customFields}</p>
              )}
            </Section>
          )}

          {/* ── BÖLÜM 6: KİME VE NASIL? ── */}
          <Section title="Kime ve Nasıl?">
            <div className="space-y-3">
              <Field label="Öncelik" required>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {CASE_PRIORITIES.map((p) => {
                    const active = form.priority === p;
                    const aiTagged = aiApplied && aiSuggestion?.priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => update('priority', p)}
                        className={
                          'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition ' +
                          (active
                            ? PRIORITY_CHIP_STYLE[p] + ' ring-2 ring-offset-1 ring-current/20'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted')
                        }
                      >
                        <span className={`inline-block h-2 w-2 rounded-full ${PRIORITY_CHIP_DOT[p]}`} />
                        {CASE_PRIORITY_LABELS[p]}
                        {aiTagged && active && <Bot size={10} className="opacity-60" />}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Atanan Takım">
                  <Select
                    value={form.assignedTeamId}
                    onChange={(e) => update('assignedTeamId', e.target.value)}
                    disabled={!form.companyId}
                  >
                    <option value="">{form.companyId ? 'Atanmadı' : 'Önce şirket seçin'}</option>
                    {teamsForCompany.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Atanan Kişi"
                  hint={form.assignedTeamId ? 'Sadece seçili takımın üyeleri' : 'Önce takım seçin'}
                >
                  <Select
                    value={form.assignedPersonId}
                    onChange={(e) => update('assignedPersonId', e.target.value)}
                    disabled={!form.assignedTeamId}
                  >
                    <option value="">Atanmadı</option>
                    {personsForTeam.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Kanal (Origin)" required>
                  <Select
                    value={form.origin}
                    onChange={(e) => update('origin', e.target.value as CaseOrigin)}
                  >
                    {CASE_ORIGINS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ürün Grubu" hint="SLA hesaplamasında kullanılır">
                  <TextInput
                    placeholder="ör. ERP - Kasa"
                    value={form.productGroup}
                    onChange={(e) => update('productGroup', e.target.value)}
                  />
                </Field>
              </div>

              {form.origin === 'Diğer' && (
                <Field label="Kanal Açıklaması" required error={errors.originDescription}>
                  <TextInput
                    placeholder="Kanalı kısaca açıklayın"
                    value={form.originDescription}
                    onChange={(e) => update('originDescription', e.target.value)}
                  />
                </Field>
              )}
            </div>
          </Section>
        </div>

        {/* ═══════════ SAĞ: AI PANEL ═══════════ */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <AiPanel
            descriptionLength={form.description.trim().length}
            aiSuggesting={aiSuggesting}
            aiSuggestion={aiSuggestion}
            aiTitle={aiTitle}
            priority={form.priority}
            category={form.category}
            caseType={form.caseType}
            accountId={form.accountId || null}
            companyId={form.companyId || null}
          />
        </aside>
      </div>

      <AccountSearchPicker
        open={accountPickerOpen}
        companyId={form.companyId || null}
        selectedAccountId={form.accountId || null}
        // Phase D: şirket politikası "Müşterisiz devam et"i kapatabilir.
        allowNullSelection={!requireCustomer}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={(account) => {
          setAccountPickerOpen(false);
          if (account) {
            setForm((f) => ({ ...f, accountId: account.id, accountName: account.name }));
          } else {
            // "Müşterisiz devam et" — accountId boş, accountName "Müşteri Yok" işaret.
            setForm((f) => ({ ...f, accountId: '', accountName: 'Müşterisiz vaka' }));
          }
        }}
      />
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────
// Reusable inner pieces
// ──────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  accent,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: 'violet' | 'rose';
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headColor =
    accent === 'violet'
      ? 'text-violet-700 dark:text-violet-300'
      : accent === 'rose'
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-slate-700 dark:text-ndark-text';
  const borderColor =
    accent === 'violet'
      ? 'border-l-violet-400 dark:border-l-violet-500'
      : accent === 'rose'
        ? 'border-l-rose-400 dark:border-l-rose-500'
        : 'border-l-transparent';
  return (
    <section
      className={
        accent
          ? `border-l-4 pl-4 ${borderColor} animate-fade-slide`
          : ''
      }
    >
      <header className="mb-3">
        <h2 className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${headColor}`}>
          {icon}
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function AiBadge() {
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400">
      <Bot size={10} />
      AI önerisi
    </div>
  );
}

function DuplicateBanner({
  caseItem,
  overrideActive,
  onOverride,
  onClearOverride,
  onShowExisting,
}: {
  caseItem: Case;
  overrideActive: boolean;
  onOverride: () => void;
  onClearOverride: () => void;
  onShowExisting?: () => void;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div>Bu müşteri için aynı tipte <strong>açık bir vaka</strong> mevcut.</div>
          <div className="flex flex-wrap items-center gap-2 rounded bg-white/60 px-2 py-1.5 ring-1 ring-amber-200 dark:bg-ndark-card/60 dark:ring-amber-900/40">
            <span className="font-mono text-xs text-slate-600 dark:text-ndark-muted">{caseItem.caseNumber}</span>
            <span className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">{caseItem.title}</span>
            <StatusPill status={caseItem.status} />
            {onShowExisting && (
              <button
                type="button"
                onClick={onShowExisting}
                className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-800 underline hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
              >
                <ExternalLink size={12} /> Mevcut Vakayı Gör
              </button>
            )}
          </div>
          {!overrideActive ? (
            <Button size="sm" variant="outline" onClick={onOverride}>
              Yine de Devam Et
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
              <Badge tint="amber">Override aktif</Badge>
              <button
                type="button"
                onClick={onClearOverride}
                className="underline hover:text-amber-900 dark:hover:text-amber-200"
              >
                vazgeç
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AiSuggestionCard({
  loading,
  category,
  title,
  error,
  onApplyAll,
  onCollapse,
}: {
  loading: boolean;
  category: CategorySuggestion | null;
  title: TitleSuggestion | null;
  error: string | null;
  onApplyAll: () => void;
  onCollapse: () => void;
}) {
  if (loading && !category) {
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
        <div className="flex items-center gap-2 text-xs font-medium text-violet-800 dark:text-violet-200">
          <Loader2 size={14} className="animate-spin" />
          RUNA AI analiz ediyor…
        </div>
      </div>
    );
  }
  if (!category) {
    if (error) {
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          ⚠ AI önerisi alınamadı: {error}. Aşağıdan manuel doldurabilirsiniz.
        </div>
      );
    }
    return null;
  }
  const conf = Math.round(category.confidence * 100);
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-900 dark:text-violet-100">
          <Bot size={16} />
          RUNA AI Önerileri
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-violet-700 dark:text-violet-300">
            %{conf} güven
          </span>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-0.5 text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
            aria-label="Kapat"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        {title && (
          <Row label="Başlık" value={`"${title.title}"`} />
        )}
        <Row label="Tip" value={CASE_TYPE_LABELS[category.requestType as never] ?? '—'} />
        <Row
          label="Kategori"
          value={`${category.category} / ${category.subCategory} · ${category.requestType}`}
        />
        <Row
          label="Öncelik"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${PRIORITY_CHIP_DOT[category.priority]}`} />
              {CASE_PRIORITY_LABELS[category.priority]}
            </span>
          }
        />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" leftIcon={<Check size={12} />} onClick={onApplyAll}>
          Tümünü Uygula
        </Button>
        <Button size="sm" variant="outline" onClick={onCollapse}>
          Tek tek düzenle
        </Button>
        {loading && (
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300">
            <Loader2 size={10} className="animate-spin" />
            Güncelleniyor…
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-slate-800 dark:text-ndark-text">{value}</dd>
    </div>
  );
}

function AiPanel({
  descriptionLength,
  aiSuggesting,
  aiSuggestion,
  aiTitle,
  priority,
  category,
  caseType,
  accountId,
  companyId,
}: {
  descriptionLength: number;
  aiSuggesting: boolean;
  aiSuggestion: CategorySuggestion | null;
  aiTitle: TitleSuggestion | null;
  priority: CasePriority;
  category: string;
  caseType: CaseType;
  accountId: string | null;
  companyId: string | null;
}) {
  const isIdle = descriptionLength < DESCRIPTION_AI_THRESHOLD && !aiSuggestion;
  const isAnalyzing = aiSuggesting && !aiSuggestion;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100/30 px-3 py-2 dark:border-violet-900/40 dark:from-violet-950/40 dark:to-violet-900/20">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600 text-white shadow-sm">
          <Sparkles size={14} />
        </div>
        <div>
          <div className="text-sm font-semibold text-violet-900 dark:text-violet-100">RUNA AI</div>
          <div className="text-[11px] text-violet-700 dark:text-violet-300">Asistan</div>
        </div>
      </div>

      {/* State 1: Bekliyor */}
      {isIdle && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center dark:border-ndark-border dark:bg-ndark-card">
          <div className="flex justify-center gap-1">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-ndark-muted">
            Müşteriyi seçin ve ne olduğunu yazın. Ben analiz edeceğim.
          </p>
        </div>
      )}

      {/* State 2: Analiz */}
      {isAnalyzing && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-800 dark:text-violet-200">
            <Loader2 size={14} className="animate-spin" />
            Analiz ediliyor…
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-900/40">
            <div className="h-full w-1/3 animate-pulse bg-violet-400" />
          </div>
        </div>
      )}

      {/* SLA tahmini */}
      <PanelCard
        icon={<Zap size={12} className="text-amber-600" />}
        title="SLA Tahmini"
      >
        <SlaPreview priority={priority} category={category} caseType={caseType} />
      </PanelCard>

      {/* Müşteri Durumu — Customer Pulse (account-based, deterministic only).
          Müşteri + şirket seçilince zenginleşir; öncesinde küçük placeholder. */}
      {accountId && companyId ? (
        <CustomerPulsePanel source={{ kind: 'account', accountId, companyId }} />
      ) : (
        <PanelCard
          icon={<History size={12} className="text-slate-500" />}
          title="Müşteri Durumu"
        >
          <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
            Müşteri seçilince durum gösterilir.
          </p>
        </PanelCard>
      )}

      {/* Churn risk — yalnız Churn type seçilince placeholder */}
      {caseType === 'Churn' && (
        <PanelCard
          icon={<ShieldAlert size={12} className="text-rose-600" />}
          title="Churn Risk"
        >
          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-ndark-muted">
            Vaka oluşturulduktan sonra RUNA AI churn risk skoru üretir ve
            önerilen aksiyon planını paylaşır.
          </p>
        </PanelCard>
      )}

      {/* AI öneri özeti panel sonu */}
      {aiSuggestion && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-xs dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="font-medium text-violet-900 dark:text-violet-100">
            <Bot size={12} className="mr-1 inline" />
            Bu vakayı şöyle anlıyorum:
          </div>
          <p className="mt-1 leading-relaxed text-slate-700 dark:text-ndark-muted">
            {aiSuggestion.reasoning}
          </p>
          {aiTitle && (
            <p className="mt-2 text-[11px] italic text-violet-700 dark:text-violet-300">
              Başlık önerisi: "{aiTitle.title}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PanelCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
        {icon}
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function SlaPreview({
  priority,
  category,
  caseType,
}: {
  priority: CasePriority;
  category: string;
  caseType: CaseType;
}) {
  const [responseHours, resolutionHours] = SLA_BY_PRIORITY[priority];
  const hasInputs = !!category;
  return (
    <dl className="space-y-1.5 text-xs">
      <div className="flex items-baseline justify-between">
        <dt className="text-slate-500 dark:text-ndark-muted">Yanıt</dt>
        <dd className="font-semibold tabular-nums text-slate-800 dark:text-ndark-text">
          {hasInputs ? `${responseHours} saat` : '—'}
        </dd>
      </div>
      <div className="flex items-baseline justify-between">
        <dt className="text-slate-500 dark:text-ndark-muted">Çözüm</dt>
        <dd className="font-semibold tabular-nums text-slate-800 dark:text-ndark-text">
          {hasInputs ? `${resolutionHours} saat` : '—'}
        </dd>
      </div>
      {!hasInputs && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-ndark-muted">
          Şirket + kategori seçilince hesaplanır.
        </p>
      )}
      {caseType === 'Churn' && hasInputs && (
        <p className="mt-1 text-[10px] text-rose-700 dark:text-rose-300">
          Churn'de SLA, takip tarihiyle birlikte değerlendirilir.
        </p>
      )}
    </dl>
  );
}
