import { useEffect, useState } from 'react';
import { Inbox, Keyboard, LayoutDashboard, Settings2 } from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseAnalyticsPage } from './features/analytics/CaseAnalyticsPage';
import { CustomerCardModal } from './features/customers/CustomerCardModal';
import { Badge } from './components/ui/Badge';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { useHotkey } from './lib/useHotkey';

type View = 'cases' | 'dashboard' | 'admin' | 'case-detail';

const NAV: { key: View; label: string; icon: React.ReactNode; available: boolean }[] = [
  { key: 'cases',     label: 'Vakalar',          icon: <Inbox size={16} />,           available: true },
  { key: 'dashboard', label: 'Vaka Raporları',   icon: <LayoutDashboard size={16} />, available: true },
  { key: 'admin',     label: 'Tanım Ekranları',  icon: <Settings2 size={16} />,       available: false },
];

export default function App() {
  const [view, setView] = useState<View>('cases');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [customerCardId, setCustomerCardId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);

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
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-4">
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = view === item.key || (isDetail && item.key === 'cases');
              return (
                <button
                  key={item.key}
                  disabled={!item.available}
                  onClick={() => item.available && handleNavSelect(item.key)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : item.available
                        ? 'text-slate-700 hover:bg-slate-100'
                        : 'cursor-not-allowed text-slate-400'
                  }`}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  {!item.available && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">soon</span>
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
    </div>
  );
}
