import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CornerUpLeft,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Paperclip,
  PenLine,
  Settings2,
  Shield,
  Sparkles,
  Target,
  Users2,
  Wand2,
  Workflow,
  Wrench,
  X as XIcon,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import {
  caseService,
  lookupService,
  type CaseSolutionStep,
  type SmartTicketTaxonomyItem,
  type SmartTicketRootCauseGroup,
  type SmartTicketTaxonomyResponse,
  type SmartTicketStepOutcomesSummary,
  type SuggestClassificationResponse,
  type SuggestClassificationField,
} from '@/services/caseService';
import { accountService, type AccountListItem } from '@/services/accountService';
import type { Case, CasePriority, CaseRequestType } from '@/features/cases/types';
import {
  CASE_FILE_MAX_COUNT,
  CASE_FILE_MAX_SIZE,
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_REQUEST_TYPES,
} from '@/features/cases/types';
import { CaseSolutionStepsPanel } from '@/features/cases/CaseSolutionStepsPanel';
import { resolveSmartTicketMapping } from './mapping';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatRelative } from '@/lib/format';
import { KbDraftCard } from '@/features/cases/KbDraftCard';
import { isAcceptedUpload } from '@/features/cases/uploadWhitelist';

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

// Madde 3 — UI polish. Her taxonomy alanına anlamlı bir lucide ikonu
// eklendi; Field label'inin yanında küçük rozet olarak render edilir.
// Renk paleti değişmedi; sadece görsel okunabilirlik.
const TAXONOMY_FIELDS: Array<{
  key: 'platform' | 'businessProcess' | 'operationType' | 'affectedObject' | 'impact';
  label: string;
  hint?: string;
  Icon: typeof Layers;
}> = [
  { key: 'platform',        label: 'Platform',         Icon: Layers },
  { key: 'businessProcess', label: 'İş Süreci',        Icon: Workflow },
  { key: 'operationType',   label: 'İşlem Tipi',       Icon: Settings2 },
  { key: 'affectedObject',  label: 'Etkilenen Nesne',  Icon: Box },
  { key: 'impact',          label: 'Etki',             Icon: Flame },
];

interface SmartTicketProjectOption {
  id: string;
  name: string;
  /** PR-6 — Proje kodu (örn. "ROTA-2026"). AccountProject schema'da
   *  zaten zorunlu alan; accountService.get response'unda dönüyor.
   *  Stage 1'de name + code substring filter için kullanılır. */
  code?: string;
}

// PR-5 — QuickCaseModal pendingFiles tipi ile birebir aynı. Kullanıcı
// dosya seçtiğinde queued olarak girer; submit'te uploading → done /
// error transition'ı yapılır.
interface PendingFile {
  file: File;
  id: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  percent: number;
  errorMessage?: string;
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
  // PR-3 — Business review Madde 3. Manual selection (kullanıcı override
  // etti mi) flag'leri ile birlikte tutulur; flag false ise payload
  // mapping derive / fallback yoluna düşer (mevcut davranış korunur).
  // priority default 'Medium' (Case schema default ile uyumlu). requestType
  // boş başlar — boş kalırsa mapping derive eder.
  priority: CasePriority;
  priorityManual: boolean;
  requestType: CaseRequestType | '';
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
  priority: 'Medium',
  priorityManual: false,
  requestType: '',
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
  onOpenExistingCase,
}: {
  /**
   * Kullanıcı bilinçli olarak Case Detail'e gitmek isterse caller bunu
   * yönlendirir. **Birincil akışta otomatik çağrılmaz**: Case create
   * sonrası kullanıcı Smart Ticket ekranında kalır (Stage 2).
   */
  onCreated: (caseId: string) => void;
  onCancel: () => void;
  /**
   * Müşteri açık vakalar paneli — kullanıcı listeden bir vakaya tıklayınca
   * caller Cases List'e geçirir (mevcut Smart Ticket akışı abandone
   * edilir; bu kasıtlı: kullanıcı mükerrer açmaktan vazgeçti).
   * Verilmezse satırlar bilgi amaçlı, tıklatılabilir değil.
   */
  onOpenExistingCase?: (caseId: string) => void;
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

  // Madde 1 — Müşteri seçildiğinde o müşterinin açık vakalarını panel
  // olarak göster. Mükerrer ticket önleme + L1 ajan başkası işliyor mu
  // görsün. Mevcut endpoint reuse: caseService.findByAccount.
  // Klasik akışı bozmuyor — yalnız Smart Ticket Stage 1 paneli.
  const [accountOpenCases, setAccountOpenCases] = useState<Case[]>([]);
  const [accountOpenCasesLoading, setAccountOpenCasesLoading] = useState(false);
  const [accountOpenCasesError, setAccountOpenCasesError] = useState<string | null>(null);
  const accountOpenCasesReqIdRef = useRef(0);
  const accountOpenCasesAccountIdRef = useRef<string>('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // PR-5 — Business review Madde 2. Stage 1'de dosya attach.
  // QuickCaseModal pendingFiles pattern'i birebir reuse: queued/uploading/
  // done/error state machine. Case create öncesi FE state'inde tutulur;
  // create başarılı olunca sıralı upload (caseService.addFile). Upload
  // fail olursa Case AÇIK KALIR; kullanıcıya Vaka Detayı → Dosyalar'dan
  // tekrar yükleme yönlendirmesi yapılır.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  // PR-6 — Business review Madde 4. Proje kodu ile arama. Müşteri
  // seçildiğinde gelen mevcut proje listesinde FE-side substring filter.
  // Yeni endpoint YOK; backend yetkilendirme aynı (account scope).
  // Seçili proje varken filter yine tüm listede çalışır — kullanıcı
  // başka projeye geçebilir.
  const [projectFilter, setProjectFilter] = useState('');

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

  // WR-KB-v2 doc §7 — Stage 3 AI önerisi state.
  const [closureSuggesting, setClosureSuggesting] = useState(false);
  const [closureSuggestion, setClosureSuggestion] = useState<import('@/services/caseService').SuggestClosureResponse | null>(null);
  const [closureSuggestionError, setClosureSuggestionError] = useState<string | null>(null);

  // Stage 3 resolution-first: "Çözüm Açıklaması" textarea'sını kullanıcı bilerek
  // edit ettiğinde flag set edilir; prefill (Stage 2 worked step → resolution
  // note) bir daha çalışmaz — kullanıcının yazısı korunur. Voice input da
  // explicit edit sayılır. resolutionDebounceRef: 1000 ms inactivity sonrası
  // KB önerisinin current textarea değerinden yeniden istemek için timer.
  const resolutionNoteDirtyRef = useRef(false);
  const resolutionDebounceRef = useRef<number | null>(null);
  // Stage 3 resolution-first KB drafts override gate: bir kez başarılı
  // suggest-closure cevabı geldiğinde true olur. KbDraftCard'da "ilk refresh'ten
  // sonra persisted Stage 2 aiDrafts'a fallback YAPMA" garantisi için bu flag
  // override (boş object) geçirmeyi tetikler — null closureSuggestion (re-fetch
  // sırasında) bile stale persisted'i göstermez.
  const closureRefreshedOnceRef = useRef(false);
  const [closureRefreshedTick, setClosureRefreshedTick] = useState(0);

  // PR-T2 — Stage 3 transfer form state. PR-T1 backend kontratını kullanır:
  //   smartTicketTransfer = { transferNote, composedSummary?, attemptedStepIds?,
  //                            stepOutcomesSummary? }
  // Hedef takım hard-code edilmez: Team.defaultSupportLevel === 'L2' bazlı
  // tenant-safe filter; tek L2 ekip varsa preselect, çoklu/sıfır halinde
  // kullanıcı seçimi zorunlu.
  const [transferToTeamId, setTransferToTeamId] = useState('');
  const [transferToPersonId, setTransferToPersonId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferComposedSummary, setTransferComposedSummary] = useState('');
  const [transferAttemptedStepIds, setTransferAttemptedStepIds] = useState<string[]>([]);
  const [transferStepOutcomes, setTransferStepOutcomes] = useState<SmartTicketStepOutcomesSummary | null>(null);
  const [transferBriefLoading, setTransferBriefLoading] = useState(false);
  const [transferBriefError, setTransferBriefError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  // Madde 4 — opsiyonel priority değişimi. Default mevcut Case.priority.
  const [transferPriority, setTransferPriority] = useState<CasePriority>('Medium');
  // Composer'ın kullanıcı tarafından düzenlenip düzenlenmediğini izle.
  // Auto-fetch user override'ı ezmesin diye flag tutuluyor.
  const transferSummaryDirtyRef = useRef(false);

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
        .map((p) => ({ id: p.id, name: p.name, code: p.code }));
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

  // Madde 1 — Müşteri seçilince o müşterinin açık vakalarını çek.
  // Stale guard: accountId değişince eski response uygulanmaz.
  // findByAccount tüm vakaları döner; client-side "open" filtresi (Çözüldü
  // ve İptalEdildi hariç) — CustomerCardModal'daki aynı pattern.
  useEffect(() => {
    if (!form.accountId) {
      accountOpenCasesAccountIdRef.current = '';
      setAccountOpenCases([]);
      setAccountOpenCasesError(null);
      setAccountOpenCasesLoading(false);
      return;
    }
    const reqId = ++accountOpenCasesReqIdRef.current;
    const targetAccountId = form.accountId;
    accountOpenCasesAccountIdRef.current = targetAccountId;
    setAccountOpenCasesLoading(true);
    setAccountOpenCasesError(null);
    void caseService
      .findByAccount(targetAccountId, {
        statusNotIn: ['Çözüldü', 'İptalEdildi'],
      })
      .then((list) => {
        if (
          reqId !== accountOpenCasesReqIdRef.current ||
          accountOpenCasesAccountIdRef.current !== targetAccountId
        ) {
          return;
        }
        setAccountOpenCases(list ?? []);
      })
      .catch((e: unknown) => {
        if (
          reqId !== accountOpenCasesReqIdRef.current ||
          accountOpenCasesAccountIdRef.current !== targetAccountId
        ) {
          return;
        }
        setAccountOpenCasesError((e as Error)?.message ?? 'Açık vakalar yüklenemedi.');
      })
      .finally(() => {
        if (reqId === accountOpenCasesReqIdRef.current) {
          setAccountOpenCasesLoading(false);
        }
      });
  }, [form.accountId]);

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

  // PR-6 — Proje filter: name veya code substring (case-insensitive,
  // Filter boşsa tüm projeler döner. Seçili proje filter dışına düşse
  // bile listede tutulur (visual continuity).
  //
  // Codex P2 (PR #467 review) — Proje kodu (ASCII identifier, örn.
  // "INV-2026" / "IK-1") için locale-NEUTRAL lowercase. tr-TR
  // toLocaleLowerCase 'I' → 'ı' (dotless) yapar; kullanıcı 'inv'
  // yazınca query 'inv' (dotted) kalır ve match etmez. Code için
  // ASCII toLowerCase; name için Türkçe karakter desteği (ş/ç/ğ/ö/ü/ı)
  // gerektiği için tr-TR korunur. Query iki yola normalize edilir:
  // qNeutral (code karşılaştırması) + qTr (name karşılaştırması).
  const filteredProjects = useMemo(() => {
    const raw = projectFilter.trim();
    if (!raw) return projects;
    const qNeutral = raw.toLowerCase();
    const qTr = raw.toLocaleLowerCase('tr-TR');
    return projects.filter((p) => {
      // Seçili olan görünür kalsın.
      if (form.accountProjectId === p.id) return true;
      const name = (p.name || '').toLocaleLowerCase('tr-TR');
      const code = (p.code || '').toLowerCase();
      return name.includes(qTr) || code.includes(qNeutral);
    });
  }, [projects, projectFilter, form.accountProjectId]);

  // Müşteri / şirket / projeler değişince filter'ı temizle.
  useEffect(() => {
    setProjectFilter('');
  }, [form.accountId, form.companyId]);

  // PR-5 — Pending files handlers. QuickCaseModal pattern'i birebir
  // (count + size validation + queue update). Mevcut helper'ları
  // duplicate etmek yerine inline kalıyor çünkü Smart Ticket'a özel
  // basit lifecycle yeterli.
  function handlePickFiles(filesList: FileList | File[]) {
    const list = Array.from(filesList);
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
    // PR-7 — MIME + uzantı whitelist pre-validation. Backend yine
    // kesin koruma sağlar; bu pre-validation UX iyileştirmesi (kullanıcı
    // upload başlamadan önce reddedilenleri görsün).
    const rejected = list.filter((f) => !isAcceptedUpload(f.type, f.name));
    if (rejected.length > 0) {
      toast({
        type: 'error',
        message:
          rejected.length === 1
            ? `"${rejected[0].name}" dosya türü kabul edilmiyor.`
            : `${rejected.length} dosya türü kabul edilmiyor (PDF, Office, görsel, TXT/CSV/JSON/XML, ZIP).`,
        duration: 4500,
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

  function handleRemovePendingFile(id: string) {
    setPendingFiles((q) => q.filter((p) => p.id !== id));
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

    // PR-3 — Business review Madde 3. Final priority/requestType + source.
    // Kullanıcı override > mapping derive > fallback.
    //   requestType:
    //     - form.requestType doluysa → manual (kullanıcı seçti)
    //     - boşsa → mapping.requestType (taxonomy / fallback)
    //   priority:
    //     - form.priorityManual true ise → manual (kullanıcı override etti)
    //     - değilse → default 'Medium' (mevcut davranış aynen)
    //   Source field'ları customFields.smartTicket içine yazılır — audit
    //   ve future analytics için. Backend enum validation'ı bozulmaz.
    const finalRequestType = form.requestType || mapping.requestType;
    const requestTypeSource: 'manual' | 'mapping' = form.requestType ? 'manual' : 'mapping';
    const finalPriority: CasePriority = form.priorityManual ? form.priority : 'Medium';
    const prioritySource: 'manual' | 'default' = form.priorityManual ? 'manual' : 'default';
    smartTicket.requestTypeSource = requestTypeSource;
    smartTicket.prioritySource = prioritySource;

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
        priority: finalPriority,
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
        requestType: finalRequestType,
        customFields: { smartTicket },
      });
      setCreatedCase(created);

      // PR-5 — Pending files'i sırayla upload et (Case create başarılı
      // olduktan sonra, KB import'tan ÖNCE). Hata olursa Case AÇIK KALIR;
      // kullanıcıya warn toast ile "Vaka Detayı → Dosyalar'dan tekrar
      // yükleyebilirsin" yönlendirmesi yapılır. QuickCaseModal pattern'i
      // ile simetrik (sequential, hata durumunda devam).
      let uploadedCase: Case = created;
      let filesOk = 0;
      let filesFail = 0;
      if (pendingFiles.length > 0) {
        for (const pf of pendingFiles) {
          setPendingFiles((q) =>
            q.map((p) => (p.id === pf.id ? { ...p, status: 'uploading', percent: 0 } : p)),
          );
          const result = await caseService.addFile(uploadedCase.id, pf.file, (percent) => {
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
            uploadedCase = result.caseUpdated;
            setPendingFiles((q) =>
              q.map((p) => (p.id === pf.id ? { ...p, status: 'done', percent: 100 } : p)),
            );
          }
        }
        setCreatedCase(uploadedCase);
        if (filesFail > 0) {
          toast({
            type: 'warn',
            message: `${filesOk}/${pendingFiles.length} dosya yüklendi · ${filesFail} hata. Vaka Detayı → Dosyalar'dan tekrar yükleyebilirsiniz.`,
            duration: 4500,
          });
        }
      }

      // Çözüm Adımlarını çağırma asynchronous — başarısız olsa bile
      // kullanıcı manuel adım ekleyebilir. Hata bilgilendirme toast'unda.
      //
      // Codex P2 (main #459 review) — import-ai-suggested route artık
      // customFields.smartTicket.aiDrafts persist ediyor (Madde 2).
      // Eski impl `created` snapshot'unu state'te tutuyordu → KbDraftCard
      // (Stage 3 closure / transfer / Case Detail) stale customFields ile
      // render ediyordu, KB teknik handoff + müşteri yanıt taslakları hiç
      // görünmüyordu. Fix: import sonrası caseService.get ile case'i
      // yenile, başarısız olursa eski create snapshot'unda kal.
      try {
        const importResult = await caseService.importAiSuggestedSolutionSteps(created.id, {
          freeText: form.description.trim(),
        });
        // aiDrafts persist'i tetiklenmiş olabilir (Madde 2 server-side).
        // Fresh fetch ile customFields.smartTicket.aiDrafts UI'a yansır.
        const refreshed = await caseService.get(created.id);
        if (refreshed) setCreatedCase(refreshed);
        if (importResult && importResult.summary.importedCount > 0) {
          toast({
            type: 'success',
            message: `Vaka açıldı (${created.caseNumber}) · ${importResult.summary.importedCount} AI önerisi eklendi.`,
            duration: 3000,
          });
        } else {
          // importResult var ve importedCount===0 — KB cevap verdi ama
          // suggestedSteps boş geldi (sessiz fail değil, meşru durum).
          // L1 kullanıcısı manuel adım eklemesi gerektiğini bilsin diye
          // info toast — eski "success" mesajı kullanıcıya hiçbir sinyal
          // vermiyordu, kullanıcı KB önerisini boş yere bekliyordu.
          toast({
            type: 'info',
            message: `Vaka açıldı (${created.caseNumber}). KB cevabında öneri bulunamadı — manuel adım ekleyebilirsiniz.`,
            duration: 3500,
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

  // Kök Neden Grubu değişince Detay seçimini sıfırla — ama yalnız mevcut
  // detail yeni grubun children'ında ARTIK GEÇERLİ DEĞİLSE.
  //
  // Codex P2 (main #447 review) — KB closure suggestion rootCauseGroup +
  // rootCauseDetail'i tek setState'te birlikte doldurur
  // (handleSuggestClosure ve handleApplyAllClosureSuggestions). Eski impl
  // group değişimini gözleyip koşulsuz detail'i clear ediyordu →
  // suggestion'ın yazdığı detail yapışmıyordu. Yeni davranış: detail seçili
  // ve yeni grubun rcdList'inde varsa koru; aksi takdirde temizle. Bu hem
  // AI suggestion (group + detail aynı render'da) hem manuel group değişimi
  // (yeni grup içinde eski detail invalid) için doğru çalışır.
  useEffect(() => {
    setClosure((c) => {
      if (!c.rootCauseDetail) return c;
      const stillValid = closureLists.rcdList.some((d) => d.code === c.rootCauseDetail);
      if (stillValid) return c;
      return { ...c, rootCauseDetail: '' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closure.rootCauseGroup, closureLists.rcdList]);

  // Stage 3 resolution-first: Stage 2'deki step listesinden "Çözüm Açıklaması"
  // textarea'sı için prefill text üret. En son worked step'lerin title (+ varsa
  // note) bilgisini compose eder. Hiç worked step yoksa en son manual step'i
  // yedek olarak kullanır. Hiçbiri yoksa boş döner — kullanıcı boş textarea
  // görür (spec).
  function buildResolutionPrefillFromSteps(steps: CaseSolutionStep[]): string {
    const worked = steps
      .filter((s) => s.status === 'worked')
      .sort((a, b) => a.stepIndex - b.stepIndex);
    const source = worked.length > 0
      ? worked
      : steps.filter((s) => s.source === 'manual').slice(-1);
    return source
      .map((s) => {
        const title = (s.title ?? '').trim();
        const note = (s.note ?? '').trim();
        if (title && note) return `${title} — ${note}`;
        return title || note;
      })
      .filter((line) => line.length > 0)
      .join('\n');
  }

  // Stage 3 resolution-first: Stage 3'e girince
  //   1. Stage 2'nin step listesini çek.
  //   2. resolutionNote BOŞ ve kullanıcı henüz textarea'ya dokunmadıysa
  //      worked step'ten compose edilen text'i prefill et.
  //   3. KB önerisini current resolution note ile iste (override geçer).
  // Re-entry (Stage 2 ↔ Stage 3 gidip gelme) durumunda dirty flag korunduğu
  // için kullanıcının yazısı bir daha ezilmez.
  useEffect(() => {
    if (stage !== 'closure' || !createdCase) return;
    let cancelled = false;
    const targetCaseId = createdCase.id;
    void (async () => {
      let prefillText = '';
      try {
        const steps = await caseService.listSolutionSteps(targetCaseId);
        if (cancelled) return;
        prefillText = buildResolutionPrefillFromSteps(steps);
      } catch {
        // Step fetch başarısızsa prefill atla — kullanıcı boş textarea'ya yazar.
      }
      if (cancelled) return;
      let effectiveResolution = '';
      setClosure((c) => {
        if (resolutionNoteDirtyRef.current || c.resolutionNote.trim().length > 0) {
          effectiveResolution = c.resolutionNote;
          return c;
        }
        effectiveResolution = prefillText;
        return prefillText ? { ...c, resolutionNote: prefillText } : c;
      });
      if (cancelled) return;
      void handleSuggestClosure({
        resolutionOverride: effectiveResolution.trim().length > 0 ? effectiveResolution : undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, createdCase?.id]);

  // Stage 3 resolution-first: "Çözüm Açıklaması" textarea değişikliği →
  // 1000 ms inactivity sonrası KB önerisini current değerle yenile. Kullanıcı
  // yazmayı sürdürdükçe önceki timer iptal edilir; aşırı API çağrısı önlenir.
  // İlk girişte useEffect'in suggestClosure çağrısıyla zaten önerek geldi —
  // bu effect yalnız dirty=true olunca anlamlı, prefill'in tetiklediği
  // değişimde no-op (dirty ref'i prefill set etmiyor).
  useEffect(() => {
    if (stage !== 'closure' || !createdCase) return;
    if (!resolutionNoteDirtyRef.current) return;
    if (resolutionDebounceRef.current != null) {
      window.clearTimeout(resolutionDebounceRef.current);
    }
    const trimmed = closure.resolutionNote.trim();
    resolutionDebounceRef.current = window.setTimeout(() => {
      resolutionDebounceRef.current = null;
      void handleSuggestClosure({
        resolutionOverride: trimmed.length > 0 ? closure.resolutionNote : undefined,
      });
    }, 1000);
    return () => {
      if (resolutionDebounceRef.current != null) {
        window.clearTimeout(resolutionDebounceRef.current);
        resolutionDebounceRef.current = null;
      }
    };
    // handleSuggestClosure stable değil; effect resolutionNote'a göre tetiklenmeli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closure.resolutionNote, stage, createdCase?.id]);

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

  // WR-KB-Closure-Auto — Stage 3 KB önerisi handler.
  //
  // Codex P2 fix — Re-entry sırasında pending request guard:
  //
  // Stage 3'e girince useEffect handleSuggestClosure() çağırıyor; KB
  // çağrısı birkaç saniye sürebilir. Kullanıcı request pending iken
  // Stage 2'ye dönüp (worked step değiştirip vs.) tekrar Stage 3'e
  // gelirse effect tekrar tetiklenir AMA `closureSuggesting=true`
  // olduğu için eski impl erken return ediyordu → request bittikten
  // sonra yeni fetch queue'lanmıyor → öneri stale solution-step
  // outcome set'iyle kalıyordu.
  //
  // İki katmanlı koruma (CaseSolutionStepsPanel P2 fix pattern'i ile
  // simetrik):
  //  - `closureSuggestReqIdRef`: her çağrı kendi token'ını snapshot
  //    eder; setState öncesi current ref ile karşılaştırır. Aynı case
  //    için arka arkaya 2 çağrıda yalnız sonuncu kazanır.
  //  - `closureSuggestRefreshQueuedRef`: request pending iken yeni
  //    çağrı isteği gelirse flag set edilir; finally'de current case/
  //    stage hala geçerliyse yeniden tetiklenir.
  const closureSuggestReqIdRef = useRef(0);
  const closureSuggestRefreshQueuedRef = useRef(false);
  const closureSuggestQueuedOptsRef = useRef<{ workedStepId?: string; resolutionOverride?: string }>({});

  // Stage 3 resolution-first: imzaya `resolutionOverride` eklendi. Verildiyse
  // backend compose-from-steps yerine bu değeri KB'ye gönderir; kategorizasyon
  // current "Çözüm Açıklaması" metnine göre üretilir. Önceki workedStepId-only
  // çağrı şekli geri uyumlu — eski caller'lar etkilenmez.
  async function handleSuggestClosure(opts?: { workedStepId?: string; resolutionOverride?: string }) {
    if (!createdCase) return;
    const workedStepId = opts?.workedStepId;
    const resolutionOverride = opts?.resolutionOverride;
    if (closureSuggesting) {
      // Pending request var → yeni isteği kuyruğa al; finally tetikler.
      closureSuggestRefreshQueuedRef.current = true;
      closureSuggestQueuedOptsRef.current = { workedStepId, resolutionOverride };
      return;
    }
    const reqId = ++closureSuggestReqIdRef.current;
    const targetCaseId = createdCase.id;
    setClosureSuggesting(true);
    setClosureSuggestionError(null);
    setClosureSuggestion(null);
    try {
      const res = await lookupService.suggestSmartTicketClosure({
        caseId: targetCaseId,
        ...(workedStepId ? { workedStepId } : {}),
        ...(resolutionOverride && resolutionOverride.trim().length > 0
          ? { resolutionOverride: resolutionOverride.trim() }
          : {}),
      });
      // Stale response guard — yanıt geldiğinde case değiştiyse veya
      // yeni bir request başlatıldıysa state'i uygulama.
      if (
        reqId !== closureSuggestReqIdRef.current ||
        createdCase.id !== targetCaseId ||
        stage !== 'closure'
      ) {
        return;
      }
      if (!res) {
        setClosureSuggestionError('Kapanış önerisi alınamadı.');
        return;
      }
      setClosureSuggestion(res);
      // Stage 3 resolution-first — bir kez başarılı refresh = persisted
      // aiDrafts fallback'i kapanır; bundan sonra KbDraftCard yalnız current
      // KB cevabından (drafts varsa) render eder.
      if (!closureRefreshedOnceRef.current) {
        closureRefreshedOnceRef.current = true;
        setClosureRefreshedTick((t) => t + 1);
      }
      setClosure((c) => {
        const next = { ...c };
        const s = res.suggestions;
        if (s.rootCauseGroup && !next.rootCauseGroup) next.rootCauseGroup = s.rootCauseGroup.code;
        if (s.rootCauseDetail && !next.rootCauseDetail) next.rootCauseDetail = s.rootCauseDetail.code;
        if (s.resolutionType && !next.resolutionType) next.resolutionType = s.resolutionType.code;
        if (s.permanentPrevention && !next.permanentPrevention)
          next.permanentPrevention = s.permanentPrevention.code;
        return next;
      });
    } catch (e) {
      if (reqId === closureSuggestReqIdRef.current && createdCase.id === targetCaseId) {
        setClosureSuggestionError((e as Error)?.message ?? 'Kapanış önerisi alınamadı.');
      }
    } finally {
      // setLoading clear yalnız bu çağrı current ise (aksi takdirde
      // başka çağrı zaten ilerlemiş demektir).
      if (reqId === closureSuggestReqIdRef.current) {
        setClosureSuggesting(false);
      }
      // Queue işle — pending sırasında yeni istek geldiyse şimdi tetikle.
      // Sadece bu çağrı current ise işle (race koşulu önler) ve case/stage
      // hala geçerliyse. Infinite loop guard'ı: queue ref tetikleme
      // öncesi temizlenir.
      if (
        reqId === closureSuggestReqIdRef.current &&
        closureSuggestRefreshQueuedRef.current &&
        createdCase?.id === targetCaseId &&
        stage === 'closure'
      ) {
        const queuedOpts = closureSuggestQueuedOptsRef.current;
        closureSuggestRefreshQueuedRef.current = false;
        closureSuggestQueuedOptsRef.current = {};
        void handleSuggestClosure(queuedOpts);
      }
    }
  }

  // ── PR-T2: Stage 3 transfer — deterministic devir özetini auto-fetch ─
  //
  // Pattern closure auto-fetch ile simetrik: pending request guard +
  // queued re-fetch + stale response guard. Stage 2'de outcome değişip
  // Stage 3 'transfer'e geri dönülürse özet yenilenir.
  //
  // Kullanıcı özeti elle düzenlediyse (transferSummaryDirtyRef.current),
  // auto-fetch DOLU textarea'yı EZMEZ — fetched data yalnız
  // attemptedStepIds + stepOutcomesSummary metadata'sı için kullanılır.
  const transferBriefReqIdRef = useRef(0);
  const transferBriefQueuedRef = useRef(false);

  async function handleFetchTransferBrief() {
    if (!createdCase) return;
    if (transferBriefLoading) {
      transferBriefQueuedRef.current = true;
      return;
    }
    const reqId = ++transferBriefReqIdRef.current;
    const targetCaseId = createdCase.id;
    setTransferBriefLoading(true);
    setTransferBriefError(null);
    try {
      const res = await lookupService.smartTicketTransferBrief({ caseId: targetCaseId });
      if (
        reqId !== transferBriefReqIdRef.current ||
        createdCase.id !== targetCaseId ||
        stage !== 'transfer'
      ) {
        return;
      }
      if (!res) {
        setTransferBriefError('Devir özeti alınamadı.');
        return;
      }
      // Kullanıcı düzenleme yapmadıysa composer'ı doldur; aksi halde
      // editleyen textarea'yı koruyalım (metadata'yı yine güncelle).
      if (!transferSummaryDirtyRef.current) {
        setTransferComposedSummary(
          res.composedSummary && res.composedSummary.trim()
            ? res.composedSummary
            : 'L1 çözüm adımı kaydı yok.',
        );
      }
      setTransferAttemptedStepIds(res.attemptedStepIds ?? []);
      setTransferStepOutcomes(res.stepOutcomesSummary ?? null);
    } catch (e) {
      if (reqId === transferBriefReqIdRef.current && createdCase.id === targetCaseId) {
        setTransferBriefError((e as Error)?.message ?? 'Devir özeti alınamadı.');
      }
    } finally {
      if (reqId === transferBriefReqIdRef.current) {
        setTransferBriefLoading(false);
      }
      if (
        reqId === transferBriefReqIdRef.current &&
        transferBriefQueuedRef.current &&
        createdCase?.id === targetCaseId &&
        stage === 'transfer'
      ) {
        transferBriefQueuedRef.current = false;
        void handleFetchTransferBrief();
      }
    }
  }

  useEffect(() => {
    if (stage !== 'transfer' || !createdCase) return;
    void handleFetchTransferBrief();
    // Madde 4 — Stage 3 transfer'e girince priority select'i mevcut
    // Case.priority ile sync et (default fallback Medium).
    setTransferPriority(createdCase.priority ?? 'Medium');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, createdCase?.id]);

  // L2 takım filtreleme — hard-code teamId/name yok; yalnız metadata.
  const transferTeamOptions = useMemo(() => {
    if (!createdCase) return { all: [], l2: [], nonL2: [], hasL2: false };
    const all = lookupService
      .teams()
      .filter(
        (t) =>
          t.companyId === createdCase.companyId &&
          t.id !== createdCase.assignedTeamId,
      );
    const l2 = all.filter((t) => t.defaultSupportLevel === 'L2');
    const nonL2 = all.filter((t) => t.defaultSupportLevel !== 'L2');
    return { all, l2, nonL2, hasL2: l2.length > 0 };
  }, [createdCase]);

  // Tek L2 ekip varsa preselect. Çoklu L2 → seçim zorunlu (auto-select yok).
  // Sıfır L2 → calm warning, tüm aktif takımlar gösterilir, seçim zorunlu.
  useEffect(() => {
    if (stage !== 'transfer') return;
    if (transferTeamOptions.l2.length === 1 && !transferToTeamId) {
      setTransferToTeamId(transferTeamOptions.l2[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, transferTeamOptions.l2.length, createdCase?.id]);

  // Seçili takıma ait persons.
  const transferPersonOptions = useMemo(() => {
    if (!transferToTeamId) return [];
    return lookupService.personsByTeam(transferToTeamId);
  }, [transferToTeamId]);

  // Takım değişince geçersiz kişi seçimini temizle.
  useEffect(() => {
    if (transferToPersonId && !transferPersonOptions.some((p) => p.id === transferToPersonId)) {
      setTransferToPersonId('');
    }
  }, [transferPersonOptions, transferToPersonId]);

  async function handleSubmitTransfer() {
    if (!createdCase || transferring) return;
    const trimmedNote = transferNote.trim();
    if (!trimmedNote) {
      setTransferError('Devir notu zorunlu.');
      return;
    }
    if (!transferToTeamId) {
      setTransferError('Hedef takım seçin.');
      return;
    }
    setTransferring(true);
    setTransferError(null);
    try {
      const summary = transferComposedSummary.trim();
      // Madde 4 — mevcut Case.priority ile transferPriority aynıysa
      // backend zaten no-op yapıyor; yine de payload'a yalnız değişim
      // varsa ekle (network payload temiz, backend FieldUpdate row'u
      // duplicate yazmaz).
      const priorityChanged = transferPriority !== createdCase.priority;
      const updated = await caseService.transferCase(createdCase.id, {
        toTeamId: transferToTeamId,
        toPersonId: transferToPersonId || undefined,
        reason: trimmedNote,
        reasonCode: 'expertise',
        smartTicketTransfer: {
          transferNote: trimmedNote,
          ...(summary ? { composedSummary: summary } : {}),
          attemptedStepIds: transferAttemptedStepIds,
          ...(transferStepOutcomes ? { stepOutcomesSummary: transferStepOutcomes } : {}),
        },
        ...(priorityChanged ? { priority: transferPriority } : {}),
      });
      if (!updated) {
        setTransferError('Vaka aktarılamadı.');
        return;
      }
      setCreatedCase(updated);
      toast({
        type: 'success',
        message: `Vaka L2'ye aktarıldı (${updated.caseNumber}).`,
        duration: 2500,
      });
      // Devir tamamlandı — kullanıcıyı Case Detail'e götür.
      onCreated(updated.id);
    } catch (e) {
      setTransferError((e as Error)?.message ?? 'Vaka aktarılamadı.');
    } finally {
      setTransferring(false);
    }
  }

  function handleApplyAllClosureSuggestions() {
    if (!closureSuggestion) return;
    setClosure((c) => {
      const next = { ...c };
      const s = closureSuggestion.suggestions;
      if (s.rootCauseGroup) next.rootCauseGroup = s.rootCauseGroup.code;
      if (s.rootCauseDetail) next.rootCauseDetail = s.rootCauseDetail.code;
      if (s.resolutionType) next.resolutionType = s.resolutionType.code;
      if (s.permanentPrevention) next.permanentPrevention = s.permanentPrevention.code;
      return next;
    });
  }

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

    const closurePayload: Record<string, unknown> = {
      rootCauseGroup: closure.rootCauseGroup || undefined,
      rootCauseGroupLabel: findLabel(closureLists.rcgList, closure.rootCauseGroup),
      rootCauseDetail: closure.rootCauseDetail || undefined,
      rootCauseDetailLabel: findLabel(closureLists.rcdList, closure.rootCauseDetail),
      resolutionType: closure.resolutionType || undefined,
      resolutionTypeLabel: findLabel(closureLists.rtList, closure.resolutionType),
      permanentPrevention: closure.permanentPrevention || undefined,
      permanentPreventionLabel: findLabel(closureLists.ppList, closure.permanentPrevention),
    };

    // WR-KB-Closure-Auto — backend `selectedWorkedStepId` (varsa) ve
    // `closureSuggestion` meta'sını customFields.smartTicket.closure
    // altına persist eder. Raw KB cevabı persist EDİLMEZ.
    const suggestedWorkedStepId = closureSuggestion?.meta?.selectedWorkedStepId;
    if (suggestedWorkedStepId) {
      closurePayload.selectedWorkedStepId = suggestedWorkedStepId;
    }
    if (closureSuggestion) {
      const appliedFields: string[] = [];
      const perField: Record<string, { matchedBy: string; suggestedCode: string }> = {};
      for (const key of [
        'rootCauseGroup',
        'rootCauseDetail',
        'resolutionType',
        'permanentPrevention',
      ] as const) {
        const s = closureSuggestion.suggestions[key];
        if (s && closure[key] === s.code) {
          appliedFields.push(key);
          perField[key] = { matchedBy: s.matchedBy, suggestedCode: s.code };
        }
      }
      closurePayload.closureSuggestion = {
        source: 'external_kb',
        appliedAt: new Date().toISOString(),
        appliedFields,
        perField,
        unmatched: closureSuggestion.unmatched.map((u) => ({
          taxonomyType: u.taxonomyType,
          rawValue: u.rawValue,
        })),
        ...(closureSuggestion.meta?.confidence != null
          ? { confidence: closureSuggestion.meta.confidence }
          : {}),
        ...(closureSuggestion.meta?.reason ? { reason: closureSuggestion.meta.reason } : {}),
        ...(closureSuggestion.meta?.modelUsed ? { modelUsed: closureSuggestion.meta.modelUsed } : {}),
      };
    }

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

              {/* Madde 1 — Müşteri açık vakalar paneli (mükerrer önleme).
                  Yalnız form.accountId set olunca koşullu render. */}
              {form.accountId && (
                <AccountOpenCasesPanel
                  loading={accountOpenCasesLoading}
                  error={accountOpenCasesError}
                  cases={accountOpenCases}
                  onOpenCase={onOpenExistingCase}
                />
              )}
              {((projectsEnabled && !!form.accountId) || projects.length > 0) && (
                <Field
                  label="Proje"
                  required={projectsEnabled && projectsRequired && !!form.accountId}
                  hint={
                    projectsEnabled && projectsRequired && !!form.accountId
                      ? 'Bu şirket için proje zorunlu. Kod veya ad ile arayabilirsiniz.'
                      : 'Opsiyonel. Kod veya ad ile arayabilirsiniz.'
                  }
                >
                  <div className="space-y-1.5">
                    {/* PR-6 — Search input: name veya code substring filter.
                        Yalnız 3+ proje varsa göster (1-2 projede gereksiz). */}
                    {projects.length >= 3 && (
                      <TextInput
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                        placeholder="Proje kodu veya adı ile ara…"
                        disabled={stage !== 'opening'}
                      />
                    )}
                    <Select
                      value={form.accountProjectId}
                      onChange={(e) => handleSelectProject(e.target.value)}
                      disabled={stage !== 'opening'}
                    >
                      <option value="">
                        {projectsRequired ? 'Proje seç…' : '— Proje yok —'}
                      </option>
                      {filteredProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code ? `${p.code} — ${p.name}` : p.name}
                        </option>
                      ))}
                    </Select>
                    {projectFilter.trim() && filteredProjects.length === 0 && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        "{projectFilter}" için proje bulunamadı.
                      </p>
                    )}
                  </div>
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
              <Field
                label="Açıklama"
                required
                actions={
                  stage === 'opening' ? (
                    <VoiceNoteButton
                      onTranscript={(chunk) =>
                        setForm((f) => ({
                          ...f,
                          description: f.description ? `${f.description} ${chunk}` : chunk,
                        }))
                      }
                    />
                  ) : undefined
                }
              >
                <TextArea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Problemi kısa ve net anlat. Hangi platform? Hangi işlem? Hangi etki?"
                  disabled={stage !== 'opening'}
                />
              </Field>

              {/* PR-5 — Business review Madde 2. Stage 1'de dosya attach.
                  Yalnız stage === 'opening' iken aktif; Case create
                  başarılı olunca sıralı upload edilir. Hata olursa Case
                  açık kalır, kullanıcı Vaka Detayı → Dosyalar'dan tekrar
                  yükleyebilir. */}
              {stage === 'opening' && (
                <Stage1FileAttach
                  pendingFiles={pendingFiles}
                  onPick={handlePickFiles}
                  onRemove={handleRemovePendingFile}
                  disabled={creating}
                />
              )}

              {/* PR-3 — Business review Madde 3. Talep Türü + Öncelik.
                  Boş bırakılırsa Talep Türü mapping derive eder; Öncelik
                  default 'Medium'. Kullanıcı seçim yaparsa override eder
                  (customFields.smartTicket.requestTypeSource /
                  prioritySource). Mevcut Case enum validation backend'de
                  zorunlu — backend sade payload ile uyumlu. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Talep Türü"
                  hint={
                    !form.requestType
                      ? 'Boş bırakılırsa Akıllı Tanımlar / mapping otomatik seçer.'
                      : undefined
                  }
                >
                  <Select
                    value={form.requestType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, requestType: e.target.value as CaseRequestType | '' }))
                    }
                    disabled={stage !== 'opening'}
                  >
                    <option value="">— Otomatik —</option>
                    {CASE_REQUEST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Öncelik"
                  hint={
                    form.priorityManual
                      ? `Seçildi: ${CASE_PRIORITY_LABELS[form.priority]}`
                      : 'Default: Orta. Devirde değiştirilebilir.'
                  }
                >
                  <Select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: e.target.value as CasePriority,
                        priorityManual: true,
                      }))
                    }
                    disabled={stage !== 'opening'}
                  >
                    {CASE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {CASE_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

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
                    const Icon = f.Icon;
                    return (
                      <Field
                        key={f.key}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <Icon size={11} className="text-brand-500" />
                            {f.label}
                          </span>
                        }
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
              createdCase={createdCase}
              closure={closure}
              setClosure={setClosure}
              closureLists={closureLists}
              closing={closing}
              closureError={closureError}
              requiredChecklistPending={requiredChecklistPending}
              closureSuggesting={closureSuggesting}
              closureSuggestion={closureSuggestion}
              closureSuggestionError={closureSuggestionError}
              closureRefreshedOnce={closureRefreshedOnceRef.current && closureRefreshedTick > 0}
              onSuggestClosure={() => {
                // Manuel "KB Önerisini Yenile" — debounce iptal et + current
                // "Çözüm Açıklaması" değerini override olarak gönder.
                if (resolutionDebounceRef.current != null) {
                  window.clearTimeout(resolutionDebounceRef.current);
                  resolutionDebounceRef.current = null;
                }
                const r = closure.resolutionNote.trim();
                void handleSuggestClosure({ resolutionOverride: r.length > 0 ? closure.resolutionNote : undefined });
              }}
              onApplyAllClosureSuggestions={handleApplyAllClosureSuggestions}
              onClose={() => void handleCloseCase()}
              onBack={() => {
                setStage('solution');
                setClosureError(null);
              }}
              onGoToCaseDetail={() => onCreated(createdCase.id)}
              onChangeResolutionNote={(text) => {
                resolutionNoteDirtyRef.current = true;
                setClosure((c) => ({ ...c, resolutionNote: text }));
              }}
            />
          )}

          {stage === 'transfer' && createdCase && (
            <Stage3Transfer
              createdCase={createdCase}
              teamOptions={transferTeamOptions}
              personOptions={transferPersonOptions}
              transferToTeamId={transferToTeamId}
              transferToPersonId={transferToPersonId}
              transferNote={transferNote}
              transferComposedSummary={transferComposedSummary}
              transferStepOutcomes={transferStepOutcomes}
              transferBriefLoading={transferBriefLoading}
              transferBriefError={transferBriefError}
              transferring={transferring}
              transferError={transferError}
              transferPriority={transferPriority}
              onChangeTeam={(id) => setTransferToTeamId(id)}
              onChangePerson={(id) => setTransferToPersonId(id)}
              onChangeNote={(v) => {
                setTransferNote(v);
                if (transferError) setTransferError(null);
              }}
              onChangeSummary={(v) => {
                transferSummaryDirtyRef.current = true;
                setTransferComposedSummary(v);
              }}
              onChangePriority={(p) => setTransferPriority(p)}
              onRefreshBrief={() => {
                transferSummaryDirtyRef.current = false;
                void handleFetchTransferBrief();
              }}
              onSubmit={() => void handleSubmitTransfer()}
              onBack={() => {
                setStage('solution');
                setTransferError(null);
              }}
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
  // User feedback (description-rerun): KB Stage 1'de yetersiz cevap
  // verdiğinde kullanıcı açıklamayı genişletip yeniden sorabilmeli.
  // Açıklama editor submit sonrası refreshKey artırılır → panel `key`
  // prop'u ile remount → listSolutionSteps yeniden çağrılır, yeni AI
  // önerileri (dedup ile) listede görünür.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-3">
      <Stage2DescriptionEditor
        createdCase={createdCase}
        onUpdated={(updated) => {
          onCaseChanged(updated);
          setRefreshKey((k) => k + 1);
        }}
      />
      <CaseSolutionStepsPanel
        key={`${createdCase.id}:${refreshKey}`}
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
            <Button variant="outline" leftIcon={<ArrowRight size={12} />} onClick={onGoToTransfer}>
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
  createdCase,
  closure,
  setClosure,
  closureLists,
  closing,
  closureError,
  requiredChecklistPending,
  closureSuggesting,
  closureSuggestion,
  closureSuggestionError,
  closureRefreshedOnce,
  onSuggestClosure,
  onApplyAllClosureSuggestions,
  onClose,
  onBack,
  onGoToCaseDetail,
  onChangeResolutionNote,
}: {
  createdCase: Case;
  closure: ClosureFormState;
  setClosure: (fn: (c: ClosureFormState) => ClosureFormState) => void;
  closureLists: ClosureListsRef;
  closing: boolean;
  closureError: string | null;
  requiredChecklistPending: { id: string; label: string }[];
  closureSuggesting: boolean;
  closureSuggestion: import('@/services/caseService').SuggestClosureResponse | null;
  closureSuggestionError: string | null;
  /** Stage 3 resolution-first: ilk başarılı suggest-closure tamamlandı mı?
   *  true → KbDraftCard'ı override mode'da kullan (current KB drafts veya
   *  render yok); false → persisted aiDrafts fallback'i göster. */
  closureRefreshedOnce: boolean;
  onSuggestClosure: () => void;
  onApplyAllClosureSuggestions: () => void;
  onClose: () => void;
  onBack: () => void;
  onGoToCaseDetail: () => void;
  /** Stage 3 resolution-first: textarea + voice input için tek değişiklik
   *  noktası. Parent kullanıcı edit'ini dirty flag ile işaretler + debounced
   *  KB refetch'i tetikler. setClosure'dan ayrı tutuluyor çünkü 4 dropdown'un
   *  user değişiklikleri "Çözüm Açıklaması" dirty sayılmamalı. */
  onChangeResolutionNote: (text: string) => void;
}) {
  const checklistBlocked = requiredChecklistPending.length > 0;
  const canSave =
    closure.resolutionNote.trim().length > 0 && !closing && !checklistBlocked;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle text="3. Kapanış" />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Wand2 size={11} />}
              disabled={closureSuggesting}
              onClick={onSuggestClosure}
              title="KB üzerinden kapanış önerisini yeniden iste"
            >
              {closureSuggesting ? 'Öneriliyor…' : 'KB Önerisini Yenile'}
            </Button>
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
        </div>
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          Vakanın nasıl çözüldüğünü önce yazın. Sınıflandırma ve KB önerisi bu metne göre güncellenir.
          Onay politikası geçerliyse mevcut çözüm onayı akışı çalışır; otomatik bypass yok.
        </p>
        {/* Stage 3 resolution-first — "Çözüm Açıklaması" textarea KB önerisi
            block'unun üstüne taşındı. Stage 2 worked step'ten prefill edilir;
            user edit ettiğinde dirty flag set olur ve bir daha ezilmez.
            Voice input append davranışı korunur (her ikisi de
            onChangeResolutionNote'tan geçer → dirty + debounced refetch). */}
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              <Check size={11} className="text-emerald-500" />
              Çözüm Açıklaması
            </span>
          }
          required
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) =>
                onChangeResolutionNote(
                  closure.resolutionNote ? `${closure.resolutionNote} ${chunk}` : chunk,
                )
              }
            />
          }
        >
          <TextArea
            rows={4}
            value={closure.resolutionNote}
            onChange={(e) => onChangeResolutionNote(e.target.value)}
            placeholder="Sorun nasıl çözüldü? Müşteriye ne anlatıldı?"
          />
        </Field>
        {closureSuggesting && !closureSuggestion && (
          <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200">
            <Loader2 size={12} className="animate-spin" />
            <span>KB kapanış önerisi alınıyor… (boş alanlar otomatik dolacak)</span>
          </div>
        )}
        {closureSuggestionError && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {closureSuggestionError} Manuel seçim yapabilirsiniz.
          </p>
        )}
        {closureSuggestion && (
          <div className="rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/30">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-violet-800 dark:text-violet-200">
                KB önerisi: {Object.keys(closureSuggestion.suggestions).length} alan eşleşti
                {closureSuggestion.unmatched.length > 0 && `, ${closureSuggestion.unmatched.length} eşleşmedi`}
                {closureSuggestion.meta?.confidence != null && (
                  <span className="ml-1 text-violet-600">
                    (güven %{Math.round(closureSuggestion.meta.confidence * 100)})
                  </span>
                )}
              </span>
              {Object.keys(closureSuggestion.suggestions).length > 0 && (
                <Button size="sm" variant="ghost" onClick={onApplyAllClosureSuggestions}>
                  Tümünü uygula
                </Button>
              )}
            </div>
            {closureSuggestion.unmatched.length > 0 && (
              <ul className="mt-1 text-[11px] text-violet-700 dark:text-violet-300">
                {closureSuggestion.unmatched.map((u, i) => (
                  <li key={`${u.taxonomyType}-${i}`}>
                    Eşleşmedi: <span className="font-medium">{u.taxonomyType}</span> —{' '}
                    <code className="font-mono">{u.rawValue}</code>
                  </li>
                ))}
              </ul>
            )}
            {closureSuggestion.meta?.reason && (
              <p className="mt-1 text-[11px] italic text-violet-600 dark:text-violet-400">
                {closureSuggestion.meta.reason}
              </p>
            )}
          </div>
        )}
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
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <Target size={11} className="text-rose-500" />
                Kök Neden Grubu
              </span>
            }
          >
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
            label={
              <span className="inline-flex items-center gap-1.5">
                <Target size={11} className="text-rose-500" />
                Kök Neden Detayı
              </span>
            }
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
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <Wrench size={11} className="text-emerald-500" />
                Çözüm Tipi
              </span>
            }
          >
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
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <Shield size={11} className="text-amber-500" />
                Kalıcı Önlem
              </span>
            }
          >
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
        {/* Stage 3 resolution-first — KB Teknik Devir Notu + Müşteri Yanıt
            Taslağı kartları. Override gate:
              - closureRefreshedOnce=false (ilk refresh tamamlanmadı) → override
                undefined → eski persisted aiDrafts (Stage 2 opening'den) render.
              - closureRefreshedOnce=true → override = current KB cevabının
                drafts'ı (varsa). Boş object override → render YOK; stale Stage 2
                drafts current KB output gibi sunulmaz.
              - Re-fetch sırasında suggestion null'a düşse de bayrak true kalır;
                kullanıcı bir an stale persisted görmez. */}
        <KbDraftCard
          item={createdCase}
          variant="closure"
          override={
            closureRefreshedOnce
              ? closureSuggestion?.drafts ?? {}
              : undefined
          }
        />
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
// Stage 3 — L2 (veya başka ekip/kişi) devir formu (PR-T2)
//
// Tenant-safe target selection:
//   - Team.defaultSupportLevel === 'L2' bazlı L2 önerisi (hard-code yok)
//   - 1 L2 ekip → preselect ama lock yok
//   - >1 L2 ekip → seçim zorunlu, "Önerilen L2 ekipleri" grubu
//   - 0 L2 ekip → calm warning + tüm aktif takımlar gösterilir
//   - Hedef kişi opsiyonel; takım bazlı filter
//
// Davranış:
//   - Devir notu zorunlu (ana state'te enforce)
//   - Denenen adımlar özeti server-side compose ile prefill, editable
//   - Submit PR-T1 backend'ini çağırır: caseService.transferCase +
//     smartTicketTransfer payload
//   - Vaka YENİDEN oluşturulmaz, SLA/supportLevel değişmez, auto-close yok
// ─────────────────────────────────────────────────────────────────

interface TransferTeamOption {
  id: string;
  name: string;
  defaultSupportLevel?: 'L1' | 'L2' | 'L3' | 'Expert';
}

interface TransferPersonOption {
  id: string;
  name: string;
  teamId: string;
}

function Stage3Transfer({
  createdCase,
  teamOptions,
  personOptions,
  transferToTeamId,
  transferToPersonId,
  transferNote,
  transferComposedSummary,
  transferStepOutcomes,
  transferBriefLoading,
  transferBriefError,
  transferring,
  transferError,
  transferPriority,
  onChangeTeam,
  onChangePerson,
  onChangeNote,
  onChangeSummary,
  onChangePriority,
  onRefreshBrief,
  onSubmit,
  onBack,
  onGoToCaseDetail,
}: {
  createdCase: Case;
  teamOptions: { all: TransferTeamOption[]; l2: TransferTeamOption[]; nonL2: TransferTeamOption[]; hasL2: boolean };
  personOptions: TransferPersonOption[];
  transferToTeamId: string;
  transferToPersonId: string;
  transferNote: string;
  transferComposedSummary: string;
  transferStepOutcomes: SmartTicketStepOutcomesSummary | null;
  transferBriefLoading: boolean;
  transferBriefError: string | null;
  transferring: boolean;
  transferError: string | null;
  transferPriority: CasePriority;
  onChangeTeam: (id: string) => void;
  onChangePerson: (id: string) => void;
  onChangeNote: (v: string) => void;
  onChangeSummary: (v: string) => void;
  onChangePriority: (p: CasePriority) => void;
  onRefreshBrief: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onGoToCaseDetail: () => void;
}) {
  // Codex P2 — brief hala yüklenirken submit edilirse attemptedStepIds boş
  // ve composedSummary fallback metin olarak gönderilir → L1 context kaybı.
  // Loading bitene kadar submit'i kilitle; success path'te composer ve
  // metadata dolu olarak gönderilir.
  const canSubmit =
    transferToTeamId !== '' &&
    transferNote.trim().length > 0 &&
    !transferring &&
    !transferBriefLoading;
  const noTeamsAtAll = teamOptions.all.length === 0;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle text="3. L2'ye Devir" />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Wand2 size={11} />}
              disabled={transferBriefLoading}
              onClick={onRefreshBrief}
              title="Denenen adımlar özetini yeniden üret"
            >
              {transferBriefLoading ? 'Yenileniyor…' : 'Özeti Yenile'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<CornerUpLeft size={11} />}
              onClick={onBack}
              disabled={transferring}
            >
              Çözüm Adımlarına Geri Dön
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          L1'de çözemediğin vakayı başka bir ekibe veya kişiye aktar. Vaka <strong>kapatılmaz</strong>,
          SLA değişmez, yeni vaka oluşturulmaz. L2 vakayı aynı numarayla devralır.
        </p>

        {/* Empty-state: bu şirketin başka aktif takımı yok */}
        {noTeamsAtAll && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            ⚠ Bu vakanın şirketinde ({createdCase.companyName ?? '—'}) aktarılabilecek başka aktif
            takım bulunmuyor. Yönetim → Takımlar altından yeni takım oluştur veya pasif bir takımı
            aktif et.
          </div>
        )}

        {/* L2 yok uyarı — calm, blocking değil */}
        {!noTeamsAtAll && !teamOptions.hasL2 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            <strong>L2 olarak işaretli takım bulunamadı.</strong>{' '}
            Başka aktif bir takım veya kişi seçerek devredebilirsin. Yönetim → Takımlar altından
            takımın "Varsayılan Destek Seviyesi" alanını <strong>L2</strong> yapabilirsin.
          </div>
        )}

        {/* Hedef takım + kişi */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <Users2 size={11} className="text-brand-500" />
                Hedef Takım
              </span>
            }
            required
            hint={
              teamOptions.l2.length === 1
                ? 'Tek L2 takım otomatik seçildi; değiştirebilirsin.'
                : teamOptions.l2.length > 1
                  ? 'Birden fazla L2 takım var — seçim yap.'
                  : undefined
            }
          >
            <Select
              value={transferToTeamId}
              onChange={(e) => onChangeTeam(e.target.value)}
              disabled={noTeamsAtAll || transferring}
            >
              <option value="">
                {noTeamsAtAll ? '— Aktif takım yok —' : 'Takım seç…'}
              </option>
              {teamOptions.l2.length > 0 && (
                <optgroup label="Önerilen L2 ekipleri">
                  {teamOptions.l2.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {teamOptions.nonL2.length > 0 && (
                <optgroup label={teamOptions.l2.length > 0 ? 'Diğer aktif takımlar' : 'Aktif takımlar'}>
                  {teamOptions.nonL2.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.defaultSupportLevel ? ` · ${t.defaultSupportLevel}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <Users2 size={11} className="text-slate-500" />
                Hedef Kişi
              </span>
            }
            hint={
              !transferToTeamId
                ? 'Önce takım seç.'
                : personOptions.length === 0
                  ? 'Bu takımın aktif kişi kaydı yok.'
                  : 'Boş bırakılırsa takıma genel atanır.'
            }
          >
            <Select
              value={transferToPersonId}
              onChange={(e) => onChangePerson(e.target.value)}
              disabled={!transferToTeamId || personOptions.length === 0 || transferring}
            >
              <option value="">
                {transferToTeamId ? '— takıma genel ata —' : 'Önce takım seç'}
              </option>
              {personOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Madde 4 — Devir sırasında opsiyonel priority değişimi.
            Default: mevcut Case.priority. Değişmezse network'e gönderilmez
            (no-op). SLA değiştirilmez. */}
        <Field
          label="Öncelik"
          hint={
            transferPriority !== createdCase.priority
              ? `Mevcut: ${CASE_PRIORITY_LABELS[createdCase.priority]} → Yeni: ${CASE_PRIORITY_LABELS[transferPriority]}`
              : 'Devir sırasında önceliği değiştirebilirsin. Klasik vakaların SLA\'sı değişmez.'
          }
        >
          <Select
            value={transferPriority}
            onChange={(e) => onChangePriority(e.target.value as CasePriority)}
            disabled={transferring}
          >
            {CASE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {CASE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>

        {/* Madde 2 — KB Teknik Devir Notu kartı (varsa). Müşteri yanıt
            taslağı transfer akışında gizli (L1 → L2 devri için anlamsız). */}
        <KbDraftCard item={createdCase} variant="transfer" />

        {/* Devir notu — zorunlu */}
        <Field
          label="Devir Notu"
          required
          hint="L2 vakayı açtığında neyi göreceği. Mevcut adımları ekrana bakmadan anlasın."
        >
          <TextArea
            rows={3}
            value={transferNote}
            onChange={(e) => onChangeNote(e.target.value)}
            placeholder="Örn: KB önerilerini denedim, çözüm yok. API token rotation tarafına bakar mısın?"
            disabled={transferring}
          />
        </Field>

        {/* Denenen adımlar özeti — server-side compose, editable */}
        <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-violet-500" />
              <span className="text-xs font-medium text-violet-800 dark:text-violet-200">
                Denenen Adımlar Özeti
              </span>
              {transferBriefLoading && (
                <Loader2 size={11} className="animate-spin text-violet-500" />
              )}
            </div>
            {transferStepOutcomes && transferStepOutcomes.total > 0 && (
              <span className="text-[11px] text-violet-700 dark:text-violet-300">
                Toplam {transferStepOutcomes.total} · İşe yaradı {transferStepOutcomes.worked} ·
                İşe yaramadı {transferStepOutcomes.notWorked} · Uygun değil {transferStepOutcomes.skipped} ·
                Beklemede {transferStepOutcomes.pending}
              </span>
            )}
          </div>
          {transferBriefError && (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {transferBriefError} Aşağıdaki kutuda manuel yazabilirsin.
            </p>
          )}
          <TextArea
            rows={7}
            value={transferComposedSummary}
            onChange={(e) => onChangeSummary(e.target.value)}
            placeholder={
              transferBriefLoading
                ? 'Özet üretiliyor…'
                : 'L1 çözüm adımları için özet — düzenleyebilirsin.'
            }
            disabled={transferring}
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-ndark-muted">
            Özet düzenlenebilir; gönderdiğin metin L2'nin "Vaka Detayı → Çözüm Adımları" sekmesinde
            "L1 Devir Özeti" olarak görünür.
          </p>
        </div>

        {transferError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            {transferError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ExternalLink size={12} />}
            onClick={onGoToCaseDetail}
            disabled={transferring}
          >
            Vaka Detayına Git
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onBack} disabled={transferring}>
              Vazgeç
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!canSubmit}
              title={
                transferBriefLoading
                  ? 'Denenen adımlar özeti yükleniyor; tamamlanmasını bekle.'
                  : transferToTeamId === ''
                    ? 'Hedef takım seçin.'
                    : transferNote.trim().length === 0
                      ? 'Devir notu zorunlu.'
                      : undefined
              }
              leftIcon={
                transferring ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ArrowRight size={12} />
                )
              }
            >
              {transferring ? 'Aktarılıyor…' : 'Devret ve L2\'ye Gönder'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Madde 1 — Müşteri seçildiğinde açık vakalar paneli.
//
// Amaç: Mükerrer ticket önleme. L1 ajan müşteri seçince O müşterinin
// açık vakalarını + kim ilgileniyor + status'unu görür. Listeye
// tıklanabilirse caller mevcut Smart Ticket akışını abandone edip
// vakaya geçer (onOpenExistingCase callback verilmişse).
//
// Render politikası:
//   - 0 açık vaka     → yeşil "Bu müşterinin açık vakası yok" bilgi
//   - 1-5 vaka        → tümü liste
//   - >5 vaka         → ilk 5 + "Tümü Vakalar'da" linki YOK (bu
//                       PR'da skip — Cases List filter pre-fill yok;
//                       caller'a yönlendirme şart)
//   - SLA breach varsa header'da kırmızı uyarı rozeti
// ─────────────────────────────────────────────────────────────────

function AccountOpenCasesPanel({
  loading,
  error,
  cases,
  onOpenCase,
}: {
  loading: boolean;
  error: string | null;
  cases: Case[];
  onOpenCase?: (caseId: string) => void;
}) {
  const breachCount = cases.filter((c) => c.slaViolation).length;
  const display = cases.slice(0, 5);
  const remaining = Math.max(0, cases.length - display.length);

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-2.5 dark:border-amber-900/30 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {cases.length > 0 ? (
            <AlertTriangle size={12} className="text-amber-600 dark:text-amber-400" />
          ) : (
            <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="text-[11px] font-medium text-slate-700 dark:text-ndark-text">
            {loading
              ? 'Açık vakalar kontrol ediliyor…'
              : cases.length > 0
                ? `Bu müşterinin ${cases.length} açık vakası var`
                : 'Bu müşterinin açık vakası yok'}
          </span>
        </div>
        {breachCount > 0 && (
          <span className="rounded-full bg-rose-100 px-1.5 py-0 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {breachCount} SLA ihlal
          </span>
        )}
      </div>

      {error && !loading && (
        <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </p>
      )}

      {display.length > 0 && (
        <ul className="mt-2 space-y-1">
          {display.map((c) => {
            const clickable = !!onOpenCase;
            const row = (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px]">
                <span className="font-mono font-medium text-slate-700 dark:text-ndark-text">
                  {c.caseNumber}
                </span>
                <StatusPill status={c.status} />
                <span className="truncate text-slate-700 dark:text-ndark-text" title={c.title}>
                  {c.title}
                </span>
                {c.assignedPersonName && (
                  <span className="text-slate-500 dark:text-ndark-muted">
                    · {c.assignedPersonName}
                  </span>
                )}
                <span className="text-slate-400 dark:text-ndark-dim">
                  · {formatRelative(c.createdAt)}
                </span>
              </div>
            );
            return (
              <li key={c.id}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onOpenCase!(c.id)}
                    className="w-full rounded-md border border-transparent bg-white/70 px-2 py-1 text-left hover:border-amber-300 hover:bg-white dark:bg-ndark-card/40 dark:hover:border-amber-700 dark:hover:bg-ndark-card"
                    title="Bu vakaya geç (Akıllı Ticket akışı iptal olur)"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="rounded-md bg-white/70 px-2 py-1 dark:bg-ndark-card/40">
                    {row}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {remaining > 0 && (
        <p className="mt-1 text-[10px] text-slate-500 dark:text-ndark-muted">
          + {remaining} daha · tümünü görmek için Vakalar listesini aç
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage2DescriptionEditor — KB cevabı yetersiz çıktığında açıklamayı
// genişletip yeniden sorma akışı.
//
// Akış:
//   1. Stage 2'ye girince collapsed render (açıklamanın özeti + Düzenle link).
//   2. "Düzenle ve yeniden sor" → textarea expanded, mevcut açıklama prefilled.
//   3. Submit "Kaydet ve Yeniden Sor":
//      a) caseService.update(id, { description: newDesc }) — FieldUpdate
//         activity backend tarafından yazılır.
//      b) caseService.importAiSuggestedSolutionSteps(id, { freeText }) —
//         yeni KB analyze, dedup ile yeni adımlar listeye eklenir.
//      c) onUpdated callback caller'a yeni Case object'i geçirir;
//         caller refreshKey artırır → CaseSolutionStepsPanel remount eder.
//   4. Aynı açıklama submit edilirse boşa istek önlenir (info toast).
//
// Out of scope: backend taraftaki update + import path'i değişmez;
// yalnız UI ek bir yol eklendi.
// ─────────────────────────────────────────────────────────────────

function Stage2DescriptionEditor({
  createdCase,
  onUpdated,
}: {
  createdCase: Case;
  onUpdated: (updated: Case) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(createdCase.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // createdCase değişince (örn. parent setCreatedCase) draft'ı senk et —
  // ama yalnız collapsed iken; expanded iken kullanıcının edit'ini ezme.
  useEffect(() => {
    if (!expanded) setDraft(createdCase.description ?? '');
  }, [createdCase.description, expanded]);

  function handleOpen() {
    setDraft(createdCase.description ?? '');
    setError(null);
    setExpanded(true);
  }

  function handleCancel() {
    setExpanded(false);
    setError(null);
    setDraft(createdCase.description ?? '');
  }

  async function handleSubmit() {
    if (submitting) return;
    const trimmed = draft.trim();
    if (trimmed.length < 5) {
      setError('En az 5 karakter girin.');
      return;
    }
    if (trimmed === (createdCase.description ?? '').trim()) {
      toast({
        type: 'info',
        message: 'Açıklama değişmedi; yeniden sormaya gerek yok.',
        duration: 2200,
      });
      setExpanded(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await caseService.update(createdCase.id, { description: trimmed });
      if (!updated) {
        setError('Açıklama güncellenemedi.');
        return;
      }
      let importedCount = 0;
      try {
        const r = await caseService.importAiSuggestedSolutionSteps(updated.id, {
          freeText: trimmed,
        });
        importedCount = r?.summary?.importedCount ?? 0;
      } catch (importErr) {
        // Açıklama güncellendi ama KB başarısız — kullanıcıya bildir,
        // adımları manuel veya panel buton'u ile sonradan deneyebilir.
        toast({
          type: 'warn',
          message: `Açıklama güncellendi ama AI önerileri alınamadı: ${(importErr as Error)?.message ?? ''}`,
          duration: 4500,
        });
        onUpdated(updated);
        setExpanded(false);
        return;
      }
      // Codex P2 (main #459) — import-ai-suggested aiDrafts persist
      // ediyor. Update'in döndürdüğü `updated` snapshot'unda aiDrafts
      // henüz yok. Fresh fetch ile customFields.smartTicket.aiDrafts
      // KbDraftCard'a yansır (Stage 3 closure / transfer).
      const refreshed = await caseService.get(updated.id);
      onUpdated(refreshed ?? updated);
      setExpanded(false);
      if (importedCount > 0) {
        toast({
          type: 'success',
          message: `Açıklama güncellendi · ${importedCount} yeni AI önerisi eklendi.`,
          duration: 3000,
        });
      } else {
        toast({
          type: 'info',
          message: 'Açıklama güncellendi ama KB ek öneri vermedi. Açıklamayı daha da genişletmeyi dene.',
          duration: 4000,
        });
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'İşlem başarısız.');
    } finally {
      setSubmitting(false);
    }
  }

  const preview =
    (createdCase.description ?? '').slice(0, 110) +
    ((createdCase.description?.length ?? 0) > 110 ? '…' : '');
  const charCount = draft.trim().length;
  const charTooShort = charCount > 0 && charCount < 5;
  const noChange =
    expanded && draft.trim() === (createdCase.description ?? '').trim();

  return (
    <Card>
      <CardBody className="space-y-2">
        {!expanded ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-ndark-muted">
                <PenLine size={11} className="text-brand-500" />
                Açıklama
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-700 dark:text-ndark-text" title={createdCase.description ?? ''}>
                {preview || '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                AI önerisi yetersiz mi? Açıklamayı genişlet, KB'ye yeniden sor.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Wand2 size={11} />}
              onClick={handleOpen}
            >
              Düzenle ve yeniden sor
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-ndark-muted">
              <PenLine size={11} className="text-brand-500" />
              Açıklamayı düzenle
            </div>
            <TextArea
              autoFocus
              rows={4}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Sorunu daha detaylı anlat — KB daha iyi öneri verebilsin."
              disabled={submitting}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
                {charCount} karakter
                {charTooShort && ' · en az 5'}
                {noChange && ' · değişiklik yok'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={submitting}
                >
                  Vazgeç
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSubmit()}
                  disabled={submitting || charCount < 5}
                  leftIcon={
                    submitting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Wand2 size={11} />
                    )
                  }
                  title={
                    charCount < 5
                      ? 'En az 5 karakter girin'
                      : noChange
                        ? 'Açıklamayı değiştir veya Vazgeç'
                        : 'Açıklamayı güncelle ve KB önerisini yenile'
                  }
                >
                  {submitting ? 'Yeniden Soruluyor…' : 'Kaydet ve Yeniden Sor'}
                </Button>
              </div>
            </div>
            {error && (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                {error}
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stage1FileAttach — PR-5 (Business review Madde 2)
//
// Stage 1 sol kolonda dosya seçme + queue render. QuickCaseModal
// "Kanıt / Dosyalar" pattern'i ile simetrik ama compact (Smart Ticket
// akışı 1 ekran amaçlı). Status renkleri:
//   - queued / done   → slate (default)
//   - uploading       → brand (progress bar)
//   - error           → rose (uyarı)
//
// Görsel preview bu PR'da YOK (scope sınırı); sadece filename + size.
// Preview ileride opsiyonel olarak eklenebilir.
// ─────────────────────────────────────────────────────────────────

function Stage1FileAttach({
  pendingFiles,
  onPick,
  onRemove,
  disabled,
}: {
  pendingFiles: PendingFile[];
  onPick: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const remaining = CASE_FILE_MAX_COUNT - pendingFiles.length;
  const limitReached = remaining <= 0;
  const maxMb = Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024));

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-ndark-border dark:bg-ndark-bg/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-ndark-muted">
          <Paperclip size={11} className="text-brand-500" />
          Dosyalar (opsiyonel)
          <span className="text-slate-400">
            · {pendingFiles.length}/{CASE_FILE_MAX_COUNT}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Paperclip size={11} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || limitReached}
          title={limitReached ? `Limit dolu (${CASE_FILE_MAX_COUNT} dosya)` : `Maks ${maxMb} MB / dosya`}
        >
          Dosya Ekle
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onPick(e.target.files);
          // Aynı dosyayı tekrar seçebilmek için input'u reset et.
          e.target.value = '';
        }}
      />
      {pendingFiles.length === 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
          Ekran görüntüsü, log, XML — vaka açıldıktan sonra otomatik yüklenir. Maks {maxMb} MB / dosya, en fazla {CASE_FILE_MAX_COUNT} dosya.
        </p>
      ) : (
        <ul className="space-y-1">
          {pendingFiles.map((pf) => {
            const isError = pf.status === 'error';
            const isUploading = pf.status === 'uploading';
            const isDone = pf.status === 'done';
            return (
              <li
                key={pf.id}
                className={
                  'flex items-center gap-2 rounded-md border px-2 py-1 ' +
                  (isError
                    ? 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30'
                    : isDone
                      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30'
                      : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card')
                }
              >
                <Paperclip size={11} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-slate-800 dark:text-ndark-text" title={pf.file.name}>
                    {pf.file.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-ndark-muted">
                    <span>{formatSize(pf.file.size)}</span>
                    {isUploading && (
                      <>
                        <span>·</span>
                        <span>%{pf.percent}</span>
                      </>
                    )}
                    {isDone && (
                      <>
                        <span>·</span>
                        <Check size={9} className="text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-300">Yüklendi</span>
                      </>
                    )}
                    {isError && (
                      <>
                        <span>·</span>
                        <span className="text-rose-700 dark:text-rose-300">
                          {pf.errorMessage ?? 'Hata'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {!isUploading && !isDone && (
                  <button
                    type="button"
                    onClick={() => onRemove(pf.id)}
                    disabled={disabled}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-ndark-bg/60"
                    title="Sırada bekleyenden çıkar"
                    aria-label="Dosyayı kaldır"
                  >
                    <XIcon size={11} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
