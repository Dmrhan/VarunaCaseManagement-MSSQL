import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Inbox, Loader2, X } from 'lucide-react';
import {
  actionCenterService,
  ACTION_CENTER_EVENT,
  type ActionCenterListResponse,
  type ActionCenterView,
  type ActionItem,
} from '@/services/actionCenterService';
import { ActionItemRow } from './ActionItemRow';

/**
 * WR-ACTION-CENTER Phase 1 — Right-side drawer ("Aksiyonlarım").
 *
 * 4 tabs: İşler / Bildirimler / Ertelenen / Tamamlanan.
 * Polls every 30s while open; refreshes on `app:action-center-changed`.
 *
 * UX redesign (WR-NOTIFICATION-CENTER): tab underline (no purple wall),
 * Bugün / Dün / Daha eski grouping, calmer header + footer.
 */

const TABS: { value: ActionCenterView; label: string }[] = [
  { value: 'action', label: 'İşler' },
  { value: 'fyi', label: 'Bildirimler' },
  { value: 'snoozed', label: 'Ertelenen' },
  { value: 'done', label: 'Tamamlanan' },
];

const POLL_MS = 30000;

const EMPTY_COPY: Record<ActionCenterView, string> = {
  action: 'Şu an senden aksiyon bekleyen iş yok.',
  fyi: 'Yeni bilgilendirme yok.',
  snoozed: 'Ertelenmiş iş veya bildirim yok.',
  done: 'Son 30 günde tamamlanmış öğe yok.',
};

interface DayBucket {
  label: 'Bugün' | 'Dün' | 'Daha eski';
  items: ActionItem[];
}

function bucketByDay(items: ActionItem[]): DayBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const bugun: ActionItem[] = [];
  const dun: ActionItem[] = [];
  const eski: ActionItem[] = [];

  for (const it of items) {
    if (!it.createdAt) {
      eski.push(it);
      continue;
    }
    const d = new Date(it.createdAt);
    if (Number.isNaN(d.getTime())) {
      eski.push(it);
      continue;
    }
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) bugun.push(it);
    else if (d.getTime() === yesterday.getTime()) dun.push(it);
    else eski.push(it);
  }

  const out: DayBucket[] = [];
  if (bugun.length) out.push({ label: 'Bugün', items: bugun });
  if (dun.length) out.push({ label: 'Dün', items: dun });
  if (eski.length) out.push({ label: 'Daha eski', items: eski });
  return out;
}

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

  /**
   * Refresh modes (hotfix — silent polling):
   *
   *   silent=false  Default. Sets the loading spinner; on a null
   *                 response also clears `data` so the empty state is
   *                 honored. Used for initial open and tab change.
   *
   *   silent=true   No spinner, no list flicker. On a successful
   *                 response we patch in the new data; on a null
   *                 response we KEEP the previous data so a transient
   *                 network failure during background polling does not
   *                 blank the drawer. Used for interval polling and
   *                 ACTION_CENTER_EVENT (post-action) refreshes.
   */
  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      const r = await actionCenterService.list({ view, limit: 50 });
      if (!silent) setLoading(false);
      if (r) {
        setData(r);
        return;
      }
      if (!silent) setData(null);
    },
    [view],
  );

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = window.setInterval(() => void refresh({ silent: true }), POLL_MS);
    const handler = () => void refresh({ silent: true });
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

  const items: ActionItem[] = data?.items ?? [];
  const buckets = useMemo(() => bucketByDay(items), [items]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — mobile/tablet only; desktop drawer leaves the page
          interactive (DR-4). */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="complementary"
        aria-label="Aksiyonlarım"
        // DR-1..DR-10 sizing preserved:
        //   desktop: clamp(420px, 34vw, 640px)
        //   tablet:  min(90vw, 560px)
        //   mobile:  full-screen (max-w-[92vw])
        className="fixed inset-y-0 right-0 z-50 flex max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-ndark-border dark:bg-ndark-card"
        style={{ width: 'clamp(420px, 34vw, 640px)' }}
      >
        {/* ── Header ── */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5 dark:border-ndark-border dark:bg-ndark-card">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-900/50"
              aria-hidden
            >
              <Bell size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-5 text-slate-900 dark:text-ndark-text">
                Aksiyonlarım
              </div>
              <div className="truncate text-[11.5px] leading-4 text-slate-500 dark:text-ndark-muted">
                Sana atanan işler ve bilgilendirmeler
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-ndark-muted dark:hover:bg-ndark-bg dark:hover:text-ndark-text"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </header>

        {/* ── Tabs (underline accent, no purple wall) ── */}
        <nav
          className="sticky top-[64px] z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 dark:border-ndark-border dark:bg-ndark-card"
          aria-label="Aksiyon türü sekmeleri"
        >
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
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs transition ${
                  active
                    ? 'border-violet-500 font-semibold text-violet-700 dark:border-violet-400 dark:text-violet-200'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-ndark-muted dark:hover:border-ndark-border dark:hover:text-ndark-text'
                }`}
              >
                <span>{tab.label}</span>
                {count != null && count > 0 && (
                  <span
                    className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0 text-[10px] font-semibold leading-4 tabular-nums ${
                      active
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200'
                        : 'bg-slate-100 text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── List ── */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500 dark:text-ndark-muted">
              <Loader2 size={14} className="animate-spin" />
              <span>Yükleniyor…</span>
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <Inbox size={22} className="mb-2 text-slate-300 dark:text-ndark-muted" />
              <div className="text-[12px] text-slate-500 dark:text-ndark-muted">
                {EMPTY_COPY[view]}
              </div>
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="space-y-4">
              {buckets.map((bucket) => (
                <section key={bucket.label} aria-label={bucket.label}>
                  <div className="mb-2 flex items-center gap-2 px-0.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-muted">
                      {bucket.label}
                    </span>
                    <span className="h-px flex-1 bg-slate-100 dark:bg-ndark-border" />
                    <span className="text-[10.5px] tabular-nums text-slate-400 dark:text-ndark-muted">
                      {bucket.items.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {bucket.items.map((it) => (
                      <ActionItemRow
                        key={it.id}
                        item={it}
                        view={view}
                        // Current product behavior preserved: any row's
                        // "Vakayı Aç" / "Yorumu Aç" navigates AND closes
                        // the drawer.
                        onCaseOpen={(caseId) => {
                          onCaseOpen(caseId);
                          onClose();
                        }}
                        onChanged={() => void refresh({ silent: true })}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer chip ── */}
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/30 dark:text-ndark-muted">
          Son 30 gündeki aksiyon ve bildirimleri görüyorsun.
        </div>
      </aside>
    </>
  );
}
