import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  Brain,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Archive,
  ArrowRightLeft,
  ChevronDown,
  RotateCw,
  ChevronRight,
  Clock,
  Clock3,
  Copy,
  Eye,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  AtSign,
  FileText,
  History as HistoryIcon,
  Inbox,
  ListChecks,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Save,
  ShieldAlert,
  Box,
  Boxes,
  Flame,
  Layers,
  Package,
  Settings2,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingDown,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { PendingReplyBadge } from './components/PendingReplyBadge';
import { SmartClassificationCard } from './components/SmartClassificationCard';
import { externalKbService } from '@/services/externalKbService';
import { Modal } from '@/components/ui/Modal';
import { Popover } from '@/components/ui/Popover';
import { ActiveCallBanner } from '@/components/ui/ActiveCallBanner';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { RunaAiCard } from '@/components/ui/RunaAiCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { CustomFieldRenderer } from '@/components/CustomFieldRenderer';
// StatusTransitionPanel artık CompactStatusStepper içinde reason zorunlu
// geçişler için modal olarak reuse ediliyor; CaseDetailPage gövdesinde
// doğrudan render edilmez.
import { CompactStatusStepper } from './CompactStatusStepper';
import { CaseSolutionStepsPanel } from './CaseSolutionStepsPanel';
import { KbDraftCard } from './KbDraftCard';
import { ResolutionApprovalCard } from './components/ResolutionApprovalCard';
import { CommunicationDispatchCard } from './components/CommunicationDispatchCard';
import { TransferModal } from './components/TransferModal';
import { SnoozeModal } from './components/SnoozeModal';
import { MentionTextarea, type MentionTextareaHandle } from './components/MentionTextarea';
import { NoteAvatar, NotesTab } from './components/CaseNotes';
// M6.2c — İletişim sekmesi lazy-load. TipTap + MailComposer +
// RichTextEditor + DOMPurify ağır bağımlılıklarını main bundle dışına
// taşır (~600 KB gzip → İletişim açılınca yüklenir).
// React.lazy + Suspense standart deseni: kontrat değişmez (item: Case
// prop'u aynen); statik named export'tan default export'a wrap.
const CommunicationTab = lazy(() =>
  import('./components/CommunicationTab').then((m) => ({ default: m.CommunicationTab })),
);
import { LazyTabBoundary } from './components/LazyTabBoundary';
import { FilesTab } from './components/CaseFiles';
import { CustomerPulsePanel } from './components/CustomerPulsePanel';
import { CaseTitleEditable } from './components/CaseTitleEditable';
import { DevOpsSection } from './components/DevOpsSection';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import {
  apiFetch,
  caseService,
  lookupService,
  type CustomerMatchSuggestion,
  type CustomerMatchSuggestionsResponse,
} from '@/services/caseService';
import { aiService, aiErrorMessage, type ChurnConversion } from '@/services/aiService';
import { accountService, type CaseCustomerContext } from '@/services/accountService';
import {
  authorizationService,
  type AuthorizationFieldState,
} from '@/services/authorizationService';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import { useAuth } from '@/services/AuthContext';
import { featureFlags } from '@/config/featureFlags';
import { formatDateTime, formatRelative, formatRemaining } from '@/lib/format';
import {
  CALL_DISPOSITIONS,
  CALL_OUTCOMES,
  CASE_FIELD_LABELS,
  CASE_ORIGINS,
  CASE_PRIORITY_LABELS,
  CASE_REQUEST_TYPES,
  CASE_TYPE_LABELS,
  ESCALATION_LEVELS,
  ESCALATION_LEVEL_LABELS,
  FINANCIAL_STATUSES,
  OFFER_OUTCOMES,
  PRODUCT_USAGES,
  RESPONSE_LEVELS,
  SUPPORT_LEVEL_LABELS,
  USAGE_CHANGE_ALERTS,
  type CallDisposition,
  type CallOutcome,
  type Case,
  type CaseHistoryActionType,
  type CaseHistoryEntry,
  type CasePriority,
  type CaseTransferRecord,
  type EscalationLevel,
  type NoteVisibility,
  type SupportLevel,
} from './types';

type TabKey =
  | 'detail'
  | 'activity'
  | 'notes'
  | 'files'
  | 'callLogs'
  | 'links'
  // M6.1 — Vaka İçi E-Posta thread sekmesi (gelen + giden + otomatik
  // dispatch mailleri). Composer M6.2'de eklenir.
  | 'communication'
  // WR-Smart-Ticket UX fix 1 — "Çözüm Adımları" artık Detay body'sinde
  // değil, kendi tab'inde. TÜM vakalar için görünür (Smart Ticket gate yok);
  // L2/L3 ve normal vakalar için ikincil troubleshooting yüzeyi.
  | 'solution-steps';

const CASE_DETAIL_AUTHZ_FIELDS = [
  'description',
  'resolutionNote',
  'category',
  'subCategory',
  'requestType',
  'origin',
  'priority',
  'smartTicketMeta',
] as const;

type FieldStateMap = Record<string, AuthorizationFieldState>;

const DEFAULT_AUTHZ_FIELD_STATE: AuthorizationFieldState = {
  visible: true,
  readable: true,
  editable: true,
  required: false,
  masked: false,
};

interface CaseDetailPageProps {
  caseId: string;
  onBack: () => void;
  onShowCustomer?: (accountId: string) => void;
  /** "Müşteri Detayı'na git" linki — sadece canReadAccounts olan rollerde aktiftir. */
  onOpenAccount?: (accountId: string) => void;
}

// R10.3 (2026-07-04) — onShowCustomer yeniden aktif tüketici: CommunicationTab
// tam-ekran başlık barı müşteri linki App'in CustomerCardModal'ını açar
// (Detay sekmesindeki kardeş kullanım deseni — accounts sayfası navigasyonu
// DEĞİL). eslint yorumu ve _prefix kaldırıldı.
export function CaseDetailPage({ caseId, onBack, onShowCustomer, onOpenAccount }: CaseDetailPageProps) {
  const { user } = useAuth();
  // Phase D + Agent/Backoffice genişletmesi — tüm operasyon rolleri müşteri
  // eşleştirebilir. Öğrenme (learned sender) yalnız Supervisor+ kararından
  // beslenir; ayrım backend'de link-account route'unda yapılır.
  const canLinkAccount =
    !!user &&
    ['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'].includes(user.role);
  // PR-SD — Soft archive yalnız SystemAdmin yetkisinde.
  const canArchive = user?.role === 'SystemAdmin';
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [item, setItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(false);
  const [customerContext, setCustomerContext] = useState<CaseCustomerContext | null>(null);
  const [activeId, setActiveId] = useState(caseId);

  // Breadcrumb stack — geçmiş vaka navigasyonu için (max 3 level)
  // Eski item'lar burada birikir; ana breadcrumb item'ı = activeId
  const [navStack, setNavStack] = useState<{ id: string; caseNumber: string; accountName: string }[]>([]);

  const [tab, setTab] = useState<TabKey>('detail');
  // 2026-07-04 PR-2 — Mail-kaynaklı vakada default sekme = İletişim.
  // Codex R1 P2 fix (2026-07-04) — Guard VAKA-BAŞINA:
  //   Eski: initialTabAppliedRef bool koşulsuz tek-seferlik → aynı mount'ta
  //   ikinci mail vakasına geçince İletişim seçilmiyordu (ref true kaldığı
  //   için).
  //   Yeni: appliedForCaseIdRef vaka kimliğine bağlı. Vaka değişince
  //   baseline yeniden kurulur; aynı vakada refresh'lerde re-apply YOK
  //   (kullanıcının manuel sekme seçimi item update'lerinde EZİLMEZ).
  const appliedForCaseIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item) return;
    if (appliedForCaseIdRef.current === item.id) return;
    appliedForCaseIdRef.current = item.id;
    setTab(item.origin === 'E-posta' ? 'communication' : 'detail');
  }, [item]);
  const [previousCases, setPreviousCases] = useState<Case[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  // Phase D — Müşteri eşleştirme modal'ı (Supervisor+).
  const [linkAccountOpen, setLinkAccountOpen] = useState(false);
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [unsnoozing, setUnsnoozing] = useState(false);
  // Çağrı kaydı modal'ı — parent'ta tek instance. handleEndCall otomatik açar.
  const [callNoteModal, setCallNoteModal] = useState<{ open: boolean; prefillDurationMin?: number }>({
    open: false,
  });
  // Durum Raporu modal — header toolbar trigger; içerik self-fetch ile gelir.
  const [statusReportOpen, setStatusReportOpen] = useState(false);

  // Inline edit / drafts
  const [drafts, setDrafts] = useState<Partial<Case>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [fieldStates, setFieldStates] = useState<FieldStateMap>({});

  // Status transition artık StatusTransitionPanel içinde (header popover kaldırıldı)

  // New note state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<MentionTextareaHandle>(null);
  // Synchronous double-submit guard — React state updates batch across
  // an await; a second click before setNoteSubmitting paints would
  // sneak past `noteSubmitting`. The ref flips synchronously.
  const noteSubmittingRef = useRef(false);

  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);
  // Phase C2: account bilgisi artık /api/cases/:id/customer-context'tan; bootstrap kullanılmıyor.
  const accounts = useMemo(() => lookupService.accounts(), []);
  const categories = useMemo(() => lookupService.categories(), []);
  const teams = useMemo(() => lookupService.teams(), []);
  const persons = useMemo(() => lookupService.persons(), []);
  const thirdParties = useMemo(() => lookupService.thirdParties(), []);
  const { toast } = useToast();

  // WR-A7b — Catalog state (Package + Product). Vakanın companyId/accountId'sine bağlı.
  const [catalogPackages, setCatalogPackages] = useState<
    Array<{ id: string; code: string; name: string; supportLevel: SupportLevel }>
  >([]);
  const [catalogProducts, setCatalogProducts] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      supportLevel: SupportLevel;
      productGroupId: string;
    }>
  >([]);

  // Parent caseId değişirse içerideki state ve breadcrumb sıfırlanır
  useEffect(() => {
    setActiveId(caseId);
    setNavStack([]);
    setDrafts({});
    setEditingField(null);
  }, [caseId]);

  // L2-Smart-Flow FAZ 1 — tenant KB kapısı. Akıllı Tanımlar kartı +
  // "AI Önerilen Adımlar" butonu yalnız KB entegrasyonu AKTİF şirkette
  // görünür (kullanıcı kararı: PARAM gibi KB'siz kiracılarda ekran
  // karışıklığı olmasın). null = henüz yüklenmedi.
  const [kbEnabled, setKbEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const companyId = item?.companyId;
    if (!companyId) {
      setKbEnabled(null);
      return;
    }
    void externalKbService
      .settingsStatus(companyId)
      .then((s) => {
        if (alive) setKbEnabled(s?.enabled === true);
      })
      .catch(() => {
        if (alive) setKbEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [item?.companyId]);

  useEffect(() => {
    let alive = true;
    if (!activeId) return;
    setLoading(true);
    void caseService.get(activeId).then((c) => {
      if (alive) {
        setItem(c ?? null);
        setLoading(false);
        setNoteText('');
        setNoteVisibility('Internal');
        setTab('detail');
      }
    });
    // Faz 1.5 Madde 3: vaka açıldığı an kullanıcının buradaki @mention'larını
    // seen yap. Header bell badge'i bu çağrıdan sonra refresh ile sayıyı düşürür.
    void caseService.markMentionsSeen(activeId).then(() => {
      window.dispatchEvent(new CustomEvent('app:mentions-changed'));
    });
    // Phase C2: customer-context — dış kod, paket, aktif ürünler, primary kontak.
    void accountService.getCaseCustomerContext(activeId).then((out) => {
      if (alive) setCustomerContext(out?.context ?? null);
    });
    return () => {
      alive = false;
    };
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    if (!featureFlags.authorizationFieldUiEnforcementEnabled || !item?.companyId) {
      setFieldStates({});
      return () => {
        alive = false;
      };
    }
    void authorizationService.fieldStates({
      companyId: item.companyId,
      scope: 'case.detail',
      resourceKey: 'case',
      fields: [...CASE_DETAIL_AUTHZ_FIELDS],
    }).then((result) => {
      if (!alive) return;
      setFieldStates(Object.fromEntries(result.fields.map((f) => [f.fieldKey, f.state])));
    }).catch(() => {
      if (alive) setFieldStates({});
    });
    return () => {
      alive = false;
    };
  }, [item?.companyId, item?.id]);

  // WR-A7b — Vakanın companyId/accountId'sine bağlı catalog lookup.
  useEffect(() => {
    let alive = true;
    if (!item?.companyId) {
      setCatalogPackages([]);
      setCatalogProducts([]);
      return;
    }
    void lookupService
      .caseCatalog({ companyId: item.companyId, accountId: item.accountId || null })
      .then((data) => {
        if (!alive) return;
        setCatalogPackages(data.packages);
        setCatalogProducts(data.products);
      });
    return () => {
      alive = false;
    };
  }, [item?.companyId, item?.accountId]);

  // Önceki vakalar (Çözüldü / İptalEdildi)
  useEffect(() => {
    let alive = true;
    if (!item) {
      setPreviousCases([]);
      return;
    }
    void caseService
      .findByAccount(item.accountId, {
        excludeId: item.id,
        statusIn: ['Çözüldü', 'İptalEdildi'],
      })
      .then((items) => {
        if (alive) {
          items.sort((a, b) => {
            const ta = new Date(a.resolvedAt ?? a.updatedAt).getTime();
            const tb = new Date(b.resolvedAt ?? b.updatedAt).getTime();
            return tb - ta;
          });
          setPreviousCases(items);
        }
      });
    return () => {
      alive = false;
    };
  }, [item]);

  const account = useMemo(
    () => (item ? accounts.find((a) => a.id === item.accountId) : undefined),
    [item, accounts],
  );

  async function handleAddNote() {
    if (!item || !noteText.trim()) return;
    // Ref guard catches the rare double-click that lands before
    // setNoteSubmitting paints; React state guard catches everything
    // after first paint. Both must clear on completion.
    if (noteSubmittingRef.current) return;
    noteSubmittingRef.current = true;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      const created = await caseService.addNote(item.id, {
        content: noteText.trim(),
        visibility: noteVisibility,
        authorName: user?.fullName ?? 'Kullanıcı',
      });
      if (created) {
        // Backend short-window guard may return an EXISTING row (rapid
        // duplicate). De-dup the local list so the same note never
        // appears twice in the UI.
        const alreadyPresent = item.notes.some((n) => n.id === created.id);
        setItem(
          alreadyPresent ? item : { ...item, notes: [created, ...item.notes] },
        );
        setNoteText('');
        toast({
          type: 'success',
          message: noteVisibility === 'Internal' ? 'İç not eklendi.' : 'Müşteriye görünür not eklendi.',
          duration: 2500,
        });
      } else {
        // apiFetch already surfaced a toast; keep draft and show inline
        // hint so the user knows they can retry without retyping.
        setNoteError('Not gönderilemedi. Tekrar deneyebilirsin.');
      }
    } finally {
      noteSubmittingRef.current = false;
      setNoteSubmitting(false);
    }
  }

  // Delete own note/reply — author-only at backend; UI hides the
  // button when not eligible, but the API enforces it.
  async function handleDeleteNote(
    noteId: string,
    parentNoteIdHint?: string | null,
  ): Promise<boolean> {
    if (!item) return false;
    const r = await caseService.deleteNote(item.id, noteId);
    if (r.ok) {
      // Replies are lazy-loaded via listReplies and not in item.notes;
      // the caller (NoteCard) supplies parentNoteIdHint so
      // parent.replyCount decrements correctly. item.notes lookup is
      // the fallback for top-level deletions (Codex P2 fix).
      const deleted = item.notes.find((n) => n.id === noteId);
      const parentId = parentNoteIdHint ?? deleted?.parentNoteId ?? null;
      setItem({
        ...item,
        notes: item.notes
          .filter((n) => n.id !== noteId)
          .map((n) =>
            parentId && n.id === parentId
              ? { ...n, replyCount: Math.max(0, (n.replyCount ?? 0) - 1) }
              : n,
          ),
      });
      toast({ type: 'success', message: 'Not silindi.', duration: 2000 });
      return true;
    }
    // Structured error → user-facing message; UI keeps the row visible.
    const msg =
      r.reason === 'has_replies'
        ? (r.message ?? 'Yanıtı olan ana not silinemez.')
        : r.reason === 'forbidden'
          ? (r.message ?? 'Bu notu silme yetkin yok.')
          : r.reason === 'orphan'
            ? (r.message ?? 'Yazarı belirlenemeyen eski not silinemez.')
            : r.reason === 'not_found'
              ? 'Not bulunamadı.'
              : 'Not silinemedi.';
    toast({ type: 'error', message: msg, duration: 3500 });
    return false;
  }

  // Reply eklendiginde parent note'un replyCount alanini increment et —
  // case detail re-fetch etmeden badge guncellenir.
  function handleReplyAdded(parentNoteId: string) {
    if (!item) return;
    setItem({
      ...item,
      notes: item.notes.map((n) =>
        n.id === parentNoteId ? { ...n, replyCount: (n.replyCount ?? 0) + 1 } : n,
      ),
    });
  }

  // handleQuickActionAddNote — eski "Hızlı Aksiyonlar" PanelSection'undaki
  // "Tüm not akışını aç" linkinden çağrılıyordu. LBD A7 ile o blok kalktı;
  // Notlar sekmesine geçmek için doğal yol artık tab tıklaması.
  // Fonksiyon: silindi (caller yok).

  // Breadcrumb stack üzerinden geçmiş vakaya geçiş — Spec UX 4
  function navigateToCase(targetId: string) {
    if (!item || targetId === activeId) return;
    setNavStack((prev) => {
      const next = [...prev, { id: item.id, caseNumber: item.caseNumber, accountName: item.accountName }];
      // Max 3 level: en eski item düşer
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    setActiveId(targetId);
    setDrafts({});
    setEditingField(null);
    setTab('detail');
  }

  function navigateToStackItem(index: number) {
    const target = navStack[index];
    if (!target) return;
    setActiveId(target.id);
    setNavStack((prev) => prev.slice(0, index));
    setDrafts({});
    setEditingField(null);
    setTab('detail');
  }

  // Inline edit handlers
  function commitDraft(field: keyof Case, value: unknown) {
    setDrafts((prev) => {
      let next: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
      // Mevcut değerle aynıysa draft'ı kaldır
      if ((item as Record<string, unknown> | null)?.[field as string] === value) {
        delete next[field as string];
      } else {
        next[field as string] = value;
      }

      // Cascade temizleme: kategori değişince eskimiş alt kategori'yi düşür
      if (field === 'category') {
        const cat = categories.find((c) => c.category === value);
        const currentSub = (next.subCategory ?? item?.subCategory) as string | undefined;
        if (cat && currentSub && !cat.subCategories.includes(currentSub)) {
          // Alt kategori artık geçersiz — taslakta sıfırla (boş)
          next.subCategory = '';
        }
      }
      // Takım değişince eski kişi'yi düşür
      if (field === 'assignedTeamId') {
        const teamPersons = persons.filter((p) => p.teamId === value);
        const currentPersonId = (next.assignedPersonId ?? item?.assignedPersonId) as string | undefined;
        if (currentPersonId && !teamPersons.find((p) => p.id === currentPersonId)) {
          next.assignedPersonId = '';
          next.assignedPersonName = '';
        }
        // Takım adını da senkronize et (denormalized)
        const team = teams.find((t) => t.id === value);
        next.assignedTeamName = team?.name ?? '';
      }
      // Kişi değişince adını senkronize et
      if (field === 'assignedPersonId') {
        const person = persons.find((p) => p.id === value);
        next.assignedPersonName = person?.name ?? '';
      }
      // 3. parti seçilince adını senkronize et
      if (field === 'thirdPartyId') {
        const tp = thirdParties.find((t) => t.id === value);
        next.thirdPartyName = tp?.name ?? '';
      }

      return next as Partial<Case>;
    });
    setEditingField(null);
  }

  function cancelEdit() {
    setEditingField(null);
  }

  async function handleSaveDrafts() {
    if (!item || Object.keys(drafts).length === 0 || savingDrafts) return;
    setSavingDrafts(true);
    const updated = await caseService.update(item.id, drafts);
    setSavingDrafts(false);
    if (updated) {
      setItem(updated);
      setDrafts({});
      setEditingField(null);
      toast({ type: 'success', title: 'Vaka güncellendi ✓', message: `${Object.keys(drafts).length} alan kaydedildi.` });
    }
  }

  function handleDiscardDrafts() {
    setDrafts({});
    setEditingField(null);
  }

  // ESC = açık edit'i iptal et (ya da pending draft'ları sıfırla — kullanıcı seçimi)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editingField) {
          setEditingField(null);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingField]);

  function handleStartCall() {
    setCallActive(true);
  }

  function handleEndCall(durationSec: number) {
    setCallActive(false);
    // Süreyi dakikaya yuvarla (her zaman >=1) — kullanıcı dilerse modal'da düzenler.
    const durationMin = Math.max(1, Math.round(durationSec / 60));
    setCallNoteModal({ open: true, prefillDurationMin: durationMin });
  }

  // WR-C1 — "Üstlen" / Claim handler. Race conflict 409 → apiFetch toast eder, undefined döner.
  const [claiming, setClaiming] = useState(false);
  async function handleClaim() {
    if (!item || claiming) return;
    setClaiming(true);
    const updated = await caseService.claimCase(item.id);
    setClaiming(false);
    if (updated) setItem(updated);
  }

  if (loading && !item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Vaka yükleniyor…
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <span>Vaka bulunamadı.</span>
        <Button variant="outline" size="sm" leftIcon={<ArrowLeft size={12} />} onClick={onBack}>
          Vakalar listesine dön
        </Button>
      </div>
    );
  }

  const isSnoozeActive = Boolean(
    item.snoozeUntil && new Date(item.snoozeUntil).getTime() > Date.now(),
  );

  async function handleUnsnooze() {
    if (!item) return;
    setUnsnoozing(true);
    const updated = await apiFetch<Case>(
      `/api/cases/${item.id}/snooze`,
      { method: 'DELETE' },
      'Erteleme kaldırılamadı',
    );
    setUnsnoozing(false);
    if (!updated) return;
    setItem(updated);
    toast({ type: 'success', title: 'Erteleme kaldırıldı', message: 'Vaka tekrar açıldı.' });
  }

  // PR-SD — Arşivle (SystemAdmin-only). Reason min 3 char zorunlu (UI + backend).
  async function handleArchive() {
    if (!item) return;
    const reason = archiveReason.trim();
    if (reason.length < 3) {
      toast({ type: 'warn', message: 'Arşiv sebebi en az 3 karakter olmalı.' });
      return;
    }
    setArchiving(true);
    const updated = await caseService.archive(item.id, reason);
    setArchiving(false);
    if (!updated) return;
    setItem(updated);
    setArchiveModalOpen(false);
    setArchiveReason('');
    toast({ type: 'success', title: 'Vaka arşivlendi', message: 'Listelerden gizlendi.' });
  }

  // PR-SD — Geri yükle (SystemAdmin-only).
  async function handleRestore() {
    if (!item) return;
    if (!window.confirm('Vakayı arşivden geri yüklemek istediğinizden emin misiniz?')) return;
    setRestoring(true);
    const updated = await caseService.restore(item.id);
    setRestoring(false);
    if (!updated) return;
    setItem(updated);
    toast({ type: 'success', title: 'Vaka geri yüklendi', message: 'Listelerde görünür.' });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — sticky */}
      <header className="border-b border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex items-start gap-4 px-6 py-3">
          {/* Mobile: hamburger for left panel */}
          <button
            type="button"
            onClick={() => setLeftDrawerOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
            title="Müşteri özeti"
          >
            <Inbox size={16} />
          </button>

          <button
            type="button"
            onClick={onBack}
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            title="Vakalar listesine dön"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="min-w-0 flex-1">
            <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <button type="button" onClick={onBack} className="hover:text-brand-700 hover:underline">
                Vakalar
              </button>
              {navStack.map((entry, i) => (
                <span key={`${entry.id}-${i}`} className="flex items-center gap-1">
                  <ChevronRight size={11} className="text-slate-400" />
                  <button
                    type="button"
                    onClick={() => navigateToStackItem(i)}
                    className="font-mono text-slate-600 hover:text-brand-700 hover:underline"
                    title={entry.accountName}
                  >
                    {entry.caseNumber}
                  </button>
                </span>
              ))}
              <ChevronRight size={11} className="text-slate-400" />
              <span className="font-mono text-slate-700">{item.caseNumber}</span>
              <span className="text-slate-400">—</span>
              <span className="truncate text-slate-600">{item.accountName}</span>
              {/* M6.3b Faz 1 — "Yanıt bekliyor" rozeti (detay header).
                  Codex review fix — duration kaynağı lastEmailInboundAt. */}
              {item.pendingCustomerReply && (
                <PendingReplyBadge
                  pending={item.pendingCustomerReply}
                  lastEmailInboundAt={item.lastEmailInboundAt}
                  size="sm"
                />
              )}
            </nav>
            <CaseTitleEditable item={item} onUpdated={setItem} />
            {/* Statü bandı LBD-Move ile header'dan içerik alanına taşındı —
                sekme navigasyonunun hemen üstünde, tam genişlikte. */}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {Object.keys(drafts).length > 0 && (
              <button
                type="button"
                onClick={handleDiscardDrafts}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                title="Taslak değişiklikleri sil"
              >
                Taslakları sil
              </button>
            )}
            <Button
              variant={Object.keys(drafts).length > 0 ? 'primary' : 'outline'}
              size="sm"
              leftIcon={<Save size={12} />}
              disabled={Object.keys(drafts).length === 0 || savingDrafts}
              onClick={handleSaveDrafts}
              title={Object.keys(drafts).length > 0
                ? `${Object.keys(drafts).length} alan kaydedilecek`
                : 'Düzenlenmiş alan yok'}
            >
              {savingDrafts ? 'Kaydediliyor…' : `Kaydet${Object.keys(drafts).length > 0 ? ` (${Object.keys(drafts).length})` : ''}`}
            </Button>
            {/* WR-C1 — "Üstlen" butonu Kaydet'in yanına taşındı (LeftPanel'den). */}
            {!!user?.personId && !item.assignedPersonId && item.status !== 'Çözüldü' && item.status !== 'İptalEdildi' && (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-3 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200 dark:hover:bg-brand-950/50"
                title="Bu vakayı üstlen"
              >
                {claiming ? 'Üstleniliyor…' : 'Üstlen'}
              </button>
            )}
            <Button
              size="sm"
              leftIcon={<Phone size={12} />}
              onClick={handleStartCall}
              disabled={callActive}
            >
              Çağrı Başlat
            </Button>
            <button
              type="button"
              onClick={() => setStatusReportOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-400 bg-white px-3 text-xs font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-700 dark:bg-ndark-card dark:text-violet-300 dark:hover:bg-violet-950/40"
              title="Paydaşlara gönderilebilecek profesyonel özet"
            >
              <Sparkles size={12} />
              Durum Raporu
            </button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<UserPlus size={12} />}
              onClick={() => setTransferOpen(true)}
            >
              Devret
            </Button>
            {!isSnoozeActive && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Clock3 size={12} />}
                onClick={() => setSnoozeOpen(true)}
                title="Vakayı ertele — opsiyonel olarak kişisel takvime de düşer"
              >
                Ertele
              </Button>
            )}
            <Popover
              align="end"
              width={200}
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg"
                  title="Daha fazla aksiyon"
                  aria-label="Daha fazla aksiyon"
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            >
              {({ close }) => (
                <ul className="text-sm">
                  <MenuAction
                    label="İptal Et"
                    onClick={() => {
                      close();
                      toast({ type: 'info', message: 'İptal akışı status popover üzerinden çalıştırılır.' });
                    }}
                  />
                  {/* PR-D3 — "Jira'ya Aktar" stub kaldırıldı (TBD-12).
                      DevOps section bu ihtiyacı karşılıyor; ayrı bir Jira
                      entegrasyonu planlanmıyor. */}
                  <MenuAction
                    label="Yazdır"
                    onClick={() => {
                      close();
                      window.print();
                    }}
                  />
                  {/* PR-SD — Arşivle (SystemAdmin-only, arşivli değilse). */}
                  {canArchive && !item.isArchived && (
                    <MenuAction
                      label="Arşivle"
                      onClick={() => {
                        close();
                        setArchiveReason('');
                        setArchiveModalOpen(true);
                      }}
                    />
                  )}
                </ul>
              )}
            </Popover>
          </div>
        </div>
      </header>

      {/* Active call banner */}
      {callActive && (
        <ActiveCallBanner
          customerName={item.accountName}
          customerPhone={account?.phone}
          caseId={item.id}
          onNoteAdded={(note) => setItem({ ...item, notes: [note, ...item.notes] })}
          onEnd={handleEndCall}
        />
      )}

      {/* PR-SD — Arşivli vaka banner (SystemAdmin görür). Diğer roller bu
          vakanın detayına zaten erişemez (route 404). */}
      {item.isArchived && (
        <div className="flex items-start gap-3 border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          <Archive size={16} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-400" />
          <div className="flex-1">
            <div className="font-medium">Bu vaka arşivlendi</div>
            <div className="mt-0.5 text-rose-800 dark:text-rose-300">
              {item.archivedByUserName ? <>Arşivleyen: <strong>{item.archivedByUserName}</strong> · </> : null}
              {item.archivedAt
                ? new Date(item.archivedAt).toLocaleString('tr-TR', {
                    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
              {item.archiveReason ? <> · Sebep: <em>{item.archiveReason}</em></> : null}
            </div>
          </div>
          {canArchive && (
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={restoring}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <RotateCw size={12} />
              {restoring ? 'Geri yükleniyor…' : 'Geri Yükle'}
            </button>
          )}
        </div>
      )}

      {/* Aktarım uyarısı — FAZ 2 §20.2: 2+ aktarımda kök neden analizi tetiklenir */}
      {(item.transferCount ?? 0) >= 2 && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <ArrowRightLeft size={16} className="shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1">
            <span className="font-medium">Bu vaka {item.transferCount} kez aktarıldı.</span>{' '}
            <span className="text-amber-800 dark:text-amber-300">
              RUNA AI kök neden analizini hazırladı — aktivite akışında "🔍 AI Kök Neden Analizi" satırına bak.
            </span>
          </div>
        </div>
      )}

      {/* Snooze banner — vakayı geçici olarak ertelendiğinde */}
      {isSnoozeActive && item.snoozeUntil && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900">
          <Clock3 size={16} className="shrink-0 text-amber-700" />
          <div className="flex-1">
            <span className="font-medium">Bu vaka ertelendi.</span>{' '}
            <span className="text-amber-800">
              {new Date(item.snoozeUntil).toLocaleString('tr-TR', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              {item.snoozeReason && ` — ${{
                CustomerWillCall: 'Müşteri tekrar arayacak',
                WaitingThirdParty: '3. taraf bekleniyor',
                Reminder: 'Hatırlatıcı',
              }[item.snoozeReason]}`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<BellOff size={12} />}
            disabled={unsnoozing}
            onClick={handleUnsnooze}
          >
            {unsnoozing ? 'Kaldırılıyor…' : 'Erteleme Kaldır'}
          </Button>
        </div>
      )}

      {/* PR-SD — Arşive sebep modal'ı (SystemAdmin) */}
      <Modal
        open={archiveModalOpen}
        onClose={() => {
          setArchiveModalOpen(false);
          setArchiveReason('');
        }}
        title="Vakayı Arşivle"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-ndark-muted">
            Bu vaka arşivlenecek. Tüm geçmiş (notlar, dosyalar, audit) korunur; sadece
            operasyonel listelerden gizlenir. SystemAdmin "Arşivlenenleri göster" filtresiyle erişebilir.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-ndark-muted">
              Arşiv sebebi (zorunlu, en az 3 karakter)
            </label>
            <textarea
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              rows={3}
              placeholder="Örn: Yanlış açılmış test vakası"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setArchiveModalOpen(false);
                setArchiveReason('');
              }}
              disabled={archiving}
            >
              Vazgeç
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Archive size={12} />}
              onClick={() => void handleArchive()}
              disabled={archiving || archiveReason.trim().length < 3}
            >
              {archiving ? 'Arşivleniyor…' : 'Arşivle'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Body — 3 columns */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left panel */}
        <LeftPanel
          item={item}
          accountPhone={customerContext?.primaryContact?.phone ?? account?.phone}
          accountEmail={customerContext?.primaryContact?.email ?? account?.email}
          accountContact={customerContext?.primaryContact?.fullName ?? account?.contactPerson}
          customerContext={customerContext}
          onOpenAccount={onOpenAccount}
          canLinkAccount={canLinkAccount}
          onLinkAccount={canLinkAccount ? () => setLinkAccountOpen(true) : undefined}
          onConfirmLinkSuggestion={
            canLinkAccount
              ? async (suggestion) => {
                  // Manuel onay: confirm popup spec gereği zorunlu.
                  const ok = window.confirm(
                    `Bu vakayı "${suggestion.accountName}" müşterisine bağlamak istiyor musun?`,
                  );
                  if (!ok) return;
                  const updated = await caseService.linkAccount(item.id, suggestion.accountId);
                  if (updated) {
                    setItem(updated);
                    void accountService.getCaseCustomerContext(item.id).then((out) => {
                      setCustomerContext(out?.context ?? null);
                    });
                  }
                }
              : undefined
          }
          drawerOpen={leftDrawerOpen}
          onCloseDrawer={() => setLeftDrawerOpen(false)}
          userRole={user?.role}
        />

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Statü bandı — Adım-1: progress bar geniş + kimlik (Öncelik · Tip).
              SLA göstergesi aşağıdaki KPI/SLA şeridine taşındı (tek yerde olsun). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2 dark:border-ndark-border dark:bg-ndark-bg/40">
            {/* [Statü] progress bar (wideConnectors=true ile banda yayılır) */}
            <CompactStatusStepper item={item} onApplied={setItem} wideConnectors />

            {/* Sağ: yalnız kimlik metadata — SLA / Watcher KPI şeridinde */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-ndark-muted">
              <span title={`Öncelik: ${CASE_PRIORITY_LABELS[item.priority]} · Tip: ${CASE_TYPE_LABELS[item.caseType]}`}>
                {CASE_PRIORITY_LABELS[item.priority]} · {CASE_TYPE_LABELS[item.caseType]}
              </span>
            </div>
          </div>

          {/* KPI/SLA/tarih birleşik şeridi — status bandının ALTINDA, tab nav'ın ÜSTÜNDE.
              Tek satır sönük metin "·" ayraçlı; SLA aşıldı tek kırmızı sinyal.
              Sticky değil — content ile scroll olur. */}
          <KpiSummaryStrip item={item} caseId={item.id} />

          <nav className="sticky top-0 z-10 flex shrink-0 gap-1 border-b border-slate-200 bg-white px-4 dark:border-ndark-border dark:bg-ndark-card">
            <TabButton
              active={tab === 'detail'}
              icon={<FileText size={14} />}
              label="Detay"
              onClick={() => setTab('detail')}
            />
            <TabButton
              active={tab === 'activity'}
              icon={<HistoryIcon size={14} />}
              label="Aktivite"
              count={item.history.length}
              onClick={() => setTab('activity')}
            />
            <TabButton
              active={tab === 'notes'}
              icon={<MessageSquare size={14} />}
              label="Notlar"
              count={item.notes.length}
              onClick={() => setTab('notes')}
            />
            <TabButton
              active={tab === 'files'}
              icon={<Paperclip size={14} />}
              label="Dosyalar"
              count={item.files.length}
              onClick={() => setTab('files')}
            />
            <TabButton
              active={tab === 'links'}
              icon={<LinkIcon size={14} />}
              label="Bağlantılar"
              onClick={() => setTab('links')}
            />
            <TabButton
              active={tab === 'communication'}
              icon={<AtSign size={14} />}
              label="İletişim"
              onClick={() => setTab('communication')}
            />
            {(item.caseType === 'ProactiveTracking' || item.caseType === 'Churn') && (
              <TabButton
                active={tab === 'callLogs'}
                icon={<Mic size={14} />}
                label="Çağrı Logları"
                count={item.callLogs.length}
                onClick={() => setTab('callLogs')}
              />
            )}
            {/* WR-Smart-Ticket UX fix 1 — "Çözüm Adımları" sekme,
                tüm vakalar için görünür. Smart Ticket gate YOK. */}
            <TabButton
              active={tab === 'solution-steps'}
              icon={<ListChecks size={14} />}
              label="Çözüm Adımları"
              onClick={() => setTab('solution-steps')}
            />
          </nav>

          {/* R15 M1 — Tum sekmeler ayni wrapper (overflow-y-auto p-6). */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'detail' && (
              <DetailTab
                item={item}
                offeredSolutions={offeredSolutions}
                categories={categories}
                teams={teams}
                persons={persons}
                thirdParties={thirdParties}
                catalogPackages={catalogPackages}
                catalogProducts={catalogProducts}
                previousCases={previousCases}
                onSelectPrevious={navigateToCase}
                drafts={drafts}
                editingField={editingField}
                fieldStates={fieldStates}
                onStartEdit={(f) => setEditingField(f)}
                onCancelEdit={cancelEdit}
                onCommitDraft={commitDraft}
                onTransitionApplied={(updated) => setItem(updated)}
                kbEnabled={kbEnabled}
                onCaseUpdated={(updated) => setItem(updated)}
              />
            )}
            {tab === 'activity' && <ActivityTab item={item} />}
            {tab === 'notes' && (
              <NotesTab
                item={item}
                noteText={noteText}
                noteVisibility={noteVisibility}
                noteSubmitting={noteSubmitting}
                noteError={noteError}
                onChangeText={(s) => {
                  setNoteText(s);
                  if (noteError) setNoteError(null);
                }}
                onChangeVisibility={setNoteVisibility}
                onSubmit={handleAddNote}
                onReplyAdded={handleReplyAdded}
                onDeleteNote={handleDeleteNote}
                currentUserId={user?.id ?? null}
                inputRef={noteRef}
              />
            )}
            {tab === 'files' && (
              <FilesTab item={item} onItemUpdated={(c) => setItem(c)} />
            )}
            {tab === 'links' && (
              <LinksTab item={item} onShowCase={navigateToCase} />
            )}
            {tab === 'communication' && (
              // Codex review fix — LazyTabBoundary lazy chunk REJECT'ini
              // yakalar (network fail / stale index.js sonrası kaldırılmış
              // chunk request'i). Aksi halde hata yukarı fırlar ve case
              // sayfasını çökertir (uygulamada üst error boundary yok).
              // R15 M1 — className geçmez (sayfa akışına döndü).
              <LazyTabBoundary label="İletişim sekmesi yüklenemedi.">
                <Suspense
                  fallback={
                    <div className="space-y-2 p-4">
                      <div className="h-6 w-2/5 animate-pulse rounded bg-slate-100 dark:bg-ndark-card" />
                      <div className="h-32 w-full animate-pulse rounded bg-slate-100 dark:bg-ndark-card" />
                    </div>
                  }
                >
                  <CommunicationTab
                    item={item}
                    onCaseShouldRefresh={() => {
                      // Codex P2 fix (M6.3b Faz 1) — Send sonrası header
                      // badge (pendingCustomerReply) ve K4 timestamp'leri
                      // tazelensin.
                      void caseService.get(item.id).then((c) => {
                        if (c) setItem(c);
                      });
                    }}
                    onShowCustomer={onShowCustomer}
                  />
                </Suspense>
              </LazyTabBoundary>
            )}
            {tab === 'callLogs' && (
              <CallLogsTab
                item={item}
                onAddCallLog={() => setCallNoteModal({ open: true })}
              />
            )}
            {/* WR-Smart-Ticket UX fix 1 — Çözüm Adımları artık kendi tab'inde.
                Tüm vakalar için görünür; Smart Ticket gate YOK.
                Panel implementasyonu CaseSolutionStepsPanel'de aynen reuse. */}
            {tab === 'solution-steps' && (
              <CaseSolutionStepsPanel
                item={item}
                kbEnabled={kbEnabled}
                onChange={() => {
                  void caseService.get(item.id).then((c) => {
                    if (c) setItem(c);
                  });
                }}
              />
            )}
          </div>
        </main>

        {/* Right panel — RUNA AI + type-specific summary (Agent rolünde gizli) */}
        {user?.role !== 'Agent' && (
          <RightPanel
            item={item}
            offeredSolutions={offeredSolutions}
            onCaseUpdated={(updated) => setItem(updated)}
          />
        )}

      </div>

      {/* Phase D — Müşteri Eşleştir modal'ı. Picker companyId case'in şirketiyle
          scoped; manuel onay (auto-link yok). Phase D Step 2'de öneri section'ı
          eklenecek; mevcut picker arama davranışı korunur. */}
      {canLinkAccount && (
        <AccountSearchPicker
          open={linkAccountOpen}
          companyId={item.companyId}
          selectedAccountId={item.accountId || null}
          allowNullSelection={false}
          onClose={() => setLinkAccountOpen(false)}
          onSelect={async (account) => {
            if (!account || linkSubmitting) return;
            setLinkSubmitting(true);
            const updated = await caseService.linkAccount(item.id, account.id);
            setLinkSubmitting(false);
            if (updated) {
              setItem(updated);
              setLinkAccountOpen(false);
              // Customer context'i yeniden çek — banner kaybolur, panel zenginleşir.
              void accountService.getCaseCustomerContext(item.id).then((out) => {
                setCustomerContext(out?.context ?? null);
              });
            }
          }}
        />
      )}

      {/* Vaka aktarımı modal'ı (FAZ 2 §20.2) — AI öneri + 3 step */}
      <TransferModal
        open={transferOpen}
        caseItem={item}
        onClose={() => setTransferOpen(false)}
        onTransferred={(updated) => setItem(updated)}
      />

      {/* Vaka erteleme modal'ı — içinde "Takvime ekle" checkbox'ı default ON,
          ayrı bir "Bana Hatırlat" akışına gerek bırakmıyor. */}
      <SnoozeModal
        open={snoozeOpen}
        caseId={item.id}
        caseTitle={item.title}
        onClose={() => setSnoozeOpen(false)}
        onSnoozed={(updated) => setItem(updated)}
      />

      {/* Çağrı kaydı modal'ı — parent'a yükseltildi:
          (1) handleEndCall otomatik açar (süre pre-fill);
          (2) Çağrı Logları sekmesindeki "Çağrı Notu Gir" butonu da aynı modal'ı açar. */}
      <NewCallLogModal
        open={callNoteModal.open}
        item={item}
        prefillDurationMin={callNoteModal.prefillDurationMin}
        onClose={() => setCallNoteModal({ open: false })}
        onCreated={(c) => {
          setItem(c);
          setCallNoteModal({ open: false });
        }}
      />

      {/* Durum Raporu modal — header toolbar'dan tetiklenir.
          Self-fetch; AI çağrısı modal açılınca yapılır. Persist edilmez. */}
      <StatusReportModal
        open={statusReportOpen}
        caseId={item.id}
        onClose={() => setStatusReportOpen(false)}
      />
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function MenuAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100"
      >
        {label}
      </button>
    </li>
  );
}

function TabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span>
      )}
    </button>
  );
}

function LeftPanel({
  item,
  accountPhone,
  accountEmail,
  accountContact,
  customerContext,
  onOpenAccount,
  canLinkAccount,
  onLinkAccount,
  onConfirmLinkSuggestion,
  drawerOpen,
  onCloseDrawer,
  userRole,
}: {
  item: Case;
  accountPhone?: string;
  accountEmail?: string;
  accountContact?: string;
  customerContext: CaseCustomerContext | null;
  onOpenAccount?: (accountId: string) => void;
  canLinkAccount?: boolean;
  onLinkAccount?: () => void;
  onConfirmLinkSuggestion?: (suggestion: CustomerMatchSuggestion) => Promise<void>;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  /** LBD A6 — Agent rolünde WatchersPanel gizlenir; diğer tüm rollerde görünür. */
  userRole?: string;
}) {
  const ctxCompany = customerContext?.company ?? null;
  const content = (
    <div className="space-y-4">
      <PanelSection title="Müşteri" icon={<Building2 size={12} />}>
        <div className="space-y-1.5">
          {item.accountId ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {/* LBD A12 — Müşteri adı tıklanır; "Detay →" ile aynı yere
                      yönlendirir. onOpenAccount yoksa düz metin. */}
                  {onOpenAccount ? (
                    <button
                      type="button"
                      onClick={() => onOpenAccount(item.accountId as string)}
                      title="Müşteri Detayı'na git"
                      className="block w-full truncate cursor-pointer text-left text-sm font-semibold text-slate-900 hover:text-brand-700 hover:underline dark:text-ndark-text dark:hover:text-brand-300"
                    >
                      {customerContext?.accountName ?? item.accountName}
                    </button>
                  ) : (
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">
                      {customerContext?.accountName ?? item.accountName}
                    </div>
                  )}
                  {customerContext?.vknMasked && (
                    <div className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                      VKN {customerContext.vknMasked}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {onOpenAccount && (
                    <button
                      type="button"
                      onClick={() => onOpenAccount(item.accountId as string)}
                      title="Müşteri Detayı'na git"
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                    >
                      Detay →
                    </button>
                  )}
                  {/* Müşteriyi değiştir — mevcut linkAccount picker'ını
                      selectedAccountId=item.accountId ile açar; backend
                      linkAccount zaten overwrite ediyor (bkz. caseRepository.js). */}
                  {canLinkAccount && onLinkAccount && (
                    <button
                      type="button"
                      onClick={onLinkAccount}
                      title="Bu vakayı başka bir müşteriye bağla"
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card"
                    >
                      Değiştir
                    </button>
                  )}
                </div>
              </div>
              {/* LBD baseline 1+5 — Çip çorbası → sönük tek satır metin.
                  Tek vurgu: priority Critical olduğunda küçük rose dot inline.
                  Diğerleri (şirket / kod / paket / proje / ürün / supportLevel /
                  non-Critical priority) düz sönük metin "·" ile ayrılır. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-ndark-muted">
                {(() => {
                  const parts: string[] = [];
                  parts.push(item.companyName);
                  if (ctxCompany?.externalCustomerCode) parts.push(`Kod ${ctxCompany.externalCustomerCode}`);
                  if (ctxCompany?.packageName) parts.push(ctxCompany.packageName);
                  if (item.accountProjectName) parts.push(`Proje: ${item.accountProjectName}`);
                  if (item.packageName) parts.push(`Paket: ${item.packageName}`);
                  if (item.productName) parts.push(`Ürün: ${item.productName}`);
                  if (item.supportLevel) parts.push(SUPPORT_LEVEL_LABELS[item.supportLevel] ?? item.supportLevel);
                  // Critical olmayan priority düz metinde göster
                  if (item.priority !== 'Critical') {
                    parts.push(CASE_PRIORITY_LABELS[item.priority] ?? item.priority);
                  }
                  return <span title={parts.join(' · ')}>{parts.join(' · ')}</span>;
                })()}
                {item.priority === 'Critical' && (
                  <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    Kritik
                  </span>
                )}
              </div>
              {ctxCompany?.activeProducts && ctxCompany.activeProducts.length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] font-medium text-slate-400 dark:text-ndark-dim">
                    Aktif Ürünler
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {ctxCompany.activeProducts.slice(0, 6).map((p) => (
                      <Badge key={p.id} tint="teal">
                        <span className="max-w-[140px] truncate">{p.productName}</span>
                        {p.productCode && (
                          <span className="ml-1 font-mono opacity-80">{p.productCode}</span>
                        )}
                      </Badge>
                    ))}
                    {ctxCompany.activeProducts.length > 6 && (
                      <span className="text-[10px] text-slate-500 dark:text-ndark-muted">
                        +{ctxCompany.activeProducts.length - 6}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {accountPhone && (
                <div className="flex items-center gap-1.5 pt-1 text-xs text-slate-600 dark:text-ndark-muted">
                  <Phone size={11} />
                  {accountPhone}
                </div>
              )}
              {accountEmail && (
                <div className="truncate text-[11px] text-slate-500 dark:text-ndark-muted">
                  {accountEmail}
                </div>
              )}
              {accountContact && (
                <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
                  Yetkili: {accountContact}
                  {customerContext?.primaryContact?.title && (
                    <span className="ml-1 text-slate-400 dark:text-ndark-dim">
                      ({customerContext.primaryContact.title})
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div className="min-w-0">
                    <div className="font-medium">Bu vakaya henüz müşteri eşleştirilmedi.</div>
                    {!canLinkAccount && (
                      <div className="mt-0.5 text-[11px] opacity-80">
                        Eşleştirme için Supervisor veya Admin yetkisi gerekir.
                      </div>
                    )}
                  </div>
                </div>
                {canLinkAccount && onLinkAccount && (
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Search size={12} />}
                    onClick={onLinkAccount}
                    className="w-full justify-center border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Manuel müşteri ara
                  </Button>
                )}
              </div>
              {/* Phase D Step 2 — Başvuran bilgileri (müşterisiz intake context). */}
              {(item.customerCompanyName ||
                item.customerContactName ||
                item.customerContactPhone ||
                item.customerContactEmail) && (
                <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-700 dark:border-ndark-border dark:text-ndark-text">
                  <div className="mb-1 font-medium text-slate-500 dark:text-ndark-muted">
                    Başvuran Bilgileri
                  </div>
                  <dl className="space-y-0.5">
                    {item.customerCompanyName && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 dark:text-ndark-muted">Firma</dt>
                        <dd className="truncate">{item.customerCompanyName}</dd>
                      </div>
                    )}
                    {item.customerContactName && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 dark:text-ndark-muted">Ad Soyad</dt>
                        <dd className="truncate">{item.customerContactName}</dd>
                      </div>
                    )}
                    {item.customerContactPhone && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 dark:text-ndark-muted">Telefon</dt>
                        <dd className="truncate">{item.customerContactPhone}</dd>
                      </div>
                    )}
                    {item.customerContactEmail && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-500 dark:text-ndark-muted">E-posta</dt>
                        <dd className="truncate">{item.customerContactEmail}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Phase D Step 2 — Önerilen müşteriler. Yalnız Supervisor+. */}
              {canLinkAccount && onConfirmLinkSuggestion && (
                <CustomerMatchSuggestionsPanel
                  caseId={item.id}
                  onConfirmLink={onConfirmLinkSuggestion}
                />
              )}
            </div>
          )}
        </div>
      </PanelSection>

      {/* Customer Pulse — müşterinin geniş durumu (Roadmap §"Customer Context
          Intelligence"). Self-fetch; hata olursa case detail bozulmaz. */}
      <CustomerPulsePanel source={{ kind: 'case', caseId: item.id }} metricsLayout="summary" />

      <PanelSection title="SLA Durumu" icon={<Clock size={12} />}>
        <div className="space-y-2 text-xs">
          {/* Yanıt SLA */}
          <div className="space-y-1">
            <SlaRow label="Yanıt SLA" value={item.slaResponseDueAt ? formatDateTime(item.slaResponseDueAt) : '—'} />
            {item.slaResponseDueAt && (
              item.status !== 'Açık' ? (
                <div className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 ring-1 ring-emerald-200">
                  <CheckCircle2 size={11} className="mr-1 inline" />
                  Yanıt verildi
                </div>
              ) : new Date(item.slaResponseDueAt) < new Date() ? (
                <div className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-800 ring-1 ring-rose-200">
                  <ShieldAlert size={11} className="mr-1 inline" />
                  Yanıt SLA aşıldı — {formatRelative(item.slaResponseDueAt)}
                </div>
              ) : (
                <div className="rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800 ring-1 ring-sky-200">
                  Yanıta {formatRemaining(item.slaResponseDueAt)}
                </div>
              )
            )}
          </div>

          {/* Çözüm SLA */}
          <div className="space-y-1">
            <SlaRow label="Çözüm SLA" value={item.slaResolutionDueAt ? formatDateTime(item.slaResolutionDueAt) : '—'} />
            {item.slaResolutionDueAt && (
              item.slaViolation ? (
                <div className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-800 ring-1 ring-rose-200">
                  <ShieldAlert size={11} className="mr-1 inline" />
                  SLA İhlali — {formatRelative(item.slaResolutionDueAt)}
                </div>
              ) : item.status !== 'Çözüldü' && item.status !== 'İptalEdildi' && !item.slaPausedAt ? (
                <div className="rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800 ring-1 ring-sky-200">
                  Çözüme {formatRemaining(item.slaResolutionDueAt)}
                </div>
              ) : null
            )}
          </div>

          {/* Duraklatma */}
          {(item.slaPausedAt || item.slaPausedDurationMin > 0) && (
            <div className="space-y-1">
              {item.slaPausedDurationMin > 0 && (
                <SlaRow label="Duraklatma" value={`${item.slaPausedDurationMin} dk`} />
              )}
              {item.slaPausedAt && (
                <div className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-200">
                  Şu an duraklıyor — {formatRelative(item.slaPausedAt)}
                </div>
              )}
            </div>
          )}
        </div>
      </PanelSection>

      {/* "Atama" PanelSection (Vaka Sahibi / Takım / Eskalasyon) görsel
          arayüzden kaldırıldı. "Üstlen" butonu (WR-C1) header'a, Kaydet'in
          yanına taşındı — artık burada render edilmiyor. */}

      {/* FAZ 2 Collab — izleyiciler. LBD A6: Agent rolünde gizli, diğer
          tüm rollerde (Supervisor/Backoffice/CSM/Admin/SystemAdmin) görünür.
          Self-watch + Supervisor başkasını ekleyebilir. */}
      {userRole !== 'Agent' && (
        <WatchersPanel caseId={item.id} assignedPersonId={item.assignedPersonId ?? null} />
      )}

      {/* LBD A7: "Hızlı Aksiyonlar" PanelSection kaldırıldı.
          Aksiyonların erişim noktası:
            - Çağrı Başlat → header "Çağrı Başlat" butonu
            - Devret → header "Devret" butonu
            - Hızlı Not / Tüm not akışı → Notlar sekmesi
          Header aksiyonları KALDI (kullanıcı hızlı erişim istedi). */}
    </div>
  );

  return (
    <>
      <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/40 p-4 lg:block">
        {content}
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={onCloseDrawer} />
          <aside className="absolute left-0 top-0 h-full w-[320px] overflow-y-auto bg-white p-4 shadow-xl dark:bg-ndark-bg">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-ndark-muted">Müşteri Özeti</span>
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Müşteri özeti panelini kapat"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card"
              >
                ✕
              </button>
            </div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * Faz 3 — Case.aiKeyPoints DB'de JSON array<string> string olarak tutulur
 * (MSSQL JSON tip yok — customFields aynı pattern). Parse hatası sessiz
 * fallback: boş array. Non-array veya non-string element → filtre.
 */
function parseAiKeyPoints(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

function RightPanel({
  item,
  offeredSolutions,
  onCaseUpdated,
}: {
  item: Case;
  offeredSolutions: { id: string; name: string }[];
  onCaseUpdated: (updated: Case) => void;
}) {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [churnAnalyzing, setChurnAnalyzing] = useState(false);
  const [churnResult, setChurnResult] = useState<ChurnConversion | null>(null);
  const [converting, setConverting] = useState(false);

  // Vaka değişince churn preview state'ini sıfırla
  useEffect(() => {
    setChurnResult(null);
  }, [item.id]);

  async function handleAnalyze() {
    setAnalyzing(true);
    // Faz 1 — caseId tabanlı. Backend zengin sinyalleri (Smart Ticket +
    // Çözüm Adımları + Müşteri durumu + Devir + Ürün + son 3 çağrı +
    // resolutionNote) PII guard'lı select'lerle kendisi toplar.
    const r = await aiService.supervisorSummary({ caseId: item.id });
    if (!r.ok) {
      setAnalyzing(false);
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
      return;
    }
    // Faz 2 — supervisor-summary çıktısının persist edilen 5 alanı.
    // Eski 2 alan (aiSummary, aiFollowupRecommendation) korunur; yeni 3 alan
    // (aiRiskLevel, aiKeyPoints, aiConfidenceScore) Faz 3 schema'sıyla
    // birlikte gelir. confidence opsiyonel — eski çağrı cache'inden
    // dönerse undefined olur, payload'a yazılmaz (Partial<Case>).
    const updated = await caseService.update(item.id, {
      aiSummary: r.data.summary,
      aiFollowupRecommendation: r.data.recommendation,
      aiRiskLevel: r.data.riskLevel,
      aiKeyPoints: JSON.stringify(r.data.keyPoints ?? []),
      ...(typeof r.data.confidence === 'number'
        ? { aiConfidenceScore: r.data.confidence }
        : {}),
    });
    setAnalyzing(false);
    if (updated) {
      onCaseUpdated(updated);
      toast({ type: 'success', message: 'Vaka analizi tamamlandı.', duration: 2000 });
    }
  }

  async function handleChurnAnalysis() {
    setChurnAnalyzing(true);
    const r = await aiService.churnConversion({
      case: { title: item.title, companyName: item.companyName, accountName: item.accountName },
      callLogs: item.callLogs,
      financialStatus: item.financialStatus,
      productUsage: item.productUsage,
      usageChangeAlert: item.usageChangeAlert,
    });
    setChurnAnalyzing(false);
    if (r.ok) {
      setChurnResult(r.data);
    } else {
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
    }
  }

  async function handleConvertToChurn() {
    if (!churnResult) return;
    if (!window.confirm('Vakayı Churn tipine dönüştürmek istediğinizden emin misiniz?')) return;
    setConverting(true);
    const updated = await caseService.update(item.id, {
      caseType: 'Churn',
      aiRetentionOfferSuggestion: churnResult.suggestedAction,
    });
    setConverting(false);
    if (updated) {
      onCaseUpdated(updated);
      toast({ type: 'success', message: 'Vaka Churn tipine dönüştürüldü.', duration: 2200 });
    }
  }

  return (
    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/40 p-4 xl:block">
      <div className="space-y-4">
        {/* RUNA AI — Vaka özeti / analiz.
            Faz 3 — riskLevel rozeti + keyPoints liste persist edilen
            alanlardan okunur. aiKeyPoints DB'de JSON array<string> string
            tutulur; parse hatası sessiz fallback (boş array). */}
        <RunaAiCard
          title={item.aiSummary ? 'Vaka Özeti' : 'RUNA AI Hazır'}
          body={item.aiSummary ?? 'Bu vaka için henüz AI analizi yapılmadı.'}
          isLoading={analyzing}
          riskLevel={item.aiRiskLevel ?? null}
          keyPoints={parseAiKeyPoints(item.aiKeyPoints)}
          badges={
            item.aiConfidenceScore != null
              ? [`%${Math.round(item.aiConfidenceScore * 100)} güven`]
              : []
          }
          primaryAction={
            !analyzing
              ? {
                  label: item.aiSummary ? '✦ Yeniden Analiz Et' : '✦ Analiz Et',
                  onClick: () => void handleAnalyze(),
                }
              : undefined
          }
        />

        {/* AI ek detaylar (varsa) — RUNA AI'ın altında ek context olarak */}
        {(item.aiCategoryPrediction ||
          item.aiPriorityPrediction ||
          item.aiCallBrief ||
          item.aiFollowupRecommendation ||
          item.aiRetentionOfferSuggestion ||
          item.aiRejectReason) && (
          <PanelSection title="AI Detayları" icon={<Brain size={12} />}>
            <div className="space-y-3 text-xs">
              {(item.aiCategoryPrediction || item.aiPriorityPrediction) && (
                <div className="grid grid-cols-2 gap-2">
                  <AiTile
                    label="Kategori önerisi"
                    value={item.aiCategoryPrediction ?? '—'}
                    tint="indigo"
                  />
                  <AiTile
                    label="Öncelik önerisi"
                    value={item.aiPriorityPrediction ?? '—'}
                    tint="indigo"
                  />
                </div>
              )}
              {item.aiCallBrief && (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                  <div className="mb-1 text-[10px] font-medium text-slate-500">
                    Çağrı Özeti
                  </div>
                  {item.aiCallBrief}
                </div>
              )}
              {item.aiFollowupRecommendation && (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                  <div className="mb-1 text-[10px] font-medium text-slate-500">
                    Takip Önerisi
                  </div>
                  {item.aiFollowupRecommendation}
                </div>
              )}
              {item.aiRetentionOfferSuggestion && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200">
                  <div className="mb-1 text-[10px] font-medium text-rose-700">
                    Retention Teklif Önerisi
                  </div>
                  {item.aiRetentionOfferSuggestion}
                </div>
              )}
              {item.aiRejectReason && (
                <div className="rounded-md bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                  <strong>Önceki red:</strong> {item.aiRejectReason}
                </div>
              )}
            </div>
          </PanelSection>
        )}

        {/* QA Skor — Faz 1.5 Madde 4. Kapatılmış vakada AI değerlendirmesi varsa göster. */}
        {item.qaScoredAt && item.qaEmpathyScore != null && (
          <PanelSection title="AI QA Skoru" icon={<Star size={12} />} tint="amber">
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 gap-1.5">
                <QaScorePill label="Empati" value={item.qaEmpathyScore} />
                <QaScorePill label="Netlik" value={item.qaClarityScore ?? 0} />
                <QaScorePill label="Hız" value={item.qaSpeedScore ?? 0} />
              </div>
              {item.qaFeedback && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/40">
                  {item.qaFeedback}
                </p>
              )}
              <div className="text-[10px] text-slate-400 dark:text-ndark-muted">
                {formatRelative(item.qaScoredAt)} skorlanmış
              </div>
            </div>
          </PanelSection>
        )}

        {item.caseType === 'ProactiveTracking' && (
          <>
            <PanelSection title="Proaktif Takip" icon={<TrendingDown size={12} />} tint="violet">
              <div className="space-y-1 text-xs">
                <Row label="Finansal Risk"      value={item.financialStatus ?? '—'} />
                <Row label="Ürün Kullanımı"     value={item.productUsage ?? '—'} />
                <Row label="Kullanım Trendi"    value={item.usageChangeAlert ?? '—'} />
                <Row label="Müdahale Önceliği"  value={item.responseLevel ?? '—'} />
                <Row label="Toplam Çağrı"       value={String(item.callLogs.length)} />
              </div>
            </PanelSection>

            {/* RUNA AI — Churn risk değerlendirmesi */}
            <RunaAiCard
              title="Churn Risk Değerlendirmesi"
              body={
                churnResult?.reasoning ??
                'Churn riskini değerlendirmek için analiz başlatın. Finansal durum, ürün kullanımı ve arama geçmişi incelenir.'
              }
              badges={
                churnResult
                  ? [
                      `Risk: ${churnResult.churnRisk}`,
                      churnResult.shouldConvert ? 'Dönüşüm önerilir' : 'Bekle',
                    ]
                  : []
              }
              isLoading={churnAnalyzing}
              primaryAction={
                !churnResult && !churnAnalyzing
                  ? { label: '✦ Değerlendir', onClick: () => void handleChurnAnalysis() }
                  : undefined
              }
              dangerAction={
                churnResult?.shouldConvert
                  ? {
                      label: converting ? 'Dönüştürülüyor…' : "Churn'e Dönüştür",
                      onClick: () => void handleConvertToChurn(),
                      disabled: converting,
                    }
                  : undefined
              }
              secondaryAction={
                churnResult
                  ? { label: 'Yeniden', onClick: () => void handleChurnAnalysis() }
                  : undefined
              }
            />
          </>
        )}

        {item.caseType === 'Churn' && (
          <PanelSection title="Churn Yönetimi" icon={<Wallet size={12} />} tint="rose">
            <div className="space-y-2 text-xs">
              <Row label="İptal Talebi"    value={item.cancellationRequest ? 'Var' : 'Yok'} />
              <Row label="Teklif Sonucu"   value={item.offerOutcome ?? '—'} />
              <Row label="Churn Sonucu"    value={item.churnResult ?? '—'} />
              <Row label="Retention"       value={item.retentionStatus ?? '—'} />
              {item.followUpDate && (
                <Row label="Takip Tarihi" value={formatDateTime(item.followUpDate)} />
              )}
              {item.offeredSolutions && item.offeredSolutions.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[10px] font-medium text-rose-700">
                    Sunulan Teklifler
                  </div>
                  {item.offeredSolutions.map((id) => {
                    const def = offeredSolutions.find((o) => o.id === id);
                    return (
                      <div key={id} className="rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-rose-200">
                        {def?.name ?? id}
                      </div>
                    );
                  })}
                </div>
              )}
              {item.offerRejectionReason && (
                <div className="rounded-md bg-rose-50 px-2 py-1.5 text-rose-900 ring-1 ring-rose-200">
                  <div className="text-[10px] font-medium text-rose-700">
                    Red Gerekçesi
                  </div>
                  {item.offerRejectionReason}
                </div>
              )}
            </div>
          </PanelSection>
        )}
      </div>
    </aside>
  );
}

// Customer Pulse component shared module'a taşındı:
// src/features/cases/components/CustomerPulsePanel.tsx
// CaseDetailPage <CustomerPulsePanel source={{ kind: 'case', caseId }} />
// NewCaseForm <CustomerPulsePanel source={{ kind: 'account', accountId, companyId }} />


// ──────────────────────────────────────────────────────────────
// Watcher header badge — kullanıcı bu vakanın izleyicisiyse status
// pill'inin yanında "İzliyorsunuz" göstergesi. Self-fetch + custom
// event ile WatchersPanel ile senkron.
// ──────────────────────────────────────────────────────────────

function WatcherHeaderBadge({ caseId }: { caseId: string }) {
  const { user } = useAuth();
  const [isWatching, setIsWatching] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsWatching(false);
      return;
    }
    let alive = true;
    async function check() {
      const watchers = await caseService.listWatchers(caseId);
      if (alive && user) setIsWatching(watchers.some((w) => w.userId === user.id));
    }
    void check();

    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ caseId?: string }>).detail;
      if (!detail || detail.caseId === caseId) void check();
    };
    window.addEventListener('app:watcher-changed', onChanged);
    return () => {
      alive = false;
      window.removeEventListener('app:watcher-changed', onChanged);
    };
  }, [caseId, user]);

  if (!isWatching) return null;
  return (
    <Badge tint="violet" icon={<Eye size={11} />}>
      İzliyorsunuz
    </Badge>
  );
}

// ──────────────────────────────────────────────────────────────
// Watchers panel — FAZ 2 Collab. LeftPanel'in altında, ATAMA section'undan
// hemen sonra. Self-watch toggle + Supervisor başkalarını ekleyebilir.
// ──────────────────────────────────────────────────────────────

function WatchersPanel({
  caseId,
  assignedPersonId,
}: {
  caseId: string;
  assignedPersonId: string | null;
}) {
  const { user } = useAuth();
  const [watchers, setWatchers] = useState<import('./types').CaseWatcherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Yetki: başkasını ekleyebilen kullanıcı?
  // Supervisor+ her zaman; Agent yalnız atanmış olduğu vakaya başkasını ekleyebilir.
  const elevated = !!user && ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role);
  const isAssignedOwner = !!user?.personId && assignedPersonId === user.personId;
  const canAddOthers = elevated || isAssignedOwner;

  async function reload() {
    setLoading(true);
    const rows = await caseService.listWatchers(caseId);
    setWatchers(rows);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const meWatching = !!user && watchers.some((w) => w.userId === user.id);

  function dispatchChanged() {
    // Header'daki badge'in tazelenmesi için sinyal
    window.dispatchEvent(new CustomEvent('app:watcher-changed', { detail: { caseId } }));
  }

  async function toggleSelf() {
    if (!user || busy) return;
    setBusy(true);
    if (meWatching) {
      const r = await caseService.removeWatcher(caseId, user.id);
      if (r) {
        setWatchers((ws) => ws.filter((w) => w.userId !== user.id));
        dispatchChanged();
      }
    } else {
      const r = await caseService.addWatcher(caseId, user.id);
      if (r) {
        await reload();
        dispatchChanged();
      }
    }
    setBusy(false);
  }

  async function removeWatcher(userId: string) {
    if (busy) return;
    setBusy(true);
    const r = await caseService.removeWatcher(caseId, userId);
    if (r) {
      setWatchers((ws) => ws.filter((w) => w.userId !== userId));
      dispatchChanged();
    }
    setBusy(false);
  }

  return (
    <PanelSection title="İzleyiciler" icon={<Eye size={12} />}>
      {loading ? (
        <div className="space-y-1.5">
          <Skeleton height={12} width="60%" />
          <Skeleton height={12} width="80%" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Avatar stack — max 5, +N more rozet */}
          {watchers.length === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Henüz izleyici yok.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {watchers.slice(0, 5).map((w) => {
                const canRemove = (user?.id === w.userId) || elevated;
                return (
                  <button
                    key={w.userId}
                    type="button"
                    onClick={canRemove ? () => removeWatcher(w.userId) : undefined}
                    disabled={!canRemove || busy}
                    title={canRemove ? `${w.userName} — Kaldır` : w.userName}
                    className={
                      'rounded-full ring-2 ring-white transition dark:ring-ndark-card ' +
                      (canRemove ? 'hover:scale-105 hover:ring-rose-300' : 'cursor-default')
                    }
                  >
                    <NoteAvatar name={w.userName} size={28} />
                  </button>
                );
              })}
              {watchers.length > 5 && (
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-medium text-slate-600 ring-2 ring-white dark:bg-ndark-bg dark:text-ndark-muted dark:ring-ndark-card"
                  title={watchers.slice(5).map((w) => w.userName).join(', ')}
                >
                  +{watchers.length - 5}
                </span>
              )}
              {canAddOthers && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  disabled={busy}
                  title="İzleyici Ekle"
                  aria-label="İzleyici Ekle"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 transition hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ndark-border dark:text-ndark-muted dark:hover:border-brand-500"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          )}

          {/* Self-watch toggle */}
          <button
            type="button"
            onClick={toggleSelf}
            disabled={busy || !user}
            className={
              'inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ' +
              (meWatching
                ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg')
            }
          >
            {meWatching ? (
              <>
                <Eye size={12} /> İzliyorum
              </>
            ) : (
              <>
                <Eye size={12} /> İzle
              </>
            )}
          </button>

          {addOpen && canAddOthers && (
            <AddWatcherModal
              open={addOpen}
              caseId={caseId}
              existingUserIds={new Set(watchers.map((w) => w.userId))}
              onClose={() => setAddOpen(false)}
              onAdded={async () => {
                setAddOpen(false);
                await reload();
              }}
            />
          )}
        </div>
      )}
    </PanelSection>
  );
}

function AddWatcherModal({
  open,
  caseId,
  existingUserIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  caseId: string;
  existingUserIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [candidates, setCandidates] = useState<import('./types').MentionableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void caseService.listMentionableUsers(caseId).then((rows) => {
      setCandidates(rows.filter((c) => !existingUserIds.has(c.userId)));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLocaleLowerCase('tr').includes(q) ||
        c.email.toLocaleLowerCase('tr').includes(q),
    );
  }, [candidates, query]);

  async function pick(userId: string) {
    setSubmitting(userId);
    const r = await caseService.addWatcher(caseId, userId);
    setSubmitting(null);
    if (r) {
      window.dispatchEvent(new CustomEvent('app:watcher-changed', { detail: { caseId } }));
      toast({ type: 'success', message: 'İzleyici eklendi.', duration: 1800 });
      onAdded();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="İzleyici Ekle" size="md">
      <div className="space-y-3">
        <TextInput
          autoFocus
          placeholder="İsim veya e-posta ile ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading ? (
          <div className="space-y-1.5">
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="70%" />
            <Skeleton height={14} width="75%" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-ndark-muted">
            {candidates.length === 0
              ? 'Eklenebilecek kullanıcı yok.'
              : 'Bu aramaya uyan kullanıcı bulunamadı.'}
          </p>
        ) : (
          <ul className="max-h-[320px] space-y-1 overflow-y-auto">
            {filtered.map((c) => (
              <li key={c.userId}>
                <button
                  type="button"
                  onClick={() => pick(c.userId)}
                  disabled={!!submitting}
                  className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:bg-brand-50 hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-card dark:hover:bg-brand-950/20"
                >
                  <NoteAvatar name={c.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {c.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-ndark-muted">
                      {c.teamName ?? '—'} · {c.email}
                    </span>
                  </span>
                  {submitting === c.userId && (
                    <Loader2 size={14} className="animate-spin text-brand-500" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────
// Links tab — FAZ 2 Collab. AI öneri kartı (auto-load) + gruplanmış
// link listesi (Related / Parent / Duplicate). "Vaka Bağla" modalı.
// ──────────────────────────────────────────────────────────────

type LinkTypeMeta = { label: string; icon: React.ReactNode; pill: string };
const LINK_TYPE_META: Record<import('./types').CaseLinkType, LinkTypeMeta> = {
  Related: {
    label: 'İlişkili Vakalar',
    icon: <LinkIcon size={14} className="text-blue-600 dark:text-blue-400" />,
    pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  Parent: {
    label: 'Üst Vaka',
    icon: <LinkIcon size={14} className="text-emerald-600 dark:text-emerald-400" />,
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  Duplicate: {
    label: 'Mükerrer',
    icon: <LinkIcon size={14} className="text-amber-600 dark:text-amber-400" />,
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
};

function LinksTab({
  item,
  onShowCase,
}: {
  item: Case;
  onShowCase: (caseId: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<import('./types').LinkedCaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<import('./types').LinkSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiErrored, setAiErrored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  const elevated = !!user && ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role);
  const isOwner = !!user?.personId && item.assignedPersonId === user.personId;
  const canRemove = elevated || isOwner;

  async function reload() {
    setLoading(true);
    const rows = await caseService.listLinks(item.id);
    setLinks(rows);
    setLoading(false);
  }

  async function loadAi() {
    setAiLoading(true);
    setAiErrored(false);
    const r = await aiService.suggestLinks(item.id);
    setAiLoading(false);
    if (r.ok) setSuggestions(r.data.suggestions);
    else setAiErrored(true);
  }

  useEffect(() => {
    void reload();
    void loadAi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function addLink(linkedCaseId: string, linkType: import('./types').CaseLinkType) {
    setBusy(true);
    const r = await caseService.addLink(item.id, linkedCaseId, linkType);
    setBusy(false);
    if (r) {
      toast({ type: 'success', message: 'Bağlantı eklendi.', duration: 1500 });
      await reload();
      // AI önerisini de tazelen (uygulanan vaka tekrar önerilmesin)
      setSuggestions((prev) => prev.filter((s) => s.caseId !== linkedCaseId));
    }
  }

  async function removeLink(linkId: string) {
    setBusy(true);
    const r = await caseService.removeLink(item.id, linkId);
    setBusy(false);
    if (r) {
      toast({ type: 'success', message: 'Bağlantı kaldırıldı.', duration: 1500 });
      setLinks((ls) => ls.filter((l) => l.linkId !== linkId));
    }
  }

  // Linkleri tip bazında grupla — render sırası: Related → Parent → Duplicate
  const groups: import('./types').CaseLinkType[] = ['Related', 'Parent', 'Duplicate'];
  const grouped = useMemo(() => {
    const m: Record<string, import('./types').LinkedCaseEntry[]> = {
      Related: [], Parent: [], Duplicate: [],
    };
    for (const l of links) m[l.linkType]?.push(l);
    return m;
  }, [links]);

  return (
    <div className="space-y-4">
      {/* AI öneri kartı */}
      <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
        <header className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-violet-900 dark:text-violet-200">
            <Sparkles size={12} />
            RUNA AI Benzer Vakalar
          </h3>
          <button
            type="button"
            onClick={loadAi}
            disabled={aiLoading}
            className="rounded p-1 text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-900/40"
            title="Benzer vakaları yeniden analiz et"
            aria-label="Benzer vakaları yeniden analiz et"
          >
            <RefreshCw size={12} />
          </button>
        </header>

        {aiLoading ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-violet-800 dark:text-violet-200">
            <Loader2 size={12} className="animate-spin" />
            Analiz ediliyor…
          </div>
        ) : aiErrored ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert size={12} />
            AI önerisi alınamadı. Manuel "Vaka Bağla" ile ekleyebilirsiniz.
          </p>
        ) : suggestions.length === 0 ? (
          <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">
            Önerilecek benzer vaka bulunamadı.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {suggestions.map((s) => {
              const meta = LINK_TYPE_META[s.linkType];
              const conf = Math.round(s.confidence * 100);
              return (
                <li
                  key={s.caseId}
                  className="rounded-md border border-violet-100 bg-white px-3 py-2 dark:border-violet-900/40 dark:bg-ndark-card"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <button
                      type="button"
                      onClick={() => onShowCase(s.caseId)}
                      className="font-mono text-xs text-slate-600 underline-offset-2 hover:text-brand-700 hover:underline dark:text-ndark-muted"
                    >
                      {s.caseNumber}
                    </button>
                    <span className="truncate text-sm text-slate-800 dark:text-ndark-text">
                      {s.title}
                    </span>
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}
                    >
                      {meta.label.replace(' Vakalar', '')}
                    </span>
                    <span className="text-[10px] tabular-nums text-violet-700 dark:text-violet-300">
                      %{conf}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] italic text-slate-600 dark:text-ndark-muted">
                    "{s.reason}"
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addLink(s.caseId, s.linkType)}
                      disabled={busy}
                    >
                      Bağla
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSuggestions((prev) => prev.filter((x) => x.caseId !== s.caseId))
                      }
                    >
                      Yoksay
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Existing links — gruplandırılmış */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-slate-600 dark:text-ndark-muted">
            Mevcut Bağlantılar
          </h3>
          <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setLinkModalOpen(true)}>
            Vaka Bağla
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton height={36} width="100%" />
            <Skeleton height={36} width="100%" />
          </div>
        ) : links.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-ndark-muted">
            Bu vakaya bağlı vaka yok.
          </p>
        ) : (
          groups.map((t) => {
            const items = grouped[t];
            if (items.length === 0) return null;
            const meta = LINK_TYPE_META[t];
            return (
              <div key={t}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-ndark-text">
                  {meta.icon}
                  <span>{meta.label}</span>
                  <span className="text-[10px] text-slate-500 dark:text-ndark-muted">
                    ({items.length})
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {items.map((l) => (
                    <li
                      key={l.linkId}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-ndark-border dark:bg-ndark-card"
                    >
                      <button
                        type="button"
                        onClick={() => l.linkedCase && onShowCase(l.linkedCase.id)}
                        disabled={!l.linkedCase}
                        className="font-mono text-xs text-slate-600 underline-offset-2 hover:text-brand-700 hover:underline disabled:cursor-not-allowed dark:text-ndark-muted"
                      >
                        {l.linkedCase?.caseNumber ?? '?'}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-ndark-text">
                        {l.linkedCase?.title ?? '(silinmiş vaka)'}
                      </span>
                      {l.linkedCase && (
                        <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
                          {l.linkedCase.status}
                        </span>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => removeLink(l.linkId)}
                          disabled={busy}
                          className="text-[11px] font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
                        >
                          Kaldır
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {linkModalOpen && (
        <LinkCaseModal
          open={linkModalOpen}
          item={item}
          onClose={() => setLinkModalOpen(false)}
          onAdded={async () => {
            setLinkModalOpen(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

const LINK_TYPE_DESCRIPTIONS: Record<import('./types').CaseLinkType, string> = {
  Related: 'Genel ilişkili — aynı müşteri başka konu, aynı ürün vs.',
  Duplicate: 'Aynı sorun — iki yön de otomatik bağlanır.',
  Parent: 'Bu vaka, hedef vakanın bir parçası/alt-kırılımı.',
};

function LinkCaseModal({
  open,
  item,
  onClose,
  onAdded,
}: {
  open: boolean;
  item: Case;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Case[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Case | null>(null);
  const [linkType, setLinkType] = useState<import('./types').CaseLinkType>('Related');
  const [submitting, setSubmitting] = useState(false);
  // Aynı müşteri için açılış suggestion'ı
  const [initialList, setInitialList] = useState<Case[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelected(null);
      setLinkType('Related');
      return;
    }
    // Açılışta aynı müşterinin son vakalarını öner
    void caseService
      .findByAccount(item.accountId, { excludeId: item.id })
      .then((rows) => setInitialList(rows.slice(0, 10)));
  }, [open, item.accountId, item.id]);

  // Search debounce — number/title
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      const data = await caseService.list({ search: q }, { page: 1, pageSize: 10 });
      if (!alive) return;
      setSearching(false);
      setResults(data.items.filter((c) => c.id !== item.id));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [open, query, item.id]);

  async function submit() {
    if (!selected || submitting) return;
    setSubmitting(true);
    const r = await caseService.addLink(item.id, selected.id, linkType);
    setSubmitting(false);
    if (r) {
      toast({ type: 'success', message: 'Bağlantı eklendi.', duration: 1500 });
      onAdded();
    }
  }

  const visible = query.trim().length >= 2 ? results : initialList;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vaka Bağla"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button size="sm" onClick={submit} disabled={!selected || submitting}>
            {submitting ? 'Ekleniyor…' : 'Bağla'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Vaka Ara" hint="Vaka no, başlık veya müşteri ile ara (min. 2 karakter)">
          <TextInput
            autoFocus
            placeholder="örn. VK-... veya kategori adı"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>

        {searching ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
            <Loader2 size={12} className="animate-spin" />
            Aranıyor…
          </div>
        ) : visible.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-500 dark:text-ndark-muted">
            {query.trim().length >= 2 ? 'Eşleşen vaka yok.' : 'Bu müşteri için başka vaka yok.'}
          </p>
        ) : (
          <ul className="max-h-[240px] space-y-1 overflow-y-auto">
            {visible.map((c) => {
              const isSelected = selected?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c)}
                    className={
                      'flex w-full items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition ' +
                      (isSelected
                        ? 'border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-card dark:hover:bg-brand-950/20')
                    }
                  >
                    <span className="font-mono text-xs">{c.caseNumber}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
                      {c.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected && (
          <Field label="Bağlantı Tipi" required>
            <div className="space-y-1.5">
              {(['Related', 'Duplicate', 'Parent'] as import('./types').CaseLinkType[]).map((t) => {
                const meta = LINK_TYPE_META[t];
                const active = linkType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setLinkType(t)}
                    className={
                      'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition ' +
                      (active
                        ? 'border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                        : 'border-slate-200 bg-white hover:border-brand-300 dark:border-ndark-border dark:bg-ndark-card')
                    }
                  >
                    <span className="mt-0.5">{meta.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 dark:text-ndark-text">
                        {meta.label.replace(' Vakalar', '')}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-ndark-muted">
                        {LINK_TYPE_DESCRIPTIONS[t]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────
// Status Report Modal — paydaşlara gönderilebilecek mail-ready
// vaka durum raporu. Header toolbar'dan tetiklenir.
// Modal açıldığında AI çağrısı tetiklenir; kullanıcı kopyala-kapat
// akışıyla raporu kullanır. Persist edilmez.
// ──────────────────────────────────────────────────────────────

function StatusReportModal({
  open,
  caseId,
  onClose,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<import('./types').ActionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modal açılınca AI çağrısı yap. Kapanınca state'i sıfırla.
  useEffect(() => {
    if (!open) {
      setReport(null);
      setLoading(false);
      setErrored(false);
      setCopied(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErrored(false);
    setReport(null);
    void caseService.getActionSummary(caseId).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r) setReport(r);
      else setErrored(true);
    });
    return () => {
      alive = false;
    };
  }, [open, caseId]);

  async function regenerate() {
    if (loading) return;
    setLoading(true);
    setErrored(false);
    const r = await caseService.getActionSummary(caseId);
    setLoading(false);
    if (r) setReport(r);
    else setErrored(true);
  }

  async function copyToClipboard() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard izni yoksa sessiz kal — spec sadece pozitif feedback ister
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-600 dark:text-violet-400" />
          <span>Durum Raporu</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          {copied && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40">
              <Check size={12} />
              Kopyalandı
            </span>
          )}
          {report && !loading && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<RefreshCw size={12} />}
              onClick={regenerate}
              title="Yenile"
            >
              Yenile
            </Button>
          )}
          <Button
            size="sm"
            leftIcon={<Copy size={12} />}
            onClick={copyToClipboard}
            disabled={!report || loading}
          >
            Kopyala
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 rounded-md bg-violet-50 px-3 py-3 text-sm text-violet-900 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-200 dark:ring-violet-900/40">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          Rapor hazırlanıyor…
        </div>
      )}

      {errored && !loading && (
        <div className="space-y-2">
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40">
            Oluşturulamadı. Tekrar deneyin.
          </p>
          <Button size="sm" variant="outline" onClick={regenerate}>
            Tekrar Dene
          </Button>
        </div>
      )}

      {report && !loading && (
        <div className="space-y-2">
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-xs leading-relaxed text-slate-800 dark:border-ndark-border dark:bg-ndark-bg dark:text-slate-200">
            {report.report}
          </pre>
          <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
            Son üretim: {formatRelative(report.generatedAt)} · {report.eventCount} olay
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Phase D Step 2 — Önerilen müşteriler panel'i.
 *
 * Lazy fetch: customerMatchPending banner'ı altında render olunca öneri çağrısı
 * yapılır. Deterministic skor — AI YOK. Bağlama tıklanınca parent'a confirm +
 * linkAccount akışını delege eder. Auto-link asla yok.
 */
function CustomerMatchSuggestionsPanel({
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

function PanelSection({
  title,
  icon,
  badge,
  children,
  hidden,
  tint = 'default',
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  hidden?: boolean;
  tint?: 'default' | 'violet' | 'rose' | 'amber';
}) {
  if (hidden) return null;
  const ring =
    tint === 'violet' ? 'ring-violet-200 dark:ring-violet-900/40' :
    tint === 'rose'   ? 'ring-rose-200 dark:ring-rose-900/40' :
    tint === 'amber'  ? 'ring-amber-200 dark:ring-amber-900/40' :
                         'ring-slate-200 dark:ring-ndark-border';
  return (
    <section className={`rounded-lg bg-white p-3 ring-1 ring-inset dark:bg-ndark-card ${ring}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* LBD baseline 2 — sentence-case + sönük, ALL CAPS YOK.
            PanelSection bu dosyaya local; başka ekrana yayılmaz. */}
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-ndark-muted">
          {icon}
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      {/* LBD baseline 2 — sentence-case + sönük (Row da bu dosyaya local). */}
      <span className="text-xs text-slate-500 dark:text-ndark-muted">{label}</span>
      <span className="truncate text-right text-slate-800 dark:text-ndark-text">{value}</span>
    </div>
  );
}

function AiTile({
  label,
  value,
  tint = 'slate',
}: {
  label: string;
  value: string;
  tint?: 'slate' | 'indigo';
}) {
  const cls =
    tint === 'indigo'
      ? 'bg-indigo-50 ring-indigo-200 dark:bg-indigo-950/30 dark:ring-indigo-900/40'
      : 'bg-white ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border';
  return (
    <div className={`rounded-md px-2.5 py-2 ring-1 ring-inset ${cls}`}>
      <div className="text-[10px] font-medium text-slate-500 dark:text-ndark-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-ndark-text">{value}</div>
    </div>
  );
}

function QaScorePill({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 4
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/40'
      : value >= 3
      ? 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/40'
      : 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/40';
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ring-1 ring-inset ${tone}`}>
      <div className="text-[9px] font-medium opacity-80">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}/5</div>
    </div>
  );
}

function SlaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px]  text-slate-500">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}

// KpiCompact + KpiMini kaldırıldı — KPI artık Detay sekmesinin üstünde KpiInlineRow ile gösteriliyor

const PRIORITY_CONFIG: {
  value: CasePriority;
  label: string;
  dot: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}[] = [
  {
    value: 'Low',
    label: 'Düşük',
    dot: 'bg-slate-400',
    activeBg: 'bg-slate-100 dark:bg-slate-700/60',
    activeBorder: 'border-slate-400 dark:border-slate-500',
    activeText: 'text-slate-700 dark:text-slate-200',
  },
  {
    value: 'Medium',
    label: 'Orta',
    dot: 'bg-amber-400',
    activeBg: 'bg-amber-50 dark:bg-amber-900/30',
    activeBorder: 'border-amber-400 dark:border-amber-500',
    activeText: 'text-amber-700 dark:text-amber-300',
  },
  {
    value: 'High',
    label: 'Yüksek',
    dot: 'bg-orange-500',
    activeBg: 'bg-orange-50 dark:bg-orange-900/30',
    activeBorder: 'border-orange-500 dark:border-orange-400',
    activeText: 'text-orange-700 dark:text-orange-300',
  },
  {
    value: 'Critical',
    label: 'Kritik',
    dot: 'bg-rose-500',
    activeBg: 'bg-rose-50 dark:bg-rose-900/30',
    activeBorder: 'border-rose-500 dark:border-rose-400',
    activeText: 'text-rose-700 dark:text-rose-300',
  },
];

function PriorityStrip({
  value,
  isDraft,
  disabled,
  onChange,
}: {
  value: CasePriority;
  isDraft: boolean;
  disabled: boolean;
  onChange: (p: CasePriority) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {PRIORITY_CONFIG.map((p) => {
        const isActive = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            onClick={() => { if (!disabled && !isActive) onChange(p.value); }}
            title={`Öncelik: ${p.label}`}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded border py-1 text-xs font-medium transition-colors',
              isActive
                ? `${p.activeBg} ${p.activeBorder} ${p.activeText}`
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted dark:hover:bg-ndark-bg',
              disabled ? 'cursor-default opacity-60' : 'cursor-pointer',
              isDraft && isActive ? 'ring-1 ring-offset-1 ring-brand-400' : '',
            ].join(' ')}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} aria-hidden="true" />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// Açıklama alanı — uzun metinlerde "Devamını oku" göster; kısa metinlerde
// buton hiç render edilmez (CaseSolutionStepsPanel'deki overflow-ölçüm
// pattern'iyle aynı: scrollHeight > clientHeight ise kırpılmış demektir).
function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    const measure = () => {
      if (!expanded) {
        setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  return (
    <div>
      <p
        ref={ref}
        className={`whitespace-pre-wrap text-sm text-slate-700 ${!expanded ? 'line-clamp-6' : ''}`}
      >
        {text}
      </p>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((current) => !current);
          }}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {expanded ? 'Daralt' : 'Devamını oku'}
        </button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Tab Components
// ----------------------------------------------------------------

function DetailTab({
  item,
  offeredSolutions,
  categories,
  teams,
  persons,
  thirdParties,
  catalogPackages,
  catalogProducts,
  previousCases,
  onSelectPrevious,
  drafts,
  editingField,
  fieldStates,
  onStartEdit,
  onCancelEdit,
  onCommitDraft,
  onTransitionApplied,
  kbEnabled,
  onCaseUpdated,
}: {
  item: Case;
  offeredSolutions: { id: string; name: string }[];
  categories: { category: string; subCategories: string[] }[];
  teams: { id: string; name: string }[];
  persons: { id: string; name: string; teamId: string }[];
  thirdParties: { id: string; name: string }[];
  catalogPackages: Array<{ id: string; code: string; name: string; supportLevel: SupportLevel }>;
  catalogProducts: Array<{
    id: string;
    code: string;
    name: string;
    supportLevel: SupportLevel;
    productGroupId: string;
  }>;
  previousCases: Case[];
  onSelectPrevious: (id: string) => void;
  drafts: Partial<Case>;
  editingField: string | null;
  fieldStates: FieldStateMap;
  onStartEdit: (field: string) => void;
  onCancelEdit: () => void;
  onCommitDraft: (field: keyof Case, value: unknown) => void;
  onTransitionApplied: (updated: Case) => void;
  /** L2-Smart-Flow FAZ 1 — tenant KB kapısı (null = yükleniyor). */
  kbEnabled: boolean | null;
  /** Akıllı Tanımlar kaydı sonrası güncel Case'i üst state'e yaz. */
  onCaseUpdated: (updated: Case) => void;
}) {
  // PR-D3 — case-write yetkili rol set'i. DevOps section'da Bağla/Kaldır
  // gating'i için kullanılır. Backend'de PATCH /:id ile aynı kapı
  // (allowedCompanyIds scope; explicit requireRole yok), UI sadece
  // görünürlüğü düşürür — sızıntı yok.
  const { user } = useAuth();
  const canWriteCase =
    !!user && ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'].includes(user.role);

  // Kategori cascade — taslakta seçili kategoriye göre alt-kategori opsiyonları
  const activeCategory = (drafts.category ?? item.category) as string;
  const subCategoryOptions = categories.find((c) => c.category === activeCategory)?.subCategories ?? [];
  // Takım cascade — seçili takıma göre kişi opsiyonları
  const activeTeamId = (drafts.assignedTeamId ?? item.assignedTeamId) as string | undefined;
  const personOptions = activeTeamId ? persons.filter((p) => p.teamId === activeTeamId) : persons;
  // Aktif değer = pending draft varsa onu göster, yoksa item değeri
  const v = <K extends keyof Case>(key: K): Case[K] =>
    (drafts[key] !== undefined ? drafts[key] : item[key]) as Case[K];
  const fieldState = (fieldKey: string) => fieldStates[fieldKey] ?? DEFAULT_AUTHZ_FIELD_STATE;
  const canShowField = (fieldKey: string) => fieldState(fieldKey).visible !== false;
  const canReadField = (fieldKey: string) => fieldState(fieldKey).readable !== false;
  const canEditField = (fieldKey: string) => fieldState(fieldKey).editable !== false;
  const isMaskedField = (fieldKey: string) => fieldState(fieldKey).masked === true;
  const maskedDisplay = <span className="text-slate-400">••••••</span>;
  const displayValue = (fieldKey: string, node: React.ReactNode) => (
    canReadField(fieldKey) ? (isMaskedField(fieldKey) ? maskedDisplay : node) : maskedDisplay
  );

  // Atama & eskalasyon kartı — Sınıflandırma kartındakiyle aynı iki katmanlı
  // kompakt tasarım. İkincil katman varsayılan kapalı; içindeki bir alan
  // doldurulunca üst (her zaman görünen) bölüme otomatik taşınır.
  const [showOtherAssignment, setShowOtherAssignment] = useState(false);

  // Devir Notu — en son aktarımın notu, Açıklama'nın hemen altında.
  // Stale guard CaseSolutionStepsPanel.tsx'teki reqIdRef/caseIdRef pattern'iyle
  // aynı mantık: CaseDetailPage breadcrumb/önceki-vaka navigasyonuyla aynı
  // instance üzerinde item.id'yi değiştirebiliyor (unmount olmadan), eski
  // case'in transfer yanıtı geç gelirse yeni case panelinde görünmemeli.
  // transferCount bağımlılığı şart — "Devret" item.id'yi değiştirmez, sadece
  // transferCount'u increment eder; bu olmadan Devret sonrası not anında
  // güncellenmez.
  const [latestTransfer, setLatestTransfer] = useState<CaseTransferRecord | null>(null);
  const transferReqIdRef = useRef(0);
  const transferCaseIdRef = useRef(item.id);

  useEffect(() => {
    const reqId = ++transferReqIdRef.current;
    transferCaseIdRef.current = item.id;
    setLatestTransfer(null);
    void caseService.listTransfers(item.id).then((list) => {
      if (reqId !== transferReqIdRef.current || transferCaseIdRef.current !== item.id) return;
      if (list.length === 0) return;
      const sorted = [...list].sort(
        (a, b) => new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime(),
      );
      const latest = sorted[0];
      if (latest.reasonLabel || latest.reason) setLatestTransfer(latest);
    });
  }, [item.id, item.transferCount]);

  // Sınıflandırma kartı — iki katmanlı kompakt tasarım. İkincil katman
  // ("Diğer sınıflandırma bilgileri") varsayılan kapalı; açılınca tüm
  // ikincil alanları gösterir (ayrı bir "tümünü göster" anahtarı yok).
  const [showOtherClassification, setShowOtherClassification] = useState(false);

  // WR-Smart-Ticket UX fix 1 — "Çözüm Adımları" panel'i artık Detay body'sinde
  // değil; kendi tab'inde (Case Detail tab listinin son sırasında, tüm
  // vakalar için). Bu sayede L2/L3 ekipleri ve non-Smart-Ticket vakalar
  // için ikincil troubleshooting yüzeyi olarak çalışır.

  return (
    <div className="space-y-5">
      {/* Statü Geçişi artık sticky header'da CompactStatusStepper olarak duruyor.
          Reason zorunlu geçişler StatusTransitionPanel'i modal içinde reuse eder;
          burada geniş kart grid'i render edilmez. */}

      {/* Adım-2: ResolutionApprovalCard + CommunicationDispatchCard kalan
          koşullu bloklar grubuna (Atama'nın altına) taşındı.
          Aksiyonel önemleri var → grubun başında konumlanır. */}

      {/* Cila-1 (madde #5) — "Alanlara tıklayarak düzenleyebilirsiniz…"
          statik notu kaldırıldı. Edit cue'lar (Cila-4'te chevron + hover
          pencil) bu bilgiyi taşıyacak. */}

      {/* Adım-1: KpiInlineRow buradan çıkarıldı — content band'a (status'un
          altına, tab nav'ın üstüne) <KpiSummaryStrip> olarak taşındı.
          Tab içeriğinin ilk öğesi artık Açıklama'ya yaklaşıyor (Adım-2). */}

      {/* Öncelik şeridi + Açıklama — sıkı grup (space-y-2).
          -mt-4: tab wrapper p-6 üst padding'ini 8px'e indirir (alt boşlukla eşit). */}
      {(canShowField('priority') || canShowField('description')) && (
        <div className="-mt-4 space-y-2">
          {canShowField('priority') && (
            <PriorityStrip
              value={(v('priority') as CasePriority) ?? item.priority}
              isDraft={drafts.priority !== undefined}
              disabled={!canEditField('priority') || !canReadField('priority') || isMaskedField('priority')}
              onChange={(p) => onCommitDraft('priority', p)}
            />
          )}

          {canShowField('description') && (
            <Section title="Açıklama">
              <InlineEdit
                fieldKey="description"
                type="textarea"
                value={v('description') ?? ''}
                editing={editingField === 'description'}
                isDraft={drafts.description !== undefined}
                onStart={() => onStartEdit('description')}
                onCommit={(val) => onCommitDraft('description', val)}
                onCancel={onCancelEdit}
                disabled={!canEditField('description') || !canReadField('description') || isMaskedField('description')}
                renderDisplay={(val) => displayValue('description', <ExpandableDescription text={String(val ?? '—')} />)}
              />
            </Section>
          )}
        </div>
      )}

      {/* Devir Notu — en son "Devret" aktarımının notu, Açıklama'nın hemen
          altında. Hiç devir yapılmamışsa veya not boşsa render edilmez. */}
      {latestTransfer && (
        <Section title="Devir Notu">
          <div className="rounded-md bg-slate-50/60 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 border-l-2 border-violet-400 dark:bg-ndark-bg/30 dark:text-ndark-text dark:ring-ndark-border">
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="text-slate-700 line-through decoration-slate-300 dark:text-ndark-muted">
                {latestTransfer.fromTeamName ?? '—'}
                {latestTransfer.fromPersonName ? ` - ${latestTransfer.fromPersonName}` : ''}
              </span>
              <span className="text-slate-400">→</span>
              <span className="text-slate-800 dark:text-ndark-text">
                {latestTransfer.toTeamName ?? '—'}
                {latestTransfer.toPersonName ? ` - ${latestTransfer.toPersonName}` : ''}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs italic text-violet-800 dark:text-violet-300">
              Gerekçe: {latestTransfer.reasonLabel
                ? `${latestTransfer.reasonLabel} — ${latestTransfer.reason}`
                : latestTransfer.reason}
            </p>
          </div>
        </Section>
      )}

      {/* L2-Smart-Flow FAZ 1 — Akıllı Tanımlar kartı (Devir Notu'nun altı,
          kullanıcı kararı). 5'li açılış sınıflandırması: göster + düzenle +
          KB analiz. Tenant kapısı kart içinde (kbEnabled); açılış chip'leri
          artık BURADA yaşar — SmartTicketMetaSection kapanış-only oldu. */}
      {canShowField('smartTicketMeta') && canReadField('smartTicketMeta') && !isMaskedField('smartTicketMeta') && (
        <SmartClassificationCard
          item={item}
          kbEnabled={kbEnabled}
          canEdit={canWriteCase && canEditField('smartTicketMeta')}
          onUpdated={onCaseUpdated}
        />
      )}

      {/* Adım-2 — Çözüm Notu Açıklama'nın hemen ALTINDA (problem → çözüm).
          Yeni stil: emerald sol-şerit + nötr arka plan (PR-B sakin dili).
          Boşsa render edilmez. */}
      {item.resolutionNote && canShowField('resolutionNote') && (
        <Section title="Çözüm Notu">
          <div className="rounded-md bg-slate-50/60 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 border-l-2 border-emerald-400 dark:bg-ndark-bg/30 dark:text-ndark-text dark:ring-ndark-border">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={11} />
              Çözüm
            </div>
            <p className="whitespace-pre-wrap">
              {displayValue('resolutionNote', item.resolutionNote)}
            </p>
          </div>
        </Section>
      )}

      {/* Business review Madde 4 (PR-4) → L2-Smart-Flow FAZ 1 revizyonu:
          açılış kategorileri artık SmartClassificationCard'da (yukarıda,
          düzenlenebilir). Bu bölüm KAPANIŞ etiketleri chip'lerini gösterir
          (hideOpening) — FAZ 2'de kapanış da düzenlenebilir olacak. */}
      {canShowField('smartTicketMeta') && canReadField('smartTicketMeta') && !isMaskedField('smartTicketMeta') && (
        <SmartTicketMetaSection item={item} hideOpening />
      )}

      {/* Adım-3: Müşteri geçmiş vakaları tam liste — ilk 10 + "Hepsini gör" toggle.
          previousCases mevcut findByAccount fetch'inden gelir (yeni istek yok).
          Mevcut vaka filtrelendi; en yeni üstte (resolvedAt ?? updatedAt DESC).
          Boş durumda worded empty. */}
      <PreviousCasesSection
        previousCases={previousCases}
        currentCaseId={item.id}
        onSelectPrevious={onSelectPrevious}
      />

      {/* PR-D3 — Azure DevOps İş Öğeleri.
          Backend ALLOWLIST guard'lı (16 alan). Read role-gate ile arşivli case
          için SystemAdmin görür, diğer roller 404. Bağla/Kaldır case-write. */}
      <DevOpsSection caseId={item.id} canWrite={canWriteCase} />

      {/* Adım-2 #5 — "Müşteri & Sınıflandırma" → "Sınıflandırma":
          Şirket/Müşteri sol panelde zaten var (duplikasyon kaldırıldı).
          Cila-4 #2 — "operable" structured variant: hafif başlık şeridi +
          bg-white içerik + hairline çerçeve + sıkı ızgara. */}
      {(() => {
        const primaryClassificationItems = [
          { fieldKey: 'category', label: 'Kategori', icon: Layers, node: (
            <InlineEdit
              fieldKey="category"
              type="select"
              value={v('category') ?? ''}
              editing={editingField === 'category'}
              isDraft={drafts.category !== undefined}
              onStart={() => onStartEdit('category')}
              onCommit={(val) => onCommitDraft('category', val)}
              onCancel={onCancelEdit}
              disabled={!canEditField('category') || !canReadField('category') || isMaskedField('category')}
              options={categories.map((c) => ({ value: c.category, label: c.category }))}
              renderDisplay={(val) => displayValue('category', <span className="text-sm text-slate-800">{String(val || '—')}</span>)}
            />
          )},
          { fieldKey: 'subCategory', label: 'Alt Kategori', icon: Box, node: (
            <InlineEdit
              fieldKey="subCategory"
              type="select"
              value={v('subCategory') ?? ''}
              editing={editingField === 'subCategory'}
              isDraft={drafts.subCategory !== undefined}
              onStart={() => onStartEdit('subCategory')}
              onCommit={(val) => onCommitDraft('subCategory', val)}
              onCancel={onCancelEdit}
              options={[{ value: '', label: '— Seçin —' }, ...subCategoryOptions.map((s) => ({ value: s, label: s }))]}
              disabled={!activeCategory || !canEditField('subCategory') || !canReadField('subCategory') || isMaskedField('subCategory')}
              renderDisplay={(val) => displayValue('subCategory', <span className="text-sm text-slate-800">{String(val || '—')}</span>)}
            />
          )},
          { fieldKey: 'requestType', label: 'Talep Türü', icon: ListChecks, node: (
            <InlineEdit
              fieldKey="requestType"
              type="select"
              value={v('requestType')}
              editing={editingField === 'requestType'}
              isDraft={drafts.requestType !== undefined}
              onStart={() => onStartEdit('requestType')}
              onCommit={(val) => onCommitDraft('requestType', val)}
              onCancel={onCancelEdit}
              disabled={!canEditField('requestType') || !canReadField('requestType') || isMaskedField('requestType')}
              options={CASE_REQUEST_TYPES.map((r) => ({ value: r, label: r }))}
              renderDisplay={(val) => displayValue('requestType', <span className="text-sm text-slate-800">{String(val || '—')}</span>)}
            />
          )},
          { fieldKey: 'origin', label: 'Origin', icon: Workflow, node: (
            <InlineEdit
              fieldKey="origin"
              type="select"
              value={v('origin')}
              editing={editingField === 'origin'}
              isDraft={drafts.origin !== undefined}
              onStart={() => onStartEdit('origin')}
              onCommit={(val) => onCommitDraft('origin', val)}
              onCancel={onCancelEdit}
              disabled={!canEditField('origin') || !canReadField('origin') || isMaskedField('origin')}
              options={CASE_ORIGINS.map((o) => ({ value: o, label: o }))}
              renderDisplay={(val) => displayValue('origin', <span className="text-sm text-slate-800">{String(val || '—')}</span>)}
            />
          )},
        ].filter((i) => canShowField(i.fieldKey));

        // WR-A7b — Catalog Paket/Ürün inline edit; renderDisplay'in kullandığı
        // aynı id/name çözümlemesi burada da reuse edilir.
        const packageDisplayId = (drafts.packageId as string | null | undefined) ?? item.packageId ?? null;
        const productDisplayId = (drafts.productId as string | null | undefined) ?? item.productId ?? null;
        const thirdPartyDisplayName = (drafts.thirdPartyName as string | undefined) ?? item.thirdPartyName;
        const isBlankValue = (val: unknown) =>
          val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '—';

        const secondaryClassificationItems = [
          { label: 'Ürün Grubu', icon: Boxes, isEmpty: isBlankValue(v('productGroup')), node: (
            <InlineEdit
              fieldKey="productGroup"
              type="select"
              value={v('productGroup') ?? ''}
              editing={editingField === 'productGroup'}
              isDraft={drafts.productGroup !== undefined}
              onStart={() => onStartEdit('productGroup')}
              onCommit={(val) => onCommitDraft('productGroup', val)}
              onCancel={onCancelEdit}
              options={[{ value: '', label: '— Seçin —' }, ...lookupService.productGroups().map((p) => ({ value: p, label: p }))]}
            />
          )},
          // WR-A7b — Catalog Paket inline edit. BFF DI.3/4/5 enforce eder; role gate
          // (Supervisor/Admin/SystemAdmin) BFF tarafında, UI 403 ise toast gösterir.
          { label: 'Paket', icon: Package, isEmpty: !packageDisplayId && !item.packageName, node: (
            <InlineEdit
              fieldKey="packageId"
              type="select"
              value={(v('packageId') as string | null | undefined) ?? ''}
              editing={editingField === 'packageId'}
              isDraft={drafts.packageId !== undefined}
              onStart={() => onStartEdit('packageId')}
              onCommit={(val) => onCommitDraft('packageId', val || null)}
              onCancel={onCancelEdit}
              options={[
                { value: '', label: '— Paket Yok —' },
                ...catalogPackages.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
              ]}
              renderDisplay={() => (
                <span className="text-sm text-slate-800">
                  {(() => {
                    if (!packageDisplayId) return item.packageName ?? '—';
                    const found = catalogPackages.find((p) => p.id === packageDisplayId);
                    return found ? `${found.name} (${found.code})` : item.packageName ?? packageDisplayId;
                  })()}
                </span>
              )}
            />
          )},
          // WR-A7b — Catalog Ürün inline edit. BFF DI.2 enforce; role gate
          // (Supervisor/CSM/Admin/SystemAdmin) BFF tarafında.
          { label: 'Ürün', icon: ShoppingBag, isEmpty: !productDisplayId && !item.productName, node: (
            <InlineEdit
              fieldKey="productId"
              type="select"
              value={(v('productId') as string | null | undefined) ?? ''}
              editing={editingField === 'productId'}
              isDraft={drafts.productId !== undefined}
              onStart={() => onStartEdit('productId')}
              onCommit={(val) => onCommitDraft('productId', val || null)}
              onCancel={onCancelEdit}
              options={(() => {
                const pid =
                  (drafts.packageId as string | null | undefined) ?? item.packageId ?? null;
                // Paket seçiliyse o pakete bağlı ürünleri öncelikle göster (cascade filter UI hint).
                // Tüm ürünleri yine yedek olarak sun ki paketsiz ürün de eklenebilsin.
                return [
                  { value: '', label: '— Ürün Yok —' },
                  ...catalogProducts.map((p) => ({
                    value: p.id,
                    label:
                      `${p.name} (${p.code})` +
                      (pid && p.id ? '' : '') /* paket filtresi UI yardımı; backend katı değil */,
                  })),
                ];
              })()}
              renderDisplay={() => (
                <span className="text-sm text-slate-800">
                  {(() => {
                    if (!productDisplayId) return item.productName ?? '—';
                    const found = catalogProducts.find((p) => p.id === productDisplayId);
                    return found ? `${found.name} (${found.code})` : item.productName ?? productDisplayId;
                  })()}
                </span>
              )}
            />
          )},
          { label: 'Origin Açıklama', icon: FileText, isEmpty: isBlankValue(v('originDescription')), node: (
            <InlineEdit
              fieldKey="originDescription"
              type="text"
              value={v('originDescription')}
              editing={editingField === 'originDescription'}
              isDraft={drafts.originDescription !== undefined}
              onStart={() => onStartEdit('originDescription')}
              onCommit={(val) => onCommitDraft('originDescription', String(val))}
              onCancel={onCancelEdit}
              disabled={v('origin') !== 'Diğer'}
              placeholder={v('origin') === 'Diğer' ? 'Origin = Diğer için zorunlu' : 'Yalnızca origin = Diğer'}
            />
          )},
          { label: '3. Parti Bekleniyor', icon: Building2, isEmpty: isBlankValue(thirdPartyDisplayName), node: (
            <InlineEdit
              fieldKey="thirdPartyId"
              type="select"
              value={v('thirdPartyId') ?? ''}
              editing={editingField === 'thirdPartyId'}
              isDraft={drafts.thirdPartyId !== undefined}
              onStart={() => onStartEdit('thirdPartyId')}
              onCommit={(val) => onCommitDraft('thirdPartyId', val)}
              onCancel={onCancelEdit}
              options={[{ value: '', label: '— Yok —' }, ...thirdParties.map((tp) => ({ value: tp.id, label: tp.name }))]}
              renderDisplay={() => (
                <span className="text-sm text-slate-800">{thirdPartyDisplayName ?? '—'}</span>
              )}
            />
          )},
        ];

        // Kompakt tek satır düzeni: "İkon Label: değer" — yalnız bu kartta.
        // EditableGrid'in dt/dd dikey istifi burada kullanılmıyor (alan
        // tasarrufu için); InlineEdit davranışı/propları değişmedi.
        // Doldurulmuş ikincil alanlar (Paket, Ürün vb.) artık üst (her zaman
        // açık) bölüme taşınır — "Diğer sınıflandırma bilgileri" katlanabilir
        // kısmı yalnız HENÜZ BOŞ olan ikincil alanları barındırır.
        const filledSecondary = secondaryClassificationItems.filter((i) => !i.isEmpty);
        const emptySecondary = secondaryClassificationItems.filter((i) => i.isEmpty);

        return (
          <Section title="Sınıflandırma" variant="structured">
            <div className="grid grid-cols-1 gap-x-3 gap-y-0 sm:grid-cols-2">
              {primaryClassificationItems.map((i) => (
                <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                  <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                  <span className="shrink-0 text-[11px] font-medium text-slate-500">{i.label}:</span>
                  <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                </div>
              ))}
              {filledSecondary.map((i) => (
                <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                  <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                  <span className="shrink-0 text-[11px] font-medium text-slate-500">{i.label}:</span>
                  <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                </div>
              ))}
            </div>
            {emptySecondary.length > 0 && (
              <div className="mt-0.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowOtherClassification((s) => !s)}
                  className="flex w-full items-center gap-1 px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${showOtherClassification ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                  Diğer sınıflandırma bilgileri
                </button>
                {showOtherClassification && (
                  <div className="grid grid-cols-1 gap-x-3 gap-y-0 sm:grid-cols-2">
                    {emptySecondary.map((i) => (
                      <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                        <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                        <span className="shrink-0 text-[11px] font-medium text-slate-500">{i.label}:</span>
                        <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        );
      })()}

      {/* Atama & eskalasyon — sol panelden bağımsız, inline-edit'li alanlar.
          Cila-4 #2 — structured variant (hafif başlık şeridi + bg-white +
          sıkı ızgara). Sol panel okuma özeti; merkez edit. */}
      <Section title="Atama & eskalasyon" variant="structured">
        {(() => {
          const assignedTeamName = (drafts.assignedTeamName as string | undefined) ?? item.assignedTeamName;
          const assignedPersonName = (drafts.assignedPersonName as string | undefined) ?? item.assignedPersonName;

          const primaryAssignmentItems = [
            ...(item.status === 'Eskalasyon' ? [{ label: 'Eskalasyon', icon: AlertTriangle, node: (
              <InlineEdit
                fieldKey="escalationLevel"
                type="select"
                value={v('escalationLevel')}
                editing={editingField === 'escalationLevel'}
                isDraft={drafts.escalationLevel !== undefined}
                onStart={() => onStartEdit('escalationLevel')}
                onCommit={(val) => onCommitDraft('escalationLevel', val)}
                onCancel={onCancelEdit}
                options={ESCALATION_LEVELS.filter((l) => l !== 'Yok').map((l) => ({ value: l, label: ESCALATION_LEVEL_LABELS[l] }))}
                renderDisplay={() => (
                  <span className="text-sm text-slate-800">
                    {ESCALATION_LEVEL_LABELS[(drafts.escalationLevel as EscalationLevel | undefined) ?? item.escalationLevel]}
                  </span>
                )}
              />
            )}] : []),
            { label: 'Vaka Sahibi', icon: UserCheck, node: (
              <span className="block cursor-default text-sm text-slate-800" title="Vakayı açan kullanıcı">{item.createdByName ?? '—'}</span>
            )},
          ];

          const secondaryAssignmentItems = [
            { label: 'Atanan Takım', icon: Users, isEmpty: !assignedTeamName, node: (
              <InlineEdit
                fieldKey="assignedTeamId"
                type="select"
                value={v('assignedTeamId') ?? ''}
                editing={editingField === 'assignedTeamId'}
                isDraft={drafts.assignedTeamId !== undefined}
                onStart={() => onStartEdit('assignedTeamId')}
                onCommit={(val) => onCommitDraft('assignedTeamId', val)}
                onCancel={onCancelEdit}
                options={[{ value: '', label: '— Atanmadı —' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                renderDisplay={() => (
                  assignedTeamName ? (
                    <span className="text-sm text-slate-800">{assignedTeamName}</span>
                  ) : (
                    <span className="text-sm italic text-slate-400">Atanmadı</span>
                  )
                )}
              />
            )},
            { label: 'Atanan Kişi', icon: User, isEmpty: !assignedPersonName, node: (
              <InlineEdit
                fieldKey="assignedPersonId"
                type="select"
                value={v('assignedPersonId') ?? ''}
                editing={editingField === 'assignedPersonId'}
                isDraft={drafts.assignedPersonId !== undefined}
                onStart={() => onStartEdit('assignedPersonId')}
                onCommit={(val) => onCommitDraft('assignedPersonId', val)}
                onCancel={onCancelEdit}
                options={[
                  { value: '', label: activeTeamId ? '— Atanmadı —' : '— Önce takım seçin —' },
                  ...personOptions.map((p) => ({ value: p.id, label: p.name })),
                ]}
                disabled={!activeTeamId}
                renderDisplay={() => (
                  assignedPersonName ? (
                    <span className="text-sm text-slate-800">{assignedPersonName}</span>
                  ) : (
                    <span className="text-sm italic text-slate-400">Atanmadı</span>
                  )
                )}
              />
            )},
          ];

          const filledSecondaryAssignment = secondaryAssignmentItems.filter((i) => !i.isEmpty);
          const emptySecondaryAssignment = secondaryAssignmentItems.filter((i) => i.isEmpty);

          return (
            <>
              <div className="grid grid-cols-1 gap-x-3 gap-y-0 sm:grid-cols-2">
                {filledSecondaryAssignment.map((i) => (
                  <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                    <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                    <span className="shrink-0 text-xs font-medium text-slate-500">{i.label}:</span>
                    <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                  </div>
                ))}
                {primaryAssignmentItems.map((i) => (
                  <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                    <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                    <span className="shrink-0 text-xs font-medium text-slate-500">{i.label}:</span>
                    <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                  </div>
                ))}
              </div>
              {emptySecondaryAssignment.length > 0 && (
                <div className="mt-0.5 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowOtherAssignment((s) => !s)}
                    className="flex w-full items-center gap-1 px-1.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${showOtherAssignment ? 'rotate-90' : ''}`}
                      aria-hidden
                    />
                    Diğer atama bilgileri
                  </button>
                  {showOtherAssignment && (
                    <div className="grid grid-cols-1 gap-x-3 gap-y-0 sm:grid-cols-2">
                      {emptySecondaryAssignment.map((i) => (
                        <div key={i.label} className="flex items-center gap-1 px-1.5 py-0.5">
                          <i.icon size={12} className="shrink-0 text-slate-400" aria-hidden />
                          <span className="shrink-0 text-xs font-medium text-slate-500">{i.label}:</span>
                          <div className="min-w-0 flex-1 text-sm">{i.node}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </Section>

      {/* FAZ 4 — Kontrol Listesi (3-tuple template'inden snapshot, vaka açılırken yüklenir) */}
      {item.checklistItems && item.checklistItems.length > 0 && (
        <ChecklistSection item={item} onCaseUpdated={onTransitionApplied} />
      )}

      {item.caseType === 'ProactiveTracking' && (
        <Section title="Proaktif Takip Bilgileri" tint="violet">
          <EditableGrid
            rows={[
              { label: 'Finansal Risk', node: (
                <InlineEdit
                  fieldKey="financialStatus" type="select" value={v('financialStatus')}
                  editing={editingField === 'financialStatus'}
                  isDraft={drafts.financialStatus !== undefined}
                  onStart={() => onStartEdit('financialStatus')}
                  onCommit={(val) => onCommitDraft('financialStatus', val)}
                  onCancel={onCancelEdit}
                  options={FINANCIAL_STATUSES.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Ürün Kullanımı', node: (
                <InlineEdit
                  fieldKey="productUsage" type="select" value={v('productUsage')}
                  editing={editingField === 'productUsage'}
                  isDraft={drafts.productUsage !== undefined}
                  onStart={() => onStartEdit('productUsage')}
                  onCommit={(val) => onCommitDraft('productUsage', val)}
                  onCancel={onCancelEdit}
                  options={PRODUCT_USAGES.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Kullanım Trendi', node: (
                <InlineEdit
                  fieldKey="usageChangeAlert" type="select" value={v('usageChangeAlert')}
                  editing={editingField === 'usageChangeAlert'}
                  isDraft={drafts.usageChangeAlert !== undefined}
                  onStart={() => onStartEdit('usageChangeAlert')}
                  onCommit={(val) => onCommitDraft('usageChangeAlert', val)}
                  onCancel={onCancelEdit}
                  options={USAGE_CHANGE_ALERTS.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Müdahale Önceliği', node: (
                <InlineEdit
                  fieldKey="responseLevel" type="select" value={v('responseLevel')}
                  editing={editingField === 'responseLevel'}
                  isDraft={drafts.responseLevel !== undefined}
                  onStart={() => onStartEdit('responseLevel')}
                  onCommit={(val) => onCommitDraft('responseLevel', val)}
                  onCancel={onCancelEdit}
                  options={RESPONSE_LEVELS.map((s) => ({ value: s, label: s }))}
                />
              )},
            ]}
          />
        </Section>
      )}

      {item.caseType === 'Churn' && (
        <Section title="Churn Yönetimi" tint="rose">
          <EditableGrid
            rows={[
              { label: 'İptal Talebi', node: (
                <InlineEdit
                  fieldKey="cancellationRequest" type="checkbox" value={v('cancellationRequest')}
                  editing={editingField === 'cancellationRequest'}
                  isDraft={drafts.cancellationRequest !== undefined}
                  onStart={() => onStartEdit('cancellationRequest')}
                  onCommit={(val) => onCommitDraft('cancellationRequest', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? 'Var' : 'Yok'}</span>}
                />
              )},
              { label: 'Teklif Sonucu', node: (
                <InlineEdit
                  fieldKey="offerOutcome" type="select" value={v('offerOutcome')}
                  editing={editingField === 'offerOutcome'}
                  isDraft={drafts.offerOutcome !== undefined}
                  onStart={() => onStartEdit('offerOutcome')}
                  onCommit={(val) => onCommitDraft('offerOutcome', val)}
                  onCancel={onCancelEdit}
                  options={[{ value: '', label: '—' }, ...OFFER_OUTCOMES.map((o) => ({ value: o, label: o }))]}
                />
              )},
              { label: 'Teklif Geçerlilik', node: (
                <InlineEdit
                  fieldKey="offerExpiryDate" type="date" value={v('offerExpiryDate')}
                  editing={editingField === 'offerExpiryDate'}
                  isDraft={drafts.offerExpiryDate !== undefined}
                  onStart={() => onStartEdit('offerExpiryDate')}
                  onCommit={(val) => onCommitDraft('offerExpiryDate', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? formatDateTime(String(val)) : '—'}</span>}
                />
              )},
              { label: 'Takip Tarihi', node: (
                <InlineEdit
                  fieldKey="followUpDate" type="date" value={v('followUpDate')}
                  editing={editingField === 'followUpDate'}
                  isDraft={drafts.followUpDate !== undefined}
                  onStart={() => onStartEdit('followUpDate')}
                  onCommit={(val) => onCommitDraft('followUpDate', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? formatDateTime(String(val)) : '—'}</span>}
                />
              )},
              { label: 'Churn Sonucu', node: <span className="px-2 py-1 text-sm text-slate-800">{item.churnResult ?? '—'}</span> },
              { label: 'Retention Durumu', node: <span className="px-2 py-1 text-sm text-slate-800">{item.retentionStatus ?? '—'}</span> },
            ]}
          />

          <div className="mt-3 grid grid-cols-1 gap-2">
            <div>
              <h4 className="mb-1 text-[11px] font-medium text-slate-500">
                Yapılan Aksiyon
              </h4>
              <InlineEdit
                fieldKey="actionTaken" type="textarea" value={v('actionTaken') ?? ''}
                editing={editingField === 'actionTaken'}
                isDraft={drafts.actionTaken !== undefined}
                onStart={() => onStartEdit('actionTaken')}
                onCommit={(val) => onCommitDraft('actionTaken', String(val))}
                onCancel={onCancelEdit}
                renderDisplay={(val) => (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{val ? String(val) : <span className="text-slate-400">— eklenmemiş —</span>}</p>
                )}
              />
            </div>
            {(v('offerOutcome') === 'Reddedildi' || drafts.offerOutcome === 'Reddedildi') && (
              <div>
                <h4 className="mb-1 text-[11px] font-medium text-rose-700">
                  Red Gerekçesi
                </h4>
                <InlineEdit
                  fieldKey="offerRejectionReason" type="textarea" value={v('offerRejectionReason') ?? ''}
                  editing={editingField === 'offerRejectionReason'}
                  isDraft={drafts.offerRejectionReason !== undefined}
                  onStart={() => onStartEdit('offerRejectionReason')}
                  onCommit={(val) => onCommitDraft('offerRejectionReason', String(val))}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => (
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{val ? String(val) : <span className="text-slate-400">— eklenmemiş —</span>}</p>
                  )}
                />
              </div>
            )}
          </div>

          {/* Sunulan Teklifler — her zaman görünür; ekle/çıkar butonları taslağa yazar */}
          <OfferedSolutionsBlock
            currentIds={(v('offeredSolutions') ?? []) as string[]}
            options={offeredSolutions}
            isDraft={drafts.offeredSolutions !== undefined}
            onChange={(newIds) => onCommitDraft('offeredSolutions', newIds)}
          />
        </Section>
      )}

      {/* Adım-2 #4 — "SLA & Tarihler" Section kaldırıldı. KPI/SLA şeridi
          (status bandı altı) tek kaynak; tarih duplikasyonu yok.
          SLA Duraklatıldı / Toplam Pause özel detaylar şu an gizlendi —
          ihtiyaç olursa Aktivite tab'ında zaten history satırlarında görünür. */}

      {/* Çözüm Notu Adım-2 #2 ile Açıklama'nın hemen ALTINA taşındı —
          bu konumdan kaldırıldı. */}

      {/* Kalan koşullu bloklar — Atama'nın altına grup olarak.
          Önemli/aksiyonel olanlar başta: Approval → Dispatch → KB/SmartTicket. */}

      {/* WR-D4 Phase 1 — Çözüm Onayı kartı (yalnız eşleşen politika varsa) */}
      <ResolutionApprovalCard
        item={item}
        onApprovalChanged={() => {
          void caseService.get(item.id).then((c) => {
            if (c) onTransitionApplied(c);
          });
        }}
      />

      {/* WR-D4 Phase 2 — İletişim bildirimleri (yalnız bu vakaya dispatch varsa) */}
      <CommunicationDispatchCard
        item={item}
        onChanged={() => {
          void caseService.get(item.id).then((c) => {
            if (c) onTransitionApplied(c);
          });
        }}
      />

      {/* Madde 2 — KB Teknik Devir Notu + Müşteri Yanıt Taslağı.
          KbDraftCard customFields.smartTicket.aiDrafts varsa render eder;
          aksi takdirde null döner (klasik vakalar etkilenmez). */}
      <KbDraftSection item={item} />

      {item.cancellationReason && (
        <Section title="İptal Gerekçesi">
          <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
            {item.cancellationReason}
          </p>
        </Section>
      )}

      {/* Adım-2: Önceki Vakalar bloğu Sınıflandırma'nın altına taşındı —
          bu konumdan kaldırıldı. */}

      {/* Custom Fields — şirket FieldDefinition'larına göre dinamik */}
      <CustomFieldsCaseSection item={item} onCommitDraft={onCommitDraft} drafts={drafts} />
    </div>
  );
}

// ----------------------------------------------------------------
// Custom Fields — vakanın bağlı olduğu şirketin FieldDefinition'larını
// gösterir; inline edit ile değer güncellenir, drafts üzerinden Kaydet'e kadar
// commit edilir.
// ----------------------------------------------------------------

function CustomFieldsCaseSection({
  item,
  drafts,
  onCommitDraft,
}: {
  item: Case;
  drafts: Partial<Case>;
  onCommitDraft: (field: keyof Case, value: unknown) => void;
}) {
  const allDefs = useMemo(() => lookupService.fieldDefinitions(), []);
  const defs = useMemo(
    () =>
      allDefs
        .filter((d) => d.companyId === item.companyId)
        .filter((d) => d.isActive)
        .filter((d) => !d.caseType || d.caseType === item.caseType)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [allDefs, item.companyId, item.caseType],
  );

  if (defs.length === 0) return null;

  const currentValues =
    (drafts.customFields as Record<string, unknown> | undefined) ??
    (item.customFields as Record<string, unknown> | undefined) ??
    {};

  function update(fieldKey: string, value: unknown) {
    const next = { ...currentValues, [fieldKey]: value };
    onCommitDraft('customFields', next);
  }

  return (
    <Section title="Dinamik Alanlar" tint="default">
      <div className="space-y-3 px-3 py-3">
        {defs.map((def) => (
          <CustomFieldRenderer
            key={def.id}
            definition={def}
            value={currentValues[def.fieldKey]}
            onChange={(v) => update(def.fieldKey, v)}
          />
        ))}
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------
// Sunulan Teklifler — Churn yönetimindeki çoklu teklif seçim alanı
// ----------------------------------------------------------------

function OfferedSolutionsBlock({
  currentIds,
  options,
  isDraft,
  onChange,
}: {
  currentIds: string[];
  options: { id: string; name: string; description?: string }[];
  isDraft: boolean;
  onChange: (newIds: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleRemove(id: string) {
    onChange(currentIds.filter((x) => x !== id));
  }

  return (
    <>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium text-slate-500">
            Sunulan Teklifler
            {isDraft && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                Taslak
              </span>
            )}
          </h4>
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            + Teklif Sun
          </Button>
        </div>
        {currentIds.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-500">
            Henüz teklif sunulmadı. <strong>+ Teklif Sun</strong> ile listeden seçim yapabilirsiniz.
          </div>
        ) : (
          <ul className="space-y-1">
            {currentIds.map((id) => {
              const def = options.find((o) => o.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md bg-rose-50/60 px-3 py-1.5 text-sm ring-1 ring-rose-200"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800">{def?.name ?? `Bilinmeyen teklif (${id})`}</div>
                    {def?.description && (
                      <div className="truncate text-[11px] text-slate-500">{def.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(id)}
                    className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-700"
                    title="Tekliften çıkar"
                    aria-label={`${def?.name ?? id} teklifini çıkar`}
                  >
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <OfferedSolutionsPickerModal
        open={pickerOpen}
        currentIds={currentIds}
        options={options}
        onClose={() => setPickerOpen(false)}
        onSave={(newIds) => {
          onChange(newIds);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function OfferedSolutionsPickerModal({
  open,
  currentIds,
  options,
  onClose,
  onSave,
}: {
  open: boolean;
  currentIds: string[];
  options: { id: string; name: string; description?: string }[];
  onClose: () => void;
  onSave: (newIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(currentIds);

  // Modal her açılışında mevcut seçimi başlangıç olarak yükle
  useEffect(() => {
    if (open) setSelected(currentIds);
  }, [open, currentIds]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Müşteriye Teklif Sun"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {selected.length} teklif seçildi
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button onClick={() => onSave(selected)}>Uygula</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Müşteriyi tutabilmek için sunulacak retention teklif(ler)ini seçin. Çoklu seçim
          mümkündür; mevcut listeye eklenir/çıkarılır.
        </p>
        {options.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">
            Tanımlı teklif yok. Admin → Teklif Tanımları'ndan ekleyin.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {options.map((o) => {
              const checked = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition ${
                      checked
                        ? 'border-rose-300 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:hover:border-ndark-border dark:hover:bg-ndark-bg'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.id)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800">{o.name}</div>
                      {o.description && (
                        <div className="text-[11px] text-slate-500">{o.description}</div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Kontrol Listesi section — FAZ 4
// 3-tuple match'ten gelen snapshot item'ları gösterir; check/uncheck
// caseService.toggleChecklistItem ile persist edilir, parent'a bildirilir.
// ----------------------------------------------------------------

function ChecklistSection({
  item,
  onCaseUpdated,
}: {
  item: Case;
  onCaseUpdated: (updated: Case) => void;
}) {
  const items = item.checklistItems ?? [];
  const total = items.length;
  const checkedCount = items.filter((i) => i.checked).length;
  const requiredItems = items.filter((i) => i.required);
  const requiredPending = requiredItems.filter((i) => !i.checked).length;
  const allRequiredDone = requiredPending === 0;
  const pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0;

  async function handleToggle(itemId: string, currentlyChecked: boolean) {
    const updated = await caseService.toggleChecklistItem(item.id, itemId, !currentlyChecked);
    if (updated) onCaseUpdated(updated);
  }

  return (
    <Section title="Kontrol Listesi" tint={allRequiredDone ? 'emerald' : 'default'}>
      {/* Progress header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-medium text-slate-800">
            {checkedCount} / {total}
          </span>
          <span>· %{pct} tamamlandı</span>
          {requiredItems.length > 0 && (
            <Badge tint={allRequiredDone ? 'emerald' : 'rose'}>
              {requiredPending === 0
                ? 'Zorunlu maddeler tamam'
                : `${requiredPending} zorunlu eksik`}
            </Badge>
          )}
        </div>
        <div className="hidden sm:block min-w-[120px] flex-1 max-w-[220px]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full transition-all ${allRequiredDone ? 'bg-emerald-500' : 'bg-brand-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 transition ${
              it.checked
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                : it.required
                  ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20'
                  : 'border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card'
            }`}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={it.checked}
              onClick={() => void handleToggle(it.id, it.checked)}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                it.checked
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-slate-300 bg-white hover:border-slate-400 dark:border-ndark-border dark:bg-ndark-card dark:hover:border-ndark-muted'
              }`}
              title={it.checked ? 'İşareti kaldır' : 'Tamamlandı olarak işaretle'}
            >
              {it.checked && <Check size={12} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm ${
                    it.checked ? 'text-slate-500 line-through' : 'text-slate-800'
                  }`}
                >
                  {it.label}
                </span>
                {it.required && !it.checked && (
                  <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-medium text-rose-700">
                    Zorunlu
                  </span>
                )}
              </div>
              {it.checked && it.checkedAt && (
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {it.checkedBy ?? 'Bilinmiyor'} · {formatDateTime(it.checkedAt)}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ----------------------------------------------------------------
// KPI / SLA / tarih birleşik şeridi — Adım-1.
// Status bandının altında, tab nav'ın üstünde, tek satır sönük metin.
// Dağınık 4 kutu yerine kompakt şerit; SLA aşıldı tek kırmızı sinyal
// (sayfada tek SLA göstergesi burası).
// ----------------------------------------------------------------
function KpiSummaryStrip({ item, caseId }: { item: Case; caseId: string }) {
  const minutes = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const fmt = (m: number) => {
    if (m < 60) return `${m} dk`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} sa`;
    return `${Math.round(h / 24)} gün`;
  };
  const firstReview = item.history.find(
    (h) => h.action === 'Statü değişti' && h.toValue === 'İncelemede',
  );
  const responseMin = firstReview ? minutes(item.createdAt, firstReview.at) : null;
  const resolutionMin = item.resolvedAt ? minutes(item.createdAt, item.resolvedAt) : null;
  const fcr = responseMin != null && resolutionMin != null && resolutionMin <= 24 * 60;
  const reopened = item.history.some(
    (h) => h.action === 'Statü değişti' && h.fromValue === 'Çözüldü' && h.toValue === 'YenidenAcildi',
  );

  // Parts: sönük metin parçaları; boş alanlar atlanır (graceful empty).
  const parts: Array<{ key: string; node: React.ReactNode }> = [];
  parts.push({ key: 'opened', node: <>Açılış {formatDateTime(item.createdAt)}</> });
  if (responseMin != null) parts.push({ key: 'response', node: <>Müdahale {fmt(responseMin)}</> });
  if (resolutionMin != null) parts.push({ key: 'resolution', node: <>Çözüm {fmt(resolutionMin)}</> });
  parts.push({
    key: 'fcr',
    node: <>İlk temas {fcr ? 'Evet' : resolutionMin != null ? 'Hayır' : <span className="italic text-slate-400">henüz</span>}</>,
  });
  if (reopened) parts.push({ key: 'reopen', node: <>Y.açılma Var</> });
  if (item.slaResponseDueAt) {
    parts.push({ key: 'slaResp', node: <>Yanıt SLA {formatRelative(item.slaResponseDueAt)}</> });
  }
  if (item.slaResolutionDueAt && !item.slaViolation && !item.slaPausedAt) {
    parts.push({ key: 'slaRes', node: <>Çözüm SLA {formatRelative(item.slaResolutionDueAt)}</> });
  }
  parts.push({ key: 'updated', node: <>Son güncelleme {formatDateTime(item.updatedAt)}</> });
  if (item.resolvedAt) {
    parts.push({ key: 'resolved', node: <>Çözüm {formatDateTime(item.resolvedAt)}</> });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
      {parts.map((p, idx) => (
        <span key={p.key} className="inline-flex items-center gap-2">
          {idx > 0 && <span aria-hidden="true" className="text-slate-300">·</span>}
          <span>{p.node}</span>
        </span>
      ))}
      {/* SLA aşıldı / durdu — tek kırmızı/amber sinyal (sayfada tek SLA göstergesi) */}
      {item.slaViolation && (
        <span className="ml-2 inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400" title="SLA süresi aşıldı">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          SLA aşıldı
        </span>
      )}
      {item.slaPausedAt && (
        <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-300" title="SLA duraklatıldı">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          SLA durdu
        </span>
      )}
      <span className="ml-auto">
        <WatcherHeaderBadge caseId={caseId} />
      </span>
    </div>
  );
}

// ----------------------------------------------------------------
// Inline edit (click-to-edit; ESC/click outside iptal eder; commit draft state'e gider,
// header'daki Kaydet butonu drafts'ı caseService.update ile flush eder)
// ----------------------------------------------------------------
type InlineEditType = 'text' | 'textarea' | 'select' | 'checkbox' | 'date';

function InlineEdit({
  fieldKey,
  type,
  value,
  options,
  editing,
  isDraft,
  onStart,
  onCommit,
  onCancel,
  renderDisplay,
  placeholder,
  disabled,
}: {
  fieldKey: string;
  type: InlineEditType;
  value: unknown;
  options?: { value: string; label: string }[];
  editing: boolean;
  isDraft: boolean;
  onStart: () => void;
  onCommit: (newValue: unknown) => void;
  onCancel: () => void;
  renderDisplay?: (val: unknown) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<unknown>(value);

  // editing açıldığında draft'ı resetle
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (disabled) return;
          e.preventDefault();
          onStart();
        }}
        title={disabled ? '' : `${fieldKey} alanını düzenle`}
        aria-label={disabled ? undefined : `${fieldKey} alanını düzenle`}
        className={`group relative w-full rounded-md border text-left transition ${
          disabled
            ? 'cursor-default border-transparent'
            : 'cursor-pointer border-transparent hover:border-slate-200 hover:bg-slate-50'
        } ${isDraft ? 'border-amber-300 bg-amber-50' : ''}`}
      >
        <span className="block px-2 py-1 pr-7">
          {renderDisplay ? renderDisplay(value) : (value ? String(value) : <span className="text-slate-400">—</span>)}
        </span>
        {!disabled && !isDraft && (
          // Cila-4 — edit cue: type === 'select' ise ChevronDown ipucu
          // (kalıcı opacity-60 + hover'da full); diğer tiplerde Pencil hover.
          type === 'select' ? (
            <ChevronDown
              size={12}
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 opacity-60 transition-opacity group-hover:opacity-100"
            />
          ) : (
            <Pencil
              size={12}
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100"
            />
          )
        )}
        {isDraft && (
          <span className="absolute right-1 top-1 rounded bg-amber-200 px-1 text-[9px] font-semibold text-amber-900">
            taslak
          </span>
        )}
      </button>
    );
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && type !== 'textarea' && !(e.shiftKey)) {
      e.preventDefault();
      onCommit(draft);
    }
  }

  // Aktif edit durumunda kullanılan ✓ ve ✗ butonları
  const editControls = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-role="commit-draft"
        onMouseDown={(e) => {
          e.preventDefault();
          onCommit(draft);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-200"
        title="Onayla (Enter)"
        aria-label="Onayla"
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
        title="İptal (ESC)"
        aria-label="İptal"
      >
        <X size={14} />
      </button>
    </div>
  );

  if (type === 'textarea') {
    return (
      <div className="rounded-md ring-2 ring-blue-500">
        <TextArea
          autoFocus
          value={String(draft ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            // Click outside iptal — eğer relatedTarget Kaydet/Voice butonuna gitmiyorsa
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.dataset?.role === 'commit-draft' || next?.dataset?.role === 'voice-input') {
              onCommit(draft);
            } else {
              onCancel();
            }
          }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={4}
        />
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-slate-500">
          <VoiceNoteButton
            onTranscript={(chunk) =>
              setDraft((prev: unknown) => {
                const cur = String(prev ?? '');
                return cur ? `${cur} ${chunk}` : chunk;
              })
            }
          />
          <div className="flex items-center gap-2">
            <span>ESC iptal</span>
            {editControls}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 rounded-md ring-2 ring-blue-500">
          <Select
            autoFocus
            value={String(draft ?? '')}
            onChange={(e) => {
              setDraft(e.target.value);
              onCommit(e.target.value);
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.dataset?.role === 'commit-draft') return; // commit zaten onChange'de
              onCancel();
            }}
            onKeyDown={handleKey}
          >
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {editControls}
      </div>
    );
  }

  if (type === 'checkbox') {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1 ring-2 ring-blue-500">
        <input
          type="checkbox"
          autoFocus
          checked={Boolean(draft)}
          onChange={(e) => {
            setDraft(e.target.checked);
            onCommit(e.target.checked);
          }}
          onKeyDown={handleKey}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="flex-1 text-sm text-slate-700">{Boolean(draft) ? 'Var' : 'Yok'}</span>
        {editControls}
      </div>
    );
  }

  // text / date
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        type={type === 'date' ? 'date' : 'text'}
        value={String(draft ?? '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.dataset?.role === 'commit-draft') {
            onCommit(draft);
          } else {
            onCancel();
          }
        }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-blue-500 bg-white px-3 py-1.5 text-sm text-slate-800 ring-2 ring-blue-500/40 focus:outline-none dark:bg-ndark-card dark:text-ndark-text"
      />
      {editControls}
    </div>
  );
}

type ActivityFilter = 'all' | 'status' | 'assign' | 'files' | 'notes' | 'calls' | 'fields' | 'checklist';

interface FilterDef {
  key: ActivityFilter;
  label: string;
  types: CaseHistoryActionType[];
  /** Tailwind class'ları — chip aktif iken arka plan + nokta rengi */
  active: string;
  dot: string;
  /** Tailwind class'ları — chip pasif (renkli ama tonlu) */
  inactive: string;
  /** Custom matcher — types yetersizse (örn. Atama hem Transfer hem assignment FieldUpdate). */
  match?: (h: CaseHistoryEntry) => boolean;
}

// Atama filtresi için sayılan FieldUpdate alanları — bu alanlardaki değişimler
// "Atama"ya düşer, "Alan"a düşmez (BUG 2).
const ASSIGNMENT_FIELDS = new Set([
  'assignedPersonId',
  'assignedTeamId',
  'assignedPersonName',
  'assignedTeamName',
]);

const ACTIVITY_FILTERS: FilterDef[] = [
  { key: 'all',       label: 'Hepsi',   types: [],
    active:   'bg-slate-700 text-white shadow-sm',
    inactive: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    dot:      'bg-slate-500' },
  { key: 'status',    label: 'Statü',   types: ['StatusChange', 'CaseCreated', 'SLAApplied'],
    active:   'bg-brand-600 text-white shadow-sm',
    inactive: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    dot:      'bg-brand-500' },
  { key: 'assign',    label: 'Atama',   types: ['Transfer'],
    active:   'bg-amber-600 text-white shadow-sm',
    inactive: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
    dot:      'bg-amber-500',
    match: (h) =>
      h.actionType === 'Transfer' ||
      (h.actionType === 'FieldUpdate' && ASSIGNMENT_FIELDS.has(h.fieldName ?? '')) },
  { key: 'files',     label: 'Dosya',   types: ['FileUploaded', 'FileRemoved'],
    active:   'bg-blue-600 text-white shadow-sm',
    inactive: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    dot:      'bg-blue-500' },
  { key: 'notes',     label: 'Not',     types: ['NoteAdded'],
    active:   'bg-emerald-600 text-white shadow-sm',
    inactive: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    dot:      'bg-emerald-500' },
  { key: 'calls',     label: 'Çağrı',   types: ['CallLogAdded'],
    active:   'bg-violet-600 text-white shadow-sm',
    inactive: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
    dot:      'bg-violet-500' },
  { key: 'fields',    label: 'Alan',    types: ['FieldUpdate'],
    active:   'bg-slate-600 text-white shadow-sm',
    inactive: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    dot:      'bg-slate-400',
    // Atamayla çift sayım olmasın — assignment field'lar "Atama"ya gider.
    match: (h) =>
      h.actionType === 'FieldUpdate' && !ASSIGNMENT_FIELDS.has(h.fieldName ?? '') },
  { key: 'checklist', label: 'Kontrol', types: ['ChecklistToggle'],
    active:   'bg-teal-600 text-white shadow-sm',
    inactive: 'bg-teal-50 text-teal-700 hover:bg-teal-100',
    dot:      'bg-teal-500' },
];

function matchesFilter(h: CaseHistoryEntry, f: FilterDef): boolean {
  if (f.match) return f.match(h);
  return !!h.actionType && f.types.includes(h.actionType);
}

/** Bir history entry için dot rengi — chip rengiyle eşleşmesi için custom matcher dahil. */
function dotColorFor(h: CaseHistoryEntry): string {
  if (!h.actionType) return 'bg-slate-400';
  const def = ACTIVITY_FILTERS.find((f) => f.key !== 'all' && matchesFilter(h, f));
  return def?.dot ?? 'bg-slate-400';
}

// Aktivite satırındaki not — karakter eşiğini aşan metin kısaltılır,
// "Devamını göster / Gizle" toggle'ı çıkar. Ekran genişliğinden bağımsız
// öngörülebilir davranış için satır-ölçümü değil karakter limiti kullanılır
// (aktivite akışı kompakt kalmalı).
const ACTIVITY_NOTE_PREVIEW_CHARS = 180;

function ExpandableActivityNote({ text, className }: { text: string; className: string }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  const isLong = text.length > ACTIVITY_NOTE_PREVIEW_CHARS;
  // Kelime ortasında kesmemek için eşikten geriye son boşluğa kadar kırp.
  const preview = useMemo(() => {
    if (!isLong) return text;
    const slice = text.slice(0, ACTIVITY_NOTE_PREVIEW_CHARS);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > ACTIVITY_NOTE_PREVIEW_CHARS / 2 ? slice.slice(0, lastSpace) : slice) + '…';
  }, [text, isLong]);

  return (
    <div>
      <p className={`whitespace-pre-wrap ${className}`}>
        {expanded ? text : preview}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((current) => !current);
          }}
          aria-expanded={expanded}
          className="mt-0.5 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {expanded ? 'Gizle' : 'Devamını göster'}
        </button>
      )}
    </div>
  );
}

// 2026-07-04 UX FIX PAKETİ PR-1 — Legacy per-file FileUploaded satırlarını
// görünümde katlanabilir gruba düşür. Yeni intake (2026-07-04+) zaten tek
// satır yazıyor; grouping SADECE ESKİ kayıtlarda "14 tane Dosya yüklendi"
// selini görünüşte düzeltir. Kural: ardışık FileUploaded satırları, aynı
// actor + ≤60sn zaman farkı → 1 grup.
const ACTIVITY_GROUP_WINDOW_MS = 60_000;

// Codex R1 P2 — Aggregate upload row (inbound mail intake toplu yazımı):
//   actionType='FileUploaded' + toValue='<N> dosya' + note dolu.
// server/lib/inboundMailIntake.js kontratıyla (N=stored.length, note=isimler).
// TEK KAYNAK — renderer + grouping AYNI helper'ı kullanır.
function isAggregateUploadRow(h: CaseHistoryEntry): boolean {
  if (h.actionType !== 'FileUploaded') return false;
  if (!h.toValue || !/^\d+ dosya$/.test(h.toValue)) return false;
  return typeof h.note === 'string' && h.note.trim().length > 0;
}

// Aggregate note'u dosya adlarına parse eder.
// Note format (backend): "a.pdf, b.pdf, c.pdf" veya (180+ char sonrası)
// "a.pdf, b.pdf, +N daha". Ayraç virgül+opsiyonel boşluk.
function parseAggregateNote(note: string): { names: string[]; more: number } {
  const trimmed = note.trim();
  const moreMatch = trimmed.match(/,\s*\+(\d+)\s+daha\s*$/);
  const more = moreMatch ? Number.parseInt(moreMatch[1], 10) : 0;
  const namesPart = moreMatch ? trimmed.slice(0, moreMatch.index).trim() : trimmed;
  const names = namesPart.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return { names, more };
}
interface FileUploadGroupItem {
  __group: true;
  groupId: string;
  items: CaseHistoryEntry[];
  at: string;
  actor: string;
}
type ActivityRenderItem = CaseHistoryEntry | FileUploadGroupItem;
function isGroup(x: ActivityRenderItem): x is FileUploadGroupItem {
  return (x as FileUploadGroupItem).__group === true;
}
function groupFileUploadedRuns(items: CaseHistoryEntry[]): ActivityRenderItem[] {
  const out: ActivityRenderItem[] = [];
  let buf: CaseHistoryEntry[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) {
      out.push(buf[0]);
    } else {
      out.push({
        __group: true,
        groupId: `grp-${buf[0].id}`,
        items: buf,
        at: buf[0].at,
        actor: buf[0].actor,
      });
    }
    buf = [];
  };
  for (const h of items) {
    if (h.actionType !== 'FileUploaded') {
      flush();
      out.push(h);
      continue;
    }
    // Codex R1 P2-2 — Aggregate row (backend toplu yazım) buffer'a girmez;
    // legacy per-file grubunu flush eder, kendisi STANDALONE render'a düşer
    // (P2-1 render'ı komşularını yutmadan gösterir).
    if (isAggregateUploadRow(h)) {
      flush();
      out.push(h);
      continue;
    }
    if (buf.length === 0) {
      buf.push(h);
      continue;
    }
    const last = buf[buf.length - 1];
    const sameActor = last.actor === h.actor;
    const delta = Math.abs(new Date(last.at).getTime() - new Date(h.at).getTime());
    if (sameActor && delta <= ACTIVITY_GROUP_WINDOW_MS) {
      buf.push(h);
    } else {
      flush();
      buf.push(h);
    }
  }
  flush();
  return out;
}

// Codex R1 P2-1 — Aggregate upload row (backend toplu yazım) için renderer.
// FileUploadGroupRow UI kalıbı AYNEN reuse edildi (yeni desen icat yok);
// veri kaynağı group.items yerine note'tan parse edilen dosya adları.
// Note parse edilemezse (isim yok) zarif düşüş: note düz metin.
function AggregateFileUploadedRow({ entry }: { entry: CaseHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(
    () => (entry.note ? parseAggregateNote(entry.note) : { names: [], more: 0 }),
    [entry.note],
  );
  const totalCount = /^\d+ dosya$/.test(entry.toValue ?? '')
    ? Number.parseInt((entry.toValue ?? '').split(' ')[0], 10)
    : parsed.names.length;
  return (
    <li className="relative">
      <span className="absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white" />
      <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-baseline gap-x-1.5 text-left text-sm hover:opacity-80"
          aria-expanded={open}
        >
          <Paperclip size={12} className="text-blue-700" />
          <span className="font-medium text-blue-900">Dosya yüklendi:</span>
          <span className="font-semibold text-slate-800">{totalCount} dosya</span>
          <span className="ml-auto text-[11px] text-blue-700">
            {open ? '▾ gizle' : '▸ göster'}
          </span>
        </button>
        {open && (
          parsed.names.length > 0 ? (
            <ul className="mt-1 space-y-0.5 pl-4 text-xs text-slate-700">
              {parsed.names.map((name, i) => (
                <li key={`${entry.id}-${i}`} className="truncate">
                  <Paperclip size={10} className="inline-block text-blue-500" />{' '}
                  <span className="font-medium">{name}</span>
                </li>
              ))}
              {parsed.more > 0 && (
                <li className="italic text-slate-500">+{parsed.more} daha</li>
              )}
            </ul>
          ) : (
            // Zarif düşüş: parse edilemedi → note'u düz metin göster.
            <div className="mt-1 pl-4 text-xs italic text-slate-600">
              {entry.note}
            </div>
          )
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Calendar size={11} />
          <span>{formatDateTime(entry.at)}</span>
          <span>·</span>
          <span>{entry.actor}</span>
        </div>
      </div>
    </li>
  );
}

function FileUploadGroupRow({ group }: { group: FileUploadGroupItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative">
      <span className="absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white" />
      <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-baseline gap-x-1.5 text-left text-sm hover:opacity-80"
          aria-expanded={open}
        >
          <Paperclip size={12} className="text-blue-700" />
          <span className="font-medium text-blue-900">Dosya yüklendi:</span>
          <span className="font-semibold text-slate-800">{group.items.length} dosya</span>
          <span className="ml-auto text-[11px] text-blue-700">
            {open ? '▾ gizle' : '▸ göster'}
          </span>
        </button>
        {open && (
          <ul className="mt-1 space-y-0.5 pl-4 text-xs text-slate-700">
            {group.items.map((it) => (
              <li key={it.id} className="truncate">
                <Paperclip size={10} className="inline-block text-blue-500" />{' '}
                <span className="font-medium">{it.toValue ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Calendar size={11} />
          <span>{formatDateTime(group.at)}</span>
          <span>·</span>
          <span>{group.actor}</span>
        </div>
      </div>
    </li>
  );
}

function ActivityTab({ item }: { item: Case }) {
  const [filter, setFilter] = useState<ActivityFilter>('all');

  // Her filtre için sayım — chip'in yanında badge olarak gösterilir
  const counts = useMemo(() => {
    const map: Record<ActivityFilter, number> = {
      all: item.history.length, status: 0, assign: 0, files: 0,
      notes: 0, calls: 0, fields: 0, checklist: 0,
    };
    for (const h of item.history) {
      for (const f of ACTIVITY_FILTERS) {
        if (f.key === 'all') continue;
        if (matchesFilter(h, f)) map[f.key]++;
      }
    }
    return map;
  }, [item.history]);

  const filtered = useMemo(() => {
    if (filter === 'all') return item.history;
    const def = ACTIVITY_FILTERS.find((f) => f.key === filter);
    if (!def) return item.history;
    return item.history.filter((h) => matchesFilter(h, def));
  }, [item.history, filter]);

  // 2026-07-04 UX FIX PAKETİ PR-1 — Filtrelenmiş listeyi legacy gruplama
  // ile view-modeline dönüştür (yeni intake tek satır yazıyor, bu no-op
  // olur; ESKİ per-file kayıtlar tek gruba düşer).
  const rendered = useMemo(() => groupFileUploadedRuns(filtered), [filtered]);

  return (
    <div className="space-y-3">
      {/* Filtre chip'leri — her tipin kendi rengi, aktif iken doygun, pasifte tonlu */}
      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_FILTERS.map((f) => {
          const n = counts[f.key];
          const isActive = filter === f.key;
          const isDisabled = n === 0 && f.key !== 'all';
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => !isDisabled && setFilter(f.key)}
              disabled={isDisabled}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                isActive
                  ? f.active
                  : isDisabled
                    ? 'bg-slate-50 text-slate-400 cursor-not-allowed'
                    : f.inactive
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 py-0 text-[10px] ${
                  isActive ? 'bg-white/25 text-white' : 'bg-white/80 text-slate-600'
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {rendered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Bu filtreyle eşleşen kayıt yok.
        </p>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
          {rendered.map((h) => {
        // 2026-07-04 UX FIX PAKETİ PR-1 — Legacy FileUploaded grubu
        if (isGroup(h)) {
          return <FileUploadGroupRow key={h.groupId} group={h} />;
        }
        // Codex R1 P2-1 — Aggregate upload row (backend toplu yazım) için
        // ayrı renderer. TEKİL (N==1) satır eski format birebir korunur;
        // aggregate ise ▸ toggle + note'tan parse dosya adları.
        if (isAggregateUploadRow(h)) {
          return <AggregateFileUploadedRow key={h.id} entry={h} />;
        }
        // Dosya yüklendi/silindi — özel render: kâğıt ikonu, dosya adı vurgulu.
        if (h.actionType === 'FileUploaded' || h.actionType === 'FileRemoved') {
          const isUpload = h.actionType === 'FileUploaded';
          const fileName = isUpload ? h.toValue : h.fromValue;
          return (
            <li key={h.id} className="relative">
              <span
                className={`absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full ring-4 ring-white ${
                  isUpload ? 'bg-blue-500' : 'bg-rose-500'
                }`}
              />
              <div
                className={`rounded-md border px-3 py-2 ${
                  isUpload ? 'border-blue-200 bg-blue-50/60' : 'border-rose-200 bg-rose-50/60'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                  <Paperclip size={12} className={isUpload ? 'text-blue-700' : 'text-rose-700'} />
                  <span className={`font-medium ${isUpload ? 'text-blue-900' : 'text-rose-900'}`}>
                    {isUpload ? 'Dosya yüklendi:' : 'Dosya silindi:'}
                  </span>
                  <span
                    className={
                      isUpload
                        ? 'font-semibold text-slate-800'
                        : 'text-slate-700 line-through decoration-slate-300'
                    }
                  >
                    {fileName ?? '—'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Calendar size={11} />
                  <span>{formatDateTime(h.at)}</span>
                  <span>·</span>
                  <span>{h.actor}</span>
                </div>
              </div>
            </li>
          );
        }

        // Transfer aksiyonları için blue-tint custom render — diğer log'lardan ayrışsın.
        if (h.actionType === 'Transfer') {
          return (
            <li key={h.id} className="relative">
              <span className="absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white dark:ring-ndark-bg" />
              <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 dark:border-blue-900/40 dark:bg-blue-950/20">
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                  <span className="inline-flex items-center gap-1 font-medium text-blue-900 dark:text-blue-200">
                    <ArrowRightLeft size={12} /> Aktarıldı:
                  </span>
                  <span className="text-slate-700 line-through decoration-slate-300 dark:text-ndark-muted">{h.fromValue ?? '—'}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-slate-800 dark:text-ndark-text">{h.toValue}</span>
                </div>
                {h.note && (
                  <div className="mt-1">
                    <ExpandableActivityNote
                      text={h.note}
                      className="text-xs italic text-blue-800 dark:text-blue-300"
                    />
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  <Calendar size={11} />
                  <span>{formatDateTime(h.at)}</span>
                  <span>·</span>
                  <span>{h.actor}</span>
                </div>
              </div>
            </li>
          );
        }

        const fieldLabel = h.fieldName ? CASE_FIELD_LABELS[h.fieldName] ?? h.fieldName : null;
        const hasFrom = h.fromValue != null && h.fromValue !== '' && h.fromValue !== '—';
        const hasTo = h.toValue != null && h.toValue !== '';
        return (
          <li key={h.id} className="relative">
            <span
              className={`absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full ring-4 ring-white ${dotColorFor(h)}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-slate-800">{h.action}</span>
              {fieldLabel && (
                <span className="text-xs font-medium text-slate-500">{fieldLabel}{hasTo ? ':' : ''}</span>
              )}
              {hasFrom && hasTo && (
                <span className="inline-flex items-baseline gap-1.5 text-xs">
                  <span className="text-slate-500 line-through decoration-slate-300">{h.fromValue}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-medium text-slate-800">{h.toValue}</span>
                </span>
              )}
              {!hasFrom && hasTo && (
                <span className="text-xs font-medium text-slate-800">{h.toValue}</span>
              )}
            </div>
            {/* PR-T3 — generic note render (Smart Ticket açılış suffix dahil).
                Backend Case create'te 'Vaka oluşturuldu' + note='Smart Ticket
                akışıyla açıldı' yazıyor; eski UI bu alanı göstermiyordu.
                NoteAdded dahil uzun notlar 3 satırda kırpılır (Devamını göster). */}
            {h.note && (
              <div className="mt-0.5">
                <ExpandableActivityNote
                  text={h.note}
                  className="text-[11px] italic text-slate-600 dark:text-ndark-muted"
                />
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              <Calendar size={11} />
              <span>{formatDateTime(h.at)}</span>
              <span>·</span>
              <span>{h.actor}</span>
            </div>
          </li>
        );
          })}
        </ol>
      )}
    </div>
  );
}



function CallLogsTab({
  item,
  onAddCallLog,
}: {
  item: Case;
  onAddCallLog: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Çağrı kayıtları — toplam <strong>{item.callLogs.length}</strong>.
        </p>
        <Button size="sm" variant="outline" leftIcon={<Mic size={12} />} onClick={onAddCallLog}>
          Çağrı Notu Gir
        </Button>
      </div>
      {item.callLogs.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Çağrı kaydı yok.</p>
      ) : (
        <ul className="space-y-2">
          {item.callLogs.map((cl) => (
            <li key={cl.id} className="rounded-md bg-violet-50/40 px-3 py-2 ring-1 ring-violet-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{cl.callerName}</span>
                <span className="text-[11px] text-slate-500">
                  {formatDateTime(cl.callDate)} · {cl.durationMin} dk
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tint="violet">{cl.callDisposition}</Badge>
                <Badge tint="slate">{cl.callOutcome}</Badge>
                {cl.nextFollowupDate && (
                  <span className="text-[11px] text-slate-600">
                    Sonraki: {formatDateTime(cl.nextFollowupDate)}
                  </span>
                )}
              </div>
              {cl.description && (
                <p className="mt-1.5 text-xs text-slate-700">{cl.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewCallLogModal({
  open,
  item,
  prefillDurationMin,
  onClose,
  onCreated,
}: {
  open: boolean;
  item: Case;
  /** Çağrı sonlandığında handleEndCall'dan gelen dakika sayısı — varsa initial state'i bununla doldur. */
  prefillDurationMin?: number;
  onClose: () => void;
  onCreated: (c: Case) => void;
}) {
  const [callerName, setCallerName] = useState('');
  const [durationMin, setDurationMin] = useState(5);
  const [disposition, setDisposition] = useState<CallDisposition>('Cevapladı');
  const [outcome, setOutcome] = useState<CallOutcome>('Memnun');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setCallerName('');
      setDurationMin(prefillDurationMin ?? 5);
      setDisposition('Cevapladı');
      setOutcome('Memnun');
      setDescription('');
    }
  }, [open, prefillDurationMin]);

  async function handleSave() {
    if (!callerName.trim()) {
      toast({ type: 'warn', message: 'Arayan / muhatap adı zorunlu.' });
      return;
    }
    setSubmitting(true);
    const trimmedDescription = description.trim();
    const r = await caseService.addCallLog(item.id, {
      callerName: callerName.trim(),
      durationMin,
      callDisposition: disposition,
      callOutcome: outcome,
      description: trimmedDescription || undefined,
    });
    if (!r) {
      setSubmitting(false);
      toast({ type: 'error', message: 'Çağrı kaydı eklenemedi.' });
      return;
    }
    // Mention mirror — call log description'da @[Name](userId) varsa BE'nin
    // CaseMention parse'ı yan-bir Internal not aracılığıyla tetiklenir.
    // (addCallLog endpoint'i mention parse etmiyor; addNote ediyor.)
    if (trimmedDescription && /@\[[^\]]+\]\([^)]+\)/.test(trimmedDescription)) {
      // Actor identity hardening: authorName backend req.user üzerinden yazılır.
      await caseService.addNote(item.id, {
        content: `Çağrı kaydı (${callerName.trim()}): ${trimmedDescription}`,
        visibility: 'Internal',
      });
    }
    onCreated(r.caseUpdated);
    onClose();
    setSubmitting(false);
    toast({ type: 'success', message: 'Çağrı kaydedildi. AI özet hazırlanıyor…', duration: 1800 });

    // Auto-summarize: arka planda; sonuç gelince case'in aiCallBrief alanı güncellenir.
    void (async () => {
      const aiR = await aiService.callSummary({
        callLog: {
          note: r.callLog.description,
          outcome: r.callLog.callOutcome,
          disposition: r.callLog.callDisposition,
        },
        caseSubject: item.title,
        customerName: item.accountName,
      });
      if (aiR.ok && aiR.data.summary) {
        const updated = await caseService.update(item.id, { aiCallBrief: aiR.data.summary });
        if (updated) {
          onCreated(updated);
          toast({ type: 'success', message: 'Çağrı özeti AI tarafından hazırlandı.', duration: 2000 });
        }
      } else if (!aiR.ok) {
        // Sessiz fail — UI'da call log zaten var
        if (aiR.error.kind !== 'unconfigured') {
          toast({ type: 'warn', message: aiErrorMessage(aiR.error), duration: 2200 });
        }
      }
    })();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Çağrı Kaydı Ekle"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={submitting || !callerName.trim()}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Muhatap" required>
          <TextInput
            autoFocus
            placeholder="ör. Ayşe Yılmaz"
            value={callerName}
            onChange={(e) => setCallerName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Süre (dk)" required>
            <TextInput
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Çağrı Sonucu" required>
            <Select
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as CallDisposition)}
            >
              {CALL_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müşteri Tepkisi" required>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Açıklama"
          hint="AI bu metni özetleyerek aiCallBrief alanına yazacak. @ ile takım arkadaşını etiketleyebilirsin."
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) =>
                setDescription((t) => (t ? `${t} ${chunk}` : chunk))
              }
            />
          }
        >
          <MentionTextarea
            caseId={item.id}
            value={description}
            onChange={setDescription}
            rows={4}
            placeholder="Çağrıda ne konuşuldu, hangi karar verildi… (@ekip arkadaşı)"
          />
        </Field>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Madde 2 — KbDraftCard'ı Detay sekmesinde Section başlığıyla sarmalar.
 * Card customFields.smartTicket.aiDrafts yoksa null döner; wrapper de
 * Section header'ını render etmez. Klasik vakalar etkilenmez.
 */
function KbDraftSection({ item }: { item: Case }) {
  const cf = item.customFields;
  const st = cf && typeof cf === 'object' ? (cf as Record<string, unknown>).smartTicket : null;
  const drafts =
    st && typeof st === 'object' ? (st as Record<string, unknown>).aiDrafts : null;
  if (!drafts || typeof drafts !== 'object') return null;
  return (
    <Section title="Bilgi Bankası Önerileri">
      <KbDraftCard item={item} variant="case-detail" />
    </Section>
  );
}

/**
 * Business review Madde 4 (PR-4) — Smart Ticket açılış kategorileri
 * Case Detail Detay sekmesinde compact chip görünümü.
 *
 * Render politikası:
 *   - customFields.smartTicket varsa render edilir.
 *   - 5 alan: platform / businessProcess / operationType / affectedObject /
 *     impact. Her birinin `Label` suffix'i tercih edilir (Smart Ticket
 *     create akışı `${field}Label` olarak persist eder, PR-T1 öncesi
 *     opening pattern'i). Sadece code varsa code gösterilir.
 *   - Hiçbir alan dolu değilse null döner (boş Section header
 *     görünmesin).
 *   - Klasik vakalar etkilenmez.
 *
 * Duplicate koruması: L1 Devir Özeti kartı (PR-T3) `Çözüm Adımları`
 * sekmesinde aynı opening taxonomy snapshot'ını gösterir — ama bu
 * yalnız devir gerçekleşmiş Smart Ticket vakalarında. SmartTicketMetaSection
 * Detay sekmesinde her zaman görünür; iki tab farklı amaç (devir bağlamı
 * vs. Detay özet) — duplicate değil, kasıtlı bilgi tekrarı.
 */
function SmartTicketMetaSection({
  item,
  hideOpening = false,
}: {
  item: Case;
  /**
   * L2-Smart-Flow FAZ 1 — açılış chip'leri SmartClassificationCard'a taşındı;
   * true iken bu bölüm yalnız KAPANIŞ etiketlerini gösterir (başlık da
   * "Kapanış Etiketleri" olur). FAZ 2 kapanışı düzenlenebilir yapana kadar
   * salt-okunur.
   */
  hideOpening?: boolean;
}) {
  const cf = item.customFields;
  const st = cf && typeof cf === 'object' ? (cf as Record<string, unknown>).smartTicket : null;
  if (!st || typeof st !== 'object') return null;
  const s = st as Record<string, unknown>;

  const pick = (codeKey: string, labelKey: string): string | null => {
    const label = s[labelKey];
    if (typeof label === 'string' && label.trim()) return label.trim();
    const code = s[codeKey];
    if (typeof code === 'string' && code.trim()) return code.trim();
    return null;
  };

  // Kapanış alanları smartTicket.closure alt-objesinde — root'ta değil.
  const cl = s.closure && typeof s.closure === 'object'
    ? (s.closure as Record<string, unknown>)
    : null;
  const pickClosure = (codeKey: string, labelKey: string): string | null => {
    if (!cl) return null;
    const label = cl[labelKey];
    if (typeof label === 'string' && label.trim()) return label.trim();
    const code = cl[codeKey];
    if (typeof code === 'string' && code.trim()) return code.trim();
    return null;
  };

  const openingFields: Array<{ key: string; label: string; value: string | null; Icon: typeof Layers }> = [
    { key: 'platform',        label: 'Platform',         value: pick('platform', 'platformLabel'),                 Icon: Layers },
    { key: 'businessProcess', label: 'İş Süreci',        value: pick('businessProcess', 'businessProcessLabel'),   Icon: Workflow },
    { key: 'operationType',   label: 'İşlem Tipi',       value: pick('operationType', 'operationTypeLabel'),       Icon: Settings2 },
    { key: 'affectedObject',  label: 'Etkilenen Nesne',  value: pick('affectedObject', 'affectedObjectLabel'),     Icon: Box },
    { key: 'impact',          label: 'Etki',             value: pick('impact', 'impactLabel'),                     Icon: Flame },
  ];

  const closureFields: Array<{ key: string; label: string; value: string | null; Icon: typeof Layers }> = [
    { key: 'rootCauseGroup',      label: 'Kök Neden Grubu',  value: pickClosure('rootCauseGroup', 'rootCauseGroupLabel'),           Icon: AlertTriangle },
    { key: 'rootCauseDetail',     label: 'Kök Neden Detayı', value: pickClosure('rootCauseDetail', 'rootCauseDetailLabel'),         Icon: Search },
    { key: 'resolutionType',      label: 'Çözüm Tipi',       value: pickClosure('resolutionType', 'resolutionTypeLabel'),           Icon: CheckCircle2 },
    { key: 'permanentPrevention', label: 'Kalıcı Önlem',     value: pickClosure('permanentPrevention', 'permanentPreventionLabel'), Icon: ShieldAlert },
  ];

  const visibleOpening = hideOpening ? [] : openingFields.filter((f) => f.value);
  const visibleClosure = closureFields.filter((f) => f.value);
  if (visibleOpening.length === 0 && visibleClosure.length === 0) return null;

  const renderChips = (
    fields: typeof openingFields,
    chipClass: string,
    iconClass: string,
  ) =>
    fields.map((f) => {
      const Icon = f.Icon;
      return (
        <span
          key={f.key}
          className={`inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-[11px] text-slate-700 dark:text-ndark-muted ${chipClass}`}
        >
          <Icon size={11} className={`self-center ${iconClass}`} />
          <span className="text-slate-400">{f.label}:</span>
          <span className="font-medium">{f.value}</span>
        </span>
      );
    });

  return (
    <Section title={hideOpening ? 'Kapanış Etiketleri' : 'Akıllı Ticket Kategorileri'} tint="violet">
      {visibleOpening.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {renderChips(
            visibleOpening,
            'border-violet-200 bg-white dark:border-violet-900/40 dark:bg-ndark-card',
            'text-violet-500',
          )}
        </div>
      )}
      {visibleOpening.length > 0 && visibleClosure.length > 0 && (
        <div className="my-2 flex items-center gap-2">
          <div className="h-px flex-1 bg-violet-100 dark:bg-violet-900/30" />
          <span className="text-[10px] font-medium text-violet-400 dark:text-violet-600">
            Kapanış
          </span>
          <div className="h-px flex-1 bg-violet-100 dark:bg-violet-900/30" />
        </div>
      )}
      {visibleClosure.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {renderChips(
            visibleClosure,
            'border-emerald-200 bg-white dark:border-emerald-900/40 dark:bg-ndark-card',
            'text-emerald-600',
          )}
        </div>
      )}
    </Section>
  );
}

function Section({
  title,
  tint = 'default',
  variant = 'card',
  children,
}: {
  title: string;
  tint?: 'default' | 'violet' | 'rose' | 'emerald';
  /**
   * 'card' (default) — ağır ring + bg-white kutu (eski davranış)
   * 'flat'           — PR-B baseline: ringless, transparent bg + minimal padding
   * 'structured'     — Cila-4 "operable" dengesi: hafif başlık şeridi +
   *                    bg-white içerik + ring-1 ring-slate-100 hairline çerçeve.
   *                    Sınıflandırma/Atama gibi form benzeri bölümler için.
   */
  variant?: 'card' | 'flat' | 'structured';
  children: React.ReactNode;
}) {
  // 'card' variant tint mantığı
  const ring =
    variant === 'flat' || variant === 'structured' ? '' :
    tint === 'violet'  ? 'ring-violet-200 bg-violet-50/30' :
    tint === 'rose'    ? 'ring-rose-200 bg-rose-50/30' :
    tint === 'emerald' ? 'ring-emerald-200 bg-emerald-50/30' :
                          'ring-slate-200 bg-white';

  if (variant === 'structured') {
    return (
      <section className="overflow-hidden rounded-md ring-1 ring-slate-100 dark:ring-ndark-border">
        <h3 className="bg-slate-50/40 px-3 py-1.5 text-xs font-medium text-slate-500 dark:bg-ndark-bg/40 dark:text-ndark-muted">
          {title}
        </h3>
        <div className="bg-white px-1 py-1 dark:bg-ndark-card">{children}</div>
      </section>
    );
  }

  const wrapperCls =
    variant === 'flat'
      ? 'pt-1'
      : `rounded-lg p-4 ring-1 ring-inset ${ring}`;
  return (
    <section className={wrapperCls}>
      <h3 className="mb-2 text-xs font-medium text-slate-500 dark:text-ndark-muted">{title}</h3>
      {children}
    </section>
  );
}

// DetailGrid eski "SLA & Tarihler" Section'unda kullanılıyordu; Adım-2'de
// section silindi, tek caller'ı kalmadı → function de silindi.

/**
 * PreviousCasesSection — Müşteri geçmiş vakaları (Adım-3 / direktif #6).
 *
 * Veri: `previousCases` parent state'inden — `caseService.findByAccount`
 * mevcut fetch'i reuse (YENİ İSTEK YOK).
 *
 * Davranış:
 *  - Mevcut vaka filtrelenir (kendi geçmiş listesinde görünmez).
 *  - En yeni üstte: `resolvedAt ?? updatedAt` DESC.
 *  - Varsayılan ilk 10 satır; "Hepsini gör (N)" toggle ile tüm liste açılır.
 *  - Açık listede max-h + iç scroll (sayfa sonsuz büyümesin).
 *  - Boş durumda worded empty ("Bu müşterinin başka vakası yok"); "—" çizilmez.
 *  - Satır: caseNumber · başlık (truncate) · status pill · tarih · "Aç →"
 *  - Status pill StatusPill component'ini reuse (TR label "Eskale Edildi" dahil — PR-C).
 */
function PreviousCasesSection({
  previousCases,
  currentCaseId,
  onSelectPrevious,
}: {
  previousCases: Case[];
  currentCaseId: string;
  onSelectPrevious: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const refDate = (c: Case) => new Date(c.resolvedAt ?? c.updatedAt).getTime();
    return previousCases
      .filter((c) => c.id !== currentCaseId)
      .slice()
      .sort((a, b) => refDate(b) - refDate(a));
  }, [previousCases, currentCaseId]);

  const totalCount = sorted.length;
  const visible = showAll ? sorted : sorted.slice(0, 10);

  return (
    <Section title={`Müşteri geçmiş vakaları (${totalCount})`}>
      {totalCount === 0 ? (
        <p className="text-xs italic text-slate-400 dark:text-ndark-dim">
          Bu müşterinin başka vakası yok.
        </p>
      ) : (
        <>
          <ul
            className={`space-y-1.5 ${showAll ? 'max-h-[480px] overflow-y-auto pr-1' : ''}`}
          >
            {visible.map((p) => {
              const refDate = p.resolvedAt ?? p.updatedAt;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPrevious(p.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-card dark:hover:border-brand-500 dark:hover:bg-brand-950/20"
                  >
                    <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                      {p.caseNumber}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {p.title}
                    </span>
                    <StatusPill status={p.status} />
                    <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
                      {formatRelative(refDate)}
                    </span>
                    <span className="ml-1 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                      Aç →
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {totalCount > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="mt-2 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              {showAll ? 'Daha az göster' : `Hepsini gör (${totalCount})`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function EditableGrid({
  rows,
  variant = 'card',
}: {
  rows: { label: string; node: React.ReactNode }[];
  /**
   * 'card' (default) — ağır ring + grid (eski davranış)
   * 'flat'           — PR-B baseline: ringless, satır border yok, akışkan
   * 'structured'     — Cila-4 sıkı ızgara: ringless, her satır border-b
   *                    border-slate-100 (son hariç). Form/tablo dengesi.
   */
  variant?: 'card' | 'flat' | 'structured';
}) {
  const dlCls =
    variant === 'flat' || variant === 'structured'
      ? 'grid grid-cols-1 gap-x-4 gap-y-0 sm:grid-cols-2'
      : 'grid grid-cols-1 gap-x-4 gap-y-1 rounded-md ring-1 ring-slate-200 sm:grid-cols-2';
  return (
    <dl className={dlCls}>
      {rows.map((r, i) => {
        // Cila-4 — structured: her satır altında ince hairline (sıkı ızgara).
        // 'card' eski davranışı + 'structured' yeni: ikisi de border-b ile
        // ayrım gösterir; 'flat' ayrımsız.
        const rowBorder =
          variant === 'flat'
            ? ''
            : i < rows.length - 1
              ? 'border-b border-slate-100 sm:border-b-0'
              : '';
        return (
          <div key={r.label} className={`flex flex-col gap-0.5 px-2 py-1.5 ${rowBorder}`}>
            <dt className="px-2 text-[11px] font-medium text-slate-500">{r.label}</dt>
            <dd>{r.node}</dd>
          </div>
        );
      })}
    </dl>
  );
}
