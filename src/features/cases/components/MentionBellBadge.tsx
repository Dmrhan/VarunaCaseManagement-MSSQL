import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Bell, Eye, Inbox, SmilePlus } from 'lucide-react';
import { caseService } from '@/services/caseService';
import { formatRelative } from '@/lib/format';
import type { UnreadMention, UnreadNotification } from '../types';

/**
 * MentionBellBadge — header'da @mention + generic CaseNotification bildirimleri.
 *
 * Polling: 60 saniyede bir + window 'app:mentions-changed' / 'app:notifications-changed'
 * event'leri ile manuel tetik. Faz 2 §6 bildirim sistemi (WebSocket / 30sn poll)
 * gelene kadar minimal yaklaşım.
 *
 * İçerik: mention'lar (CaseMention) + generic notification'lar (CaseNotification)
 * birleşik bir akışta — sentAt/createdAt sıralı. Tıklanınca drawer açılır;
 * bir öğeye tıklamak parent onCaseClick prop'unu çağırır.
 *
 * Drawer açılınca **mevcut** generic notification'lar seen yapılır (mention'lar
 * vakaya girince seen yapılır — eski davranış korunur).
 */

interface MentionBellBadgeProps {
  onCaseClick: (caseId: string) => void;
}

const POLL_MS = 60_000;

type FeedItem =
  | { kind: 'mention'; id: string; caseId: string; ts: string; data: UnreadMention }
  | { kind: 'notification'; id: string; caseId: string; ts: string; data: UnreadNotification };

function notificationIcon(eventType: string | undefined) {
  if (eventType === 'note_reaction') return SmilePlus;
  if (eventType === 'watcher_added') return Eye;
  return Eye;
}

function notificationKindLabel(eventType: string | undefined): string {
  if (eventType === 'note_reaction') return 'reaksiyon';
  if (eventType === 'watcher_added') return 'izleyici';
  if (eventType === 'watcher_update') return 'izleyici güncellemesi';
  return 'bildirim';
}

export function MentionBellBadge({ onCaseClick }: MentionBellBadgeProps) {
  const [mentions, setMentions] = useState<UnreadMention[]>([]);
  const [notifications, setNotifications] = useState<UnreadNotification[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Drawer'ı kapatırken mevcut görünen notification id'lerini seen yap.
  const seenOnCloseRef = useRef<Set<string>>(new Set());

  async function refresh() {
    try {
      const [m, n] = await Promise.all([
        caseService.listUnreadMentions(),
        caseService.listUnreadNotifications(),
      ]);
      setMentions(m.items);
      setNotifications(n.items);
    } catch {
      // apiFetch toast gösterdi; sessiz devam.
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onChanged = () => void refresh();
    window.addEventListener('app:mentions-changed', onChanged);
    window.addEventListener('app:notifications-changed', onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('app:mentions-changed', onChanged);
      window.removeEventListener('app:notifications-changed', onChanged);
    };
  }, []);

  // Outside click ile popover'ı kapat; kapanışta drawer'da görüntülenen
  // notification'ları seen olarak işaretle (mention seen ayrı bir flow:
  // kullanıcı vakaya tıklayınca CaseDetailPage tetikler).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Drawer açılınca görünen notification'ları seen yap (mention'lar dokunulmaz).
  useEffect(() => {
    if (!open) return;
    if (notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    if (ids.length === 0) return;
    seenOnCloseRef.current = new Set(ids);
    void caseService.markNotificationsSeen(ids).then(() => {
      // Drawer açıkken local state'i temizleme — kullanıcı listeyi görmeye
      // devam etsin. Kapatıldıktan sonra refresh polling temizler.
    });
    // ESLint: deliberately exclude notifications from deps — only act on open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const feed: FeedItem[] = useMemo(() => {
    const all: FeedItem[] = [
      ...mentions.map((m) => ({
        kind: 'mention' as const,
        id: `m:${m.id}`,
        caseId: m.caseId,
        ts: m.createdAt,
        data: m,
      })),
      ...notifications.map((n) => ({
        kind: 'notification' as const,
        id: `n:${n.id}`,
        caseId: n.caseId,
        ts: n.sentAt,
        data: n,
      })),
    ];
    // Yeni en üstte
    all.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return all;
  }, [mentions, notifications]);

  const count = feed.length;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Bildirimler — bahsedildiğin ve izlediğin vakalar"
        aria-label={count > 0 ? `${count} okunmamış bildirim` : 'Bildirimler'}
        className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
      >
        <Bell size={18} />
        {count > 0 && (
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-ndark-card"
            aria-hidden
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
          {feed.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-slate-500 dark:text-ndark-muted">
              <Inbox size={20} className="text-slate-400 dark:text-ndark-muted" />
              <span>Şu an seni bekleyen bir bildirim yok</span>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {feed.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onCaseClick(it.caseId);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-ndark-bg/50"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                        {it.data.case.caseNumber}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
                        {formatRelative(it.ts)}
                      </span>
                    </div>
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {it.data.case.title}
                    </div>
                    {it.kind === 'mention' ? (
                      <div className="flex items-center gap-1 truncate text-xs text-slate-500 dark:text-ndark-muted">
                        <AtSign size={11} />
                        <span className="truncate">
                          {it.data.case.accountName} · seni etiketledi
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 truncate text-xs text-slate-500 dark:text-ndark-muted">
                        {(() => {
                          const Icon = notificationIcon(it.data.eventType);
                          return <Icon size={11} />;
                        })()}
                        <span className="truncate">
                          {it.data.payload?.message ?? notificationKindLabel(it.data.eventType)}
                        </span>
                      </div>
                    )}
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
