import { useEffect, useState } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Keyboard,
  LayoutDashboard,
  Settings2,
} from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseAnalyticsPage } from './features/analytics/CaseAnalyticsPage';
import { CustomerCardModal } from './features/customers/CustomerCardModal';
import { CustomerSearchModal } from './features/customers/CustomerSearchModal';
import { Badge } from './components/ui/Badge';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { useHotkey } from './lib/useHotkey';

type View = 'cases' | 'dashboard' | 'admin' | 'case-detail';

const NAV: { key: View; label: string; icon: React.ReactNode; available: boolean }[] = [
  { key: 'cases',     label: 'Vakalar',          icon: <Inbox size={16} />,           available: true },
  { key: 'dashboard', label: 'Vaka Raporları',   icon: <LayoutDashboard size={16} />, available: true },
  { key: 'admin',     label: 'Tanım Ekranları',  icon: <Settings2 size={16} />,       available: false },
];

const SIDEBAR_KEY = 'varuna-sidebar-collapsed';

export default function App() {
  const [view, setView] = useState<View>('cases');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [customerCardId, setCustomerCardId] = useState<string | null>(null);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [pendingQuickPrefill, setPendingQuickPrefill] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* localStorage erişilemez — yoksay */
    }
  }, [sidebarCollapsed]);

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
    <div className={`flex flex-col ${isDetail ? 'h-screen' : 'min-h-screen'}`}>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
            <span className="font-semibold">V</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Varuna Case Management</div>
            <div className="text-[11px] text-slate-500">FAZ 0 — Mock UI</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Klavye kısayolları (?)"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <Keyboard size={16} />
          </button>
          <Badge tint="amber">USE_MOCK = true</Badge>
        </div>
      </header>

      <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className={`flex flex-1 ${isDetail ? 'overflow-hidden' : ''}`}>
        <aside
          className={`shrink-0 border-r border-slate-200 bg-white py-3 transition-all duration-200 ${
            sidebarCollapsed ? 'w-16 px-2' : 'w-64 px-3'
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className={`mb-3 flex h-7 w-full items-center gap-1.5 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 ${
              sidebarCollapsed ? 'justify-center px-0' : 'justify-end px-2'
            }`}
            title={sidebarCollapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          >
            {sidebarCollapsed ? <ChevronsRight size={14} /> : <><ChevronsLeft size={14} /> Daralt</>}
          </button>

          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = view === item.key || (isDetail && item.key === 'cases');
              return (
                <button
                  key={item.key}
                  disabled={!item.available}
                  onClick={() => item.available && handleNavSelect(item.key)}
                  className={`flex w-full items-center gap-2 rounded-md text-sm transition-colors ${
                    sidebarCollapsed ? 'h-10 justify-center px-0' : 'px-3 py-2'
                  } ${
                    active
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : item.available
                        ? 'text-slate-700 hover:bg-slate-100'
                        : 'cursor-not-allowed text-slate-400'
                  }`}
                  title={item.label}
                >
                  {item.icon}
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      {!item.available && (
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">soon</span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
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
