import { useCallback, useEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import {
  actionCenterService,
  ACTION_CENTER_EVENT,
  type ActionCenterBadgeCounts,
} from '@/services/actionCenterService';
import { ActionCenterDrawer } from './ActionCenterDrawer';

/**
 * WR-ACTION-CENTER Phase 1 — Header bell with two distinct counters:
 *   - Action Required (kırmızı) — top priority
 *   - FYI            (gri)
 *
 * Polls /summary every 60s; refreshes on `app:action-center-changed`.
 * Click → opens ActionCenterDrawer.
 */

const POLL_MS = 60000;

export function ActionCenterBell({ onCaseOpen }: { onCaseOpen: (caseId: string) => void }) {
  const [counts, setCounts] = useState<ActionCenterBadgeCounts>({
    actionRequired: 0,
    fyi: 0,
    snoozed: 0,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const r = await actionCenterService.summary();
    if (!mountedRef.current) return;
    if (r) setCounts(r);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    const handler = () => void refresh();
    window.addEventListener(ACTION_CENTER_EVENT, handler);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener(ACTION_CENTER_EVENT, handler);
    };
  }, [refresh]);

  const { actionRequired, fyi } = counts;
  const tooltip = `Aksiyonlarım — ${actionRequired} iş bekliyor, ${fyi} bildirim`;

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="relative inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
        title={tooltip}
        aria-label={tooltip}
      >
        <ListChecks size={16} />
        {actionRequired > 0 && (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {actionRequired > 99 ? '99+' : actionRequired}
          </span>
        )}
        {fyi > 0 && (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-slate-400 px-1 text-[10px] font-semibold text-white">
            {fyi > 99 ? '99+' : fyi}
          </span>
        )}
      </button>
      <ActionCenterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCaseOpen={onCaseOpen}
      />
    </>
  );
}
