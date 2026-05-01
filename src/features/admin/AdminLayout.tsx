import { type ReactNode } from 'react';
import {
  ArrowLeft,
  Building2,
  ClipboardCheck,
  FileText,
  FolderTree,
  Network,
  Settings2,
  Sliders,
  Tag,
  Timer,
  Users2,
} from 'lucide-react';
import { useAuth } from '@/services/AuthContext';

/**
 * AdminLayout — /admin altındaki ekranlar için ayrı layout.
 *
 * SystemAdmin rolüne kapılı; Admin/Agent vs ana sayfaya yönlenir.
 * Sol menüde 3 grup: Tanımlar / Yapılandırma / Şirket
 * Üstte "← Ana Sayfaya Dön" butonu.
 */

export type AdminView =
  | 'admin-categories'
  | 'admin-sla'
  | 'admin-thirdparty'
  | 'admin-documents'
  | 'admin-checklist'
  | 'admin-teams'
  | 'admin-offered-solutions'
  | 'admin-fields'
  | 'admin-company-settings';

export const ADMIN_VIEWS: AdminView[] = [
  'admin-categories',
  'admin-sla',
  'admin-thirdparty',
  'admin-documents',
  'admin-checklist',
  'admin-teams',
  'admin-offered-solutions',
  'admin-fields',
  'admin-company-settings',
];

export function isAdminView(v: string): v is AdminView {
  return (ADMIN_VIEWS as string[]).includes(v);
}

interface NavGroup {
  label: string;
  items: { key: AdminView; label: string; icon: ReactNode }[];
}

const NAV: NavGroup[] = [
  {
    label: 'Tanımlar',
    items: [
      { key: 'admin-categories',        label: 'Kategori & Alt Kategori', icon: <FolderTree size={14} /> },
      { key: 'admin-sla',               label: 'SLA Kuralları',            icon: <Timer size={14} /> },
      { key: 'admin-checklist',         label: 'Kontrol Listesi',          icon: <ClipboardCheck size={14} /> },
      { key: 'admin-thirdparty',        label: '3. Parti Tanımları',       icon: <Network size={14} /> },
      { key: 'admin-documents',         label: 'Belge Türleri',            icon: <FileText size={14} /> },
      { key: 'admin-offered-solutions', label: 'Teklif Tanımları',         icon: <Tag size={14} /> },
      { key: 'admin-teams',             label: 'Takımlar & Üyeler',        icon: <Users2 size={14} /> },
    ],
  },
  {
    label: 'Yapılandırma',
    items: [
      { key: 'admin-fields', label: 'Dinamik Alanlar', icon: <Sliders size={14} /> },
    ],
  },
  {
    label: 'Şirket',
    items: [
      { key: 'admin-company-settings', label: 'Şirket Ayarları', icon: <Building2 size={14} /> },
    ],
  },
];

export function AdminLayout({
  view,
  onSelectView,
  onExit,
  children,
}: {
  view: AdminView;
  onSelectView: (v: AdminView) => void;
  onExit: () => void;
  children: ReactNode;
}) {
  const { user } = useAuth();

  // Rol guard: SystemAdmin değilse anaya dön
  if (user && user.role !== 'SystemAdmin') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-ndark-bg">
        <div className="max-w-md rounded-md border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="mb-2 font-medium text-rose-900">Yetkiniz yok</p>
          <p className="mb-4 text-sm text-rose-700">
            Bu alan yalnızca SystemAdmin rolüyle erişilebilir.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 dark:bg-ndark-bg">
      {/* Header — sade, ana app'ten ayrıştırıcı */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
          >
            <ArrowLeft size={14} />
            <span>Ana Uygulama</span>
          </button>
          <div className="h-5 w-px bg-slate-200 dark:bg-ndark-border" />
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-slate-500" />
            <span className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
              Yönetim Paneli
            </span>
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-ndark-muted">
          {user?.fullName} · <span className="font-medium">{user?.role}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sol nav — gruplu */}
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 dark:border-ndark-border dark:bg-ndark-card">
          {NAV.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? 'mt-5' : ''}>
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-dim">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = view === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => onSelectView(item.key)}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition ${
                          active
                            ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg'
                        }`}
                      >
                        <span className={active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'}>
                          {item.icon}
                        </span>
                        <span className="flex-1 text-left">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
