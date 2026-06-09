import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Sparkles, Users2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import {
  caseService,
  lookupService,
  type SmartTicketTaxonomyItem,
  type SmartTicketTaxonomyResponse,
  type SuggestClassificationResponse,
  type SuggestClassificationField,
} from '@/services/caseService';
import { Wand2 } from 'lucide-react';
import { accountService, type AccountListItem } from '@/services/accountService';
import type { Case } from '@/features/cases/types';
import { resolveSmartTicketMapping } from './mapping';

/**
 * WR-Smart-Ticket Phase 1c — ayrı "Akıllı Ticket Aç" intake screen.
 *
 * SCOPE GUARD:
 *  - Bu shell mevcut `POST /api/cases` üzerine gerçek bir Case oluşturur.
 *  - Smart Ticket meta verisi `customFields.smartTicket` içine yazılır.
 *  - Quick Case / New Case / Case Detail akışları DOKUNULMADI.
 *  - Schema migration YOK; `customFields` zaten Case modelinde mevcut.
 *  - Smart Ticket alanları → klasik Case alanları eşlemesi BU PR'DA YOK.
 *    Case.category/subCategory/requestType sabit fallback değerlerle
 *    set ediliyor: ("Akıllı Ticket" / "Genel" / "Talep"). Eşleme PR-1d+.
 *  - CaseSolutionStep, External KB, structured closure → KAPSAM DIŞI.
 *
 * Form akışı sade — kullanıcıdan minimum bilgi:
 *  - Şirket (zorunlu, varsayılan = ilk erişilebilir şirket)
 *  - Müşteri (zorunlu — picker)
 *  - Proje (opsiyonel, müşteri+şirket bağlamına göre)
 *  - Başlık (zorunlu)
 *  - Açıklama (zorunlu)
 *  - 5 açılış taxonomy seçimi (her biri opsiyonel; lookup endpoint'ten):
 *    platform / businessProcess / operationType / affectedObject / impact
 */

// Mapping fallback'leri ./mapping modülünden geliyor. Eskiden bu dosyada
// hard-coded olarak kullanılan sabitler artık `resolveSmartTicketMapping`
// kararının "fallback" dalında dönüyor (Phase 1d).

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

export function SmartTicketNewPage({
  onCreated,
  onCancel,
}: {
  onCreated: (caseId: string) => void;
  onCancel: () => void;
}) {
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const [form, setForm] = useState<SmartTicketFormState>(() => emptyForm(defaultCompanyId));

  // WR-A4 / PM-04 — Şirket bazlı proje opt-in / zorunluluk flag'leri.
  // selectedCompany bootstrap-cached lookup'tan gelir; backend
  // CompanySettings.projectsEnabled/projectsRequired ile aynı.
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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Phase 2b — açılış sınıflandırma önerisi (External KB / AI).
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestClassificationResponse | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  /**
   * Hangi alanların öneriden gelen değerle DOLDURULDUĞUNU takip eder.
   * Kullanıcı sonradan elle değiştirirse bu set'ten düşer — submit
   * sırasında metadata'da yalnız son halinde "öneriden gelmiş ve hala
   * değişmemiş" alanları işaretleriz.
   */
  const [appliedSuggestionFields, setAppliedSuggestionFields] = useState<Set<SuggestClassificationField>>(
    () => new Set(),
  );

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

  // Şirket değişince müşteri/proje + Smart Ticket taxonomy seçimlerini
  // sıfırla. Taxonomy listesi per-tenant; eski şirketin code'ları yeni
  // şirkette geçersiz olur, üstelik bu PR'da server-side cross-tenant
  // taxonomy code validation YOK → stale değerleri formda tutmamak için
  // burada agresif reset (Codex PR-1c review P2-A fix).
  useEffect(() => {
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
    // Phase 2b — company değişince suggestion + applied set sıfırlanır
    // (PR-1c P2-A pattern'ı: per-tenant suggestion stale olmasın).
    setSuggestion(null);
    setSuggestionError(null);
    setAppliedSuggestionFields(new Set());
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

  // Codex PR-1c review P2-B fix — projectsRequired=true tenant'larda backend
  // (caseRepository.create) `project_required` ile reddediyor. Submit'i UI'da
  // gating'le ki kullanıcı formu tamamlayıp ancak POST sonrası hata almasın.
  // Mevcut NewCaseForm gating mantığıyla eşdeğer (NewCaseForm.tsx#732).
  const projectRequirementSatisfied =
    !projectsEnabled || !projectsRequired || !form.accountId || !!form.accountProjectId;

  const canSubmit =
    !!form.companyId &&
    !!form.accountId &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    projectRequirementSatisfied &&
    !submitting;

  // ── Phase 2b — açılış sınıflandırma önerisi handler'ları ──────────
  // Button: companyId + min 5 karakter açıklama gerekir. Aksi takdirde
  // disabled. KB devre dışıysa veya hata olursa kullanıcıya net mesaj
  // verilir; manuel dropdown'lar her halükarda çalışmaya devam eder.
  const canSuggest =
    !!form.companyId && form.description.trim().length >= 5 && !suggesting;

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
      // YALNIZ BOŞ alanları otomatik doldur. Kullanıcının elle seçtiği
      // değerler asla sessiz silinmez.
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

  /**
   * "Önerileri uygula" — kullanıcının bilinçli kararıyla TÜM önerileri
   * (boş olmayan dahil) override eder. Bu, otomatik prefill'in aksine
   * kullanıcı bilgisi olan bir mutasyondur.
   */
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

  // Kullanıcı bir alanı manuel değiştirince applied set'inden düş.
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

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    // Smart Ticket → klasik Case alanları mapping (Phase 1d).
    // resolveSmartTicketMapping per-tenant taxonomy metadata'sına bakar;
    // mapping yoksa "fallback" döner ve Case yine sorunsuz açılır.
    const mapping = resolveSmartTicketMapping(taxonomies, {
      platform: form.platform || undefined,
      businessProcess: form.businessProcess || undefined,
      operationType: form.operationType || undefined,
      affectedObject: form.affectedObject || undefined,
      impact: form.impact || undefined,
    });

    // customFields.smartTicket: orijinal code + label + mapping kararı.
    // - Code'lar her zaman saklanır → klasik alanlara map edilseler bile
    //   intake context'i kaybolmaz (raporlama / audit / future closure).
    // - Label'lar bootstrap-cache benzeri downstream raporlar lookup yapmasın
    //   diye snapshot olarak yazılır.
    // - appliedMapping: hangi alanın hangi kaynaktan geldiği ve son değerleri.
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

    // Phase 2b — KB sınıflandırma önerisi metadata'sı (yalnızca
    // suggestion alındıysa). Per-field matchedBy/confidence appliedFields
    // setine girer; kullanıcı sonradan değiştirdiyse o alan listeye
    // girmez. unmatched ham raporlama için saklanır. Raw KB cevabı
    // PERSIST EDİLMEZ.
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
        // Mapping kararı: businessProcess.metadata varsa map; yoksa fallback.
        // Case create mapping yokluğunda HİÇBİR ZAMAN patlamaz — mapping.source
        // 'fallback' olur ve kullanıcıya gözüken Case kategorisi
        // "Akıllı Ticket / Genel / Talep" şeklinde kalır.
        category: mapping.category,
        subCategory: mapping.subCategory,
        requestType: mapping.requestType,
        customFields: {
          smartTicket,
        },
      });
      toast({
        type: 'success',
        message: `Akıllı Ticket "${created.title}" oluşturuldu.`,
        duration: 2500,
      });
      onCreated(created.id);
    } catch (e) {
      setError((e as Error)?.message ?? 'Vaka oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="mb-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text"
          >
            <ArrowLeft size={12} />
            <span>Vakalara dön</span>
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
              Akıllı Ticket Aç
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
            Akıllı Ticket akışı yapılandırılıyor — bu shell mevcut <strong>POST /api/cases</strong>{' '}
            üzerine gerçek bir vaka açar; Smart Ticket meta verisi vakanın{' '}
            <code className="font-mono text-[11px]">customFields.smartTicket</code> alanına yazılır.
            Quick Case ve klasik Yeni Vaka akışları aynen çalışmaya devam eder.
          </p>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-5">
          {/* Şirket / müşteri / proje */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <CompanySelector
              label="Şirket"
              value={form.companyId || null}
              onChange={(id) => setForm((f) => ({ ...f, companyId: id ?? '' }))}
              required
            />
            <Field label="Müşteri" required>
              <button
                type="button"
                onClick={() => setAccountPickerOpen(true)}
                className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400 dark:border-ndark-border dark:bg-ndark-card"
              >
                <span className={form.accountName ? 'text-slate-800 dark:text-ndark-text' : 'text-slate-400'}>
                  {form.accountName || 'Müşteri seçin…'}
                </span>
                <Users2 size={14} className="text-slate-400" />
              </button>
            </Field>
            {/* Proje alanı şu üç durumda gösterilir:
                 - şirkette projectsEnabled=true VE müşteri seçildi (NewCaseForm
                   pattern'i); projectsRequired=true ise zorunlu rozet.
                 - flag kapalı tenant'larda müşterinin aktif projesi varsa yine
                   opsiyonel olarak göster (legacy davranışı koru). */}
            {((projectsEnabled && !!form.accountId) || projects.length > 0) && (
              <Field
                label="Proje"
                required={projectsEnabled && projectsRequired && !!form.accountId}
                hint={
                  projectsEnabled && projectsRequired && !!form.accountId
                    ? 'Bu şirket için proje zorunlu.'
                    : 'Opsiyonel — müşterinin aktif projeleri.'
                }
              >
                <Select
                  value={form.accountProjectId}
                  onChange={(e) => handleSelectProject(e.target.value)}
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
          </div>

          {/* Başlık / açıklama */}
          <Field label="Başlık" required>
            <TextInput
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ör. Müşteri ürün kartı kaydı sırasında hata alıyor"
            />
          </Field>

          <Field label="Açıklama" required>
            <TextArea
              rows={5}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Problemi kısa ve net anlat. Hangi platform? Hangi işlem? Hangi etki?"
            />
          </Field>

          {/* Smart Ticket taxonomy alanları */}
          <div className="rounded-md border border-brand-100 bg-brand-50/40 p-4 dark:border-brand-900/30 dark:bg-brand-950/20">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-brand-500" />
                <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
                  Akıllı Tanımlar
                </span>
                {taxonomiesLoading && (
                  <span className="text-xs text-slate-500 dark:text-ndark-muted">yükleniyor…</span>
                )}
              </div>
              {/* WR-Smart-Ticket Phase 2b — KB'den sınıflandırma önerisi */}
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Wand2 size={12} />}
                disabled={!canSuggest}
                onClick={() => void handleSuggestClassification()}
                title={
                  !form.companyId
                    ? 'Önce şirket seçin'
                    : form.description.trim().length < 5
                      ? 'En az 5 karakter açıklama girin'
                      : 'External KB üzerinden 5 sınıflandırma alanı önerilir'
                }
              >
                {suggesting ? 'Öneriliyor…' : 'KB ile Sınıflandır'}
              </Button>
            </div>
            {taxonomyError && (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {taxonomyError}
              </p>
            )}
            {suggestionError && (
              <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                {suggestionError} Manuel seçim yapabilirsiniz.
              </p>
            )}
            {suggestion && (
              <div className="mb-3 rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-violet-800 dark:text-violet-200">
                    KB önerisi: {Object.keys(suggestion.suggestions).length} alan eşleşti
                    {suggestion.unmatched.length > 0 && `, ${suggestion.unmatched.length} eşleşmedi`}
                  </span>
                  {Object.keys(suggestion.suggestions).length > 0 && (
                    <Button size="sm" variant="ghost" onClick={handleApplyAllSuggestions}>
                      Önerileri uygula
                    </Button>
                  )}
                </div>
                {suggestion.unmatched.length > 0 && (
                  <ul className="mt-1 text-[11px] text-violet-700 dark:text-violet-300">
                    {suggestion.unmatched.map((u, i) => (
                      <li key={`${u.taxonomyType}-${i}`}>
                        Eşleşmedi: <span className="font-medium">{u.taxonomyType}</span> —{' '}
                        <code className="font-mono">{u.rawValue || '(boş)'}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                        ? `KB önerisi (eşleşme: ${suggested.matchedBy}, güven %${Math.round(suggested.confidence * 100)})`
                        : f.hint
                    }
                  >
                    <Select
                      value={form[f.key]}
                      onChange={(e) => handleTaxonomyChange(f.key, e.target.value)}
                      disabled={taxonomiesLoading || items.length === 0}
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
            <MappingPreview taxonomies={taxonomies} form={form} />
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-ndark-border">
            <Button variant="outline" onClick={onCancel} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? 'Açılıyor…' : 'Akıllı Ticket Aç'}
            </Button>
          </div>
        </CardBody>
      </Card>

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
// Mapping preview — kullanıcı submit'ten önce hangi klasik
// Kategori/Alt Kategori/İstek Tipi alanlarına eşlendiğini görsün.
// Read-only; UI submit logic'i aynı resolveSmartTicketMapping'i kullanır.
// ─────────────────────────────────────────────────────────────────
function MappingPreview({
  taxonomies,
  form,
}: {
  taxonomies: SmartTicketTaxonomyResponse['taxonomies'] | null;
  form: SmartTicketFormState;
}) {
  const mapping = resolveSmartTicketMapping(taxonomies, {
    platform: form.platform || undefined,
    businessProcess: form.businessProcess || undefined,
    operationType: form.operationType || undefined,
    affectedObject: form.affectedObject || undefined,
    impact: form.impact || undefined,
  });
  const mapped = mapping.source !== 'fallback';
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-[12px] text-slate-600 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-slate-700 dark:text-ndark-text">
          Eşleme önizleme (klasik Case alanları)
        </span>
        <span
          className={
            mapped
              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted'
          }
        >
          kaynak: {mapping.source}
        </span>
      </div>
      <ul className="space-y-0.5">
        <li>
          Kategori: <span className="font-medium">{mapping.category}</span>{' '}
          <span className="text-slate-400">({mapping.trace.category})</span>
        </li>
        <li>
          Alt Kategori: <span className="font-medium">{mapping.subCategory}</span>{' '}
          <span className="text-slate-400">({mapping.trace.subCategory})</span>
        </li>
        <li>
          İstek Tipi: <span className="font-medium">{mapping.requestType}</span>{' '}
          <span className="text-slate-400">({mapping.trace.requestType})</span>
        </li>
      </ul>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-ndark-muted">
        Eşleme businessProcess <code className="font-mono">metadata.caseCategory</code> /{' '}
        <code className="font-mono">caseSubCategory</code> /{' '}
        <code className="font-mono">caseRequestType</code> üzerinden okunur. Mapping yoksa{' '}
        Akıllı Ticket / Genel / Talep değerleriyle fallback'e düşer ve vaka yine açılır.
      </p>
    </div>
  );
}


