import { Suspense, lazy, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Calendar,
  Home,
  Inbox,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings2,
  Star,
  Sun,
} from 'lucide-react';
// Eager — sık kullanılan, ilk yükleme kritik:
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { MentionBellBadge } from './features/cases/components/MentionBellBadge';
import { MyHomePage } from './features/my/MyHomePage';
import { CustomerCardModal } from './features/customers/CustomerCardModal';
import { CustomerSearchModal } from './features/customers/CustomerSearchModal';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { Skeleton, MetricTileSkeleton } from './components/ui/Skeleton';
// AdminLayout statik — named export'ları (AdminView tip union, isAdminView)
// App.tsx tip kontrolünde kullanılıyor; lazy yaparsak tip silsilesi kopar.
// İçindeki 11 admin page lazy.
import { AdminLayout, type AdminView, isAdminView } from './features/admin/AdminLayout';
import { analyticsService } from './services/analyticsService';
import { myService } from './services/myService';
import { useHotkey } from './lib/useHotkey';
import { useTheme } from './lib/useTheme';
import { useAuth } from './services/AuthContext';

// ─── Lazy chunk'lar — vite.config.ts manualChunks ile gruplanır ───
// Named export'lu bileşenler için `.then(m => ({ default: m.X }))` kalıbı şart.

// Analytics chunk (Supervisor+ rolüne özel — frontline indirmesin):
const CaseAnalyticsPage = lazy(() =>
  import('./features/analytics/CaseAnalyticsPage').then((m) => ({ default: m.CaseAnalyticsPage })),
);
const AIUsagePage = lazy(() =>
  import('./features/analytics/AIUsagePage').then((m) => ({ default: m.AIUsagePage })),
);
const PatternsPage = lazy(() =>
  import('./features/analytics/PatternsPage').then((m) => ({ default: m.PatternsPage })),
);
const QAScoresPage = lazy(() =>
  import('./features/analytics/QAScoresPage').then((m) => ({ default: m.QAScoresPage })),
);

// Calendar chunk — modal-benzeri kullanım, az açılır:
const MyCalendarPage = lazy(() =>
  import('./features/my/MyCalendarPage').then((m) => ({ default: m.MyCalendarPage })),
);

// Admin chunk — yalnız Admin/SystemAdmin (11 page tek chunk):
const AdminThirdPartyPage = lazy(() =>
  import('./features/admin/AdminThirdPartyPage').then((m) => ({ default: m.AdminThirdPartyPage })),
);
const AdminDocumentsPage = lazy(() =>
  import('./features/admin/AdminDocumentsPage').then((m) => ({ default: m.AdminDocumentsPage })),
);
const AdminTeamsPage = lazy(() =>
  import('./features/admin/AdminTeamsPage').then((m) => ({ default: m.AdminTeamsPage })),
);
const AdminCategoriesPage = lazy(() =>
  import('./features/admin/AdminCategoriesPage').then((m) => ({ default: m.AdminCategoriesPage })),
);
const AdminSlaPage = lazy(() =>
  import('./features/admin/AdminSlaPage').then((m) => ({ default: m.AdminSlaPage })),
);
const AdminChecklistPage = lazy(() =>
  import('./features/admin/AdminChecklistPage').then((m) => ({ default: m.AdminChecklistPage })),
);
const AdminOfferedSolutionsPage = lazy(() =>
  import('./features/admin/AdminOfferedSolutionsPage').then((m) => ({ default: m.AdminOfferedSolutionsPage })),
);
const AdminFieldsPage = lazy(() =>
  import('./features/admin/AdminFieldsPage').then((m) => ({ default: m.AdminFieldsPage })),
);
const AdminKnowledgeSourcesPage = lazy(() =>
  import('./features/admin/AdminKnowledgeSourcesPage').then((m) => ({ default: m.AdminKnowledgeSourcesPage })),
);
const AdminCompaniesPage = lazy(() =>
  import('./features/admin/AdminCompaniesPage').then((m) => ({ default: m.AdminCompaniesPage })),
);
const AdminUsersPage = lazy(() =>
  import('./features/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);

/**
 * PageFallback — Suspense fallback'i. Skeleton blokları ile sayfa yapısının
 * kabaca yerini tutar; flicker'ı azaltır. Slow 3G'de < 1s görünür.
 */
function PageFallback({ label }: { label?: string }) {
  return (
    <div className="space-y-4 p-2">
      {label && (
        <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-ndark-muted">
          {label}
        </div>
      )}
      <Skeleton height={32} className="w-1/3" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTileSkeleton />
        <MetricTileSkeleton />
        <MetricTileSkeleton />
      </div>
      <Skeleton height={120} className="w-full" />
      <Skeleton height={80} className="w-full" />
    </div>
  );
}

type View = 'my-home' | 'cases' | 'dashboard' | 'analytics-ai-usage' | 'analytics-patterns' | 'analytics-qa-scores' | 'my-calendar' | 'case-detail' | AdminView;

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
  const [customerCardId, setCustomerCardId] = useState<string | null>(null);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [pendingQuickPrefill, setPendingQuickPrefill] = useState<string | null>(null);
  // Örüntü alarmından "Vakaları Gör" tıklamasında gelen filter (caseId listesi).
  const [patternCasesFilter, setPatternCasesFilter] = useState<{ caseIds: string[]; label: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  // Sidebar otomatik gizleme: default dar (icon-only), hover ile genişler
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  // Aktif örüntü alarm sayısı — sidebar badge için 60s polling.
  const [activePatternCount, setActivePatternCount] = useState(0);
  // Bugün için takvim olay sayısı — sidebar Takvimim badge'i.
  const [todayCalendarCount, setTodayCalendarCount] = useState(0);

  const { theme, toggle: toggleTheme } = useTheme();
  const { user, signOut } = useAuth();

  useHotkey('?', () => setHelpOpen(true));

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
      setView('cases');
      setSelectedCaseId(null);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function openCase(id: string) {
    setSelectedCaseId(id);
    setView('case-detail');
  }

  function backToList() {
    setView('cases');
    setSelectedCaseId(null);
  }

  // Sidebar nav item'ı tıklanınca herhangi bir alt-state'i temizle
  function handleNavSelect(key: View) {
    setView(key);
    setSelectedCaseId(null);
  }

  const isDetail = view === 'case-detail';

  // Admin view → AdminLayout. Ana app sidebar/header'dan tamamen ayrış.
  if (isAdminView(view)) {
    return (
      <AdminLayout
        view={view}
        onSelectView={(v) => setView(v)}
        onExit={() => setView('cases')}
      >
        <Suspense fallback={<PageFallback label="Yönetim paneli yükleniyor" />}>
          {view === 'admin-categories' && <AdminCategoriesPage />}
          {view === 'admin-sla' && <AdminSlaPage />}
          {view === 'admin-thirdparty' && <AdminThirdPartyPage />}
          {view === 'admin-documents' && <AdminDocumentsPage />}
          {view === 'admin-checklist' && <AdminChecklistPage />}
          {view === 'admin-teams' && <AdminTeamsPage />}
          {view === 'admin-offered-solutions' && <AdminOfferedSolutionsPage />}
          {view === 'admin-fields' && <AdminFieldsPage />}
          {view === 'admin-knowledge' && <AdminKnowledgeSourcesPage />}
          {view === 'admin-companies' && <AdminCompaniesPage />}
          {view === 'admin-users' && <AdminUsersPage />}
        </Suspense>
      </AdminLayout>
    );
  }

  return (
    <div className={`flex flex-col bg-slate-50 dark:bg-ndark-bg ${isDetail ? 'h-screen' : 'min-h-screen'}`}>
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
          {user && <MentionBellBadge onCaseClick={openCase} />}
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
          {user && (
            <>
              <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-ndark-border" />
              <div className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2">
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
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Çıkış Yap"
                className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:text-ndark-muted dark:hover:bg-rose-900/30 dark:hover:text-rose-300"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </header>

      <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className={`flex flex-1 ${isDetail ? 'overflow-hidden' : ''}`}>
        <aside
          onMouseEnter={() => setSidebarExpanded(true)}
          onMouseLeave={() => setSidebarExpanded(false)}
          className={`flex shrink-0 flex-col border-r border-slate-200 bg-white py-3 transition-all duration-200 dark:border-ndark-border dark:bg-ndark-card ${
            sidebarExpanded ? 'w-64 px-3' : 'w-16 px-2'
          }`}
        >
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {/*
              Anasayfa — Agent/Supervisor/Backoffice/CSM için kişisel landing.
              Admin/SystemAdmin görmüyor (onlar 'cases' default'unda kalır).
            */}
            {user && ['Agent', 'Supervisor', 'Backoffice', 'CSM'].includes(user.role) && (
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

            {NAV.map((item) => {
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

            {/* ÇALIŞMA ALANIM — kişisel ekranlar (Takvimim). Tüm rollere açık. */}
            {user && (
              <>
                {sidebarExpanded && (
                  <div className="mt-3 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-dim">
                    Çalışma Alanım
                  </div>
                )}
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
              </>
            )}

            {/* AI Kullanım Panosu — Supervisor / Admin / SystemAdmin */}
            {user && ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role) && (
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
            {user && ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role) && (
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

            {/* Örüntü Alarmları — Supervisor / Admin / SystemAdmin (active count badge) */}
            {user && ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role) && (
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

            {/* Yönetim girişi — yalnızca SystemAdmin görür */}
            {user?.role === 'SystemAdmin' && (
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

        <main className={isDetail ? 'flex flex-1 flex-col overflow-hidden' : 'flex-1 px-6 py-6'}>
          {/* Suspense boundary — lazy chunk'lar (analytics, calendar) burada bekler.
              Eager bileşenler (MyHomePage, CasesListPage, CaseDetailPage) Suspense
              tetiklemez; fallback sadece lazy geçişlerde görünür. */}
          <Suspense fallback={<PageFallback />}>
            {view === 'my-home' && (
              <MyHomePage
                onSelectCase={openCase}
                onShowCases={() => setView('cases')}
                onShowCalendar={() => setView('my-calendar')}
                onShowPatterns={() => setView('analytics-patterns')}
              />
            )}
            {view === 'cases' && (
              <CasesListPage
                onSelectCase={openCase}
                onShowCustomer={(id) => setCustomerCardId(id)}
                onOpenCustomerSearch={() => setCustomerSearchOpen(true)}
                pendingQuickPrefill={pendingQuickPrefill}
                onQuickPrefillConsumed={() => setPendingQuickPrefill(null)}
                patternCasesFilter={patternCasesFilter}
                onClearPatternFilter={() => setPatternCasesFilter(null)}
                onShowPatterns={() => setView('analytics-patterns')}
              />
            )}
            {view === 'dashboard' && <CaseAnalyticsPage />}
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
            {view === 'my-calendar' && <MyCalendarPage onSelectCase={openCase} />}
            {view === 'case-detail' && selectedCaseId && (
              <CaseDetailPage
                caseId={selectedCaseId}
                onBack={backToList}
                onShowCustomer={(id) => setCustomerCardId(id)}
              />
            )}
          </Suspense>
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
