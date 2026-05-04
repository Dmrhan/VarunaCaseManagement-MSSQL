import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/components/ui/cn';
import { useAuth } from '@/services/AuthContext';
import {
  myService,
  type DashboardData,
  type DashboardCalendarEvent,
  type DashboardTopCase,
  type PendingApproval,
  type PerformanceDimension,
  type UrgentSignal,
} from '@/services/myService';
import { QuickReminderModal } from './QuickReminderModal';

interface MyHomePageProps {
  onSelectCase: (caseId: string) => void;
  onShowCases: () => void;
  onShowCalendar: () => void;
  onShowPatterns: () => void;
}

const TR_DAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_MONTH = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function formatDateLong(d: Date) {
  return `${TR_DAY[d.getDay()]}, ${d.getDate()} ${TR_MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

function formatHM(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const GREETING_LABEL: Record<string, string> = {
  morning: 'Günaydın',
  afternoon: 'İyi öğlenler',
  evening: 'İyi akşamlar',
};

export function MyHomePage({
  onSelectCase,
  onShowCases,
  onShowCalendar,
  onShowPatterns,
}: MyHomePageProps) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Geç tıklanan AI önerileri — session içi (persist edilmiyor).
  const [dismissedApprovals, setDismissedApprovals] = useState<Set<string>>(new Set());
  // Reminder modal state — Ekle / Hatırlatıcı Ekle butonları açar.
  const [reminderModal, setReminderModal] = useState<{
    open: boolean;
    presetCaseId?: string;
    presetCaseLabel?: string;
    presetRemindAt?: Date | null;
  }>({ open: false });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void myService.getDashboard().then((d) => {
      if (alive) {
        setData(d ?? null);
        setLoading(false);
      }
    });
    // 'app:calendar-changed' eventiyle reminder/snooze sonrası refresh
    const onChanged = () => {
      void myService.getDashboard().then((d) => {
        if (alive) setData(d ?? null);
      });
    };
    window.addEventListener('app:calendar-changed', onChanged);
    return () => {
      alive = false;
      window.removeEventListener('app:calendar-changed', onChanged);
    };
  }, []);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertCircle size={22} />}
          title="Anasayfa yüklenemedi"
          description="Tekrar denemek için sayfayı yenileyin."
        />
      </div>
    );
  }

  const today = new Date();
  const greetingPrefix = GREETING_LABEL[data.greeting.timeOfDay] ?? 'Merhaba';
  const showDailySummary = data.dailySummary.resolvedToday > 0 || today.getHours() >= 14;

  // Approve list filtered by session dismiss state.
  const visibleApprovals = data.pendingApprovals.filter((a, i) => {
    const key = approvalKey(a, i);
    return !dismissedApprovals.has(key);
  });

  function dismissApproval(a: PendingApproval, i: number) {
    setDismissedApprovals((prev) => {
      const next = new Set(prev);
      next.add(approvalKey(a, i));
      return next;
    });
  }

  function applyApproval(a: PendingApproval) {
    if (a.type === 'followup') {
      // Bu öneri zaten "bugünkü takip aramaları" — takvime yönlendir.
      onShowCalendar();
      return;
    }
    // sla / reminder: vakaya bağlı reminder oluşturma modal'ı, suggestedTime pre-fill.
    const dt = new Date(a.suggestedTime);
    setReminderModal({
      open: true,
      presetCaseId: a.caseId ?? undefined,
      presetCaseLabel:
        a.caseNumber && a.customerName
          ? `${a.caseNumber} · ${a.customerName}`
          : a.caseNumber ?? undefined,
      presetRemindAt: Number.isFinite(dt.getTime()) ? dt : null,
    });
  }

  return (
    <div className="space-y-8">
      {/* HEADER — sol violet accent bar + büyük selamlama */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-stretch gap-4">
          <div
            aria-hidden
            className="w-1 rounded-full bg-gradient-to-b from-violet-500 to-violet-700 dark:from-violet-400 dark:to-violet-600"
          />
          <div className="py-1">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-ndark-text">
              {greetingPrefix}, {data.greeting.name} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
              {formatDateLong(today)}
            </p>
          </div>
        </div>
        <Button leftIcon={<Plus size={14} />} onClick={onShowCases}>
          Yeni Vaka
        </Button>
      </div>

      {/* URGENT SIGNALS */}
      <UrgentSignalsBar
        signals={data.urgentSignals}
        onShowCases={onShowCases}
        onShowPatterns={onShowPatterns}
      />

      {/* STATS */}
      <StatsRow
        stats={data.stats}
        onShowCases={onShowCases}
        onShowCalendar={onShowCalendar}
      />

      {/* TWO COLUMN */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {visibleApprovals.length > 0 && (
            <AISuggestionsPanel
              approvals={visibleApprovals}
              onApply={applyApproval}
              onDismiss={dismissApproval}
              originalApprovals={data.pendingApprovals}
            />
          )}
          {data.myTopCases.length > 0 && (
            <TopCasesPanel
              cases={data.myTopCases}
              onSelectCase={onSelectCase}
              onShowAll={onShowCases}
            />
          )}
          {visibleApprovals.length === 0 && data.myTopCases.length === 0 && (
            <Card>
              <div className="p-6">
                <EmptyState
                  icon={<CheckCircle2 size={22} />}
                  title="Aktif vakan yok"
                  description="Yeni vaka oluşturmak veya genel listeyi görmek için sağ üstteki butonu kullan."
                />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <TodayPanel
            events={data.todayCalendar}
            onSelectCase={onSelectCase}
            onShowCalendar={onShowCalendar}
            onAddReminder={() => setReminderModal({ open: true, presetRemindAt: null })}
          />
          <PerformancePanel performance={data.performance} userRole={user?.role} />
        </div>
      </div>

      {showDailySummary && data.dailySummary && (
        <DailySummaryStrip summary={data.dailySummary} />
      )}

      <QuickReminderModal
        open={reminderModal.open}
        presetCaseId={reminderModal.presetCaseId}
        presetCaseLabel={reminderModal.presetCaseLabel}
        presetRemindAt={reminderModal.presetRemindAt ?? null}
        onClose={() => setReminderModal({ open: false })}
        onCreated={() => {
          setReminderModal({ open: false });
          // dashboard refresh — app:calendar-changed event zaten fire ediliyor;
          // useEffect listener yakalar.
        }}
        onOpenCase={onSelectCase}
      />
    </div>
  );
}

function approvalKey(a: PendingApproval, i: number) {
  return `${a.type}:${a.caseId ?? '_'}:${i}`;
}

// ─────────── Urgent Signals ───────────

function UrgentSignalsBar({
  signals,
  onShowCases,
  onShowPatterns,
}: {
  signals: UrgentSignal[];
  onShowCases: () => void;
  onShowPatterns: () => void;
}) {
  if (signals.length === 0) {
    // Celebratory all-clear — daha büyük, daha kutlamalı.
    return (
      <div className="inline-flex items-center gap-2.5 rounded-full border border-emerald-300 bg-emerald-50 px-5 py-2.5 text-base font-medium text-emerald-800 shadow-sm dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
        <span>Her şey kontrol altında</span>
        <span aria-hidden className="text-base">✨</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {signals.map((s) => {
        if (s.type === 'sla_risk') {
          return (
            <SignalPill
              key={s.type}
              tone="red"
              icon={<AlertCircle size={16} />}
              label={`${s.count} vakanda SLA riski`}
              onClick={onShowCases}
            />
          );
        }
        if (s.type === 'unread_mentions') {
          return (
            <SignalPill
              key={s.type}
              tone="violet"
              icon={<MessageSquare size={16} />}
              label={`${s.count} okunmamış etiketlemen`}
            />
          );
        }
        if (s.type === 'awaiting_reply') {
          return (
            <SignalPill
              key={s.type}
              tone="amber"
              icon={<Clock size={16} />}
              label={`${s.count} müşteri yanıt bekliyor`}
              onClick={onShowCases}
            />
          );
        }
        if (s.type === 'pattern_alert') {
          return (
            <SignalPill
              key={s.type}
              tone="amber"
              icon={<AlertTriangle size={16} />}
              label={`Örüntü: ${s.category}`}
              onClick={onShowPatterns}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

const PILL_TONE: Record<'red' | 'amber' | 'violet', string> = {
  red: 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60',
  amber:
    'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60',
  violet:
    'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60',
};

function SignalPill({
  tone,
  icon,
  label,
  onClick,
}: {
  tone: 'red' | 'amber' | 'violet';
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors',
        PILL_TONE[tone],
        onClick && 'cursor-pointer',
      )}
    >
      {icon}
      <span>{label}</span>
    </Wrapper>
  );
}

// ─────────── Stats Row ───────────

type StatTone = 'violet' | 'emerald' | 'amber' | 'blue';

const STAT_TONE: Record<
  StatTone,
  { topBar: string; iconBg: string; iconText: string }
> = {
  violet: {
    topBar: 'bg-violet-500 dark:bg-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    iconText: 'text-violet-700 dark:text-violet-300',
  },
  emerald: {
    topBar: 'bg-emerald-500 dark:bg-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconText: 'text-emerald-700 dark:text-emerald-300',
  },
  amber: {
    topBar: 'bg-amber-500 dark:bg-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconText: 'text-amber-700 dark:text-amber-300',
  },
  blue: {
    topBar: 'bg-blue-500 dark:bg-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconText: 'text-blue-700 dark:text-blue-300',
  },
};

function StatsRow({
  stats,
  onShowCases,
  onShowCalendar,
}: {
  stats: DashboardData['stats'];
  onShowCases: () => void;
  onShowCalendar: () => void;
}) {
  const items: Array<{
    label: string;
    value: number;
    icon: React.ReactNode;
    tone: StatTone;
    onClick: () => void;
  }> = [
    { label: 'Bana Atanan', value: stats.assignedToMe, icon: <User size={20} />, tone: 'violet', onClick: onShowCases },
    { label: 'Bugün Çözdüm', value: stats.resolvedToday, icon: <CheckCircle2 size={20} />, tone: 'emerald', onClick: onShowCases },
    { label: 'Ertelenenler', value: stats.snoozed, icon: <Clock size={20} />, tone: 'amber', onClick: onShowCases },
    { label: 'Bugün Arayacaklarım', value: stats.followupToday, icon: <Phone size={20} />, tone: 'blue', onClick: onShowCalendar },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((it) => {
        const tone = STAT_TONE[it.tone];
        const isZero = it.value === 0;
        return (
          <button
            key={it.label}
            type="button"
            onClick={it.onClick}
            className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-ndark-border dark:bg-ndark-card dark:hover:border-brand-700"
          >
            {/* Tür-spesifik renkli üst şerit */}
            <span
              aria-hidden
              className={cn('absolute inset-x-0 top-0 h-1', tone.topBar)}
            />
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                tone.iconBg,
                tone.iconText,
              )}
            >
              {it.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                {it.label}
              </div>
              <div
                className={cn(
                  'text-3xl font-bold tabular-nums',
                  isZero
                    ? 'text-slate-300 dark:text-ndark-dim'
                    : 'text-slate-900 dark:text-ndark-text',
                )}
              >
                {it.value}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────── AI Suggestions ───────────

const APPROVAL_META: Record<
  PendingApproval['type'],
  { icon: React.ReactNode; label: string; primary: string }
> = {
  followup: { icon: <Phone size={14} />, label: 'Takip araması önerisi', primary: 'Takvime Git' },
  reminder: { icon: <Clock size={14} />, label: 'Hatırlatıcı önerisi', primary: 'Ekle' },
  sla: { icon: <AlertCircle size={14} />, label: 'SLA yaklaşıyor', primary: 'Ekle' },
  awaiting: { icon: <MessageSquare size={14} />, label: 'Müşteri yanıt bekliyor', primary: 'Taslak Oluştur' },
};

function AISuggestionsPanel({
  approvals,
  originalApprovals,
  onApply,
  onDismiss,
}: {
  approvals: PendingApproval[];
  originalApprovals: PendingApproval[];
  onApply: (a: PendingApproval) => void;
  onDismiss: (a: PendingApproval, i: number) => void;
}) {
  return (
    <Card className="shadow-md">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-ndark-border">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-ndark-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <Sparkles size={16} />
          </span>
          RUNA AI Önerileri
        </h2>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-ndark-border/60">
        {approvals.slice(0, 5).map((a) => {
          // dismissedApprovals key reproducibility için orijinal index'i bul
          const i = originalApprovals.indexOf(a);
          const meta = APPROVAL_META[a.type];
          return (
            <div
              key={`${a.type}:${a.caseId ?? '_'}:${i}`}
              className="px-6 py-4 transition-colors hover:bg-violet-50/30 dark:hover:bg-violet-950/10"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      {meta.icon}
                    </span>
                    {a.caseNumber && (
                      <span className="font-mono text-xs font-medium text-slate-600 dark:text-ndark-muted">
                        {a.caseNumber}
                      </span>
                    )}
                    {a.customerName && (
                      <>
                        <span className="text-slate-300 dark:text-ndark-dim">·</span>
                        <span className="truncate font-medium text-slate-800 dark:text-ndark-text">
                          {a.customerName}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    {meta.label}
                  </div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-ndark-text">
                    {a.reason}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {a.type !== 'awaiting' && (
                    <Button size="sm" onClick={() => onApply(a)}>
                      {meta.primary}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onDismiss(a, i)}>
                    Geç
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────── Top Cases ───────────

const PRIORITY_COLOR: Record<string, string> = {
  Critical: 'bg-rose-100 text-rose-900 ring-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:ring-rose-700',
  High: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:ring-amber-700',
  Medium: 'bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-700',
  Low: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  Acik: 'Açık',
  Incelemede: 'İncelemede',
  ThirdPartyWaiting: '3. Parti',
  Eskalasyon: 'Eskalasyon',
  Cozuldu: 'Çözüldü',
  YenidenAcildi: 'Yeniden',
  IptalEdildi: 'İptal',
};

const PRIORITY_LABEL: Record<string, string> = {
  Critical: 'Critical',
  High: 'Yüksek',
  Medium: 'Orta',
  Low: 'Düşük',
};

function TopCasesPanel({
  cases,
  onSelectCase,
  onShowAll,
}: {
  cases: DashboardTopCase[];
  onSelectCase: (id: string) => void;
  onShowAll: () => void;
}) {
  return (
    <Card className="shadow-md">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-ndark-border">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-ndark-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
            <AlertCircle size={16} />
          </span>
          Öncelikli Vakalarım
        </h2>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-ndark-border/60">
        {cases.map((c) => (
          <li key={c.caseId}>
            <button
              type="button"
              onClick={() => onSelectCase(c.caseId)}
              className="flex w-full items-start gap-3 px-6 py-4 text-left transition-colors hover:bg-brand-50/40 dark:hover:bg-brand-950/20"
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset',
                  PRIORITY_COLOR[c.priority] ?? PRIORITY_COLOR.Medium,
                )}
              >
                {PRIORITY_LABEL[c.priority] ?? c.priority}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-slate-500 dark:text-ndark-muted">
                    {c.caseNumber}
                  </span>
                  <span className="truncate font-medium text-slate-900 dark:text-ndark-text">
                    {c.title}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
                  <span className="truncate">{c.customerName}</span>
                  <span className="text-slate-300 dark:text-ndark-dim">·</span>
                  <span>{STATUS_LABEL[c.status] ?? c.status}</span>
                </div>
                {c.aiSignal && (
                  <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    {c.aiSignal}
                  </div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 px-6 py-3 dark:border-ndark-border">
        <button
          type="button"
          onClick={onShowAll}
          className="text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
        >
          Tüm vakalarımı gör →
        </button>
      </div>
    </Card>
  );
}

// ─────────── Today Panel ───────────

const EVENT_ICON_BY_TYPE: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  reminder: { icon: <Bell size={12} />, color: 'text-violet-600 dark:text-violet-400', label: 'Hatırlatıcı' },
  snooze: { icon: <Clock size={12} />, color: 'text-amber-600 dark:text-amber-400', label: 'Snooze' },
  sla_response: { icon: <AlertCircle size={12} />, color: 'text-rose-600 dark:text-rose-400', label: 'SLA' },
  sla_resolution: { icon: <AlertCircle size={12} />, color: 'text-rose-600 dark:text-rose-400', label: 'SLA' },
  followup: { icon: <Phone size={12} />, color: 'text-blue-600 dark:text-blue-400', label: 'Takip' },
};

function TodayPanel({
  events,
  onSelectCase,
  onShowCalendar,
  onAddReminder,
}: {
  events: DashboardCalendarEvent[];
  onSelectCase: (id: string) => void;
  onShowCalendar: () => void;
  onAddReminder: () => void;
}) {
  const today = new Date();
  const visible = events.slice(0, 6);
  return (
    <Card className="shadow-md">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-ndark-border">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-ndark-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <CalendarIcon size={16} />
          </span>
          Bugün
        </h2>
        <span className="text-xs text-slate-500 dark:text-ndark-muted">
          {today.getDate()} {TR_MONTH[today.getMonth()]}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <CalendarIcon size={28} className="mx-auto mb-2 text-slate-300 dark:text-ndark-dim" />
          <p className="text-sm text-slate-500 dark:text-ndark-muted">
            Bugün için etkinlik yok.
          </p>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Plus size={12} />}
            onClick={onAddReminder}
            className="mt-3"
          >
            Hatırlatıcı Ekle
          </Button>
        </div>
      ) : (
        <ul className="relative px-6 py-4">
          {/* Timeline — sol dikey çizgi */}
          <span
            aria-hidden
            className="absolute bottom-4 left-[5.25rem] top-4 w-px bg-slate-200 dark:bg-ndark-border"
          />
          {visible.map((ev) => {
            const meta = EVENT_ICON_BY_TYPE[ev.type] ?? EVENT_ICON_BY_TYPE.reminder;
            const dt = new Date(ev.time);
            const clickable = !!ev.caseId;
            return (
              <li key={ev.id} className="relative">
                <button
                  type="button"
                  onClick={() => clickable && onSelectCase(ev.caseId!)}
                  disabled={!clickable}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-md py-2 text-left text-sm transition-colors',
                    clickable
                      ? 'hover:bg-brand-50/40 dark:hover:bg-brand-950/20'
                      : 'cursor-default',
                  )}
                >
                  <span className="w-12 shrink-0 font-mono text-xs font-medium text-slate-500 dark:text-ndark-muted">
                    {formatHM(dt)}
                  </span>
                  <span
                    className={cn(
                      'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border',
                      meta.color,
                    )}
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      {ev.caseNumber && (
                        <span className="font-mono text-xs text-slate-600 dark:text-ndark-muted">
                          {ev.caseNumber}
                        </span>
                      )}
                      {ev.customerName && (
                        <span className="truncate text-slate-800 dark:text-ndark-text">
                          {ev.customerName}
                        </span>
                      )}
                      {!ev.caseNumber && !ev.customerName && (
                        <span className="truncate text-slate-700 dark:text-ndark-text">
                          {ev.title}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > 0 && (
        <div className="border-t border-slate-200 px-6 py-3 dark:border-ndark-border">
          <button
            type="button"
            onClick={onShowCalendar}
            className="text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
          >
            Tümünü gör →
          </button>
        </div>
      )}
    </Card>
  );
}

// ─────────── Performance Panel ───────────

function PerformancePanel({
  performance,
  userRole,
}: {
  performance: DashboardData['performance'];
  userRole?: string;
}) {
  return (
    <Card className="shadow-md">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-ndark-border">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-ndark-text">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              <Brain size={16} />
            </span>
            Performansım
          </h2>
          <span className="text-xs text-slate-500 dark:text-ndark-muted">Son 30 gün</span>
        </div>
      </div>
      <div className="px-6 py-5">
        {!performance ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center dark:border-ndark-border dark:bg-ndark-card/40">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
              <Brain size={22} />
            </span>
            <div>
              <div className="text-sm font-medium text-slate-700 dark:text-ndark-text">
                Performans verin hazırlanıyor
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">
                İlk QA skorların biriktikçe empati, açıklık ve hız boyutların burada görünecek.
              </p>
              {userRole === 'Supervisor' && (
                <p className="mt-2 text-xs text-slate-500 dark:text-ndark-muted">
                  Supervisor olarak takım skorlarını &quot;QA Skorları&quot; panosundan takip edebilirsin.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <PerfDimensionRow label="Empati" dim={performance.empathy} />
            <PerfDimensionRow label="Açıklık" dim={performance.clarity} />
            <PerfDimensionRow label="Hız" dim={performance.speed} />
            <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100/50 px-4 py-3 text-xs text-violet-900 dark:border-violet-800 dark:from-violet-950/40 dark:to-violet-900/30 dark:text-violet-200">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                  <Sparkles size={12} />
                </span>
                <div>
                  <div className="font-semibold">RUNA AI Koç</div>
                  <div className="mt-1 leading-relaxed">{performance.aiCoachMessage}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PerfDimensionRow({ label, dim }: { label: string; dim: PerformanceDimension }) {
  if (dim.score == null) {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-700 dark:text-ndark-text">{label}</span>
        <span className="text-xs text-slate-400 dark:text-ndark-dim">—</span>
      </div>
    );
  }
  const filled = Math.round((dim.score / 5) * 12);
  const segments = Array.from({ length: 12 }, (_, i) => i < filled);
  const vsTeam = dim.vsTeam;
  const vsLabel =
    vsTeam > 0 ? (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-300">
        <TrendingUp size={11} /> Takım ort. üstü
      </span>
    ) : vsTeam < 0 ? (
      <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-300">
        <TrendingDown size={11} /> Takım ort. altı
      </span>
    ) : (
      <span className="text-xs text-slate-500 dark:text-ndark-muted">Takım ortalamasında</span>
    );
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 dark:text-ndark-text">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-ndark-text">
          {dim.score}/5
        </span>
      </div>
      <div className="mt-1 flex gap-0.5">
        {segments.map((on, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-sm',
              on ? 'bg-violet-500 dark:bg-violet-400' : 'bg-slate-200 dark:bg-slate-700',
            )}
          />
        ))}
      </div>
      <div className="mt-1">{vsLabel}</div>
    </div>
  );
}

// ─────────── Daily Summary Strip ───────────

function DailySummaryStrip({ summary }: { summary: DashboardData['dailySummary'] }) {
  const parts: string[] = [];
  if (summary.resolvedToday > 0) parts.push(`${summary.resolvedToday} vaka kapattın`);
  if (summary.newCasesToday > 0) parts.push(`${summary.newCasesToday} yeni geldi`);
  if (summary.avgResolutionHours > 0) parts.push(`Ort. çözüm süren: ${summary.avgResolutionHours} saat`);
  if (parts.length === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-card dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 size={14} />
      </span>
      <div>
        <span className="font-semibold text-slate-800 dark:text-ndark-text">Bugün özet:</span>{' '}
        {parts.join(' · ')}
      </div>
    </div>
  );
}

// ─────────── Skeleton ───────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-8 w-1/2" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
