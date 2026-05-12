import { useEffect, useMemo, useState } from 'react';
import { Building2, ExternalLink, Eye, Filter, Inbox, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { caseService } from '@/services/caseService';
import { formatRelative } from '@/lib/format';
import type { Case, UnreadNotification } from '@/features/cases/types';

/**
 * WatcherInboxPage — kullanıcının izlediği vakaların tek listeden takibi
 * (Smoke Audit Phase 5c).
 *
 * - GET /api/cases/watching → izlenen vakalar (Case[] + addedAt eki)
 * - GET /api/cases/me/notifications/unread → son okunmamış generic
 *   bildirimler (watcher_update, watcher_added, note_reaction)
 *
 * Header bell drawer hızlı erişim; bu sayfa daha geniş tablo + status pill +
 * priority + son aktivite. Mention notification'lar ayrı kanal (bell drawer
 * onları gösterir; burada generic CaseNotification odaklıyız).
 *
 * Filtreler:
 * - Status: Tümü / Açık (Cozuldu/IptalEdildi hariç)
 * - Zaman: Tümü / Bugün / Bu Hafta (updatedAt'a göre)
 */

type StatusFilter = 'all' | 'open';
type TimeFilter = 'all' | 'today' | 'week';

interface WatcherInboxPageProps {
  onSelectCase: (caseId: string) => void;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfToday();
  // Pazartesi başlangıçlı hafta (TR alışkanlığı)
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - day);
  return d;
}

const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  note_reaction: 'Reaksiyon',
  watcher_added: 'İzleyici eklendi',
  watcher_update: 'Vaka güncellemesi',
};

function notificationKindLabel(eventType: string | undefined): string {
  return NOTIFICATION_KIND_LABEL[eventType ?? ''] ?? 'Bildirim';
}

export function WatcherInboxPage({ onSelectCase }: WatcherInboxPageProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [notifications, setNotifications] = useState<UnreadNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  async function refresh() {
    setLoading(true);
    try {
      const [c, n] = await Promise.all([
        caseService.listWatching(),
        caseService.listUnreadNotifications(),
      ]);
      setCases(c);
      setNotifications(n.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Bell drawer ve bu sayfa aynı kaynaktan beslenir — drawer mark-seen
    // yapsa bile burada en güncel state'i tutmak için event'i dinle.
    const onChanged = () => void refresh();
    window.addEventListener('app:notifications-changed', onChanged);
    window.addEventListener('app:watcher-changed', onChanged);
    return () => {
      window.removeEventListener('app:notifications-changed', onChanged);
      window.removeEventListener('app:watcher-changed', onChanged);
    };
  }, []);

  const filtered = useMemo(() => {
    let arr = cases;
    if (statusFilter === 'open') {
      arr = arr.filter((c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi');
    }
    if (timeFilter !== 'all') {
      const min = timeFilter === 'today' ? startOfToday() : startOfWeek();
      arr = arr.filter((c) => new Date(c.updatedAt).getTime() >= min.getTime());
    }
    // updatedAt desc — en yeni aktivite üstte
    return [...arr].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  }, [cases, statusFilter, timeFilter]);

  const slaCount = useMemo(
    () => filtered.filter((c) => c.slaViolation).length,
    [filtered],
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Eye className="text-brand-600 dark:text-brand-400" size={20} />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">
              İzleyici Inbox
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Takip ettiğiniz vakaların güncel durumu ve son bildirimler.
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500 dark:text-ndark-muted">
              <span className="font-semibold text-slate-900 dark:text-ndark-text">
                {cases.length}
              </span>{' '}
              vaka takip ediliyor
            </span>
            {slaCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40">
                <ShieldAlert size={12} />
                {slaCount} SLA ihlali
              </span>
            )}
          </div>
        )}
      </header>

      {/* Filtreler */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-slate-400 dark:text-ndark-muted" />
        <FilterChip
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        >
          Tüm Statüler
        </FilterChip>
        <FilterChip
          active={statusFilter === 'open'}
          onClick={() => setStatusFilter('open')}
        >
          Yalnız Açık
        </FilterChip>
        <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-ndark-border" />
        <FilterChip
          active={timeFilter === 'all'}
          onClick={() => setTimeFilter('all')}
        >
          Tüm Zaman
        </FilterChip>
        <FilterChip
          active={timeFilter === 'today'}
          onClick={() => setTimeFilter('today')}
        >
          Bugün
        </FilterChip>
        <FilterChip
          active={timeFilter === 'week'}
          onClick={() => setTimeFilter('week')}
        >
          Bu Hafta
        </FilterChip>
      </div>

      {/* Son Bildirimler — küçük blok */}
      {notifications.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Son Bildirimler ({notifications.length})
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-ndark-border">
              {notifications.slice(0, 10).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCase(n.caseId)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-ndark-bg/40"
                  >
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      <Eye size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                            {n.case.caseNumber}
                          </span>
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                            {n.case.title}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-400 dark:text-ndark-muted">
                          {formatRelative(n.sentAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:bg-ndark-card">
                          {notificationKindLabel(n.eventType)}
                        </span>
                        <span className="truncate">
                          {n.payload?.message ?? n.case.accountName}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* İzlenen Vakalar */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
          İzlenen Vakalar ({filtered.length}
          {filtered.length !== cases.length ? ` / ${cases.length}` : ''})
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox size={28} />}
            title={cases.length === 0 ? 'Henüz izlediğiniz vaka yok' : 'Filtreye uyan vaka yok'}
            description={
              cases.length === 0
                ? 'Vaka detayında "İzle" diyerek bir vakayı buraya ekleyebilirsiniz.'
                : 'Statü veya zaman filtresini gevşeterek tekrar deneyin.'
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectCase(c.id)}
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm dark:border-ndark-border dark:bg-ndark-card dark:hover:border-brand-500"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                        {c.caseNumber}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">
                        {c.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
                      <Building2 size={11} />
                      <span className="truncate">{c.accountName}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusPill status={c.status} />
                      <PriorityBadge priority={c.priority} />
                      {c.slaViolation && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40">
                          <ShieldAlert size={9} />
                          SLA
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-slate-400 dark:text-ndark-muted">
                        {formatRelative(c.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <ExternalLink
                    size={14}
                    className="mt-0.5 shrink-0 text-slate-300 dark:text-ndark-muted"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full px-2.5 py-1 text-xs font-medium transition ' +
        (active
          ? 'bg-brand-600 text-white shadow-sm'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg')
      }
    >
      {children}
    </button>
  );
}
