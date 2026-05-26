import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { HelpButton, HelpDrawer } from '@/components/ui/HelpDrawer';
import { ACTION_CENTER_HELP } from '@/features/admin/helpContents';
import {
  actionCenterService,
  ACTION_CENTER_EVENT,
  type ActionCenterListResponse,
  type ActionCenterView,
  type ActionItem,
} from '@/services/actionCenterService';
import { ActionItemRow } from './ActionItemRow';

/**
 * WR-ACTION-CENTER Phase 1 — Right-side drawer.
 *
 * 4 tabs: Eylem Bekleyen / Bildirimler / Ertelenen / Yapıldı.
 * Polls every 30s while open; refreshes on `app:action-center-changed`.
 */

const TABS: { value: ActionCenterView; label: string }[] = [
  { value: 'action', label: 'Eylem Bekleyen' },
  { value: 'fyi', label: 'Bildirimler' },
  { value: 'snoozed', label: 'Ertelenen' },
  { value: 'done', label: 'Yapıldı' },
];

const POLL_MS = 30000;

export function ActionCenterDrawer({
  open,
  onClose,
  onCaseOpen,
}: {
  open: boolean;
  onClose: () => void;
  onCaseOpen: (caseId: string) => void;
}) {
  const [view, setView] = useState<ActionCenterView>('action');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ActionCenterListResponse | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await actionCenterService.list({ view, limit: 50 });
    setLoading(false);
    setData(r ?? null);
  }, [view]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    const handler = () => void refresh();
    window.addEventListener(ACTION_CENTER_EVENT, handler);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(ACTION_CENTER_EVENT, handler);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items: ActionItem[] = data?.items ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="complementary"
        aria-label="Eylem Merkezi"
        className="fixed inset-y-0 right-0 z-50 flex w-96 max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-ndark-border dark:bg-ndark-card"
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-ndark-border dark:bg-ndark-bg/30">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-violet-600 dark:text-violet-400" />
            <div>
              <div className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Eylem Merkezi
              </div>
              <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
                Sana atanmış işler ve bildirimler
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <HelpButton onClick={() => setHelpOpen((v) => !v)} active={helpOpen} />
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-bg"
              aria-label="Kapat"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2 text-xs dark:border-ndark-border">
          {TABS.map((tab) => {
            const active = tab.value === view;
            const count =
              tab.value === 'action'
                ? data?.badgeCounts?.actionRequired ?? 0
                : tab.value === 'fyi'
                  ? data?.badgeCounts?.fyi ?? 0
                  : tab.value === 'snoozed'
                    ? data?.badgeCounts?.snoozed ?? 0
                    : null;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setView(tab.value)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
                  active
                    ? 'bg-violet-100 font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg'
                }`}
              >
                <span>{tab.label}</span>
                {count != null && count > 0 && (
                  <Badge tint={active ? 'violet' : 'slate'}>{count}</Badge>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" />
              <span>Yükleniyor…</span>
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-slate-500 dark:text-ndark-muted">
              <Bell size={24} className="mb-2 text-emerald-500" />
              {view === 'action' && <span>Bekleyen eylem yok — temizsin.</span>}
              {view === 'fyi' && <span>Yeni bildirim yok.</span>}
              {view === 'snoozed' && <span>Ertelediğin öğe yok.</span>}
              {view === 'done' && <span>Son 7 günde tamamlanmış öğe yok.</span>}
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="space-y-2">
              {items.map((it) => (
                <ActionItemRow
                  key={it.id}
                  item={it}
                  view={view}
                  onCaseOpen={(caseId) => {
                    onCaseOpen(caseId);
                    onClose();
                  }}
                  onChanged={() => void refresh()}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
      <HelpDrawer
        open={helpOpen}
        title={ACTION_CENTER_HELP.title}
        sections={ACTION_CENTER_HELP.sections}
        onClose={() => setHelpOpen(false)}
      />
    </>
  );
}
