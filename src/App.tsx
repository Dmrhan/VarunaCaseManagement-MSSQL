import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderTree,
  Inbox,
  Keyboard,
  LayoutDashboard,
  Moon,
  Network,
  Settings2,
  Sun,
  Tag,
  Timer,
  Users2,
  LogOut,
} from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseAnalyticsPage } from './features/analytics/CaseAnalyticsPage';
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

type AdminView =
  | 'admin-categories'
  | 'admin-sla'
  | 'admin-thirdparty'
  | 'admin-documents'
  | 'admin-checklist'
  | 'admin-teams'
  | 'admin-offered-solutions';

type View = 'cases' | 'dashboard' | 'case-detail' | AdminView;

interface NavItem {
  key: View;
  label: string;
  icon: React.ReactNode;
  available: boolean;
  /** Sub-item ise hangi parent'a ait olduğunu işaretler (sidebar group expand kontrolü için) */
  children?: NavItem[];
}

const ADMIN_CHILDREN: NavItem[] = [
  { key: 'admin-categories',         label: 'Kategori & Alt Kategori', icon: <FolderTree size={14} />,    available: true },
  { key: 'admin-sla',                label: 'SLA Kuralları',           icon: <Timer size={14} />,         available: true },
  { key: 'admin-thirdparty',         label: '3. Parti Tanımları',      icon: <Network size={14} />,       available: true },
  { key: 'admin-documents',              label: 'Belge Türü Tanımları',    icon: <FileText size={14} />,      available: true },
  { key: 'admin-checklist',          label: 'Kontrol Listesi',         icon: <ClipboardCheck size={14} />,available: true },
  { key: 'admin-teams',              label: 'Takım Tanımları',         icon: <Users2 size={14} />,        available: true },
  { key: 'admin-offered-solutions',  label: 'Teklif Tanımları',        icon: <Tag size={14} />,           available: true },
];

const NAV: NavItem[] = [
  { key: 'cases',     label: 'Vakalar',          icon: <Inbox size={16} />,           available: true },
  { key: 'dashboard', label: 'Vaka Raporları',   icon: <LayoutDashboard size={16} />, available: true },
  // 'admin' artık parent group — child seçimle gerçek view set edilir
  { key: 'cases', /* dummy parent key, tıklamaz */ label: 'Tanım Ekranları', icon: <Settings2 size={16} />, available: true, children: ADMIN_CHILDREN },
];

const ADMIN_MENU_KEY = 'varuna-admin-menu-open';

function isAdminView(v: View): v is AdminView {
  return v.startsWith('admin-');
}

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
  const [adminMenuOpen, setAdminMenuOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ADMIN_MENU_KEY) === '1';
  });

  // Admin view'a girince menüyü otomatik aç (refresh sonrası vb.)
  useEffect(() => {
    if (isAdminView(view) && !adminMenuOpen) setAdminMenuOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const { theme, toggle: toggleTheme } = useTheme();
  const { user, signOut } = useAuth();

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_MENU_KEY, adminMenuOpen ? '1' : '0');
    } catch {
      /* yoksay */
    }
  }, [adminMenuOpen]);

  useHotkey('?', () => setHelpOpen(true));

  // 'g' + ikinci tuş kombinasyonu için kısa pencere
  useEffect(() => {
    if (!gPressed) return;
    const t = window.setTimeout(() => setGPressed(false), 800);
    return () => window.clearTimeout(t);
  }, [gPressed]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Klavye kısayolları (?)"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
          >
            <Keyboard size={16} />
          </button>
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
            {NAV.map((item, navIdx) => {
              const isParent = !!item.children && item.children.length > 0;
              if (isParent) {
                const expanded = adminMenuOpen;
                const hasActiveChild = item.children!.some((c) => c.key === view);
                return (
                  <div key={`group-${navIdx}`}>
                    <button
                      type="button"
                      onClick={() => setAdminMenuOpen((v) => !v)}
                      className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                        sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
                      } ${
                        hasActiveChild
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-card'
                      }`}
                      title={item.label}
                    >
                      {item.icon}
                      {sidebarExpanded && (
                        <>
                          <span className="flex-1 text-left">{item.label}</span>
                          {expanded ? (
                            <ChevronDown size={14} className="text-slate-400" />
                          ) : (
                            <ChevronRight size={14} className="text-slate-400" />
                          )}
                        </>
                      )}
                    </button>
                    {sidebarExpanded && expanded && (
                      <div className="mt-1 space-y-0.5 border-l border-slate-200 pl-3 ml-4 dark:border-ndark-border">
                        {item.children!.map((child) => {
                          const active = view === child.key;
                          return (
                            <button
                              key={child.key}
                              disabled={!child.available}
                              onClick={() => child.available && handleNavSelect(child.key)}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                                active
                                  ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                                  : child.available
                                    ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text'
                                    : 'cursor-not-allowed text-slate-400 dark:text-ndark-dim'
                              }`}
                            >
                              <span className="text-slate-400 dark:text-ndark-dim">{child.icon}</span>
                              <span className="flex-1 text-left">{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

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
          </nav>

          {/* Kullanıcı kartı + logout */}
          {user && (
            <div className="mt-2 border-t border-slate-200 pt-2 dark:border-ndark-border">
              {sidebarExpanded ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      {user.fullName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800 dark:text-ndark-text">
                        {user.fullName}
                      </div>
                      <div className="truncate text-[10px] text-slate-500 dark:text-ndark-muted">
                        {user.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void signOut()}
                      title="Çıkış Yap"
                      className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-900/30 dark:hover:text-rose-300"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  title={`${user.fullName} (${user.role}) — Çıkış Yap`}
                  className="flex h-10 w-full items-center justify-center text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-900/30 dark:hover:text-rose-300"
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          )}

          {/* Theme toggle — sidebar'ın altında, hover-expand ile etkileşimli */}
          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-ndark-border">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Açık moda geç' : 'Koyu moda geç'}
              aria-label={theme === 'dark' ? 'Açık moda geç' : 'Koyu moda geç'}
              className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text ${
                sidebarExpanded ? 'px-3 py-2' : 'h-10 justify-center px-0'
              }`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {sidebarExpanded && (
                <span className="flex-1 text-left">
                  {theme === 'dark' ? 'Açık Mod' : 'Koyu Mod'}
                </span>
              )}
            </button>
          </div>
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
          {view === 'case-detail' && selectedCaseId && (
            <CaseDetailPage
              caseId={selectedCaseId}
              onBack={backToList}
              onShowCustomer={(id) => setCustomerCardId(id)}
            />
          )}

          {/* Admin views — Sprint A placeholder'ları, B-G'de gerçek bileşenlerle replace edilecek */}
          {view === 'admin-categories' && <AdminCategoriesPage />}
          {view === 'admin-sla' && <AdminSlaPage />}
          {view === 'admin-thirdparty' && <AdminThirdPartyPage />}
          {view === 'admin-documents' && <AdminDocumentsPage />}
          {view === 'admin-checklist' && <AdminChecklistPage />}
          {view === 'admin-teams' && <AdminTeamsPage />}
          {view === 'admin-offered-solutions' && <AdminOfferedSolutionsPage />}
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
