import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Inbox,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings2,
  Sun,
} from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { MentionBellBadge } from './features/cases/components/MentionBellBadge';
import { CaseAnalyticsPage } from './features/analytics/CaseAnalyticsPage';
import { AIUsagePage } from './features/analytics/AIUsagePage';
import { PatternsPage } from './features/analytics/PatternsPage';
import { analyticsService } from './services/analyticsService';
import { CustomerCardModal } from './features/customers/CustomerCardModal';
import { CustomerSearchModal } from './features/customers/CustomerSearchModal';
import { AdminThirdPartyPage } from './features/admin/AdminThirdPartyPage';
import { AdminDocumentsPage } from './features/admin/AdminDocumentsPage';
import { AdminTeamsPage } from './features/admin/AdminTeamsPage';
import { AdminCategoriesPage } from './features/admin/AdminCategoriesPage';
import { AdminSlaPage } from './features/admin/AdminSlaPage';
import { AdminChecklistPage } from './features/admin/AdminChecklistPage';
import { AdminOfferedSolutionsPage } from './features/admin/AdminOfferedSolutionsPage';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { useHotkey } from './lib/useHotkey';
import { useTheme } from './lib/useTheme';
import { useAuth } from './services/AuthContext';

import { AdminLayout, type AdminView, isAdminView } from './features/admin/AdminLayout';
import { AdminFieldsPage } from './features/admin/AdminFieldsPage';
import { AdminCompaniesPage } from './features/admin/AdminCompaniesPage';
import { AdminUsersPage } from './features/admin/AdminUsersPage';

type View = 'cases' | 'dashboard' | 'analytics-ai-usage' | 'analytics-patterns' | 'case-detail' | AdminView;

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
  const [view, setView] = useState<View>('cases');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [customerCardId, setCustomerCardId] = useState<string | null>(null);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [pendingQuickPrefill, setPendingQuickPrefill] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  // Sidebar otomatik gizleme: default dar (icon-only), hover ile genişler
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  // Aktif örüntü alarm sayısı — sidebar badge için 60s polling.
  const [activePatternCount, setActivePatternCount] = useState(0);

  const { theme, toggle: toggleTheme } = useTheme();
  const { user, signOut } = useAuth();

  useHotkey('?', () => setHelpOpen(true));

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
        {view === 'admin-categories' && <AdminCategoriesPage />}
        {view === 'admin-sla' && <AdminSlaPage />}
        {view === 'admin-thirdparty' && <AdminThirdPartyPage />}
        {view === 'admin-documents' && <AdminDocumentsPage />}
        {view === 'admin-checklist' && <AdminChecklistPage />}
        {view === 'admin-teams' && <AdminTeamsPage />}
        {view === 'admin-offered-solutions' && <AdminOfferedSolutionsPage />}
        {view === 'admin-fields' && <AdminFieldsPage />}
        {view === 'admin-companies' && <AdminCompaniesPage />}
        {view === 'admin-users' && <AdminUsersPage />}
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
          {view === 'cases' && (
            <CasesListPage
              onSelectCase={openCase}
              onShowCustomer={(id) => setCustomerCardId(id)}
              onOpenCustomerSearch={() => setCustomerSearchOpen(true)}
              pendingQuickPrefill={pendingQuickPrefill}
              onQuickPrefillConsumed={() => setPendingQuickPrefill(null)}
            />
          )}
          {view === 'dashboard' && <CaseAnalyticsPage />}
          {view === 'analytics-ai-usage' && <AIUsagePage />}
          {view === 'analytics-patterns' && <PatternsPage onShowCases={() => setView('cases')} />}
          {view === 'case-detail' && selectedCaseId && (
            <CaseDetailPage
              caseId={selectedCaseId}
              onBack={backToList}
              onShowCustomer={(id) => setCustomerCardId(id)}
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
