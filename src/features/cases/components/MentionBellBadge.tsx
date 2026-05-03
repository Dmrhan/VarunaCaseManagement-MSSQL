import { useEffect, useRef, useState } from 'react';
import { Bell, Inbox } from 'lucide-react';
import { caseService } from '@/services/caseService';
import { formatRelative } from '@/lib/format';
import type { UnreadMention } from '../types';

/**
 * MentionBellBadge — header'da @mention bildirimleri.
 *
 * Polling: 60 saniyede bir + window 'app:mentions-changed' event'i ile manuel
 * tetik (CaseDetailPage vakayı açıp seen yapınca yayar). Faz 2 §6 bildirim
 * sistemi (WebSocket / 30sn poll) gelene kadar minimal yaklaşım.
 *
 * Tıklanınca drawer açılır; bir mention'a tıklamak parent onCaseClick prop'unu
 * çağırır (App.tsx routing — case-detail).
 */

interface MentionBellBadgeProps {
  onCaseClick: (caseId: string) => void;
}

const POLL_MS = 60_000;

export function MentionBellBadge({ onCaseClick }: MentionBellBadgeProps) {
  const [items, setItems] = useState<UnreadMention[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const r = await caseService.listUnreadMentions();
      setItems(r.items);
    } catch {
      // apiFetch toast gösterdi; sessiz devam.
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onChanged = () => void refresh();
    window.addEventListener('app:mentions-changed', onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('app:mentions-changed', onChanged);
    };
  }, []);

  // Outside click ile popover'ı kapat.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const count = items.length;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Bildirimler — bahsedildiğin vakalar"
        className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
      >
        <Bell size={18} />
        {count > 0 && (
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-ndark-card"
            aria-label={`${count} okunmamış bildirim`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl ring-1 ring-slate-900/5 dark:border-ndark-border dark:bg-ndark-card dark:ring-white/5">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-ndark-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
                Bildirimler
              </span>
              <span className="text-xs text-slate-500 dark:text-ndark-muted">
                {count === 0 ? 'okunmamış yok' : `${count} okunmamış`}
              </span>
            </div>
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-slate-500 dark:text-ndark-muted">
              <Inbox size={20} className="text-slate-400" />
              <span>Şu an seni bekleyen bir bildirim yok</span>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onCaseClick(m.caseId);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-ndark-bg/50"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                        {m.case.caseNumber}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
                        {formatRelative(m.createdAt)}
                      </span>
                    </div>
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {m.case.title}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-ndark-muted">
                      {m.case.accountName} · seni etiketledi
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
