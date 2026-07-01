import { useCallback, useEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import {
  actionCenterService,
  ACTION_CENTER_EVENT,
  type ActionCenterBadgeCounts,
  type ActionItem,
} from '@/services/actionCenterService';
import { ActionCenterDrawer } from './ActionCenterDrawer';
import { notify } from '@/components/ui/Toast';

/**
 * WR-ACTION-CENTER Phase 1 — Header bell with two distinct counters:
 *   - Action Required (kırmızı) — top priority
 *   - FYI            (gri)
 *
 * Polls /summary every 60s; refreshes on `app:action-center-changed`.
 * Click → opens ActionCenterDrawer.
 */

const POLL_MS = 60000;

function buildToastForItem(item: ActionItem, onCaseOpen: (caseId: string) => void) {
  const title = item.caseNumber
    ? `#${item.caseNumber} ${item.caseTitle ?? ''}`.trim()
    : 'Yeni bildirim';

  const isActionRequired = item.actionRequired === true;
  const isSystemAlert = item.kind === 'system_alert';

  notify({
    type: isActionRequired ? 'error' : isSystemAlert ? 'warn' : 'info',
    title,
    message: item.reasonLabel,
    duration: isActionRequired ? 0 : 5000,
    role: isActionRequired ? 'alert' : 'status',
    ...(item.caseId
      ? { action: { label: 'Görüntüle', onClick: () => onCaseOpen(item.caseId!) } }
      : {}),
  });
}

export function ActionCenterBell({ onCaseOpen }: { onCaseOpen: (caseId: string) => void }) {
  const [counts, setCounts] = useState<ActionCenterBadgeCounts>({
    actionRequired: 0,
    fyi: 0,
    snoozed: 0,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mountedRef = useRef(true);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const onCaseOpenRef = useRef(onCaseOpen);
  onCaseOpenRef.current = onCaseOpen;

  const refresh = useCallback(async () => {
    const [summaryResult, actionResult, fyiResult] = await Promise.all([
      actionCenterService.summary(),
      actionCenterService.list({ view: 'action', limit: 50 }),
      actionCenterService.list({ view: 'fyi', limit: 50 }),
    ]);
    if (!mountedRef.current) return;
    if (summaryResult) setCounts(summaryResult);
    const items = [
      ...(actionResult?.items ?? []),
      ...(fyiResult?.items ?? []),
    ];
    if (!initializedRef.current) {
      items.forEach((item) => seenIdsRef.current.add(item.id));
      initializedRef.current = true;
    } else {
      items.forEach((item) => {
        if (!seenIdsRef.current.has(item.id)) {
          seenIdsRef.current.add(item.id);
          buildToastForItem(item, onCaseOpenRef.current);
        }
      });
    }
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
