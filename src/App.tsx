import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  Building2,
  Calendar,
  Eye,
  Home,
  Inbox,
  ChevronDown,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  FileSpreadsheet,
  FileText,
  LogOut,
  Mail,
  Network,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Settings2,
  ShieldCheck,
  Star,
  Gauge,
  Sun,
} from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { L1CaseResolutionConsole } from './features/cases/L1CaseResolutionConsole';
import { MentionBellBadge } from './features/cases/components/MentionBellBadge';
import { ActionCenterBell } from './features/action-center/ActionCenterBell';
import { featureFlags } from './config/featureFlags';
import { OperationsDashboardPage } from './features/analytics/OperationsDashboardPage';
import { CaseReportStudioPage } from './features/reports/CaseReportStudioPage';
import { MonthlyBulletinPage } from './features/reports/MonthlyBulletinPage';
import { RootCauseReportPage } from './features/analytics/RootCauseReportPage';
import { AIUsagePage } from './features/analytics/AIUsagePage';
import { PatternsPage } from './features/analytics/PatternsPage';
import { QAScoresPage } from './features/analytics/QAScoresPage';
import { PeoplePerformancePage } from './features/analytics/PeoplePerformancePage';
import { MyCalendarPage } from './features/my/MyCalendarPage';
import { MyHomePage } from './features/my/MyHomePage';
import { WatcherInboxPage } from './features/my/WatcherInboxPage';
import { analyticsService } from './services/analyticsService';
import { myService } from './services/myService';
import { CustomerCardModal } from './features/customers/CustomerCardModal';
import { CustomerSearchModal } from './features/customers/CustomerSearchModal';
import { AdminThirdPartyPage } from './features/admin/AdminThirdPartyPage';
import { AdminDocumentsPage } from './features/admin/AdminDocumentsPage';
import { AdminTeamsPage } from './features/admin/AdminTeamsPage';
import { AdminTaxonomyDefsPage } from './features/admin/AdminTaxonomyDefsPage';
import { AdminCategoriesPage } from './features/admin/AdminCategoriesPage';
import { AdminSlaPage } from './features/admin/AdminSlaPage';
import { AdminChecklistPage } from './features/admin/AdminChecklistPage';
import { AdminOfferedSolutionsPage } from './features/admin/AdminOfferedSolutionsPage';
import { AdminProductCatalogPage } from './features/admin/AdminProductCatalogPage';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { Popover } from './components/ui/Popover';
import { useHotkey } from './lib/useHotkey';
import { useTheme } from './lib/useTheme';
import { useAuth } from './services/AuthContext';
import { ChangePasswordModal } from './features/auth/SetPasswordPage';
// M6.3b Faz 2 — TipTap RichTextEditor reuse ettiği için lazy (main
// bundle'ı 588→724 KB şişiriyordu).
const UserSignatureModal = lazy(() =>
  import('./features/profile/UserSignatureModal').then((m) => ({ default: m.UserSignatureModal })),
);

import { AdminLayout, type AdminView, isAdminView } from './features/admin/AdminLayout';
import { AdminFieldsPage } from './features/admin/AdminFieldsPage';
import { AdminKnowledgeSourcesPage } from './features/admin/AdminKnowledgeSourcesPage';
import { AdminExternalKbPage } from './features/admin/AdminExternalKbPage';
import { AdminExternalDevOpsPage } from './features/admin/AdminExternalDevOpsPage';
import { AdminExternalMailPage } from './features/admin/AdminExternalMailPage';
// Compose-Signature F4 — Lazy load: DOMPurify bağımlılığı main bundle'a girmesin.
const AdminEmailTemplatesPage = lazy(() =>
  import('./features/admin/AdminEmailTemplatesPage').then((m) => ({ default: m.AdminEmailTemplatesPage })),
);
import { AdminDataImportPage } from './features/admin/AdminDataImportPage';
import { KnowledgeBasePage } from './features/kb/KnowledgeBasePage';
import { AdminCompaniesPage } from './features/admin/AdminCompaniesPage';
import { AdminUsersPage } from './features/admin/AdminUsersPage';
import { ResolutionApprovalPoliciesPage } from './features/admin/ResolutionApprovalPoliciesPage';
import { NotificationTemplatesPage } from './features/admin/NotificationTemplatesPage';
import { NotificationRulesPage } from './features/admin/NotificationRulesPage';
import { NotificationDispatchesPage } from './features/admin/NotificationDispatchesPage';
import { AdminAuthorizationPoliciesPage } from './features/admin/AdminAuthorizationPoliciesPage';
import { AccountsListPage } from './features/accounts/AccountsListPage';
import { AccountDetailPage } from './features/accounts/AccountDetailPage';
import { canReadAccounts } from './services/accountService';
import { authorizationService } from './services/authorizationService';
import type { EffectiveMenuAccess } from './services/authorizationService';
import { SmartTicketNewPage } from './features/smart-ticket/SmartTicketNewPage';
import { accountService } from './services/accountService';
import { SOFTPHONE_ANSWERED_EVENT, SOFTPHONE_INCOMING_EVENT, useSoftphone } from './contexts/SoftphoneContext';
import { CaseTaggingReviewPage } from './features/analytics/CaseTaggingReviewPage';

type View = 'my-home' | 'cases' | 'dashboard' | 'analytics-ai-usage' | 'analytics-patterns' | 'analytics-qa-scores' | 'analytics-people-performance' | 'case-report-studio' | 'monthly-bulletin' | 'root-cause-report' | 'tagging-review' | 'my-calendar' | 'watching' | 'kb-viewer' | 'case-detail' | 'accounts' | 'account-detail' | 'smart-ticket-new' | AdminView;

interface NavItem {
  key: View;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

const NAV: NavItem[] = [
  { key: 'cases',     label: 'Vakalar',        icon: <Inbox size={16} />,           available: true },
  { key: 'dashboard', label: 'Vaka Raporları', icon: <LayoutDashboard size={16} />, available: true },
];

export default function App() {
  // Default landing — Agent/Supervisor "my-home"a, Admin/SystemAdmin "cases"e iner.
  // İlk render'da user henüz null → 'cases' geçici default; user yüklenince
  // useEffect aşağıda bir kez yönlendirme yapar (sadece initialRedirectDoneRef
  // false iken — manuel nav'ı override etmesin).
  const [view, setView] = useState<View>('cases');
  const [initialRedirectDone, setInitialRedirectDone] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  // Vaka detayına hangi view'dan girildiği — geri dönüşte oraya yönlendirmek için.
  const [caseDetailOrigin, setCaseDetailOrigin] = useState<View>('cases');
  // Vaka detayına dar kapsamlı (Açık/Kapalı sekmesi ya da az önce
  // üstlenilen/oluşturulan vaka) bir navigasyondan mi girildiği — Backoffice/
  // Supervisor için Devret/Üstlen görünürlüğünü belirler (CaseDetailPage).
  const [caseDetailNarrowScopeConfirmed, setCaseDetailNarrowScopeConfirmed] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Müşteri detayına hangi view'dan girildiği (ör. vaka detayından "Detay →")
  // — geri dönüşte oraya yönlendirmek için. caseDetailOrigin ile aynı desen.
  const [accountDetailOrigin, setAccountDetailOrigin] = useState<View>('accounts');
  // Gelen çağrı screen pop'u: yanıtlanınca müşteri ön-seçili Akıllı Ticket için.
  const [smartTicketAccount, setSmartTicketAccount] = useState<{ id: string; name: string } | null>(null);
  const [customerCardId, setCustomerCardId] = useState<string | null>(null);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [pendingQuickPrefill, setPendingQuickPrefill] = useState<string | null>(null);
  // Örüntü alarmından "Vakaları Gör" tıklamasında gelen filter (caseId listesi).
  const [patternCasesFilter, setPatternCasesFilter] = useState<{ caseIds: string[]; label: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  // M6.3b Faz 2 — Per-agent imza self-service modal
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  // Sidebar otomatik gizleme: default dar (icon-only), hover ile genişler.
  // Pin (sabitleme) açıkken hover'dan bağımsız genişler — ayrı state, türetilmiş `sidebarExpanded`.
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try {
      return window.localStorage.getItem('sidebarPinned') === 'true';
    } catch {
      return false;
    }
  });
  const sidebarExpanded = sidebarHovered || sidebarPinned;
  // Aktif örüntü alarm sayısı — sidebar badge için 60s polling.
  const [activePatternCount, setActivePatternCount] = useState(0);
  // Bugün için takvim olay sayısı — sidebar Takvimim badge'i.
  const [todayCalendarCount, setTodayCalendarCount] = useState(0);
  const [effectiveMenuAccess, setEffectiveMenuAccess] = useState<EffectiveMenuAccess | null>(null);
  const [effectiveMenuFailed, setEffectiveMenuFailed] = useState(false);

  const { theme, toggle: toggleTheme } = useTheme();

  // Gelen çağrıda otomatik screen-pop: callerId → müşteri eşleştir → Akıllı Ticket
  // (müşteri ön-seçili). Çağrı ÇALMAYA başladığında (inbound) OTOMATİK açılır; agent
  // banner'daki "Vaka Aç" ile de tetikler. Aynı çağrı için tek sefer (dedup).
  const lastPoppedCallerRef = useRef<string | null>(null);
  useEffect(() => {
    const popTicket = (callerId?: string) => {
      if (!callerId || callerId === 'Bilinmeyen') return;
      if (lastPoppedCallerRef.current === callerId) return;
      lastPoppedCallerRef.current = callerId;
      void (async () => {
        let acc: { id: string; name: string } | null = null;
        try {
          const res = await accountService.list({ search: callerId, limit: 1 });
          const a = res?.accounts?.[0];
          if (a) acc = { id: a.id, name: a.name };
        } catch { /* eşleşme yoksa müşterisiz aç */ }
        setSmartTicketAccount(acc);
        setView('smart-ticket-new');
      })();
    };
    const onIncoming = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.inbound) popTicket(d?.number as string | undefined); // yalnız gelen (inbound) çağrı
    };
    const onAnswered = (e: Event) => popTicket((e as CustomEvent).detail?.number as string | undefined);
    window.addEventListener(SOFTPHONE_INCOMING_EVENT, onIncoming);
    window.addEventListener(SOFTPHONE_ANSWERED_EVENT, onAnswered);
    return () => {
      window.removeEventListener(SOFTPHONE_INCOMING_EVENT, onIncoming);
      window.removeEventListener(SOFTPHONE_ANSWERED_EVENT, onAnswered);
    };
  }, []);
  const { user, signOut } = useAuth();
  // Gömülü softphone (sağ-dock) açıkken ana içeriği sağdan 380px daralt →
  // içerik panelin altında kalmaz, panelin başladığı yerde kesilir.
  const {
    dockReserved, incomingCall,
    status: spStatus, panelCollapsed: spCollapsed,
    setPanelCollapsed: setSpCollapsed, openPanel: openSoftphonePanel,
  } = useSoftphone();
  // Çağrı bitince dedup ref sıfırlanır → aynı numara tekrar arayınca yeniden açılır.
  useEffect(() => { if (!incomingCall) lastPoppedCallerRef.current = null; }, [incomingCall]);

  useHotkey('?', () => setHelpOpen(true));

  useEffect(() => {
    if (!user || !featureFlags.authorizationMenuEnforcementEnabled) {
      setEffectiveMenuAccess(null);
      setEffectiveMenuFailed(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const result = await authorizationService.effectiveMenus();
        if (!alive) return;
        setEffectiveMenuAccess(result);
        setEffectiveMenuFailed(false);
      } catch {
        // Fail-open: policy endpoint arızası kullanıcıyı menüsüz bırakmasın.
        if (!alive) return;
        setEffectiveMenuAccess(null);
        setEffectiveMenuFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // Default landing — kullanıcı yüklendiğinde rol bazlı ilk view.
  // Tek sefer çalışır (initialRedirectDone), sonraki manuel nav'ı override etmez.
  useEffect(() => {
    if (initialRedirectDone || !user) return;
    const isFrontline = ['Agent', 'Supervisor', 'Backoffice', 'CSM'].includes(user.role);
    if (isFrontline) setView('my-home');
    setInitialRedirectDone(true);
  }, [user, initialRedirectDone]);

  // 'g' + ikinci tuş kombinasyonu için kısa pencere
  useEffect(() => {
    if (!gPressed) return;
    const t = window.setTimeout(() => setGPressed(false), 800);
    return () => window.clearTimeout(t);
  }, [gPressed]);

  // Active pattern alert sayısı — Supervisor/Admin/SystemAdmin için 60s polling.
  // 'app:patterns-changed' custom event ile dismiss sonrası anında refresh.
  useEffect(() => {
    if (!user || !['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role)) {
      setActivePatternCount(0);
      return;
    }
    let alive = true;
    async function fetchCount() {
      try {
        const list = await analyticsService.listPatterns('active');
        if (alive) setActivePatternCount(list.length);
      } catch {
        // apiFetch toast gösterdi; sessiz devam.
      }
    }
    void fetchCount();
    const id = window.setInterval(fetchCount, 60_000);
    const onChanged = () => void fetchCount();
    window.addEventListener('app:patterns-changed', onChanged);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('app:patterns-changed', onChanged);
    };
  }, [user?.id, user?.role]);

  // Takvim — sidebar badge yalnız BUGÜNÜN MANUEL HATIRLATICI sayısı.
  // Snooze/SLA/followup endpoint maliyeti yüksek (case JOIN'leri); bu sayım
  // performans sebebiyle sadece reminder türünü çeker. 10 dk polling +
  // 'app:calendar-changed' custom event'i ile reminder create sonrası anlık refresh.
  useEffect(() => {
    if (!user) {
      setTodayCalendarCount(0);
      return;
    }
    let alive = true;
    async function fetchCount() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      try {
        const events = await myService.getCalendar(today, tomorrow, ['reminder']);
        if (alive) setTodayCalendarCount(events.length);
      } catch {
        /* apiFetch toast gösterdi; sessiz devam */
      }
    }
    void fetchCount();
    const id = window.setInterval(fetchCount, 10 * 60_000);
    const onChanged = () => void fetchCount();
    window.addEventListener('app:calendar-changed', onChanged);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('app:calendar-changed', onChanged);
    };
  }, [user?.id]);

  useHotkey('g', () => setGPressed(true));
  useHotkey('v', () => {
    if (gPressed) {
      setView('cases');
      setGPressed(false);
    }
  });
  useHotkey('r', () => {
    if (gPressed) {
      setView('dashboard');
      setGPressed(false);
    }
  });

  // Browser back: case-detail view'a girince history'e bir entry pushluyoruz,
  // popstate yakalayıp listeye dönüyoruz. URL routing yok.
  useEffect(() => {
    if (view !== 'case-detail') return;
    window.history.pushState({ varunaCaseDetail: selectedCaseId }, '');
    function onPop() {
      setView(caseDetailOrigin);
      setSelectedCaseId(null);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, caseDetailOrigin]);

  function openCase(id: string, narrowScopeConfirmed = false) {
    setCaseDetailOrigin(view);
    setCaseDetailNarrowScopeConfirmed(narrowScopeConfirmed);
    setSelectedCaseId(id);
    setView('case-detail');
  }

  function backToList() {
    setView(caseDetailOrigin);
    setSelectedCaseId(null);
  }

  // Sidebar pin durumunu değiştirir, tercihi localStorage'a yazar.
  // localStorage kullanılamıyorsa (gizli mod, kota vb.) özellik bu oturumda çalışmaya devam eder.
  function toggleSidebarPinned() {
    setSidebarPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('sidebarPinned', String(next));
      } catch {
        // localStorage yok/erişilemiyor — sessizce sadece oturum içinde çalışır.
      }
      return next;
    });
  }

  // Sidebar nav item'ı tıklanınca herhangi bir alt-state'i temizle
  function handleNavSelect(key: View) {
    if (!canShowView(key, true)) return;
    setView(key);
    setSelectedCaseId(null);
    setSelectedAccountId(null);
  }

  function canShowView(key: View | string, fallback: boolean): boolean {
    if (!featureFlags.authorizationMenuEnforcementEnabled || effectiveMenuFailed) return fallback;
    if (!effectiveMenuAccess) return fallback;
    const menu = effectiveMenuAccess.menus.find((m) => m.viewKey === key);
    // MVP runtime enforcement is deny-only until backend resource guards honor
    // authorization allow grants. Policies can hide legacy-visible menus, but
    // cannot open pages whose APIs still reject the user's role.
    return menu ? fallback && menu.allowed : fallback;
  }

  const showMyHome = !!user && canShowView('my-home', ['Agent', 'Supervisor', 'Backoffice', 'CSM'].includes(user.role));
  const showAccounts = canShowView('accounts', canReadAccounts(user?.role));
  const showCalendar = !!user && canShowView('my-calendar', true);
  const showWatching = !!user && canShowView('watching', true);
  const showKbViewer = !!user && canShowView('kb-viewer', true);
  const showAiUsage = !!user && canShowView('analytics-ai-usage', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showQaScores = !!user && canShowView('analytics-qa-scores', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showPeoplePerformance = !!user && canShowView('analytics-people-performance', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showPatterns = !!user && canShowView('analytics-patterns', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showCaseReportStudio = !!user && canShowView('case-report-studio', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  // Aylık Bülten — CS ekibi müşteriye gönderir; supervisor/admin/CSM görür
  const showMonthlyBulletin = !!user && canShowView('monthly-bulletin', ['CSM', 'Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showRootCauseReport = !!user && canShowView('root-cause-report', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showTaggingReview = !!user && canShowView('tagging-review', ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role));
  const showReportsSection = sidebarExpanded && (
    showAiUsage ||
    showQaScores ||
    showPeoplePerformance ||
    showPatterns ||
    showCaseReportStudio ||
    showMonthlyBulletin ||
    showRootCauseReport ||
    showTaggingReview
  );

  function openAccount(id: string) {
    setAccountDetailOrigin(view);
    setSelectedAccountId(id);
    setView('account-detail');
  }

  function backToAccounts() {
    setView(accountDetailOrigin);
    setSelectedAccountId(null);
  }

  const isDetail = view === 'case-detail';
  // Etiket Doğrulama ekranı kendi içinde sol sabit/sağ kayan iki panelli scroll
  // yapısı kullanıyor; bunun çalışması için sayfa kendisi değil, panel'lerin
  // kendi overflow-auto container'ları scroll olmalı. Bu yüzden case-detail ile
  // aynı yükseklik-sınırlı (h-screen + overflow-hidden main) düzeni kullanır.
  const isFixedHeight = isDetail || view === 'tagging-review';

  // Admin view → AdminLayout. Ana app sidebar/header'dan tamamen ayrış.
  if (isAdminView(view)) {
    // Codex #205 P2b — Admin alt-menüye policy uygula.
    // Flag KAPALIYKEN davranış değişmez (canShowView true döner).
    // SELF-LOCKOUT guard: SystemAdmin için 'admin-authorization-policies'
    // her zaman erişilebilir — yanlış policy ile kendini kilitleyip düzeltemez
    // duruma düşmesin.
    const canShowAdminView = (key: string): boolean => {
      if (
        user?.role === 'SystemAdmin'
        && key === 'admin-authorization-policies'
      ) return true;
      return canShowView(key, true);
    };
    if (!canShowAdminView(view)) {
      // Aktif view artık deny → AdminLayout'tan ana akışa düş.
      setView('cases');
      return null;
    }
    return (
      <AdminLayout
        view={view}
        onSelectView={(v) => {
          if (!canShowAdminView(v)) return;
          setView(v);
        }}
        canShowAdminView={canShowAdminView}
        onExit={() => setView('cases')}
      >
        {view === 'admin-categories' && <AdminCategoriesPage />}
        {view === 'admin-sla' && <AdminSlaPage />}
        {view === 'admin-thirdparty' && <AdminThirdPartyPage />}
        {view === 'admin-documents' && <AdminDocumentsPage />}
        {view === 'admin-checklist' && <AdminChecklistPage />}
        {view === 'admin-teams' && <AdminTeamsPage />}
        {view === 'admin-taxonomy-defs' && <AdminTaxonomyDefsPage />}
        {view === 'admin-offered-solutions' && <AdminOfferedSolutionsPage />}
        {view === 'admin-product-catalog' && <AdminProductCatalogPage />}
        {view === 'admin-fields' && <AdminFieldsPage />}
        {view === 'admin-knowledge' && <AdminKnowledgeSourcesPage />}
        {view === 'admin-external-kb' && <AdminExternalKbPage />}
        {view === 'admin-external-devops' && <AdminExternalDevOpsPage />}
        {view === 'admin-external-mail' && <AdminExternalMailPage />}
        {view === 'admin-email-templates' && (
          <Suspense fallback={<p className="p-4 text-sm text-slate-400">Yükleniyor…</p>}>
            <AdminEmailTemplatesPage />
          </Suspense>
        )}
        {view === 'admin-data-import' && <AdminDataImportPage />}
        {view === 'admin-companies' && <AdminCompaniesPage />}
        {view === 'admin-users' && <AdminUsersPage />}
        {view === 'admin-resolution-approval' && <ResolutionApprovalPoliciesPage />}
        {view === 'admin-notification-templates' && <NotificationTemplatesPage />}
        {view === 'admin-notification-rules' && <NotificationRulesPage />}
        {view === 'admin-notification-dispatches' && <NotificationDispatchesPage />}
        {view === 'admin-authorization-policies' && <AdminAuthorizationPoliciesPage />}
      </AdminLayout>
    );
  }

  return (
    <div className={`flex flex-col bg-slate-50 transition-[padding] duration-200 dark:bg-ndark-bg ${isFixedHeight ? 'h-screen' : 'min-h-screen'} ${dockReserved ? 'pr-[380px]' : ''}`}>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex items-center gap-3">
          <BrandLogo />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
              VARUNA AI-Assisted Case Management
            </div>
            <div className="text-[11px] text-slate-500 dark:text-ndark-muted">Vaka Yönetim Sistemi</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* WR-ACTION-CENTER Phase 1 — left of existing bell; two-counter design (Action + FYI). */}
          {user && featureFlags.actionCenterEnabled && <ActionCenterBell onCaseOpen={openCase} />}
          {/* WR-NOTIFICATION-CENTER Phase 2A — legacy MentionBellBadge.
              Görünür olduğu iki yol:
                1) Action Center kapalıyken FALLBACK — kullanıcı bildirim
                   girişi olmadan kalmasın (Codex P1 review fix).
                2) VITE_LEGACY_MENTION_BELL_ENABLED=true emergency rollback /
                   debug yolu — Action Center açık olsa bile zorla görünür.
              Yani: Action Center'ın YALNIZ aktif olduğu kullanım yolunda
              ve legacy flag false iken eski bell gizlenir. */}
          {user &&
            (!featureFlags.actionCenterEnabled || featureFlags.legacyMentionBellEnabled) && (
              <MentionBellBadge onCaseClick={openCase} />
            )}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Klavye kısayolları (?)"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
          >
            <Keyboard size={16} />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Açık moda geç' : 'Koyu moda geç'}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {/* AloTech Softphone launcher — mail yazarken sağ-alttaki buton "Kaydet"i
              örtmesin diye header'a (kullanıcı menüsünün soluna) taşındı. Açık iken
              vurgulu; tıklama aç/gizle toggle'ı. */}
          {user && spStatus !== 'disabled' && (
            <button
              type="button"
              onClick={() => (spCollapsed ? openSoftphonePanel() : setSpCollapsed(true))}
              title={spCollapsed ? "Softphone'u aç" : "Softphone'u gizle"}
              aria-pressed={!spCollapsed}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                spCollapsed
                  ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text'
                  : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300'
              }`}
            >
              <Phone size={16} />
              <span className="hidden lg:inline">Softphone</span>
            </button>
          )}
          {user && (
            <>
              <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-ndark-border" />
              {/* User menu — avatar/isim dropdown trigger.
                  Click-outside + Escape kapatma Popover'a built-in. */}
              <Popover
                align="end"
                width={260}
                trigger={({ open, toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title="Kullanıcı menüsü"
                    className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:hover:bg-ndark-card"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      {user.fullName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="hidden text-right md:block">
                      <div className="text-xs font-medium leading-tight text-slate-800 dark:text-ndark-text">
                        {user.fullName}
                      </div>
                      <div className="text-[10px] leading-tight text-slate-500 dark:text-ndark-muted">
                        {user.role}
                      </div>
                    </div>
                    <ChevronDown
                      size={14}
                      className={`text-slate-400 transition-transform dark:text-ndark-muted ${open ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="-m-3 flex flex-col">
                    {/* Kimlik özeti */}
                    <div className="border-b border-slate-100 px-4 py-3 dark:border-ndark-border">
                      <div className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                        {user.fullName}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-ndark-muted">
                        {user.email}
                      </div>
                      <div className="mt-1 inline-flex items-center rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                        {user.role}
                      </div>
                    </div>
                    {/* M6.3b Faz 2 — Mail İmzam (self-service) */}
                    <button
                      type="button"
                      onClick={() => { close(); setSignatureModalOpen(true); }}
                      className="flex items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-ndark-text dark:hover:bg-ndark-card"
                    >
                      <Mail size={14} className="text-slate-500 dark:text-ndark-muted" />
                      Mail İmzam
                    </button>
                    {/* Şifre Değiştir */}
                    <button
                      type="button"
                      onClick={() => { close(); setChangePasswordOpen(true); }}
                      className="flex items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-ndark-text dark:hover:bg-ndark-card"
                    >
                      <KeyRound size={14} className="text-slate-500 dark:text-ndark-muted" />
                      Şifre Değiştir
                    </button>
                    <div className="border-t border-slate-100 dark:border-ndark-border" />
                    {/* Çıkış Yap */}
                    <button
                      type="button"
                      onClick={() => { close(); void signOut(); }}
                      className="flex items-center gap-2 px-4 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30"
                    >
                      <LogOut size={14} />
                      Çıkış Yap
                    </button>
                  </div>
                )}
              </Popover>
            </>
          )}
        </div>
      </header>

      {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}
      {signatureModalOpen && (
        <Suspense fallback={null}>
          <UserSignatureModal open={signatureModalOpen} onClose={() => setSignatureModalOpen(false)} />
        </Suspense>
      )}
      <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className={`flex flex-1 ${isFixedHeight ? 'overflow-hidden' : ''}`}>
        <aside
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
          className={`relative flex shrink-0 flex-col border-r border-slate-200 bg-white py-3 transition-all duration-200 dark:border-ndark-border dark:bg-ndark-card ${
            sidebarExpanded ? 'w-64 px-3' : 'w-16 px-2'
          }`}
        >
          {sidebarExpanded && (
            <button
              type="button"
              onClick={toggleSidebarPinned}
              title={sidebarPinned ? 'Sabitlemeyi kaldır' : 'Sidebar\'ı sabitle'}
              aria-label={sidebarPinned ? 'Sabitlemeyi kaldır' : 'Sidebar\'ı sabitle'}
              aria-pressed={sidebarPinned}
              className="
                absolute -right-3 top-3 z-20
                flex h-6 w-6 items-center justify-center
                rounded-full border border-slate-200
                bg-white text-slate-400 shadow-sm
                transition-colors
                hover:text-brand-600
                dark:border-ndark-border dark:bg-ndark-card
              "
            >
              {sidebarPinned ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
            </button>
          )}
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {/*
              Anasayfa — Agent/Supervisor/Backoffice/CSM için kişisel landing.
              Admin/SystemAdmin görmüyor (onlar 'cases' default'unda kalır).
            */}
            {showMyHome && (
              <button
                type="button"
                onClick={() => handleNavSelect('my-home')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'my-home'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Anasayfa"
              >
                <Home size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Anasayfa</span>}
              </button>
            )}

            {NAV.filter((item) => canShowView(item.key, item.available)).map((item) => {
              const active = view === item.key || (isDetail && item.key === 'cases');
              return (
                <button
                  key={item.key}
                  disabled={!item.available}
                  onClick={() => item.available && handleNavSelect(item.key)}
                  className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                    sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                  } ${
                    active
                      ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                      : item.available
                        ? 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                        : 'cursor-not-allowed text-slate-400 dark:text-ndark-dim'
                  }`}
                  title={item.label}
                >
                  {item.icon}
                  {sidebarExpanded && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      {!item.available && (
                        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-ndark-dim">soon</span>
                      )}
                    </>
                  )}
                </button>
              );
            })}

            {/*
              Müşteriler — Account 360 Phase B. Agent ve Backoffice rolleri görmez.
              Detail view (`account-detail`) seçili olduğunda da bu sidebar item aktif kalır.
            */}
            {showAccounts && (
              <button
                type="button"
                onClick={() => handleNavSelect('accounts')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'accounts' || view === 'account-detail'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Müşteriler"
              >
                <Building2 size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Müşteriler</span>}
              </button>
            )}

            {/* ÇALIŞMA ALANIM — kişisel ekranlar (Takvimim). Tüm rollere açık. */}
            {user && (showCalendar || showWatching || showKbViewer) && (
              <>
                {sidebarExpanded && (
                  <div className="mt-3 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-dim">
                    Çalışma Alanım
                  </div>
                )}
                {showCalendar && (
                  <button
                    type="button"
                    onClick={() => handleNavSelect('my-calendar')}
                    className={`relative flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                      sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                    } ${
                      view === 'my-calendar'
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                    }`}
                    title={
                      todayCalendarCount > 0
                        ? `Takvimim (${todayCalendarCount} bugün)`
                        : 'Takvimim'
                    }
                  >
                    <span className="relative">
                      <Calendar size={16} />
                      {todayCalendarCount > 0 && !sidebarExpanded && (
                        <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-brand-600 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-white dark:ring-ndark-card">
                          {todayCalendarCount > 9 ? '9+' : todayCalendarCount}
                        </span>
                      )}
                    </span>
                    {sidebarExpanded && (
                      <>
                        <span className="flex-1 text-left">Takvimim</span>
                        {todayCalendarCount > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
                            {todayCalendarCount > 99 ? '99+' : todayCalendarCount}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                )}

                {/* İzleyici Inbox — FAZ 2 Collab + Smoke Audit Phase 5c.
                    Tüm rollere açık (sadece kullanıcının kendi izlediği vakalar). */}
                {showWatching && (
                  <button
                    type="button"
                    onClick={() => handleNavSelect('watching')}
                    className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                      sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                    } ${
                      view === 'watching'
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                    }`}
                    title="İzleyici Inbox"
                  >
                    <Eye size={16} />
                    {sidebarExpanded && <span className="flex-1 text-left">İzleyici Inbox</span>}
                  </button>
                )}

                {/* WR-KB2 — Bilgi Bankası bağımsız test ekranı. Tüm rollere açık. */}
                {showKbViewer && (
                  <button
                    type="button"
                    onClick={() => handleNavSelect('kb-viewer')}
                    className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                      sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                    } ${
                      view === 'kb-viewer'
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                    }`}
                    title="Bilgi Bankası"
                  >
                    <BookOpen size={16} />
                    {sidebarExpanded && <span className="flex-1 text-left">Bilgi Bankası</span>}
                  </button>
                )}
              </>
            )}

            {/* Vaka Raporları — bölüm başlığı (Supervisor / Admin / SystemAdmin) */}
            {showReportsSection && (
              <div className="mt-3 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-dim">
                Vaka Raporları
              </div>
            )}

            {/* AI Kullanım Panosu — Supervisor / Admin / SystemAdmin */}
            {showAiUsage && (
              <button
                type="button"
                onClick={() => handleNavSelect('analytics-ai-usage')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'analytics-ai-usage'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="AI Kullanım Panosu"
              >
                <BrainCircuit size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">AI Kullanımı</span>}
              </button>
            )}

            {/* QA Skorları — Supervisor / Admin / SystemAdmin */}
            {showQaScores && (
              <button
                type="button"
                onClick={() => handleNavSelect('analytics-qa-scores')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'analytics-qa-scores'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="QA Skorları"
              >
                <Star size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">QA Skorları</span>}
              </button>
            )}

            {/* Performans Panosu — Supervisor / Admin / SystemAdmin */}
            {showPeoplePerformance && (
              <button
                type="button"
                onClick={() => handleNavSelect('analytics-people-performance')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'analytics-people-performance'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Performans Panosu"
              >
                <Gauge size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Performans</span>}
              </button>
            )}

            {/* Örüntü Alarmları — Supervisor / Admin / SystemAdmin (active count badge) */}
            {showPatterns && (
              <button
                type="button"
                onClick={() => handleNavSelect('analytics-patterns')}
                className={`relative flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'analytics-patterns'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title={
                  activePatternCount > 0
                    ? `Örüntü Alarmları (${activePatternCount} aktif)`
                    : 'Örüntü Alarmları'
                }
              >
                <span className="relative">
                  <AlertTriangle size={16} />
                  {activePatternCount > 0 && !sidebarExpanded && (
                    <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-white dark:ring-ndark-card">
                      {activePatternCount > 9 ? '9+' : activePatternCount}
                    </span>
                  )}
                </span>
                {sidebarExpanded && (
                  <>
                    <span className="flex-1 text-left">Örüntü Alarmları</span>
                    {activePatternCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
                        {activePatternCount > 99 ? '99+' : activePatternCount}
                      </span>
                    )}
                  </>
                )}
              </button>
            )}

            {/* Vaka Rapor Stüdyosu — Supervisor / Admin / SystemAdmin */}
            {showCaseReportStudio && (
              <button
                type="button"
                onClick={() => handleNavSelect('case-report-studio')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'case-report-studio'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Vaka Rapor Stüdyosu"
              >
                <FileSpreadsheet size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Rapor Stüdyosu</span>}
              </button>
            )}

            {/* Aylık Müşteri Bülteni — CSM / Supervisor / Admin / SystemAdmin */}
            {showMonthlyBulletin && (
              <button
                type="button"
                onClick={() => handleNavSelect('monthly-bulletin')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'monthly-bulletin'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Aylık Müşteri Bülteni"
              >
                <FileText size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Aylık Bülten</span>}
              </button>
            )}

            {/* Kök Neden Analiz Raporu — Supervisor / Admin / SystemAdmin */}
            {showRootCauseReport && (
              <button
                type="button"
                onClick={() => handleNavSelect('root-cause-report')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'root-cause-report'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Kök Neden Analiz Raporu"
              >
                <Network size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Kök Neden Analiz Raporu</span>}
              </button>
            )}

            {/* Vaka Etiket Doğrulama Ekranı — Supervisor / Admin / SystemAdmin */}
            {showTaggingReview && (
              <button
                type="button"
                onClick={() => handleNavSelect('tagging-review')}
                className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                } ${
                  view === 'tagging-review'
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                }`}
                title="Vaka Etiket Doğrulama Ekranı"
              >
                <ShieldCheck size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Etiket Doğrulama</span>}
              </button>
            )}

            {/* Yönetim girişi — yalnızca SystemAdmin görür */}
            {user?.role === 'SystemAdmin' && canShowView('admin-categories', true) && (
              <button
                type="button"
                onClick={() => handleNavSelect('admin-categories')}
                className={`mt-2 flex w-full items-center gap-2 rounded-md border-t border-slate-200 pt-3 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:border-ndark-border dark:text-ndark-text dark:hover:bg-ndark-card ${
                  sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                }`}
                title="Yönetim Paneli"
              >
                <Settings2 size={16} />
                {sidebarExpanded && <span className="flex-1 text-left">Yönetim</span>}
              </button>
            )}
          </nav>

        </aside>

        <main className={isFixedHeight ? 'flex flex-1 flex-col overflow-hidden' : 'min-w-0 flex-1 px-6 py-6'}>
          {view === 'my-home' && (
            <MyHomePage
              onSelectCase={openCase}
              onShowCases={() => setView('cases')}
              onShowCalendar={() => setView('my-calendar')}
              onShowPatterns={() => setView('analytics-patterns')}
              onOpenSmartTicket={
                featureFlags.smartTicketIntakeEnabled
                  ? () => setView('smart-ticket-new')
                  : undefined
              }
            />
          )}
          {(view === 'cases' || (isDetail && caseDetailOrigin === 'cases')) && (
            <div className={isDetail ? 'hidden' : 'contents'}>
              <CasesListPage
                onSelectCase={openCase}
                onShowCustomer={(id) => setCustomerCardId(id)}
                onOpenCustomerSearch={() => setCustomerSearchOpen(true)}
                pendingQuickPrefill={pendingQuickPrefill}
                onQuickPrefillConsumed={() => setPendingQuickPrefill(null)}
                patternCasesFilter={patternCasesFilter}
                onClearPatternFilter={() => setPatternCasesFilter(null)}
                onShowPatterns={() => setView('analytics-patterns')}
                onOpenSmartTicket={
                  featureFlags.smartTicketIntakeEnabled
                    ? () => setView('smart-ticket-new')
                    : undefined
                }
                isVisible={!isDetail}
              />
            </div>
          )}
          {(view === 'dashboard' || (isDetail && caseDetailOrigin === 'dashboard')) && (
            <div className={isDetail ? 'hidden' : 'contents'}>
              <OperationsDashboardPage onSelectCase={openCase} />
            </div>
          )}
          {view === 'analytics-ai-usage' && <AIUsagePage />}
          {view === 'analytics-patterns' && (
            <PatternsPage
              onShowCases={(caseIds, category) => {
                setPatternCasesFilter({ caseIds, label: category });
                setView('cases');
              }}
            />
          )}
          {view === 'analytics-qa-scores' && <QAScoresPage />}
          {view === 'analytics-people-performance' && <PeoplePerformancePage onSelectCase={openCase} />}
          {view === 'case-report-studio' && <CaseReportStudioPage />}
          {view === 'monthly-bulletin' && <MonthlyBulletinPage />}
          {(view === 'root-cause-report' || (isDetail && caseDetailOrigin === 'root-cause-report')) && (
            <div className={isDetail ? 'hidden' : 'contents'}>
              <RootCauseReportPage onSelectCase={openCase} />
            </div>
          )}
          {view === 'tagging-review' && <CaseTaggingReviewPage onSelectCase={openCase} />}
          {view === 'my-calendar' && <MyCalendarPage onSelectCase={openCase} />}
          {view === 'watching' && <WatcherInboxPage onSelectCase={openCase} />}
          {view === 'kb-viewer' && <KnowledgeBasePage />}
          {view === 'case-detail' && selectedCaseId && (
            featureFlags.l1CaseConsoleEnabled ? (
              <L1CaseResolutionConsole
                caseId={selectedCaseId}
                onBack={backToList}
                onShowCustomer={(id) => setCustomerCardId(id)}
              />
            ) : (
              <CaseDetailPage
                caseId={selectedCaseId}
                onBack={backToList}
                onShowCustomer={(id) => setCustomerCardId(id)}
                onOpenAccount={canReadAccounts(user?.role) ? openAccount : undefined}
                narrowScopeConfirmedByNav={caseDetailNarrowScopeConfirmed}
              />
            )
          )}
          {view === 'accounts' && (
            canReadAccounts(user?.role) ? (
              <AccountsListPage onSelectAccount={openAccount} />
            ) : (
              <ForbiddenView />
            )
          )}
          {view === 'account-detail' && selectedAccountId && (
            canReadAccounts(user?.role) ? (
              <AccountDetailPage
                accountId={selectedAccountId}
                onBack={backToAccounts}
                onSelectCase={openCase}
              />
            ) : (
              <ForbiddenView />
            )
          )}
          {view === 'smart-ticket-new' && featureFlags.smartTicketIntakeEnabled && (
            <SmartTicketNewPage
              initialAccountId={smartTicketAccount?.id ?? null}
              initialAccountName={smartTicketAccount?.name ?? null}
              onCancel={() => { setView('cases'); setSmartTicketAccount(null); }}
              onCreated={(caseId) => { setSmartTicketAccount(null); openCase(caseId); }}
              onOpenExistingCase={(caseId) => openCase(caseId)}
            />
          )}
        </main>
      </div>

      <CustomerCardModal
        open={customerCardId !== null}
        accountId={customerCardId}
        onClose={() => setCustomerCardId(null)}
        onShowCase={(id) => {
          setCustomerCardId(null);
          openCase(id);
        }}
      />

      <CustomerSearchModal
        open={customerSearchOpen}
        onClose={() => setCustomerSearchOpen(false)}
        onShowCase={(id) => {
          setCustomerSearchOpen(false);
          openCase(id);
        }}
        onNewCase={(accountId) => {
          setCustomerSearchOpen(false);
          // Detay sayfasındayken liste sayfasına dön + quick case modal'ı tetikle
          if (view !== 'cases') {
            setView('cases');
            setSelectedCaseId(null);
          }
          setPendingQuickPrefill(accountId);
        }}
      />
    </div>
  );
}

/**
 * Müşteriler modülüne yetkisiz roller (Agent/Backoffice) doğrudan view
 * key'iyle ulaşırsa burada güvenli bir 403 ekranı görür. Sidebar zaten
 * gizliyor; bu sadece sigorta.
 */
function ForbiddenView() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm dark:border-ndark-border dark:bg-ndark-card">
      <AlertTriangle size={28} className="text-amber-500" />
      <h2 className="text-base font-semibold text-slate-900 dark:text-ndark-text">
        Erişim engellendi
      </h2>
      <p className="text-sm text-slate-500 dark:text-ndark-muted">
        Bu sayfa Supervisor, CSM, Admin ve SystemAdmin rolleri içindir.
      </p>
    </div>
  );
}

/**
 * Brand logosu — public/varuna-logo.png varsa onu gösterir, yoksa "V"
 * placeholder'a düşer. Logo değiştirmek için public/varuna-logo.png
 * dosyasını ekleyin/değiştirin (SVG kullanmak için src uzantısını
 * .svg yapın).
 */
function BrandLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white">
        <span className="text-sm font-semibold">V</span>
      </div>
    );
  }
  return (
    <img
      src="/varuna-logo.png"
      alt="Varuna"
      className="h-9 w-9 shrink-0 rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  );
}
