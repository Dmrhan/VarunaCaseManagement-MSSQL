import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useAuth } from '@/services/AuthContext';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { AccountSearchPicker, type PickedProject } from '@/features/accounts/AccountSearchPicker';
import {
  caseService,
  lookupService,
  parseAllowedResolutionCodes,
  type CaseSolutionStep,
  type SmartTicketTaxonomyItem,
  type SmartTicketRootCauseGroup,
  type SmartTicketTaxonomyResponse,
  type SmartTicketStepOutcomesSummary,
  type SuggestClassificationResponse,
  type SuggestClassificationField,
} from '@/services/caseService';
import {
  buildClosureSuggestionTelemetry,
  type AppliedClosureSelection,
} from '@/services/closureTelemetry';
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
import { CustomerContextBanner } from './CustomerContextBanner';
import { CustomerContextDrawer } from './CustomerContextDrawer';
import { computeBannerRiskState } from './customerHistory';
import { KbDraftCard } from '@/features/cases/KbDraftCard';
import { FilesTab } from '@/features/cases/components/CaseFiles';
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
  //
  // 2026-07-02 — Öncelik + Talep Türü ZORUNLU. Her ikisi boş ('') başlar;
  // kullanıcı seçmezse "İleri" disabled. form.priority '' kabul edilir
  // (form-level; submit'te canCreate garanti eder).
  priority: CasePriority | '';
  priorityManual: boolean;
  requestType: CaseRequestType | '';
  // 2026-07-02 — Ürün Grubu (opsiyonel) → Ürün (opsiyonel, gruba cascade)
  // NewCaseForm catalog pattern'i reuse (companyId scope + isActive filter).
  // Grup-only kayıt: Case.productGroup (legacy string) grup adı yazılır;
  // Ürün seçilirse Case.productId set edilir.
  productGroupId: string;
  productId: string;
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
  // 2026-07-02 — Öncelik + Talep Türü ZORUNLU: '' başlar (kullanıcı seçmeli).
  priority: '',
  priorityManual: false,
  requestType: '',
  productGroupId: '',
  productId: '',
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
  initialAccountId,
  initialAccountName,
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
  /** Gelen çağrı screen pop'u: müşteri ön-seçili açılır (callerId eşleşmesi). */
  initialAccountId?: string | null;
  initialAccountName?: string | null;
}) {
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const { user } = useAuth();
  const [form, setForm] = useState<SmartTicketFormState>(() => emptyForm(defaultCompanyId));
  const [stage, setStage] = useState<Stage>('opening');
  const [createdCase, setCreatedCase] = useState<Case | null>(null);

  // Gelen çağrı screen pop'u: müşteri ön-seçili gelirse form'a uygula (boşsa).
  useEffect(() => {
    if (initialAccountId) {
      setForm((f) => (f.accountId ? f : { ...f, accountId: initialAccountId, accountName: initialAccountName ?? '' }));
    }
  }, [initialAccountId, initialAccountName]);

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

  // Madde 1 — Müşteri seçildiğinde o müşterinin açık vakalarını fetch et.
  // Sol panelde artık compact CustomerContextBanner (banner+drawer pattern);
  // açıklama textarea aşağı itilmesin diye AccountOpenCasesPanel kaldırıldı.
  // Open cases verisi banner state'ini hesaplar + drawer'a props ile geçer.
  const [accountOpenCases, setAccountOpenCases] = useState<Case[]>([]);
  const [accountOpenCasesLoading, setAccountOpenCasesLoading] = useState(false);
  const [accountOpenCasesError, setAccountOpenCasesError] = useState<string | null>(null);
  const accountOpenCasesReqIdRef = useRef(0);
  const accountOpenCasesAccountIdRef = useRef<string>('');

  // Customer Context — Faz 1 (closed history first).
  // Banner mount sırasında resolvedCount için count-only endpoint kullanılır
  // (Codex review P2-2): findByAccount tam CASE_INCLUDE çekiyor; rozet için
  // gereksiz maliyet. Drawer açılınca tam fetch'ini yapar.
  const [resolvedCount, setResolvedCount] = useState<number>(0);
  const [resolvedCountError, setResolvedCountError] = useState<boolean>(false);
  const [customerCtxDrawerOpen, setCustomerCtxDrawerOpen] = useState(false);
  const resolvedCountReqIdRef = useRef(0);

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
  // Stage 3 "Kapanış Dosyaları" — FilesTab'ın aktif upload state'i. "Vakayı
  // Kapat" yalnız aktif upload sırasında bloklanır; opsiyonel dosya eklemek
  // close akışını başka şekilde engellemez (spec: closing should not be
  // blocked unless file upload is actively in progress).
  const [closureFilesUploading, setClosureFilesUploading] = useState(false);

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

  // Customer Context — resolvedCount banner fetch (count-only).
  // Drawer ResolvedTab kendi tam fetch'ini açılınca yapar; bu sadece banner
  // rozet sayısı için lightweight count endpoint. Codex P2-2: findByAccount
  // tam CASE_INCLUDE çekiyor; count yeterli.
  useEffect(() => {
    if (!form.accountId) {
      setResolvedCount(0);
      setResolvedCountError(false);
      return;
    }
    const reqId = ++resolvedCountReqIdRef.current;
    const targetAccountId = form.accountId;
    setResolvedCountError(false);
    void caseService
      .countByAccount(targetAccountId, { statusIn: ['Çözüldü'] })
      .then((n) => {
        if (reqId !== resolvedCountReqIdRef.current) return;
        setResolvedCount(typeof n === 'number' ? n : 0);
      })
      .catch(() => {
        if (reqId !== resolvedCountReqIdRef.current) return;
        setResolvedCount(0);
        setResolvedCountError(true);
      });
  }, [form.accountId]);

  // 2026-07-02 — Ürün Grubu + Ürün catalog (Agent-safe /api/lookups/catalog).
  // NewCaseForm reuse; SmartTicket'ta paket kapsam dışı, sadece ProductGroup +
  // Product tutuyoruz. companyId değişince fetch, boşsa reset.
  const [catalogProducts, setCatalogProducts] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      productGroupId: string;
    }>
  >([]);
  const [catalogProductGroups, setCatalogProductGroups] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);

  useEffect(() => {
    if (stage !== 'opening' || !form.companyId) {
      setCatalogProducts([]);
      setCatalogProductGroups([]);
      return;
    }
    let alive = true;
    void lookupService
      .caseCatalog({ companyId: form.companyId, accountId: form.accountId || null })
      .then((data) => {
        if (!alive) return;
        setCatalogProductGroups(data.productGroups);
        setCatalogProducts(
          data.products.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            productGroupId: p.productGroupId,
          })),
        );
      })
      .catch(() => {
        // Sessiz — apiFetch zaten toast gösterir. Alanlar boş kalır.
      });
    return () => {
      alive = false;
    };
  }, [stage, form.companyId, form.accountId]);

  // Şirket değişince müşteri/proje + Smart Ticket taxonomy + Ürün seçimlerini sıfırla.
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
      // Ürün Grubu / Ürün — stale seçim kalmasın (KENAR/SIRALAMA spec).
      productGroupId: '',
      productId: '',
    }));
    setSuggestion(null);
    setSuggestionError(null);
    setAppliedSuggestionFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId]);

  // Grup değişince ürünü sıfırla (uyumsuz kalırsa).
  useEffect(() => {
    if (!form.productId) return;
    const product = catalogProducts.find((p) => p.id === form.productId);
    if (!product || product.productGroupId !== form.productGroupId) {
      setForm((f) => ({ ...f, productId: '' }));
    }
  }, [form.productGroupId, form.productId, catalogProducts]);

  function handleSelectAccount(item: AccountListItem | null) {
    setAccountPickerOpen(false);
    if (!item) return;
    setForm((f) => ({
      ...f,
      accountId: item.id,
      accountName: item.name ?? '',
      accountProjectId: '',
      accountProjectName: '',
    }));
  }

  function handleSelectAccountWithProject(item: AccountListItem, project: PickedProject | null) {
    setAccountPickerOpen(false);
    setForm((f) => ({
      ...f,
      accountId: item.id,
      accountName: item.name ?? '',
      accountProjectId: project?.id ?? '',
      accountProjectName: project?.name ?? '',
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

  // Akıllı Tanımlar (açılış taksonomisi) — SEÇİLEBİLİR (item'ı olan) alanların HEPSİ
  // ZORUNLU (kullanıcı isteği: hepsi zorunlu). Admin'in item tanımlamadığı alan zorunlu
  // sayılmaz — aksi halde o alan seçilemeyeceği için hiç vaka açılamazdı.
  // Taxonomiler YÜKLENİRKEN sağlanmış sayılmaz (item'lar bilinmeden buton aktifleşmesin).
  const taxonomyRequirementSatisfied =
    !taxonomiesLoading &&
    TAXONOMY_FIELDS.every((f) => (taxonomies?.[f.key]?.length ?? 0) === 0 || !!form[f.key]);
  const canCreate =
    stage === 'opening' &&
    !!form.companyId &&
    !!form.accountId &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    projectRequirementSatisfied &&
    // 2026-07-02 — Öncelik + Talep Türü ZORUNLU. Kullanıcı seçmezse advance yok.
    !!form.priority &&
    !!form.requestType &&
    // Review fix — Ürün Grubu ZORUNLU (kayıtlarda bu bilginin kesin
    // olması için; kapanış kapısıyla aynı gerekçe, ama burada açılışta
    // uygulanıyor). Şirkette tanımlı hiç ürün grubu yoksa (dropdown boş)
    // zorunluluk uygulanmaz — aksi halde o şirkette vaka HİÇ açılamazdı.
    (catalogProductGroups.length === 0 || !!form.productGroupId) &&
    // Akıllı Tanımlar — item'ı olan alanların hepsi seçili olmadan buton pasif.
    taxonomyRequirementSatisfied &&
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
    // 2026-07-02 — Öncelik + Talep Türü ZORUNLU. canCreate garanti eder ki
    // ikisi de dolu; defansif fallback yalnız TS için.
    const finalRequestType = form.requestType || mapping.requestType;
    const requestTypeSource: 'manual' | 'mapping' = form.requestType ? 'manual' : 'mapping';
    const finalPriority: CasePriority = (form.priority || 'Medium') as CasePriority;
    const prioritySource: 'manual' | 'default' = form.priority ? 'manual' : 'default';
    smartTicket.requestTypeSource = requestTypeSource;
    smartTicket.prioritySource = prioritySource;

    // 2026-07-02 — Grup-only kayıt convention.
    // NewCaseForm.tsx kardeşi: Case.productGroup serbest metin (legacy SLA),
    // Case.productId ise catalog FK. Grup seçildiyse grup ADI yazılır; ürün
    // seçildiyse productId + productName snapshot da eklenir.
    let finalProductGroup: string | undefined;
    let finalProductId: string | undefined;
    let finalProductName: string | undefined;
    if (form.productGroupId) {
      const grp = catalogProductGroups.find((g) => g.id === form.productGroupId);
      finalProductGroup = grp?.name;
    }
    if (form.productId) {
      const prd = catalogProducts.find((p) => p.id === form.productId);
      if (prd) {
        finalProductId = prd.id;
        finalProductName = prd.name;
      }
    }

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
        // Smart Ticket'ı açan kullanıcı otomatik sahip olur.
        // user.personId yoksa (SystemAdmin/Backoffice) atama yapılmaz; vaka
        // "Atanmamış" kalır ve dispatcher manuel atar.
        ...(user?.personId
          ? {
              assignedPersonId: user.personId,
              assignedPersonName: user.fullName,
            }
          : {}),
        category: mapping.category,
        subCategory: mapping.subCategory,
        requestType: finalRequestType,
        // 2026-07-02 — Ürün Grubu (legacy string) + Ürün (catalog FK).
        // NewCaseForm ile aynı convention.
        ...(finalProductGroup ? { productGroup: finalProductGroup } : {}),
        ...(finalProductId
          ? { productId: finalProductId, productName: finalProductName }
          : {}),
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
    // CASCADE v4: rcgList düz, rcdList seçili grubun altındakileri,
    // rtList seçili detayın allowedResolutionTypes kümesiyle filtrelenir.
    const rcgList: SmartTicketTaxonomyItem[] = taxonomies?.rootCauseGroup ?? [];
    const allDetails: SmartTicketTaxonomyItem[] = taxonomies?.rootCauseDetail ?? [];
    const allResolutions: SmartTicketTaxonomyItem[] = taxonomies?.resolutionType ?? [];
    const ppList: SmartTicketTaxonomyItem[] = taxonomies?.permanentPrevention ?? [];

    // Seçili grup → id bul → detayları filtrele (parentId eşleşmesi).
    const selectedGroup = rcgList.find((g) => g.code === closure.rootCauseGroup);
    const rcdList: SmartTicketTaxonomyItem[] = selectedGroup?.id
      ? allDetails.filter((d) => d.parentId === selectedGroup.id)
      : closure.rootCauseGroup
        ? [] // Grup seçili ama id yoksa eski format — boş göster
        : []; // Grup seçilmemişse boş (UX: önce grup seç)

    // Seçili detay → allowedResolutionTypes → rtList filtrele.
    const selectedDetail = rcdList.find((d) => d.code === closure.rootCauseDetail);
    let rtList: SmartTicketTaxonomyItem[];
    if (selectedDetail) {
      const allowed = parseAllowedResolutionCodes(selectedDetail);
      rtList = allowed != null
        ? allResolutions.filter((r) => allowed.includes(r.code))
        : allResolutions; // null → kısıtlama yok (geri uyum)
    } else {
      rtList = []; // Detay seçilmemişse boş (UX: önce detay seç)
    }

    return { rcgList, rcdList, rtList, ppList };
  }, [taxonomies, closure.rootCauseGroup, closure.rootCauseDetail]);

  // CASCADE RESET — grup değişince detayı ve çözüm tipini temizle;
  // detay değişince çözüm tipini temizle. onChange handler'larında yapılır
  // (aşağıda Stage3Closure prop'ları), bu yüzden burada ayrı effect YOK.

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
      // YALNIZ çözüm açıklamasını prefill et (operatörün worked step'lerinden).
      // ETİKETLEME/ÖNERİ BURADA YAPILMAZ — kullanıcı önce çözümü yazar/düzenler,
      // sonra "Bilgi Bankası Önerisi Al" butonuna basınca etiketleme çalışır.
      // (Aksi halde AI, kullanıcı çözümü onaylamadan compose edilen metne göre
      // kategori uyduruyordu.)
      setClosure((c) => {
        if (resolutionNoteDirtyRef.current || c.resolutionNote.trim().length > 0) return c;
        return prefillText ? { ...c, resolutionNote: prefillText } : c;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, createdCase?.id]);

  // Çözüm Açıklaması yazmak ARTIK OTOMATİK ETİKETLEME TETİKLEMEZ.
  // (Eski debounce'lu oto-öneri kaldırıldı — kullanıcı çözümü yazmadan AI
  // kategori uyduruyordu.) Etiketleme yalnız "Bilgi Bankası Önerisi Al"
  // butonuyla, kullanıcının yazdığı çözüm metnine göre çalışır.
  // Tek istisna: kullanıcı çözümü tamamen silerse stale öneriyi temizle.
  useEffect(() => {
    if (stage !== 'closure' || !createdCase) return;
    if (!resolutionNoteDirtyRef.current) return;
    if (closure.resolutionNote.trim().length === 0) {
      setClosureSuggestion(null);
      setClosureSuggestionError(null);
    }
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
  const closureSuggestQueuedOptsRef = useRef<{ workedStepId?: string; resolutionOverride?: string; clarifyingAnswers?: string }>({});
  // Telemetry — kapanış önerisinin client'a ulaştığı an (ISO). Submit'te
  // closureSuggestion.aiSuggested.suggestedAt'e yazılır.
  const closureSuggestedAtRef = useRef<string | null>(null);

  // Stage 3 resolution-first: imzaya `resolutionOverride` eklendi. Verildiyse
  // backend compose-from-steps yerine bu değeri KB'ye gönderir; kategorizasyon
  // current "Çözüm Açıklaması" metnine göre üretilir. Önceki workedStepId-only
  // çağrı şekli geri uyumlu — eski caller'lar etkilenmez.
  async function handleSuggestClosure(opts?: { workedStepId?: string; resolutionOverride?: string; clarifyingAnswers?: string }) {
    if (!createdCase) return;
    const workedStepId = opts?.workedStepId;
    const resolutionOverride = opts?.resolutionOverride;
    const clarifyingAnswers = opts?.clarifyingAnswers;
    if (closureSuggesting) {
      // Pending request var → yeni isteği kuyruğa al; finally tetikler.
      closureSuggestRefreshQueuedRef.current = true;
      closureSuggestQueuedOptsRef.current = { workedStepId, resolutionOverride, clarifyingAnswers };
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
        ...(clarifyingAnswers && clarifyingAnswers.trim().length > 0
          ? { clarifyingAnswers: clarifyingAnswers.trim() }
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
      closureSuggestedAtRef.current = new Date().toISOString();
      // P1.2 — AI emin değilse (needsClarification) dropdown'ları pre-fill ETME;
      // operatör soruları cevaplayınca gelen zenginleşmiş öneri pre-fill eder.
      if (!res.needsClarification) {
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
      }
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

  // Takım filtreleme — hard-code teamId/name yok; yalnız metadata.
  const transferTeamOptions = useMemo(() => {
    if (!createdCase) return { all: [] };
    const all = lookupService
      .teams()
      .filter((t) => t.companyId === createdCase.companyId);
    return { all };
  }, [createdCase]);

  // Seçili takıma ait persons. Aynı takım seçilince mevcut atanan kişi listeden çıkar.
  const transferPersonOptions = useMemo(() => {
    if (!transferToTeamId) return [];
    const persons = lookupService.personsByTeam(transferToTeamId);
    const isSameTeam = transferToTeamId === createdCase?.assignedTeamId;
    return isSameTeam
      ? persons.filter((p) => p.id !== createdCase?.assignedPersonId)
      : persons;
  }, [transferToTeamId, createdCase?.assignedTeamId, createdCase?.assignedPersonId]);

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
      // Review fix — takımdan bağımsız HER ZAMAN transferCase() çağrılır.
      // Eskiden aynı takım içi devirde caseService.update() kullanılıyordu
      // ("backend same_team guard var" varsayımıyla) — ama transferCase()
      // aynı takıma devri de sorunsuz kabul ediyor (böyle bir guard yok,
      // bkz. caseRepository.transferCase()). update() yolu CaseTransfer
      // kaydı hiç oluşturmadığı için devir notu "Devir Notu" bölümünde
      // hiç görünmüyordu.
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
        message: `Vaka aktarıldı (${updated.caseNumber}).`,
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
    // Kapanış analizi zorunluluğu — backend smart_ticket_closure_required
    // guard'ının aynası: KB analizi en az bir kez yapılmadan (closureSuggestion
    // alınmadan) veya en az bir etiket elle seçilmeden Çözüldü gönderilmez.
    // 4 alanın dolu olması şart değil — AI'ın boş bıraktığı alanlar boş
    // kalabilir (gelişim verisi).
    const hasAnyClosureField = !!(
      closure.rootCauseGroup ||
      closure.rootCauseDetail ||
      closure.resolutionType ||
      closure.permanentPrevention
    );
    // KB analizine basmak YETMEZ — en az bir kapanış etiketi SEÇİLMİŞ olmalı.
    if (!hasAnyClosureField) {
      setClosureError(
        'Vaka çözülmeden önce en az bir kapanış etiketi seçilmeli (kök neden grubu / detay / çözüm tipi / kalıcı önleme).',
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
      // Geriye uyumlu KÖK alanlar (source/appliedFields/perField/unmatched/
      // confidence/reason/modelUsed) + ai_suggested / human_applied attribution.
      // Tek kaynak: buildClosureSuggestionTelemetry (StatusTransitionPanel ile aynı).
      const applied: AppliedClosureSelection = {
        rootCauseGroup: {
          code: closure.rootCauseGroup || undefined,
          label: closurePayload.rootCauseGroupLabel as string | undefined,
        },
        rootCauseDetail: {
          code: closure.rootCauseDetail || undefined,
          label: closurePayload.rootCauseDetailLabel as string | undefined,
        },
        resolutionType: {
          code: closure.resolutionType || undefined,
          label: closurePayload.resolutionTypeLabel as string | undefined,
        },
        permanentPrevention: {
          code: closure.permanentPrevention || undefined,
          label: closurePayload.permanentPreventionLabel as string | undefined,
        },
      };
      closurePayload.closureSuggestion = buildClosureSuggestionTelemetry({
        suggestion: closureSuggestion,
        suggestedAt: closureSuggestedAtRef.current,
        applied,
      });
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

              {/* Customer Context Banner — Faz 1.
                  AccountOpenCasesPanel'in sol paneldeki yerini aldı. Detay
                  (açık vakalar listesi + geçmiş çözümler + sinyaller) drawer'da
                  reuse edilir. Açıklama textarea aşağı itilmesin diye 50-60px
                  tutar. Yalnız form.accountId set olunca render. */}
              {form.accountId && (
                <CustomerContextBanner
                  openCount={accountOpenCases.length}
                  resolvedCount={resolvedCount}
                  riskState={computeBannerRiskState({
                    openCount: accountOpenCases.length,
                    slaBreachCount: accountOpenCases.filter((c) => c.slaViolation).length,
                    hasDuplicate: false,
                  })}
                  hasDuplicate={false}
                  loading={accountOpenCasesLoading}
                  fetchError={!!accountOpenCasesError || resolvedCountError}
                  onOpenDrawer={() => setCustomerCtxDrawerOpen(true)}
                />
              )}
              {((projectsEnabled && !!form.accountId) || projects.length > 0) && (
                <Field
                  label="Proje"
                  required={projectsEnabled && projectsRequired && !!form.accountId && !form.accountProjectId}
                  hint={
                    form.accountProjectId
                      ? 'Müşteri arama listesinden seçildi. Değiştirmek için müşteriyi tekrar seç.'
                      : projectsEnabled && projectsRequired && !!form.accountId
                        ? 'Bu şirket için proje zorunlu. Müşteri arama listesinden seçin.'
                        : 'Opsiyonel. Kod veya ad ile arayabilirsiniz.'
                  }
                >
                  {form.accountProjectId ? (
                    // Picker'dan proje seçildi — pasif özet + temizle butonu
                    <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
                      <span className="flex-1 truncate text-sm font-medium text-violet-800 dark:text-violet-200">
                        {form.accountProjectName || form.accountProjectId}
                      </span>
                      {stage === 'opening' && (
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, accountProjectId: '', accountProjectName: '' }))}
                          className="shrink-0 rounded p-0.5 text-violet-500 hover:text-violet-700 dark:hover:text-violet-300"
                          title="Proje seçimini temizle"
                        >
                          <XIcon size={12} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
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
                  )}
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
                  2026-07-02 güncelleme: her ikisi ZORUNLU (label *, "— Seçin —"
                  placeholder, boşken canCreate false → "Vaka Aç" disabled).
                  customFields.smartTicket.requestTypeSource / prioritySource
                  audit alanları korundu. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Talep Türü"
                  required
                  hint={!form.requestType ? 'Zorunlu — vakanın niteliğini belirle.' : undefined}
                >
                  <Select
                    value={form.requestType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, requestType: e.target.value as CaseRequestType | '' }))
                    }
                    disabled={stage !== 'opening'}
                    required
                  >
                    <option value="" disabled>— Seçin —</option>
                    {CASE_REQUEST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Öncelik"
                  required
                  hint={
                    form.priority
                      ? `Seçildi: ${CASE_PRIORITY_LABELS[form.priority as CasePriority]}. Devirde değiştirilebilir.`
                      : 'Zorunlu — vakayı hangi hızda ele alacaksın?'
                  }
                >
                  <Select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: e.target.value as CasePriority | '',
                        priorityManual: true,
                      }))
                    }
                    disabled={stage !== 'opening'}
                    required
                  >
                    <option value="" disabled>— Seçin —</option>
                    {CASE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {CASE_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {/* 2026-07-02 — Ürün Grubu + Ürün (cascade). Grup seçilince ürün
                  dropdown'ı yalnız o grubun aktif ürünleri. Grup değişince
                  ürün seçimi otomatik sıfırlanır (useEffect). Boş gruplar
                  (Quest/ServiceCore) listede kalır — grup-only seçim
                  anlamlı; Case.productGroup name'e yazılır, productId ürün
                  seçilirse eklenir.
                  Review fix — Ürün Grubu artık ZORUNLU (şirkette hiç grup
                  tanımlı değilse istisna, bkz. canCreate). Ürün seçimi hâlâ
                  opsiyonel — grup tek başına yeterli. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Ürün Grubu"
                  required={catalogProductGroups.length > 0}
                  hint={
                    !form.companyId
                      ? 'Önce şirket seç.'
                      : catalogProductGroups.length === 0
                        ? 'Bu şirkette aktif ürün grubu tanımlı değil.'
                        : 'Vakanın konu ürün grubu.'
                  }
                >
                  <Select
                    value={form.productGroupId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, productGroupId: e.target.value }))
                    }
                    disabled={
                      stage !== 'opening' || !form.companyId || catalogProductGroups.length === 0
                    }
                  >
                    <option value="">— Grup seçme —</option>
                    {catalogProductGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Ürün"
                  hint={
                    !form.productGroupId
                      ? 'Önce Ürün Grubu seç.'
                      : (() => {
                          const filtered = catalogProducts.filter(
                            (p) => p.productGroupId === form.productGroupId,
                          );
                          if (filtered.length === 0)
                            return 'Bu grubun aktif ürünü yok — sadece grup kaydedilecek.';
                          return 'Opsiyonel. Boş bırakırsan yalnız grup kaydedilir.';
                        })()
                  }
                >
                  <Select
                    value={form.productId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, productId: e.target.value }))
                    }
                    disabled={
                      stage !== 'opening' ||
                      !form.productGroupId ||
                      catalogProducts.filter((p) => p.productGroupId === form.productGroupId)
                        .length === 0
                    }
                  >
                    <option value="">— Ürün seçme —</option>
                    {catalogProducts
                      .filter((p) => p.productGroupId === form.productGroupId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
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
                      {suggesting ? 'Analiz…' : 'Bilgi Bankası ile Analiz Et'}
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
                        required={items.length > 0}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <Icon size={11} className="text-brand-500" />
                            {f.label}
                          </span>
                        }
                        hint={
                          isFromSuggestion && suggested
                            ? `KB önerisi (${suggested.matchedBy}, %${Math.round(suggested.confidence * 100)})`
                            : items.length > 0 && !form[f.key]
                              ? 'Zorunlu'
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
                    title={
                      // 2026-07-02 — Erken uyarı: hangi zorunlu alan eksik?
                      // Kullanıcı disabled buton üstüne gelince neden açıklanır.
                      !canCreate
                        ? (() => {
                            if (!form.companyId) return 'Önce Şirket seç.';
                            if (!form.accountId) return 'Önce Müşteri seç.';
                            if (form.title.trim().length === 0) return 'Başlık boş olamaz.';
                            if (form.description.trim().length === 0) return 'Açıklama boş olamaz.';
                            if (!projectRequirementSatisfied) return 'Proje seçimi zorunlu.';
                            if (!form.priority || !form.requestType) return 'Öncelik ve Talep Türü zorunlu.';
                            if (catalogProductGroups.length > 0 && !form.productGroupId) return 'Ürün Grubu zorunlu.';
                            return undefined;
                          })()
                        : undefined
                    }
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
              closureFilesUploading={closureFilesUploading}
              onClosureFilesUploadingChange={setClosureFilesUploading}
              onItemUpdated={setCreatedCase}
              onSuggestClosure={() => {
                // Manuel "KB Önerisini Yenile" — debounce iptal et + current
                // "Çözüm Açıklaması" değerini override olarak gönder.
                // Codex P2 #2 fix — Empty resolution: refresh atma, mevcut
                // stale suggestion'ı clear et (backend zaten 400 dönerdi).
                if (resolutionDebounceRef.current != null) {
                  window.clearTimeout(resolutionDebounceRef.current);
                  resolutionDebounceRef.current = null;
                }
                const r = closure.resolutionNote.trim();
                if (r.length === 0) {
                  setClosureSuggestion(null);
                  setClosureSuggestionError(null);
                  return;
                }
                // Faz 0 — kapanış YALNIZ etiket önerir (pahalı analyze/draft yok).
                void handleSuggestClosure({ resolutionOverride: closure.resolutionNote });
              }}
              onApplyAllClosureSuggestions={handleApplyAllClosureSuggestions}
              onClarifyAnswer={(answer) =>
                // Operatör clarifying soruları cevapladı — zenginleşmiş etiket önerisi.
                void handleSuggestClosure({
                  resolutionOverride: closure.resolutionNote,
                  clarifyingAnswers: answer,
                })
              }
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
        projectsEnabled={projectsEnabled}
        projectsRequired={projectsRequired}
        onSelectWithProject={handleSelectAccountWithProject}
      />

      {/* Customer Context Drawer — Faz 1 (closed-history first).
          3 tab: Geçmiş Çözümler (default) · Açık Vakalar · Sinyaller.
          Açık Vakalar tab AccountOpenCasesPanel pattern'ini reuse eder. */}
      {form.accountId && (
        <CustomerContextDrawer
          open={customerCtxDrawerOpen}
          onClose={() => setCustomerCtxDrawerOpen(false)}
          accountId={form.accountId}
          accountName={form.accountName}
          companyId={form.companyId}
          onOpenCase={onOpenExistingCase}
          openCases={accountOpenCases}
          openCasesLoading={accountOpenCasesLoading}
          openCasesError={accountOpenCasesError}
        />
      )}
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
              Devret / Aktar
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
  closureFilesUploading,
  onSuggestClosure,
  onApplyAllClosureSuggestions,
  onClarifyAnswer,
  onClose,
  onBack,
  onGoToCaseDetail,
  onChangeResolutionNote,
  onClosureFilesUploadingChange,
  onItemUpdated,
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
  /** Stage 3 "Kapanış Dosyaları" — FilesTab aktif upload halinde mi? true ise
   *  "Vakayı Kapat" disable edilir; parent flag'ı tutar. */
  closureFilesUploading: boolean;
  onSuggestClosure: () => void;
  onApplyAllClosureSuggestions: () => void;
  /** P1.2 — operatör clarifying sorularını cevaplayınca (zenginleşmiş re-run tetikler). */
  onClarifyAnswer: (answer: string) => void;
  onClose: () => void;
  onBack: () => void;
  onGoToCaseDetail: () => void;
  /** Stage 3 resolution-first: textarea + voice input için tek değişiklik
   *  noktası. Parent kullanıcı edit'ini dirty flag ile işaretler + debounced
   *  KB refetch'i tetikler. setClosure'dan ayrı tutuluyor çünkü 4 dropdown'un
   *  user değişiklikleri "Çözüm Açıklaması" dirty sayılmamalı. */
  onChangeResolutionNote: (text: string) => void;
  /** Stage 3 "Kapanış Dosyaları" — FilesTab uploading state değişimi parent'a
   *  duyurulur (canSave hesaplaması + opsiyonel UI feedback). */
  onClosureFilesUploadingChange: (uploading: boolean) => void;
  /** Stage 3 "Kapanış Dosyaları" — FilesTab add/remove sonrası Case object
   *  yenilenir; parent createdCase'i tazeler ki Files Tab limit hesabı ve
   *  Case Detail görünümü güncel kalsın. */
  onItemUpdated: (c: Case) => void;
}) {
  // P1.2 — clarifying cevap metni (AI emin değilse sorulan 3 soruya).
  const [clarifyAnswer, setClarifyAnswer] = useState('');
  const checklistBlocked = requiredChecklistPending.length > 0;
  const canSave =
    closure.resolutionNote.trim().length > 0 &&
    !closing &&
    !checklistBlocked &&
    !closureFilesUploading;
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
              title="Yazdığın çözüm açıklamasına göre KB'den kapanış etiketlerini öner"
            >
              {closureSuggesting ? 'Öneriliyor…' : 'Kapanış Etiketlerini Öner'}
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
            OTOMATİK etiketleme YOK — kullanıcı çözümü yazıp "Bilgi Bankası
            Önerisi Al" butonuna basınca etiketleme çalışır. */}
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
        {closureSuggestion?.needsClarification && closureSuggestion.clarifyingQuestions && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              AI bu vakada emin değil — doğru etiketi seçebilmek için kısaca yanıtlayın:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-snug text-amber-800 dark:text-amber-300">
              {closureSuggestion.clarifyingQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
            <textarea
              className="mt-2 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-amber-400 dark:border-amber-900/40 dark:bg-slate-900 dark:text-slate-100"
              rows={3}
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              placeholder="Kök neden, çözüm ve önlem hakkında birkaç cümle…"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {closureSuggesting && <Loader2 size={12} className="animate-spin text-amber-700" />}
              <Button
                size="sm"
                disabled={closureSuggesting || clarifyAnswer.trim().length < 3}
                onClick={() => onClarifyAnswer(clarifyAnswer.trim())}
              >
                {closureSuggesting ? 'Gönderiliyor…' : 'Yanıtla ve etiketleri öner'}
              </Button>
            </div>
          </div>
        )}
        {closureSuggestion && !closureSuggestion.needsClarification && (
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
              onChange={(e) => {
                const v = e.target.value;
                // CASCADE RESET: grup değişince alt seçimleri temizle
                setClosure((c) =>
                  c.rootCauseGroup === v
                    ? c
                    : { ...c, rootCauseGroup: v, rootCauseDetail: '', resolutionType: '' },
                );
              }}
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
          >
            <Select
              value={closure.rootCauseDetail}
              onChange={(e) => {
                const v = e.target.value;
                // CASCADE RESET: detay değişince çözüm tipini temizle
                setClosure((c) =>
                  c.rootCauseDetail === v
                    ? c
                    : { ...c, rootCauseDetail: v, resolutionType: '' },
                );
              }}
              disabled={closureLists.rcdList.length === 0}
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
        {/* Stage 3 — KB Teknik Devir Notu + Müşteri Yanıt Taslağı kartları.
            Faz 0: kapanışta artık taze draft üretilmiyor (analyze kaldırıldı).
            Taslaklar Stage-2 import-ai-suggested akışında persist edilir ve
            kapanışta doğrudan persisted aiDrafts üzerinden gösterilir. */}
        <KbDraftCard item={createdCase} variant="closure" />
        {/* Kapanış Dosyaları — Step 3'ün son bölümü. Mevcut CaseAttachment akışı
            (caseService.addFile/removeFile/downloadFile + FilesTab component'i)
            aynen yeniden kullanılır. Yüklenen dosyalar normal vaka ek'i olur ve
            Case Detail > Dosyalar sekmesinde de görünür. Schema değişikliği YOK,
            per-step gruplama YOK. Aktif upload sırasında "Vakayı Kapat" disable
            edilir; kullanıcı dosya yüklemese de close akışı bloklanmaz. */}
        <div className="border-t border-slate-200 pt-3 dark:border-ndark-border">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <SectionTitle text="Kapanış Dosyaları" />
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Opsiyonel — kanıt/ekran görüntüsü
            </span>
          </div>
          <p className="mb-2 text-xs text-slate-500 dark:text-ndark-muted">
            Dosyalar vakaya eklenecek ve Vaka Detayı'ndaki <strong>Dosyalar</strong> sekmesinde
            görünecek. Aynı sınırlar geçerli (maks. 25 MB/dosya, 20 dosya/vaka).
          </p>
          <FilesTab
            item={createdCase}
            onItemUpdated={onItemUpdated}
            onUploadingChange={onClosureFilesUploadingChange}
          />
        </div>
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
  teamOptions: { all: TransferTeamOption[] };
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
  const isSameTeam = transferToTeamId !== '' && transferToTeamId === createdCase?.assignedTeamId;
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
          <SectionTitle text="3. Devir / Atama" />
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
          SLA değişmez, yeni vaka oluşturulmaz. Hedef ekip veya kişi vakayı devralır.
        </p>

        {/* Empty-state: bu şirketin başka aktif takımı yok */}
        {noTeamsAtAll && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            ⚠ Bu vakanın şirketinde ({createdCase.companyName ?? '—'}) aktarılabilecek başka aktif
            takım bulunmuyor. Yönetim → Takımlar altından yeni takım oluştur veya pasif bir takımı
            aktif et.
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
          >
            <Select
              value={transferToTeamId}
              onChange={(e) => onChangeTeam(e.target.value)}
              disabled={noTeamsAtAll || transferring}
            >
              <option value="">
                {noTeamsAtAll ? '— Aktif takım yok —' : 'Takım seç…'}
              </option>
              {teamOptions.all.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.defaultSupportLevel ? ` · ${t.defaultSupportLevel}` : ''}
                  {t.id === createdCase?.assignedTeamId ? ' (mevcut)' : ''}
                </option>
              ))}
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
                  : 'Boş bırakılırsa takım havuzuna atanır.'
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
          hint="Hedef ekip veya kişi vakayı açtığında neyi göreceği. Mevcut adımları ekrana bakmadan anlasın."
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
                      : isSameTeam && !transferToPersonId
                        ? 'Aynı takımda devir için hedef kişi seçin.'
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
              {transferring ? 'Aktarılıyor…' : 'Devret / Ata'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
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
