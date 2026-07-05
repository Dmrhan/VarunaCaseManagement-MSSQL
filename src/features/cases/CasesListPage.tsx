import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkey } from '@/lib/useHotkey';
import { isSubjectNormalized, normalizeSubject } from '@/lib/subjectNormalizer';
import { featureFlags } from '@/config/featureFlags';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Boxes,
  Globe,
  Mail,
  MessageSquare,
  Phone,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  Filter,
  Flag,
  Inbox,
  Layers,
  Link as LinkIcon,
  Plus,
  RotateCw,
  Search,
  SearchX,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  Users2,
  User,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { PendingReplyBadge } from './components/PendingReplyBadge';
import { Badge } from '@/components/ui/Badge';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/components/ui/cn';
import { apiFetch, caseService, lookupService } from '@/services/caseService';
import { accountService } from '@/services/accountService';
import { analyticsService, type PatternAlert } from '@/services/analyticsService';
import { useAuth, type UserRole } from '@/services/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableRowSkeleton } from '@/components/ui/Skeleton';
import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_STATUSES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseFilters,
  type CaseStatsResponse,
  type CasePriority,
  type CaseStatus,
} from './types';
import { formatDateTime, formatRelative } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { NewCaseForm } from './NewCaseForm';
import { QuickCaseModal } from './QuickCaseModal';

// Bulk action — kullanıcının açabileceği alan tipi.
// 'assign' = 2 adımlı atama modalı (takım → kişi).
type BulkField = 'priority' | 'status' | 'assign';

// Frontline = kişisel KPI'lar; Supervisor+ = global KPI'lar.
const FRONTLINE_ROLES: UserRole[] = ['Agent', 'Backoffice', 'CSM'];

// KPI tıklamasıyla aktive olan client-side display filtresi.
// 'slaRisk': slaViolation = true | 'resolvedToday': updatedAt bugün ve status 'Çözüldü'
type QuickFilter = 'slaRisk' | 'resolvedToday' | null;

// Kuyruk hızlı filtresi — tablo üstü chip'ler; mevcut filtrelerle birlikte çalışır,
// client-side mevcut sayfa kapsamında uygular (server pagination korunur).
type QuickQueueFilter = 'all' | 'unassigned' | 'critical';

// Kaynak kolonu ikon + renk yapılandırması.
const ORIGIN_CFG: Record<string, { icon: React.ReactNode }> = {
  'Telefon': { icon: <Phone         size={14} /> },
  'E-posta': { icon: <Mail          size={14} /> },
  'Web':     { icon: <Globe         size={14} /> },
  'Chatbot': { icon: <MessageSquare size={14} /> },
  'Diğer':   { icon: <Phone         size={14} /> },
};

// Sol kenar öncelik şeridi renkleri (3px border-l).
const PRIORITY_STRIPE: Record<CasePriority, string> = {
  Critical: 'border-l-red-500 dark:border-l-red-600',
  High:     'border-l-amber-400 dark:border-l-amber-500',
  Medium:   'border-l-blue-400 dark:border-l-blue-500',
  Low:      'border-l-slate-200 dark:border-l-slate-600',
};

// Bulk status'te kapatma yasak — backend de reddediyor, UI baştan göstermesin.
const BULK_STATUSES: CaseStatus[] = ['Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon', 'YenidenAcildi'];

interface CasesListPageProps {
  onSelectCase: (caseId: string) => void;
  onShowCustomer?: (accountId: string) => void;
  onOpenCustomerSearch?: () => void;
  /** App seviyesinden gelen account ID — varsa QuickCaseModal pre-fill ile açılır */
  pendingQuickPrefill?: string | null;
  onQuickPrefillConsumed?: () => void;
  /**
   * Örüntü alarmından gelen vaka filtresi (Faz 1.5 Madde 5).
   * Verilirse liste yalnızca bu caseId'leri gösterir + üstte sarı banner.
   */
  patternCasesFilter?: { caseIds: string[]; label: string } | null;
  onClearPatternFilter?: () => void;
  /** AI Briefing — örüntü alarmı için Detay → tıklamasında patterns sayfasına geçiş. */
  onShowPatterns?: () => void;
  /**
   * WR-Smart-Ticket Phase 1c — Akıllı Ticket Aç buton callback. App seviyesinden
   * gelir; featureFlags.smartTicketIntakeEnabled açıkken header'da görünür.
   * Flag kapalıyken prop verilmez → button render edilmez (zero-cost guard).
   */
  onOpenSmartTicket?: () => void;
  /**
   * App.tsx bu sayfayı case-detail açıkken unmount etmiyor, CSS ile
   * gizliyor (`hidden` class) — component her zaman mount'lu kalıyor.
   * Bu yüzden "vaka detayından üstlen → listeye dön" sonrası mount-only
   * efektler (stats/liste fetch) tekrar tetiklenmiyordu. isVisible, App
   * seviyesinden "şu an gerçekten görünürüm" sinyalini taşır; false→true
   * geçişinde stats + liste tazelenir. Verilmezse (varsayılan true) eski
   * davranış korunur.
   */
  isVisible?: boolean;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Inbox sekmesi — Açık/Later/Kapalı.
// Açık (default): aktif statüler, snoozed gizli (BE filter).
// Later: GET /api/cases/snoozed (me) — assignedPersonId = current user.
// Kapalı: status IN (Çözüldü, İptalEdildi).
// Genel #45 — "Tümü" tab'ı eklendi. Default opt-in; ilk sırada görünür ama
// açılışta hâlâ 'open' (mevcut davranış korunur).
type InboxTab = 'all' | 'open' | 'later' | 'closed';
const OPEN_STATUSES: CaseStatus[] = ['Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon', 'YenidenAcildi'];
const CLOSED_STATUSES: CaseStatus[] = ['Çözüldü', 'İptalEdildi'];

// ----------------------------------------------------------------
// Sıralama
// ----------------------------------------------------------------
type SortKey =
  | 'caseNumber'
  | 'title'
  | 'accountName'
  | 'caseType'
  | 'status'
  | 'priority'
  | 'assignment'
  | 'sla'
  | 'createdAt'
  | 'updatedAt';
type SortDir = 'asc' | 'desc';





const SORT_DROPDOWN_OPTIONS: Array<{ key: SortKey; dir: SortDir; label: string }> = [
  { key: 'updatedAt', dir: 'desc', label: 'Son Güncelleme (yeni → eski)' },
  { key: 'updatedAt', dir: 'asc', label: 'Son Güncelleme (eski → yeni)' },
  { key: 'createdAt', dir: 'desc', label: 'Açılış Tarihi (yeni → eski)' },
  { key: 'createdAt', dir: 'asc', label: 'Açılış Tarihi (eski → yeni)' },
  { key: 'sla', dir: 'asc', label: 'SLA (yaklaşan önce)' },
  { key: 'priority', dir: 'asc', label: 'Öncelik (kritik önce)' },
  { key: 'caseNumber', dir: 'asc', label: 'Vaka No (A→Z)' },
];

const STATUS_LABELS_SHORT: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3.Parti',
  // LBD A9 — display rename (enum identifier 'Eskalasyon' korunur)
  'Eskalasyon':          'Eskale Edildi',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden',
  'İptalEdildi':         'İptal',
};

const initialFilters: CaseFilters = {
  search: '',
  statuses: [],
  caseType: 'Tümü',
  priorities: [],
  teamId: '',
  personId: '',
  dateFrom: '',
  dateTo: '',
  // Phase D + KPI intent flag'leri — reset durumunda false/undefined kalmalı
  // ki "Tümünü Temizle" sonrası yan etkili filtre aktif görünmesin.
  customerMatchPending: undefined,
  // M6.3b Faz 1 — "Yanıt bekliyor" filtresi.
  pendingCustomerReply: undefined,
  assignedToMe: false,
  teamScope: false,
  slaViolation: false,
  resolvedToday: false,
};

export function CasesListPage({
  onSelectCase,
  onShowCustomer,
  onOpenCustomerSearch,
  pendingQuickPrefill,
  onQuickPrefillConsumed,
  patternCasesFilter,
  onClearPatternFilter,
  onShowPatterns,
  onOpenSmartTicket,
  isVisible = true,
}: CasesListPageProps) {
  const [allFiltered, setAllFiltered] = useState<Case[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CaseFilters>(initialFilters);
  const [inboxTab, setInboxTab] = useState<InboxTab>('open');
  const [newOpen, setNewOpen] = useState(false);
  // Codex P1 (PR #452 review) — Quick Case kapalıyken Customer Search
  // modal'ından gelen "yeni vaka aç" CTA'sını NewCaseForm'a yönlendir
  // (boş ekranda kalma fix). Quick Case açıkken pattern korunur.
  //
  // Codex P2 (main #459 review) — sadece accountId geçirmek yetmiyor:
  // NewCaseForm account-only seed'te ilk company seçildiğinde account'u
  // temizliyordu (accountCompanyIds yok → reconciliation fail). Account
  // detayını fetch edip accountCompanyIds + accountName ile tam shape
  // geçiyoruz.
  const [newPrefill, setNewPrefill] = useState<{
    accountId: string;
    accountName?: string;
    accountCompanyIds?: string[];
    accountDirectCompanyId?: string | null;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [serverTotal, setServerTotal] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefillAccount, setQuickPrefillAccount] = useState<string | null>(null);
  // Bulk select state — Set<string> performans için (kontrol O(1)).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  // KPI tıklamasıyla aktive olan client-side filtre (sortedFiltered'de uygulanır).
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  // Kuyruk hızlı filtresi — chip'ler (Tümü / Atanmamış / Kritik).
  const [quickQueueFilter, setQuickQueueFilter] = useState<QuickQueueFilter>('all');
  // Role-aware KPI stats — backend tek truth source (/api/cases/stats).
  // Önceki "personalStats + client-computed Supervisor stats" yapısı bırakıldı:
  // her rol için sayım artık server tarafında, scope korunarak hesaplanıyor.
  const [caseStats, setCaseStats] = useState<CaseStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  // Hangi KPI tile aktif/seçili olarak işaretlensin (görsel hint).
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  // AI briefing strip — pattern (Supervisor+) veya SLA mesajı veya "her şey yolunda".
  const [activePatterns, setActivePatterns] = useState<PatternAlert[]>([]);
  const [briefingDismissed, setBriefingDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem('aiBriefing:dismissed') === '1';
  });
  const { toast } = useToast();
  const { user } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isFrontline = !!user && FRONTLINE_ROLES.includes(user.role);

  // App seviyesi pendingQuickPrefill geldiğinde:
  //   - Quick Case enable iken → QuickCaseModal'ı prefill ile aç (klasik akış)
  //   - Quick Case disabled iken → NewCaseForm'u TAM initialContext ile aç
  //     (Codex P1 #452 + Codex P2 #459 review fix)
  //
  // Account detayı fetch edilir; accountCompanyIds + accountName seed
  // edildikten sonra modal açılır. Bu sayede NewCaseForm'un company
  // seçimi reconciliation logic'i account'u korur (eski impl: yalnız
  // accountId → ilk company seçiminde account temizleniyordu).
  // Fetch fail ederse fallback: yalnız accountId ile aç (eski davranış).
  useEffect(() => {
    if (!pendingQuickPrefill) return;
    const accountId = pendingQuickPrefill;
    if (featureFlags.quickCaseEnabled) {
      setQuickPrefillAccount(accountId);
      setQuickOpen(true);
      onQuickPrefillConsumed?.();
      return;
    }
    let alive = true;
    void accountService.get(accountId).then((acc) => {
      if (!alive) return;
      const companyIds = (acc?.companies ?? [])
        .map((c) => c.companyId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      setNewPrefill({
        accountId,
        accountName: acc?.name,
        accountCompanyIds: companyIds,
        accountDirectCompanyId: null,
      });
      setNewOpen(true);
      onQuickPrefillConsumed?.();
    }).catch(() => {
      if (!alive) return;
      // Fallback: account fetch fail → en azından accountId seed et,
      // company seçimi reconciliation modunu tetikleyebilir.
      setNewPrefill({ accountId });
      setNewOpen(true);
      onQuickPrefillConsumed?.();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuickPrefill]);

  // Klavye kısayolları
  useHotkey('/', (e) => {
    e.preventDefault();
    searchInputRef.current?.focus();
  });
  useHotkey('n', () => setNewOpen(true));
  useHotkey('q', () => {
    if (!featureFlags.quickCaseEnabled) return;
    setQuickPrefillAccount(null);
    setQuickOpen(true);
  });

  const teams = useMemo(() => lookupService.teams(), []);
  const personsAll = useMemo(() => lookupService.persons(), []);
  const personsForFilter = useMemo(
    () => (filters.teamId ? personsAll.filter((p) => p.teamId === filters.teamId) : personsAll),
    [filters.teamId, personsAll],
  );

  // Havuz kartı — kullanıcının kendi takımı + o takımın destek seviyesi.
  // Agent/Backoffice/CSM: L1 takımlarında kart hiç gösterilmez (L1 zaten
  // kendi işini yönetiyor); L2/L3 takımlarında görünür. Supervisor'da
  // (team mode) takım lideri persona kabul edilir, seviyeden bağımsız
  // her zaman görünür — server 'teamScope' filtresiyle kendi takımını çözer.
  const myPerson = useMemo(
    () => (user?.personId ? personsAll.find((p) => p.id === user.personId) ?? null : null),
    [personsAll, user?.personId],
  );
  const myTeamId = myPerson?.teamId ?? null;
  const myTeam = useMemo(
    () => (myTeamId ? teams.find((t) => t.id === myTeamId) ?? null : null),
    [teams, myTeamId],
  );
  const myTeamSupportLevel = myTeam?.defaultSupportLevel ?? 'L1';
  const poolVisiblePersonal = Boolean(myTeamId) && myTeamSupportLevel !== 'L1';

  // Havuz sayacı — kart tıklandığında listelenecek sayıyla birebir aynı
  // olmalı (client-side/pagination'a bağlı tahmini sayım riskli). Bu yüzden
  // mevcut liste endpoint'i aynı filtrelerle limit=1 çağrılıp gerçek
  // '@odata.count' okunuyor — yeni endpoint yok, tek ek istek.
  const [poolCount, setPoolCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadPoolCount() {
      if (caseStats?.mode === 'team') {
        const { total } = await caseService.list(
          { teamScope: true, unassigned: true },
          { page: 1, pageSize: 1 },
        );
        if (!cancelled) setPoolCount(total);
      } else if (caseStats?.mode === 'personal' && poolVisiblePersonal && myTeamId) {
        const { total } = await caseService.list(
          { teamId: myTeamId, unassigned: true },
          { page: 1, pageSize: 1 },
        );
        if (!cancelled) setPoolCount(total);
      } else {
        setPoolCount(null);
      }
    }
    void loadPoolCount();
    return () => { cancelled = true; };
    // caseStats'ın tamamına (yalnız .mode'a değil) bağımlı — refreshStats()
    // her çağrıldığında (Üstlen sonrası, Yenile butonu, bulk action) yeni
    // bir caseStats referansı üretir; poolCount da diğer KPI sayılarıyla
    // aynı anda tazelensin diye bu tetikleyiciyi paylaşıyor.
  }, [caseStats, poolVisiblePersonal, myTeamId]);

  // targetPage: undefined = mevcut page state'i kullan; sayı = o sayfayı yükle.
  const load = async (targetPage?: number, queueFilter?: QuickQueueFilter) => {
    const p = targetPage ?? page;
    const effectiveQueueFilter = queueFilter ?? quickQueueFilter;
    setLoading(true);
    setSelected(new Set());
    if (inboxTab === 'later') {
      const data = await apiFetch<{ value: Case[]; '@odata.count': number }>(
        '/api/cases/snoozed',
        undefined,
        'Ertelenmiş vakalar yüklenemedi',
      );
      const items = data?.value ?? [];
      setAllFiltered(items);
      setServerTotal(data?.['@odata.count'] ?? items.length);
    } else {
      const effectiveStatuses = inboxTab === 'all'
        ? (filters.statuses?.length ? filters.statuses : undefined)
        : (filters.statuses?.length ? filters.statuses : inboxTab === 'open' ? OPEN_STATUSES : CLOSED_STATUSES);
      const roleDefaultViewOff =
        user != null &&
        ['Supervisor', 'Backoffice'].includes(user.role) &&
        inboxTab === 'all';
      const { items, total } = await caseService.list(
        {
          ...filters,
          statuses: effectiveStatuses,
          unassigned: effectiveQueueFilter === 'unassigned' ? true : undefined,
          priorities: effectiveQueueFilter === 'critical' ? ['Critical'] : filters.priorities,
          roleDefaultView: roleDefaultViewOff ? 'off' : undefined,
        },
        { page: p, pageSize, sortBy: sortKey, sortDir },
      );
      setAllFiltered(items);
      setServerTotal(total);
    }
    setLoading(false);
  };

  // Filtre veya sekme değişince → ilk sayfaya sıfırla ve yeniden yükle.
  useEffect(() => {
    setPage(1);
    void load(1, quickQueueFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inboxTab,
    filters.search,
    filters.statuses,
    filters.caseType,
    filters.priorities,
    filters.teamId,
    filters.personId,
    filters.dateFrom,
    filters.dateTo,
    filters.customerMatchPending,
    filters.pendingCustomerReply,
    filters.assignedToMe,
    filters.teamScope,
    filters.slaViolation,
    filters.resolvedToday,
    filters.includeArchived,
    quickQueueFilter,
  ]);

  // Sayfa / pageSize / sıralama değişince → yeniden yükle (filtre değişikliği hariç).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sortKey, sortDir]);

  const stats = useMemo(() => {
    const total = serverTotal;
    const open = allFiltered.filter((c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi').length;
    const slaBreach = allFiltered.filter((c) => c.slaViolation).length;
    const critical = allFiltered.filter((c) => c.priority === 'Critical').length;
    const unassigned = allFiltered.filter((c) => !c.assignedPersonId && !CLOSED_STATUSES.includes(c.status)).length;
    return { total, open, slaBreach, critical, unassigned };
  }, [allFiltered, serverTotal]);

  // Role-aware KPI fetch — backend mod seçer (personal/team/operations).
  // Yenile butonu ve bulk action sonrası tetiklenir; tab/filtre değiştiğinde
  // değil (counts global, view'dan bağımsız).
  async function refreshStats() {
    if (!user) {
      setCaseStats(null);
      return;
    }
    setStatsLoading(true);
    try {
      const data = await caseService.getStats();
      setCaseStats(data);
    } catch {
      setCaseStats(null);
    } finally {
      setStatsLoading(false);
    }
  }

  // Kullanıcı yüklendiğinde / role değiştiğinde stats'i bir kez çek.
  useEffect(() => {
    void refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  // Bu sayfa vaka detayı açıkken unmount olmuyor (App.tsx CSS ile gizliyor),
  // yani "Vaka Detay → Üstlen → listeye dön" akışında normal mount-effect'ler
  // tekrar tetiklenmiyordu (stats/liste eski kalıyordu, Yenile'ye basmak
  // gerekiyordu). isVisible false→true geçişinde stats + liste tazelenir.
  const wasVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (!wasVisibleRef.current && isVisible) {
      void refreshStats();
      void load();
    }
    wasVisibleRef.current = isVisible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // Briefing — örüntü alarmları yalnızca Supervisor+ için. Endpoint frontline'a 403 dönüyor.
  useEffect(() => {
    if (!user || !['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role)) {
      setActivePatterns([]);
      return;
    }
    let alive = true;
    void analyticsService.listPatterns('active').then((list) => {
      if (alive) setActivePatterns(list);
    });
    return () => {
      alive = false;
    };
  }, [user?.id, user?.role]);

  function dismissBriefing() {
    try {
      window.sessionStorage.setItem('aiBriefing:dismissed', '1');
    } catch {
      /* incognito vb. — sessize al */
    }
    setBriefingDismissed(true);
  }

  // Briefing içeriği — pattern > SLA > ok sıralaması.
  // SLA briefing — server stats varsa onu kullan; yoksa client-computed
  // stats.slaBreach (mevcut sayfa view'ı kapsamında).
  const briefingSlaCount = (() => {
    if (!caseStats) return stats.slaBreach;
    if (caseStats.mode === 'personal') return caseStats.slaRiskMine;
    if (caseStats.mode === 'team') return caseStats.teamSlaRisk;
    if (caseStats.mode === 'operations') return caseStats.slaViolation;
    return stats.slaBreach;
  })();
  const briefingState: 'pattern' | 'sla' | 'ok' | null = briefingDismissed
    ? null
    : activePatterns.length > 0
      ? 'pattern'
      : briefingSlaCount > 0
        ? 'sla'
        : 'ok';

  // Server-side pagination + sort: allFiltered zaten o sayfanın kayıtları.
  // Client-side post-filter: AI örüntü alarmı overlay'i + kuyruk hızlı filtreleri.
  // NOT: quickQueueFilter yalnız mevcut sayfayı etkiler; cross-page coverage backend'e bağımlı.
  const sortedFiltered = useMemo(() => {
    let result = allFiltered;

    if (patternCasesFilter?.caseIds?.length) {
      const allowed = new Set(patternCasesFilter.caseIds);
      result = result.filter((c) => allowed.has(c.id));
    }



    // Öncelik sıralamasında secondary sort: aynı öncelikte createdAt asc
    // (en uzun bekleyen üstte). Cross-page sıralama backend sort'a bağlı.
    if (sortKey === 'priority') {
      const ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      result = [...result].sort((a, b) => {
        const pa = ORDER[a.priority] ?? 4;
        const pb = ORDER[b.priority] ?? 4;
        if (pa !== pb) return sortDir === 'asc' ? pa - pb : pb - pa;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }

    return result;
  }, [allFiltered, patternCasesFilter, quickQueueFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'updatedAt' || key === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  }

  // Server pagination: sayfayı backend kesiyor, client'ta dilim yok.
  const totalPages = Math.max(1, Math.ceil(serverTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = sortedFiltered;
  const startIdx = serverTotal === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(safePage * pageSize, serverTotal);

  const hasActiveFilters =
    Boolean(filters.search) ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.priorities?.length ?? 0) > 0 ||
    (filters.caseType && filters.caseType !== 'Tümü') ||
    Boolean(filters.teamId) ||
    Boolean(filters.personId) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    Boolean(filters.customerMatchPending) ||
    Boolean(filters.pendingCustomerReply) ||
    Boolean(filters.assignedToMe) ||
    Boolean(filters.teamScope) ||
    Boolean(filters.slaViolation) ||
    Boolean(filters.resolvedToday);

  // "Filtrele" butonu rozetinde gösterilen aktif filtre boyut sayısı.
  // Search hariç — search bar arayüzde zaten görünür, panel rozetiyle çift saymak gereksiz.
  const activeFilterCount =
    ((filters.statuses?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.priorities?.length ?? 0) > 0 ? 1 : 0) +
    (filters.caseType && filters.caseType !== 'Tümü' ? 1 : 0) +
    (filters.teamId ? 1 : 0) +
    (filters.personId ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.customerMatchPending ? 1 : 0) +
    (filters.pendingCustomerReply ? 1 : 0) +
    (filters.assignedToMe ? 1 : 0) +
    (filters.teamScope ? 1 : 0) +
    (filters.slaViolation ? 1 : 0) +
    (filters.resolvedToday ? 1 : 0);

  function toggleStatus(s: CaseStatus) {
    setFilters((f) => {
      const cur = f.statuses ?? [];
      const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      return { ...f, statuses: next };
    });
    setSelectedKpi(null); // manuel status değişimi → KPI ring sıfırla
  }

  function togglePriority(p: CasePriority) {
    setFilters((f) => {
      const cur = f.priorities ?? [];
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      return { ...f, priorities: next };
    });
    setSelectedKpi(null); // manuel priority değişimi → KPI ring sıfırla
  }

  function clearFilters() {
    setFilters(initialFilters);
    // Filtre paneli temizliği KPI selection'ı da sıfırlasın — kullanıcı manuel
    // temizledikten sonra eski kart ring'i kalmasın (görsel tutarlılık).
    setSelectedKpi(null);
  }

  // Bulk select helpers
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAllVisible(check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pageItems) {
        if (check) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function applyBulkAssign(teamId: string, personId: string) {
    const ids = Array.from(selected);
    if (ids.length === 0 || !personId) return;
    setBulkSubmitting(true);
    const result = await caseService.bulkUpdate(ids, {
      assignedTeamId: teamId || undefined,
      assignedPersonId: personId,
    });
    setBulkSubmitting(false);
    setBulkField(null);
    if (!result) return;
    if (result.failed > 0) {
      toast({ type: 'warn', title: 'Kısmi başarı', message: `${result.updated} vaka güncellendi, ${result.failed} başarısız.`, duration: 5000 });
    } else {
      toast({ type: 'success', message: `${result.updated} vaka güncellendi.` });
    }
    clearSelection();
    void load();
    void refreshStats();
  }

  async function applyBulk(field: BulkField, value: string) {
    const ids = Array.from(selected);
    if (ids.length === 0 || !value) return;
    setBulkSubmitting(true);
    const result = await caseService.bulkUpdate(ids, { [field]: value } as Parameters<typeof caseService.bulkUpdate>[1]);
    setBulkSubmitting(false);
    setBulkField(null);
    if (!result) return; // apiFetch toast gösterdi

    if (result.failed > 0) {
      toast({
        type: 'warn',
        title: 'Kısmi başarı',
        message: `${result.updated} vaka güncellendi, ${result.failed} başarısız.`,
        duration: 5000,
      });
    } else {
      toast({ type: 'success', message: `${result.updated} vaka güncellendi.` });
    }
    clearSelection();
    void load();
    void refreshStats();
  }

  function handleAccountClick(e: React.MouseEvent, account: { id: string; name: string }) {
    e.stopPropagation();
    // Spec: müşteri linki → müşteri kartı. Tam modül FAZ 1+ kapsamında; FAZ 0 önizleme modali.
    onShowCustomer?.(account.id);
  }

  // WR-C1 — Üstlen / Claim. Row-level loading state; race conflict (409) apiFetch
  // tarafından toast'lanır + list refresh fresh durumu gösterir.
  const [claimingId, setClaimingId] = useState<string | null>(null);
  async function handleClaim(e: React.MouseEvent, caseId: string) {
    e.stopPropagation();
    if (claimingId) return;
    setClaimingId(caseId);
    const updated = await caseService.claimCase(caseId);
    setClaimingId(null);
    if (updated) {
      toast({ type: 'success', message: `Vaka üstlenildi: ${updated.assignedPersonName ?? 'sen'}` });
      // Business review Madde 5 — Üstlen başarılı olunca kullanıcıyı
      // doğrudan Case Detail'e götür. Eski davranış: liste sayfasında
      // kalıp güncellenmiş row'u gösteriyordu, kullanıcı tekrar tıklayıp
      // detaya gitmek zorundaydı. Toast + arka plan refresh aynen
      // korunuyor; load()/refreshStats() arka planda çalışır, ekran
      // doğrudan Case Detail olarak açılır.
      onSelectCase(updated.id);
      void load();
      void refreshStats();
    } else {
      // apiFetch zaten toast gösterdi (409 → "üstlenilmiş olabilir"); listeyi refresh et ki güncel durum görünsün.
      void load();
    }
  }
  /** WR-C1 — Claim koşulu: kapalı değil, atanmamış, kullanıcının personId'si var. */
  const canClaimCase = (c: { status: CaseStatus; assignedPersonId?: string | null }) =>
    !!user?.personId && !c.assignedPersonId && !CLOSED_STATUSES.includes(c.status);

  // Role-aware KPI cards — backend tek truth source (GET /api/cases/stats).
  // Mode rol bazlı: personal (Agent/Backoffice/CSM), team (Supervisor),
  // operations (Admin/SystemAdmin). Tile click → list filter intent + seçili
  // tile görsel hint. JSX dışına alındı ki tile sayısı (4 veya Havuz'lu 5)
  // grid kolon sayısını belirleyebilsin.
  const kpiTiles: React.ReactNode[] = (() => {
    // Color band per card category (spec: blue/red/green/amber)
    const TILE_BORDER = {
      blue: 'border-t-2 border-t-blue-500 dark:border-t-blue-600',
      red: 'border-t-2 border-t-rose-500 dark:border-t-rose-600',
      green: 'border-t-2 border-t-emerald-500 dark:border-t-emerald-600',
      amber: 'border-t-2 border-t-amber-500 dark:border-t-amber-600',
    } as const;
    type Color = keyof typeof TILE_BORDER;

    const tile = (
      id: string,
      label: string,
      value: number,
      color: Color,
      icon: React.ReactNode,
      onClick: () => void,
    ) => (
      <KpiTile
        key={id}
        label={label}
        value={value}
        icon={icon}
        tone={value === 0 ? 'slate' : (color === 'red' ? 'rose' : color === 'green' ? 'emerald' : color === 'amber' ? 'amber' : 'brand')}
        selected={selectedKpi === id}
        extraClassName={TILE_BORDER[color]}
        onClick={() => {
          setSelectedKpi(id);
          onClick();
        }}
      />
    );

    if (statsLoading && !caseStats) {
      return [0, 1, 2, 3].map((i) => (
        <div
          key={`skel-${i}`}
          className="h-[64px] animate-pulse rounded-xl bg-slate-100 dark:bg-ndark-card"
        />
      ));
    }

    // PERSONAL (Agent/Backoffice/CSM)
    if (caseStats?.mode === 'personal' && user?.personId) {
      const s = caseStats;
      const me = user.personId;
      const tiles: React.ReactNode[] = [];
      // Havuz — yalnız kullanıcının kendi takımı L2/L3 ise görünür (L1 zaten
      // kendi işini yönetir). En başa, "Bana Atanan"ın önüne konur.
      if (poolVisiblePersonal && myTeamId) {
        tiles.push(
          tile('personal.pool', 'Havuz', poolCount ?? 0, 'blue', <Boxes size={16} />, () => {
            // NOT: unassigned=true asıl olarak quickQueueFilter state'inden
            // okunuyor (bkz. load()) — filters.unassigned load()'da hiç
            // kullanılmıyor, sadece quickQueueFilter='unassigned' filtreyi
            // gerçekten uygular. İkisini birden set etmezsek atanmış
            // kayıtlar da listeye sızar.
            setFilters({ ...initialFilters, teamId: myTeamId });
            setQuickQueueFilter('unassigned');
            setInboxTab('open');
            setQuickFilter(null);
          }),
        );
      }
      tiles.push(
        tile('personal.assigned', 'Bana Atanan', s.assignedToMe, 'blue', <User size={16} />, () => {
          setFilters({ ...initialFilters, personId: me });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('personal.slaRiskMine', 'SLA Riskimde', s.slaRiskMine, 'red', <AlertCircle size={16} />, () => {
          setFilters({ ...initialFilters, personId: me, slaViolation: true });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('personal.resolvedToday', 'Bugün Çözdüm', s.resolvedToday, 'green', <CheckCircle2 size={16} />, () => {
          setFilters({ ...initialFilters, personId: me, resolvedToday: true });
          setInboxTab('closed');
          setQuickFilter(null);
          setQuickQueueFilter('all');
        }),
        tile('personal.snoozed', 'Ertelenenlerim', s.snoozedMine, 'amber', <Clock size={16} />, () => {
          setFilters(initialFilters);
          setQuickQueueFilter('all');
          setInboxTab('later');
          setQuickFilter(null);
        }),
      );
      return tiles;
    }

    // TEAM (Supervisor)
    if (caseStats?.mode === 'team') {
      const s = caseStats;
      return [
        // Havuz — Supervisor takım lideri persona kabul edilir, seviyeden
        // bağımsız her zaman görünür. En başa, "Ekibimde Açık"ın önüne konur.
        tile('team.pool', 'Havuz', poolCount ?? 0, 'blue', <Boxes size={16} />, () => {
          // NOT: unassigned=true asıl olarak quickQueueFilter state'inden
          // okunuyor (bkz. load()) — filters.unassigned load()'da hiç
          // kullanılmıyor, sadece quickQueueFilter='unassigned' filtreyi
          // gerçekten uygular. İkisini birden set etmezsek atanmış
          // kayıtlar da listeye sızar.
          setFilters({ ...initialFilters, teamScope: true });
          setQuickQueueFilter('unassigned');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('team.open', 'Ekibimde Açık', s.teamOpenCount, 'blue', <Inbox size={16} />, () => {
          setFilters({ ...initialFilters, teamScope: true });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('team.sla', 'Ekibimde SLA', s.teamSlaRisk, 'red', <ShieldAlert size={16} />, () => {
          setFilters({ ...initialFilters, teamScope: true, slaViolation: true });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('team.escalation', 'Eskale Edildi', s.teamEscalation, 'amber', <AlertCircle size={16} />, () => {
          setFilters({ ...initialFilters, teamScope: true, statuses: ['Eskalasyon'] });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('team.resolvedToday', 'Bugün Çözülen', s.teamResolvedToday, 'green', <CheckCircle2 size={16} />, () => {
          setFilters({ ...initialFilters, teamScope: true, resolvedToday: true });
          setInboxTab('closed');
          setQuickFilter(null);
          setQuickQueueFilter('all');
        }),
      ];
    }

    // OPERATIONS (Admin/SystemAdmin)
    if (caseStats?.mode === 'operations') {
      const s = caseStats;
      return [
        tile('ops.totalOpen', 'Toplam Açık', s.totalOpen, 'blue', <Inbox size={16} />, () => {
          setFilters(initialFilters);
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('ops.slaViolation', 'SLA İhlali', s.slaViolation, 'red', <ShieldAlert size={16} />, () => {
          setFilters({ ...initialFilters, slaViolation: true });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('ops.critical', 'Kritik', s.critical, 'red', <Flag size={16} />, () => {
          setFilters({ ...initialFilters, priorities: ['Critical'] });
          setQuickQueueFilter('all');
          setInboxTab('open');
          setQuickFilter(null);
        }),
        tile('ops.resolvedToday', 'Bugün Çözülen', s.resolvedToday, 'green', <CheckCircle2 size={16} />, () => {
          setFilters({ ...initialFilters, resolvedToday: true });
          setInboxTab('closed');
          setQuickFilter(null);
          setQuickQueueFilter('all');
        }),
      ];
    }

    // Stats fetch failed / empty scope — placeholder cards with "—".
    return [0, 1, 2, 3].map((i) => (
      <div
        key={`empty-${i}`}
        className="flex h-[64px] items-center justify-center rounded-xl bg-white text-sm text-slate-400 ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-muted dark:ring-ndark-border"
      >
        —
      </div>
    ));
  })();

  return (
    <div className="space-y-4">
      {patternCasesFilter && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div>
            <strong>Örüntü filtresi:</strong> {patternCasesFilter.label} —{' '}
            <span className="font-mono">{patternCasesFilter.caseIds.length}</span> vaka
          </div>
          {onClearPatternFilter && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<X size={12} />}
              onClick={onClearPatternFilter}
            >
              Filtreyi Kaldır
            </Button>
          )}
        </div>
      )}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">Vakalar</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Müşteri talep, şikayet ve olaylarını tek listeden yönetin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            leftIcon={<RotateCw size={14} />}
            onClick={() => {
              void load();
              void refreshStats();
            }}
          >
            Yenile
          </Button>
          {onOpenCustomerSearch && (
            <Button
              variant="outline"
              leftIcon={<Search size={14} />}
              onClick={onOpenCustomerSearch}
              title="Telefon veya isim ile müşteri ara"
            >
              Müşteri Ara
            </Button>
          )}
          {featureFlags.quickCaseEnabled && (
            <Button
              variant="outline"
              leftIcon={<Zap size={14} className="text-amber-500" />}
              onClick={() => {
                setQuickPrefillAccount(null);
                setQuickOpen(true);
              }}
              title="Hızlı vaka aç (q)"
            >
              Hızlı Vaka
            </Button>
          )}
          <Button leftIcon={<Plus size={14} />} onClick={() => setNewOpen(true)}>
            Yeni Vaka
          </Button>
          {onOpenSmartTicket && (
            <Button
              // RUNA AI brand'ı projede her yerde violet — Akıllı Ticket
              // butonu da AI akışına işaret etsin diye violet→fuchsia
              // gradient. variant="outline" base ring'ini override etmek
              // için className kullanılıyor.
              variant="outline"
              leftIcon={<Sparkles size={14} className="text-white" />}
              onClick={onOpenSmartTicket}
              title="Akıllı Ticket akışıyla vaka aç (RUNA AI)"
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white ring-0 hover:from-violet-700 hover:to-fuchsia-700 dark:from-violet-700 dark:to-fuchsia-700 dark:hover:from-violet-600 dark:hover:to-fuchsia-600"
            >
              Akıllı Ticket
            </Button>
          )}
        </div>
      </div>

      {/*
        Role-aware KPI cards — backend tek truth source (GET /api/cases/stats).
        Havuz kartı dahilse (personal L2/L3 veya team/Supervisor) 5 kart olur;
        grid kolon sayısı buna göre genişler (kpiTiles component'in üstünde
        hesaplanır, bkz. yukarı).
      */}
      <div className={cn('grid grid-cols-2 gap-3', kpiTiles.length >= 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        {kpiTiles}
      </div>

      {/*
        AI Briefing — KPI'ların altında tek satır. 3 olası mesaj:
          - pattern: Supervisor+ için aktif örüntü alarmı varsa (Detay → patterns sayfası)
          - sla: SLA ihlali sayısı > 0 (Detay → quickFilter='slaRisk')
          - ok: hiçbiri yoksa "kontrol altında"
        sessionStorage'da dismiss kalıcı (sayfa yenilense bile).
      */}
      {briefingState && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex min-w-0 items-center gap-2 text-amber-900 dark:text-amber-200">
            <Sparkles size={14} className="shrink-0 text-violet-600 dark:text-violet-400" />
            <span className="truncate">
              {briefingState === 'pattern' && (
                <>
                  📊 Örüntü alarmı: <strong>{activePatterns[0].category}</strong> kategorisinde son{' '}
                  {activePatterns[0].windowMinutes} dakikada {activePatterns[0].caseCount} vaka açıldı
                  {activePatterns.length > 1 && (
                    <span className="ml-1 text-amber-700 dark:text-amber-300">
                      (+{activePatterns.length - 1} daha)
                    </span>
                  )}
                </>
              )}
              {briefingState === 'sla' && (
                <>
                  ⚠️ <strong>{briefingSlaCount}</strong>{' '}
                  {isFrontline ? 'vakanızda' : 'vakada'} SLA ihlali var
                </>
              )}
              {briefingState === 'ok' && <>✓ Tüm vakalar kontrol altında</>}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {briefingState === 'pattern' && onShowPatterns && (
              <button
                type="button"
                onClick={onShowPatterns}
                className="rounded-md px-2 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:bg-amber-100 hover:underline dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                Detay →
              </button>
            )}
            {briefingState === 'sla' && (
              <button
                type="button"
                onClick={() => {
                  if (isFrontline && user?.personId) {
                    setFilters({ ...initialFilters, personId: user.personId });
                  }
                  setInboxTab('open');
                  setQuickFilter('slaRisk');
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:bg-amber-100 hover:underline dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                Detay →
              </button>
            )}
            <button
              type="button"
              onClick={dismissBriefing}
              title="Bu oturum için kapat"
              className="rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* QuickFilter aktifken bilgi şeridi — kullanıcı neden filtrelendiğini görsün. */}
      {quickFilter && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
          <div>
            <strong className="font-medium">Hızlı filtre:</strong>{' '}
            {quickFilter === 'slaRisk' ? 'SLA ihlali olan vakalar' : 'Bugün çözülen vakalar'}
          </div>
          <Button size="sm" variant="ghost" leftIcon={<X size={12} />} onClick={() => setQuickFilter(null)}>
            Kaldır
          </Button>
        </div>
      )}

      <Card>
        {/* Inbox sekmeleri — Tümü / Açık / Ertelendi / Kapalı (Genel #45) */}
        <div className="flex items-center gap-1 border-b border-slate-200 px-3 pt-2">
          <InboxTabButton
            label="Tümü"
            icon={<Layers size={13} />}
            active={inboxTab === 'all'}
            onClick={() => { setFilters((f) => ({ ...f, personId: undefined, assignedToMe: false, teamScope: false, slaViolation: false, resolvedToday: false })); setQuickQueueFilter('all'); setInboxTab('all'); }}
          />
          <InboxTabButton
            label="Açık"
            icon={<Inbox size={13} />}
            active={inboxTab === 'open'}
            onClick={() => { setFilters((f) => ({ ...f, personId: undefined, assignedToMe: false, teamScope: false, slaViolation: false, resolvedToday: false })); setQuickQueueFilter('all'); setInboxTab('open'); }}
          />
          <InboxTabButton
            label="Ertelendi"
            icon={<Clock3 size={13} />}
            active={inboxTab === 'later'}
            onClick={() => { setFilters((f) => ({ ...f, personId: undefined, assignedToMe: false, teamScope: false, slaViolation: false, resolvedToday: false })); setQuickQueueFilter('all'); setInboxTab('later'); }}
          />
          <InboxTabButton
            label="Kapalı"
            icon={<Check size={13} />}
            active={inboxTab === 'closed'}
            onClick={() => { setFilters((f) => ({ ...f, personId: undefined, assignedToMe: false, teamScope: false, slaViolation: false, resolvedToday: false })); setQuickQueueFilter('all'); setInboxTab('closed'); }}
          />
        </div>

        {/*
          Filter bar — kompakt tek satır.
          Search + Filtrele (popover panel) + Sırala + sonuç sayısı.
          Önceki 3 satırlık chip + dropdown grid'i panele taşındı.
        */}
        <div className="border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                ref={searchInputRef}
                placeholder="Vaka no, başlık veya müşteri ara... (/ ile odak)"
                value={filters.search ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="pl-8 pr-12"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
                /
              </kbd>
            </div>

            <Popover
              align="end"
              width={380}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                    open || activeFilterCount > 0
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg',
                  )}
                >
                  <Filter size={14} />
                  <span>Filtrele</span>
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              )}
            >
              {({ close }) => (
                <div className="space-y-3">
                  <FilterPanelSection label="Tip">
                    <Select
                      value={filters.caseType ?? 'Tümü'}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, caseType: e.target.value as CaseFilters['caseType'] }))
                      }
                      className="h-8 w-full py-1"
                    >
                      <option value="Tümü">Tümü</option>
                      {CASE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {CASE_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </FilterPanelSection>

                  <FilterPanelSection label="Statü">
                    <div className="grid grid-cols-2 gap-1.5">
                      {CASE_STATUSES.map((s) => (
                        <label
                          key={s}
                          className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text"
                        >
                          <input
                            type="checkbox"
                            checked={filters.statuses?.includes(s) ?? false}
                            onChange={() => toggleStatus(s)}
                            className="h-4 w-4 cursor-pointer accent-brand-600"
                          />
                          <span className="truncate">{STATUS_LABELS_SHORT[s]}</span>
                        </label>
                      ))}
                    </div>
                  </FilterPanelSection>

                  {/* Phase D — Müşteri Eşleştirme Bekleyen: Supervisor+ rolleri. */}
                  {user && ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'].includes(user.role) && (
                    <FilterPanelSection label="Müşteri">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
                        <input
                          type="checkbox"
                          checked={filters.customerMatchPending === true}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              customerMatchPending: e.target.checked ? true : undefined,
                            }))
                          }
                          className="h-4 w-4 cursor-pointer accent-brand-600"
                        />
                        <span>Yalnız müşteri eşleştirilmemiş vakalar</span>
                      </label>
                    </FilterPanelSection>
                  )}

                  {/* M6.3b Faz 1 — "Yanıt bekliyor" filtre (tüm roller). */}
                  <FilterPanelSection label="E-posta">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
                      <input
                        type="checkbox"
                        checked={filters.pendingCustomerReply === true}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            pendingCustomerReply: e.target.checked ? true : undefined,
                          }))
                        }
                        className="h-4 w-4 cursor-pointer accent-brand-600"
                      />
                      <span>Yalnız müşteri yanıtı bekleyenler</span>
                    </label>
                  </FilterPanelSection>

                  <FilterPanelSection label="Öncelik">
                    <div className="grid grid-cols-2 gap-1.5">
                      {CASE_PRIORITIES.map((p) => (
                        <label
                          key={p}
                          className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text"
                        >
                          <input
                            type="checkbox"
                            checked={filters.priorities?.includes(p) ?? false}
                            onChange={() => togglePriority(p)}
                            className="h-4 w-4 cursor-pointer accent-brand-600"
                          />
                          <span>{CASE_PRIORITY_LABELS[p]}</span>
                        </label>
                      ))}
                    </div>
                  </FilterPanelSection>

                  <FilterPanelSection label="Takım">
                    <Select
                      value={filters.teamId ?? ''}
                      onChange={(e) =>
                        setFilters((f) => ({
                          ...f,
                          teamId: e.target.value,
                          personId: e.target.value && f.personId ? '' : f.personId,
                        }))
                      }
                      className="h-8 w-full py-1"
                    >
                      <option value="">Tümü</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </FilterPanelSection>

                  <FilterPanelSection label="Kişi">
                    <Select
                      value={filters.personId ?? ''}
                      onChange={(e) => setFilters((f) => ({ ...f, personId: e.target.value }))}
                      className="h-8 w-full py-1"
                    >
                      <option value="">Tümü</option>
                      {personsForFilter.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </FilterPanelSection>

                  <FilterPanelSection label="Tarih">
                    <div className="flex items-center gap-2">
                      <TextInput
                        type="date"
                        value={filters.dateFrom ?? ''}
                        onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                        className="h-8 flex-1 py-1"
                      />
                      <span className="text-xs text-slate-400">→</span>
                      <TextInput
                        type="date"
                        value={filters.dateTo ?? ''}
                        onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                        className="h-8 flex-1 py-1"
                      />
                    </div>
                  </FilterPanelSection>

                  {/* PR-SD — Arşivlenenleri göster: yalnız SystemAdmin. Backend
                      includeArchived rol guard'ı her durumda enforce eder; UI
                      sadece chip görünürlüğünü kapatır. */}
                  {user?.role === 'SystemAdmin' && (
                    <FilterPanelSection label="Arşiv">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-ndark-text">
                        <input
                          type="checkbox"
                          checked={filters.includeArchived === true}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              includeArchived: e.target.checked || undefined,
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Arşivlenenleri göster
                      </label>
                    </FilterPanelSection>
                  )}

                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-ndark-border">
                    {hasActiveFilters ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<X size={12} />}
                        onClick={() => {
                          clearFilters();
                          close();
                        }}
                      >
                        Filtreleri Temizle
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-ndark-muted">Aktif filtre yok</span>
                    )}
                    <Button size="sm" onClick={close}>
                      Kapat
                    </Button>
                  </div>
                </div>
              )}
            </Popover>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-ndark-muted">Sırala:</span>
              <Select
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split(':');
                  setSortKey(k as SortKey);
                  setSortDir(d as SortDir);
                  setPage(1);
                }}
                className="h-8 py-1 text-xs"
              >
                {SORT_DROPDOWN_OPTIONS.map((opt) => (
                  <option key={`${opt.key}:${opt.dir}`} value={`${opt.key}:${opt.dir}`}>
                    {opt.label}
                  </option>
                ))}
                {!SORT_DROPDOWN_OPTIONS.some((o) => o.key === sortKey && o.dir === sortDir) && (
                  <option value={`${sortKey}:${sortDir}`}>
                    Özel: {sortKey} ({sortDir === 'asc' ? 'artan' : 'azalan'})
                  </option>
                )}
              </Select>
            </div>

            {/* Hızlı kuyruk filtreleri — server-side, tüm kayıtlar üzerinde çalışır */}
            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'all' as const,        label: 'Tümü',       count: null },
                  { key: 'unassigned' as const, label: 'Atanmamış',  count: caseStats?.unassigned ?? null },
                  { key: 'critical' as const,   label: 'Kritik',     count: caseStats?.critical ?? null },
                ] satisfies { key: QuickQueueFilter; label: string; count: number | null }[]
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQuickQueueFilter(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    quickQueueFilter === key
                      ? key === 'critical'
                        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
                        : key === 'unassigned'
                        ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                        : 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg',
                  )}
                >
                  {label}
                  {count !== null && count > 0 && (
                    <span className="rounded-full bg-current/10 px-1 text-[10px] tabular-nums">{count}</span>
                  )}
                </button>
              ))}
            </div>

            <Badge tint="slate" icon={<Filter size={12} />}>
              {serverTotal} sonuç
            </Badge>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-ndark-border">
            <thead className="bg-slate-50 dark:bg-ndark-card">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={pageItems.length > 0 && pageItems.every((c) => selected.has(c.id))}
                    ref={(el) => {
                      if (!el) return;
                      const someSel = pageItems.some((c) => selected.has(c.id));
                      const allSel = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));
                      el.indeterminate = someSel && !allSel;
                    }}
                    onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-brand-600"
                    title="Görünen sayfayı seç / kaldır"
                  />
                </th>
                <SortableTh label="Vaka No"        sortKey="caseNumber"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Başlık / Müşteri" sortKey="title"     currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Tip"            sortKey="caseType"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Kaynak</th>
                <SortableTh label="Statü"          sortKey="status"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">3. Parti</th>
                <SortableTh label="Öncelik"        sortKey="priority"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Atama"          sortKey="assignment"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2">TAKIM</th>
                <SortableTh label="Açılış"         sortKey="createdAt"   currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="SLA"            sortKey="sla"         currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Son Güncelleme" sortKey="updatedAt"   currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ndark-border/60">
              {loading &&
                Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} cols={12} />)}
              {!loading && serverTotal === 0 && (
                <tr>
                  <td colSpan={12} className="px-4">
                    {hasActiveFilters ? (
                      <EmptyState
                        icon={<SearchX size={22} />}
                        title="Filtrelere uyan vaka bulunamadı"
                        description="Daha geniş bir arama için filtreleri gözden geçirebilirsin."
                        action={
                          <Button size="sm" variant="outline" leftIcon={<X size={12} />} onClick={clearFilters}>
                            Filtreleri Temizle
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState
                        icon={<Inbox size={22} />}
                        title="Henüz vaka yok"
                        description="İlk vakayı oluşturarak başlayın."
                        action={
                          <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setNewOpen(true)}>
                            Yeni Vaka
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
              {!loading &&
                pageItems.map((c) => {
                  // Later sekmesinde BE'den gelen expired flag'i ve snoozeUntil
                  // ile satır rengi + alt etiket kararı ver. Diğer sekmelerde
                  // expired her zaman false olarak ele alınır.
                  const snoozeMeta = inboxTab === 'later'
                    ? (c as Case & { expired?: boolean })
                    : null;
                  const expired = Boolean(snoozeMeta?.expired);
                  const isSelected = selected.has(c.id);
                  const isUnassignedOpen = !c.assignedPersonId && !CLOSED_STATUSES.includes(c.status);
                  // Öncelik: expired (amber) > selected (brand) > atanmamış (slate) > default hover
                  const rowBg = expired
                    ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                    : isSelected
                    ? 'bg-brand-50/60 hover:bg-brand-50 dark:bg-brand-950/30'
                    : isUnassignedOpen
                    ? 'bg-slate-50/80 hover:bg-slate-100 dark:bg-slate-800/20 dark:hover:bg-slate-800/40'
                    : 'hover:bg-brand-50 dark:hover:bg-brand-950/20';
                  return (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCase(c.id)}
                    className={`cursor-pointer text-sm ${rowBg}`}
                  >
                    <Td className={cn('w-10 border-l-[3px]', PRIORITY_STRIPE[c.priority as CasePriority] ?? 'border-l-slate-200 dark:border-l-slate-600')}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(c.id)}
                        className="h-4 w-4 cursor-pointer accent-brand-600"
                        aria-label={`${c.caseNumber} seç`}
                      />
                    </Td>
                    <Td className="font-mono text-xs text-slate-600 dark:text-ndark-muted">{c.caseNumber}</Td>
                    <Td className="max-w-[360px]">
                      <div className="flex items-center gap-1.5">
                        {/* 2026-07-04 PR-2 — subject normalize + tooltip */}
                        <div
                          className="truncate text-sm font-medium text-slate-900 dark:text-ndark-text"
                          title={isSubjectNormalized(c.title) ? c.title : undefined}
                        >
                          {normalizeSubject(c.title)}
                        </div>
                        {(c.linkCount ?? 0) > 0 && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/40"
                            title={`${c.linkCount} bağlantılı vaka`}
                          >
                            <LinkIcon size={9} />
                            {c.linkCount}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleAccountClick(e, { id: c.accountId, name: c.accountName })}
                        className="mt-0.5 block w-full truncate text-left text-xs text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline dark:text-ndark-muted dark:hover:text-brand-300"
                      >
                        {c.accountName}
                      </button>
                      {/* WR-A4 / PM-04 — Proje bağı varsa ince violet chip. */}
                      {c.accountProjectName && (
                        <span
                          className="mt-1 inline-flex w-fit max-w-full items-center gap-1 truncate rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/40"
                          title={`Proje: ${c.accountProjectName}`}
                        >
                          📁 <span className="truncate">{c.accountProjectName}</span>
                        </span>
                      )}
                      {/* Phase D — Müşteri eşleştirilmemiş vakalar için amber rozet (tüm roller görür). */}
                      {c.customerMatchPending && (
                        <span
                          className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-900/40"
                          title="Bu vakaya henüz müşteri eşleştirilmedi"
                        >
                          ⚠ Müşteri yok
                        </span>
                      )}
                      {/* M6.3b Faz 1 — "Yanıt bekliyor" rozeti (compact).
                          Codex review fix — duration kaynağı lastEmailInboundAt
                          (müşterinin bekleyen mail'i), outbound DEĞİL. */}
                      {c.pendingCustomerReply && (
                        <div className="mt-1">
                          <PendingReplyBadge
                            pending={c.pendingCustomerReply}
                            lastEmailInboundAt={c.lastEmailInboundAt}
                            size="sm"
                          />
                        </div>
                      )}
                      {snoozeMeta?.snoozeUntil && (
                        <div
                          className={`mt-0.5 text-xs ${
                            expired ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-ndark-muted'
                          }`}
                        >
                          {expired
                            ? `⏰ ${formatSnoozeAgo(snoozeMeta.snoozeUntil)}`
                            : `🕐 ${formatSnoozeIn(snoozeMeta.snoozeUntil)}`}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <CaseTypeBadge type={c.caseType} />
                    </Td>
                    <Td>
                      {(() => {
                        const cfg = ORIGIN_CFG[c.origin ?? ''];
                        if (!cfg) return <span className="text-slate-400 dark:text-ndark-muted">—</span>;
                        return (
                          <span
                            title={c.originDescription ?? c.origin}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {cfg.icon}
                          </span>
                        );
                      })()}
                    </Td>
                    <Td>
                      <StatusPill status={c.status} />
                    </Td>
                    <Td className="text-xs text-slate-700 dark:text-ndark-text">
                      {c.thirdPartyName
                        ? <span className="truncate max-w-[120px] inline-block" title={c.thirdPartyName}>{c.thirdPartyName}</span>
                        : <span className="text-slate-400 dark:text-ndark-muted">—</span>}
                    </Td>
                    <Td>
                      <PriorityBadge priority={c.priority} />
                    </Td>
                    <Td className="text-slate-700 dark:text-ndark-text">
                      {/* WR-C1 review fix — Claim eligibility person-only (assignedPersonId IS NULL).
                          Render sırası:
                            1) atanmış kişi varsa adını göster
                            2) claim eligible → Üstlen butonu + bekleme çipi
                            3) atanmamış açık ama claim yetkisi yok → takım + bekleme çipi
                            4) atanmış takım → takım adı
                            5) yoksa dash. */}
                      {c.assignedPersonName ? (
                        c.assignedPersonName
                      ) : canClaimCase(c) ? (
                        <button
                          type="button"
                          onClick={(e) => handleClaim(e, c.id)}
                          disabled={claimingId === c.id}
                          className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200 dark:hover:bg-brand-950/50"
                          title="Bu vakayı üstlen"
                        >
                          {claimingId === c.id ? 'Üstleniliyor…' : 'Üstlen'}
                        </button>
                      ) : c.assignedTeamName ? (
                        c.assignedTeamName
                      ) : (
                        <span className="text-slate-400 dark:text-ndark-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-600 dark:text-ndark-muted">
                      {c.assignedTeamName ?? <span className="text-slate-400 dark:text-ndark-muted">—</span>}
                    </Td>
                    <Td className="text-xs text-slate-500 dark:text-ndark-muted">
                      <span title={formatDateTime(c.createdAt)}>{formatRelative(c.createdAt)}</span>
                    </Td>
                    <Td>
                      <SlaPill
                        slaViolation={c.slaViolation}
                        slaPausedAt={c.slaPausedAt}
                        slaResolutionDueAt={c.slaResolutionDueAt}
                      />
                    </Td>
                    <Td className="text-xs text-slate-500 dark:text-ndark-muted">
                      <span title={formatDateTime(c.updatedAt)}>{formatRelative(c.updatedAt)}</span>
                    </Td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && serverTotal > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>
                {startIdx}–{endIdx} / {serverTotal}
              </span>
              <span className="text-slate-400">·</span>
              <span>Sayfa başına:</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 w-auto py-1 pr-6 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<ChevronLeft size={14} />}
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Önceki
              </Button>
              <span className="text-xs text-slate-600">
                Sayfa <strong>{safePage}</strong> / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                rightIcon={<ChevronRight size={14} />}
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Sonraki
              </Button>
            </div>
          </div>
        )}
      </Card>

      <NewCaseForm
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          setNewPrefill(null);
        }}
        onCreated={(c) => {
          setNewOpen(false);
          setNewPrefill(null);
          void load();
          onSelectCase(c.id);
          toast({
            type: 'success',
            title: 'Vaka oluşturuldu',
            message: `${c.caseNumber} — ${c.title}`,
          });
        }}
        onShowExisting={(id) => {
          setNewOpen(false);
          setNewPrefill(null);
          onSelectCase(id);
        }}
        initialContext={newPrefill ?? undefined}
      />

      <QuickCaseModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        prefillAccountId={quickPrefillAccount}
        onCreated={(c) => {
          void load();
          onSelectCase(c.id);
        }}
      />

      {/* Bulk action bar — 1+ vaka seçiliyken görünür */}
      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          onClear={clearSelection}
          onAction={(field) => setBulkField(field)}
          submitting={bulkSubmitting}
        />
      )}

      {/* Bulk action modal — field bazlı seçim + onay */}
      {bulkField === 'assign' && (
        <BulkAssignModal
          count={selected.size}
          teams={teams}
          persons={personsAll}
          submitting={bulkSubmitting}
          onClose={() => setBulkField(null)}
          onApply={(teamId, personId) => void applyBulkAssign(teamId, personId)}
        />
      )}
      {bulkField && bulkField !== 'assign' && (
        <BulkActionModal
          field={bulkField}
          count={selected.size}
          submitting={bulkSubmitting}
          onClose={() => setBulkField(null)}
          onApply={(value) => void applyBulk(bulkField, value)}
        />
      )}
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`group cursor-pointer select-none whitespace-nowrap px-4 py-2.5 transition-colors ${
        isActive
          ? 'bg-blue-50 text-brand-700'
          : 'hover:bg-slate-100 hover:text-slate-700'
      }`}
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive ? (
          currentDir === 'asc' ? (
            <ArrowUp size={11} className="text-brand-600" />
          ) : (
            <ArrowDown size={11} className="text-brand-600" />
          )
        ) : (
          <ArrowUpDown size={11} className="text-slate-300 group-hover:text-slate-400" />
        )}
      </div>
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${className ?? ''}`}>{children}</td>;
}

// Snooze rozetleri için TR-özel relative format. formatRelative'i kullanmadık
// çünkü "x dakika önce" gibi muğlak çıktılar yerine "uyandı / uyanacak" sonekli
// netlik istiyoruz.
function formatSnoozeAgo(when: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 60000));
  if (diffMin < 1) return 'şimdi uyandı';
  if (diffMin < 60) return `${diffMin} dakika önce uyandı`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} saat önce uyandı`;
  return `${Math.round(diffHr / 24)} gün önce uyandı`;
}

function formatSnoozeIn(when: string): string {
  const diffMin = Math.max(0, Math.round((new Date(when).getTime() - Date.now()) / 60000));
  if (diffMin < 1) return 'birazdan uyanacak';
  if (diffMin < 60) return `${diffMin} dakika sonra uyanacak`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} saat sonra uyanacak`;
  return `${Math.round(diffHr / 24)} gün sonra uyanacak`;
}

// Floating action bar — selection > 0 iken bottom-center'da render edilir.
// Kullanıcı 4 alandan birini seçer; modal o alana göre açılır.
function BulkActionBar({
  count,
  onClear,
  onAction,
  submitting,
}: {
  count: number;
  onClear: () => void;
  onAction: (field: BulkField) => void;
  submitting: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Toplu işlem barı"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-2xl ring-1 ring-slate-900/5 dark:border-ndark-border dark:bg-ndark-card dark:ring-white/5"
    >
      <span className="px-1 text-sm font-medium text-slate-700 dark:text-ndark-text">
        <span className="font-semibold text-brand-700 dark:text-brand-400">{count}</span> vaka seçildi
      </span>
      <span className="h-5 w-px bg-slate-200 dark:bg-ndark-border" />
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Users2 size={12} />}
        disabled={submitting}
        onClick={() => onAction('assign')}
      >
        Atama Yap
      </Button>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Flag size={12} />}
        disabled={submitting}
        onClick={() => onAction('priority')}
      >
        Öncelik Değiştir
      </Button>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Tag size={12} />}
        disabled={submitting}
        onClick={() => onAction('status')}
      >
        Durum Değiştir
      </Button>
      <span className="h-5 w-px bg-slate-200 dark:bg-ndark-border" />
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Trash2 size={12} />}
        disabled={submitting}
        onClick={onClear}
      >
        Temizle
      </Button>
    </div>
  );
}

// Bulk action modal — öncelik/durum değişimi için tek adımlı select + onayla.
function BulkActionModal({
  field,
  count,
  submitting,
  onClose,
  onApply,
}: {
  field: Exclude<BulkField, 'assign'>;
  count: number;
  submitting: boolean;
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [value, setValue] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(count <= 10);
  const needsConfirm = count > 10 && !confirmed;

  const config: Record<Exclude<BulkField, 'assign'>, { title: string; label: string; options: { value: string; label: string }[] }> = {
    priority: {
      title: 'Toplu — Öncelik Değiştir',
      label: 'Yeni öncelik',
      options: CASE_PRIORITIES.map((p) => ({ value: p, label: CASE_PRIORITY_LABELS[p] })),
    },
    status: {
      title: 'Toplu — Durum Değiştir',
      label: 'Yeni statü',
      options: BULK_STATUSES.map((s) => ({ value: s, label: s })),
    },
  };

  const c = config[field];

  return (
    <Modal
      open
      onClose={onClose}
      title={c.title}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          {needsConfirm ? (
            <Button onClick={() => setConfirmed(true)}>Anladım, devam et</Button>
          ) : (
            <Button onClick={() => onApply(value)} disabled={!value || submitting}>
              {submitting ? 'Uygulanıyor…' : 'Uygula'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
          <strong>{count}</strong> vaka üzerinde işlem yapılacak.
        </div>
        {needsConfirm ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-medium">Dikkat — büyük toplu işlem</div>
            <p className="mt-1 text-xs">
              10'dan fazla vaka tek seferde değişecek. İşlem geri alınamaz; her vaka için ayrı
              activity log yazılır. Yine de devam etmek istiyor musun?
            </p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text">
              {c.label}
            </label>
            <Select value={value} onChange={(e) => setValue(e.target.value)} autoFocus>
              <option value="">— Seçiniz —</option>
              {c.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </Modal>
  );
}

// 2 adımlı atama modalı — önce takım, sonra o takıma bağlı kişiler.
function BulkAssignModal({
  count,
  teams,
  persons,
  submitting,
  onClose,
  onApply,
}: {
  count: number;
  teams: ReturnType<typeof lookupService.teams>;
  persons: ReturnType<typeof lookupService.persons>;
  submitting: boolean;
  onClose: () => void;
  onApply: (teamId: string, personId: string) => void;
}) {
  const [teamId, setTeamId] = useState<string>('');
  const [personId, setPersonId] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(count <= 10);
  const needsConfirm = count > 10 && !confirmed;

  const filteredPersons = teamId
    ? persons.filter((p) => p.teamId === teamId)
    : persons;

  return (
    <Modal
      open
      onClose={onClose}
      title="Toplu — Atama Yap"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          {needsConfirm ? (
            <Button onClick={() => setConfirmed(true)}>Anladım, devam et</Button>
          ) : (
            <Button onClick={() => onApply(teamId, personId)} disabled={!personId || submitting}>
              {submitting ? 'Uygulanıyor…' : 'Uygula'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
          <strong>{count}</strong> vaka üzerinde işlem yapılacak.
        </div>
        {needsConfirm ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-medium">Dikkat — büyük toplu işlem</div>
            <p className="mt-1 text-xs">
              10'dan fazla vaka tek seferde değişecek. İşlem geri alınamaz; her vaka için ayrı
              activity log yazılır. Yine de devam etmek istiyor musun?
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text">
                Takım
              </label>
              <Select
                value={teamId}
                onChange={(e) => { setTeamId(e.target.value); setPersonId(''); }}
                autoFocus
              >
                <option value="">— Takım seçiniz —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text">
                Kişi
              </label>
              <Select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                disabled={filteredPersons.length === 0}
              >
                <option value="">— Kişi seçiniz —</option>
                {filteredPersons.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function InboxTabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-brand-600 font-medium text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

type KpiTone = 'slate' | 'brand' | 'rose' | 'amber' | 'emerald';

const KPI_TONE: Record<KpiTone, { iconBg: string; valueColor: string }> = {
  slate: {
    iconBg: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    valueColor: 'text-slate-900 dark:text-ndark-text',
  },
  brand: {
    iconBg: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    valueColor: 'text-slate-900 dark:text-ndark-text',
  },
  rose: {
    iconBg: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    valueColor: 'text-rose-700 dark:text-rose-300',
  },
  amber: {
    iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    valueColor: 'text-slate-900 dark:text-ndark-text',
  },
  emerald: {
    iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    valueColor: 'text-slate-900 dark:text-ndark-text',
  },
};

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'slate',
  onClick,
  selected = false,
  extraClassName,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ReactNode;
  tone?: KpiTone;
  onClick?: () => void;
  selected?: boolean;
  extraClassName?: string;
}) {
  const t = KPI_TONE[tone];
  const baseClass = cn(
    'flex items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 shadow-card',
    'dark:bg-ndark-card dark:ring-ndark-border',
    extraClassName,
  );
  const interactiveClass = onClick
    ? cn(
        'cursor-pointer transition-colors hover:ring-brand-300 hover:bg-slate-50 dark:hover:ring-brand-700 dark:hover:bg-ndark-bg',
        selected && 'ring-2 ring-brand-500 dark:ring-brand-600',
      )
    : '';
  const inner = (
    <>
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', t.iconBg)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
          {label}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-xl font-semibold tabular-nums',
              value === 0 ? 'text-slate-400 dark:text-ndark-muted' : t.valueColor,
            )}
          >
            {value}
          </span>
          {hint && <span className="text-[11px] text-slate-500 dark:text-ndark-muted">{hint}</span>}
        </div>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(baseClass, interactiveClass)}>
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

/**
 * SLA pill — yalnızca anlamlı durumlarda renkli pill.
 * - İhlal → RED kalın
 * - Duraklatıldı → slate
 * - Kalan süre ≤ 2 saat → AMBER (uyarı)
 * - Normal süre veya tarihsiz → "—" (pill yok)
 *
 * Backend SLA başlangıç süresini göndermediği için "uyarı" eşiği yaklaşık (<2 sa);
 * gerçek %80 hesabı için backend desteği gerekir.
 */
function SlaPill({
  slaViolation,
  slaPausedAt,
  slaResolutionDueAt,
}: {
  slaViolation: boolean;
  slaPausedAt?: string;
  slaResolutionDueAt?: string;
}) {
  if (slaViolation) {
    return <Badge tint="rose"><span className="font-bold">İhlal</span></Badge>;
  }
  if (slaPausedAt) {
    return <Badge tint="slate">Duraklatıldı</Badge>;
  }
  if (!slaResolutionDueAt) {
    return <span className="text-xs text-slate-400 dark:text-ndark-muted">—</span>;
  }
  const remainingMs = new Date(slaResolutionDueAt).getTime() - Date.now();
  if (remainingMs > 0 && remainingMs <= 2 * 60 * 60 * 1000) {
    return <Badge tint="amber">{formatRelative(slaResolutionDueAt)}</Badge>;
  }
  // Normal aralık — sade dash, pill yok. Sortable kaldı: BE remaining hesaplıyor.
  return <span className="text-xs text-slate-400 dark:text-ndark-muted">—</span>;
}

// Filtrele popover'ı içindeki etiketli grup wrapper'ı.
function FilterPanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
        {label}
      </div>
      {children}
    </div>
  );
}
