import { useState } from 'react';
import { Inbox, LayoutDashboard, Settings2 } from 'lucide-react';
import { CasesListPage } from './features/cases/CasesListPage';
import { Badge } from './components/ui/Badge';

type View = 'cases' | 'dashboard' | 'admin';

const NAV: { key: View; label: string; icon: React.ReactNode; available: boolean }[] = [
  { key: 'cases',     label: 'Vakalar',          icon: <Inbox size={16} />,           available: true },
  { key: 'dashboard', label: 'Case Analytics',   icon: <LayoutDashboard size={16} />, available: false },
  { key: 'admin',     label: 'Tanım Ekranları',  icon: <Settings2 size={16} />,       available: false },
];

export default function App() {
  const [view, setView] = useState<View>('cases');

  return (
    <div className="flex min-h-screen flex-col">
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
        <Badge tint="amber">USE_MOCK = true</Badge>
      </header>

      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-4">
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  disabled={!item.available}
                  onClick={() => item.available && setView(item.key)}
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

        <main className="flex-1 px-6 py-6">
          {view === 'cases' && <CasesListPage />}
        </main>
      </div>
    </div>
  );
}
