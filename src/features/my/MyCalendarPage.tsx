import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Phone,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/components/ui/cn';
import { myService, type CalendarEvent, type CalendarEventType } from '@/services/myService';
import { QuickReminderModal, type ReminderEditTarget } from './QuickReminderModal';

type ViewMode = 'daily' | 'weekly' | 'monthly';

interface MyCalendarPageProps {
  onSelectCase: (caseId: string) => void;
}

// "Saat slot'u tıklandı" → modal'a presetRemindAt akar.
// Vakasız reminder için boş tarih de yeterli (modal varsayılan saat doldurur).

// Görünüme göre fetch aralığı — backend max 90 gün desteğine uygun.
function rangeForView(date: Date, view: ViewMode): { from: Date; to: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (view === 'daily') {
    const from = new Date(start);
    from.setDate(from.getDate() - 1); // ufak bir buffer (TZ kayması için)
    const to = new Date(start);
    to.setDate(to.getDate() + 2);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  if (view === 'weekly') {
    // Pazartesi başlangıçlı hafta (TR alışkanlığı)
    const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
    const monday = new Date(start);
    monday.setDate(monday.getDate() - day);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 7);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday, to: sunday };
  }
  // monthly — ayın ilk gününden son gününe + ay öncesi/sonrası padding hafta
  const firstOfMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const offset = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - offset);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42); // 6 hafta * 7 gün
  gridEnd.setHours(23, 59, 59, 999);
  return { from: gridStart, to: gridEnd };
}

const TR_DAY_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_DAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz']; // Pazartesi başlangıçlı
const TR_MONTH = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function formatDayLong(d: Date) {
  return `${TR_DAY_LONG[d.getDay()]}, ${d.getDate()} ${TR_MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Filter chip'leri — kullanıcı hangi olay türlerini görmek istediğini seçer.
// Default: yalnız 'reminder' aktif (kullanıcının kendi eklediği). Vakadan gelenler
// (snooze/sla/followup) toggle ile yüklenir — performans için lazy load.
type EventGroup = 'reminder' | 'case';
const GROUP_TYPES: Record<EventGroup, CalendarEventType[]> = {
  reminder: ['reminder'],
  case: ['snooze', 'sla_response', 'sla_resolution', 'followup'],
};

export function MyCalendarPage({ onSelectCase }: MyCalendarPageProps) {
  const [view, setView] = useState<ViewMode>('daily');
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  // Saat slot'una / gün hücresine tıklama ile pre-fill: modal'ı bu tarihle açar.
  const [presetRemindAt, setPresetRemindAt] = useState<Date | null>(null);
  // Edit modu — reminder kartına tıklayınca bu state set edilir, modal düzenleme
  // formunu açar. CalendarEvent zaten gerekli alanları (id prefix, date, notes,
  // caseId, caseNumber, customerName) taşıdığı için fresh fetch'e gerek yok.
  const [editTarget, setEditTarget] = useState<ReminderEditTarget | null>(null);
  // Aktif filter chip'leri — default: sadece reminder. Vaka olaylarını
  // kullanıcı isteyince yükler (BFF'te ?types= ile filter).
  const [activeGroups, setActiveGroups] = useState<Set<EventGroup>>(() => new Set(['reminder']));

  function openReminderAt(date: Date | null) {
    setPresetRemindAt(date);
    setEditTarget(null);
    setReminderOpen(true);
  }

  // Reminder tıklanınca edit modal aç — event.id "reminder:<id>" prefix'li.
  function openReminderEdit(ev: CalendarEvent) {
    if (ev.type !== 'reminder') return;
    const reminderId = ev.id.startsWith('reminder:') ? ev.id.slice('reminder:'.length) : ev.id;
    const caseLabel =
      ev.caseNumber && ev.customerName
        ? `${ev.caseNumber} · ${ev.customerName}`
        : ev.caseNumber ?? null;
    setEditTarget({
      id: reminderId,
      caseId: ev.caseId,
      caseLabel,
      remindAt: ev.date,
      message: ev.notes,
    });
    setPresetRemindAt(null);
    setReminderOpen(true);
  }

  function toggleGroup(g: EventGroup) {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  // Aktif gruplardan tek bir type listesi türet — BFF'e gidecek.
  const activeTypes = useMemo<CalendarEventType[]>(() => {
    const arr: CalendarEventType[] = [];
    for (const g of activeGroups) arr.push(...GROUP_TYPES[g]);
    return arr;
  }, [activeGroups]);

  useEffect(() => {
    let alive = true;
    if (activeTypes.length === 0) {
      // Hiçbir filter aktif değil → fetch atma, listeyi sıfırla.
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { from, to } = rangeForView(currentDate, view);
    void myService.getCalendar(from, to, activeTypes).then((list) => {
      if (alive) {
        setEvents(list);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [currentDate, view, activeTypes]);

  function refresh() {
    if (activeTypes.length === 0) return;
    const { from, to } = rangeForView(currentDate, view);
    void myService.getCalendar(from, to, activeTypes).then(setEvents);
  }

  function navigatePrev() {
    const d = new Date(currentDate);
    if (view === 'daily') d.setDate(d.getDate() - 1);
    else if (view === 'weekly') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  }

  function navigateNext() {
    const d = new Date(currentDate);
    if (view === 'daily') d.setDate(d.getDate() + 1);
    else if (view === 'weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  }

  function goToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setCurrentDate(d);
  }

  // Header'da gösterilen tarih etiketi.
  const dateLabel = useMemo(() => {
    if (view === 'daily') return formatDayLong(currentDate);
    if (view === 'weekly') {
      const { from, to } = rangeForView(currentDate, 'weekly');
      const toEnd = new Date(to);
      toEnd.setHours(0, 0, 0, 0);
      toEnd.setDate(toEnd.getDate() - 1); // pazara kadar inclusive
      return `${from.getDate()} ${TR_MONTH[from.getMonth()]} – ${toEnd.getDate()} ${TR_MONTH[toEnd.getMonth()]} ${toEnd.getFullYear()}`;
    }
    return `${TR_MONTH[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [currentDate, view]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">Takvimim</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Hatırlatıcı, snooze, SLA ve takip aramaları tek görünümde.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button leftIcon={<Plus size={14} />} onClick={() => setReminderOpen(true)}>
            Hatırlatıcı
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-ndark-border">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={navigatePrev}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
              aria-label="Önceki"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="rounded-md px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-ndark-text dark:hover:bg-ndark-bg"
            >
              Bugün
            </button>
            <button
              type="button"
              onClick={navigateNext}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
              aria-label="Sonraki"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="text-sm font-medium text-slate-700 dark:text-ndark-text">{dateLabel}</div>
        </div>

        {/*
          Filter chips — performans katmanı. Default: yalnız "Hatırlatıcılarım" aktif.
          Vaka olayları (snooze/sla/followup) maliyetli — kullanıcı isteyince yüklenir.
        */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-ndark-border">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Filtre:
          </span>
          <FilterChip
            label="Hatırlatıcılarım"
            icon={<Bell size={12} />}
            active={activeGroups.has('reminder')}
            tone="violet"
            onToggle={() => toggleGroup('reminder')}
          />
          <FilterChip
            label="Vaka olayları"
            icon={<Calendar size={12} />}
            active={activeGroups.has('case')}
            tone="slate"
            onToggle={() => toggleGroup('case')}
          />
          {activeGroups.size === 0 && (
            <span className="ml-auto text-xs text-slate-500 dark:text-ndark-muted">
              Görmek istediğin türü seç →
            </span>
          )}
        </div>

        {activeGroups.size === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Calendar size={22} />}
              title="Takvim filtreleri kapalı"
              description="Yukarıdan en az bir filtre seç (Hatırlatıcılarım veya Vaka olayları). Performans için ilk yüklemede otomatik veri çekilmiyor."
            />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : view === 'daily' ? (
          <DailyView
            currentDate={currentDate}
            events={events}
            onSelectCase={onSelectCase}
            onEditReminder={openReminderEdit}
            onAddReminder={() => openReminderAt(null)}
            onSelectSlot={openReminderAt}
          />
        ) : view === 'weekly' ? (
          <WeeklyView
            currentDate={currentDate}
            events={events}
            onSelectCase={onSelectCase}
            onEditReminder={openReminderEdit}
            onPickDay={(d) => {
              setCurrentDate(d);
              setView('daily');
            }}
            onSelectSlot={openReminderAt}
          />
        ) : (
          <MonthlyView
            currentDate={currentDate}
            events={events}
            onPickDay={(d) => {
              setCurrentDate(d);
              setView('daily');
            }}
            onSelectSlot={openReminderAt}
          />
        )}
      </Card>

      <QuickReminderModal
        open={reminderOpen}
        presetRemindAt={presetRemindAt}
        editTarget={editTarget}
        onClose={() => {
          setReminderOpen(false);
          setPresetRemindAt(null);
          setEditTarget(null);
        }}
        onCreated={() => {
          setReminderOpen(false);
          setPresetRemindAt(null);
          setEditTarget(null);
          refresh();
        }}
      />
    </div>
  );
}

function FilterChip({
  label,
  icon,
  active,
  tone,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  tone: 'violet' | 'slate';
  onToggle: () => void;
}) {
  // Aktif: dolu renkli; pasif: outline (etkisiz görünüm).
  const activeClass =
    tone === 'violet'
      ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'
      : 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800';
  const inactiveClass =
    'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:bg-ndark-bg';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? activeClass : inactiveClass,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: Array<{ key: ViewMode; label: string }> = [
    { key: 'daily', label: 'Günlük' },
    { key: 'weekly', label: 'Haftalık' },
    { key: 'monthly', label: 'Aylık' },
  ];
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-ndark-border dark:bg-ndark-card">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            view === o.key
              ? 'bg-brand-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Olay görsel mapping ---------------------------------------------------

// İki görsel aile:
//   - reminder ("benim eklediğim") → SOLID filled violet (vurgulu, kullanıcının kendi notu).
//   - case-derived (snooze/sla/followup) → sol renkli ŞERİT + nötr arkaplan (sistem ürettiği,
//     daha az gürültülü). Type tipi şerit rengiyle ayrışır.
const EVENT_STYLE: Record<
  CalendarEventType,
  { icon: typeof Bell; cardClass: string; dotClass: string; label: string }
> = {
  reminder: {
    icon: Bell,
    cardClass:
      'border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200 dark:border-violet-700 dark:bg-violet-900/50 dark:text-violet-100 dark:hover:bg-violet-900/70',
    dotClass: 'bg-violet-500',
    label: 'Hatırlatıcı',
  },
  snooze: {
    icon: Clock,
    cardClass:
      'border-l-4 border-amber-500 border-y border-r border-y-slate-200 border-r-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-y-ndark-border dark:border-r-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg',
    dotClass: 'bg-amber-500',
    label: 'Vaka uyanacak',
  },
  sla_response: {
    icon: AlertTriangle,
    cardClass:
      'border-l-4 border-rose-500 border-y border-r border-y-slate-200 border-r-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-y-ndark-border dark:border-r-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg',
    dotClass: 'bg-rose-500',
    label: 'SLA yanıt',
  },
  sla_resolution: {
    icon: AlertCircle,
    cardClass:
      'border-l-4 border-rose-500 border-y border-r border-y-slate-200 border-r-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-y-ndark-border dark:border-r-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg',
    dotClass: 'bg-rose-500',
    label: 'SLA çözüm',
  },
  followup: {
    icon: Phone,
    cardClass:
      'border-l-4 border-blue-500 border-y border-r border-y-slate-200 border-r-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-y-ndark-border dark:border-r-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-bg',
    dotClass: 'bg-blue-500',
    label: 'Takip',
  },
};

function formatHM(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function EventCard({
  ev,
  onSelectCase,
  onEditReminder,
  compact = false,
}: {
  ev: CalendarEvent;
  onSelectCase: (id: string) => void;
  /** Reminder tıklanınca edit modal'ı açar; case-derived event'lerde kullanılmaz. */
  onEditReminder: (ev: CalendarEvent) => void;
  compact?: boolean;
}) {
  const style = EVENT_STYLE[ev.type];
  const Icon = style.icon;
  const dt = new Date(ev.date);
  // Reminder → her zaman tıklanabilir (edit). Vaka kaynaklı → caseId varsa case detay.
  const isReminder = ev.type === 'reminder';
  const clickable = isReminder || !!ev.caseId;
  // Vakaya bağlı reminder'larda ekstra "Aç" butonu — kart click'i edit'e gitse de
  // kullanıcı tek tıkla vakaya gidebilsin. Vaka kaynaklı (snooze/sla/followup)
  // event'lerde gerek yok — kartın kendisi zaten vakaya götürüyor.
  const showOpenCaseAction = isReminder && !!ev.caseId;

  // Outer = div (a11y: role+tabIndex). Inner buttons stopPropagation ile bağımsız.
  // Nested <button> sorunundan kaçınmak için outer button değil.
  function handleMainClick() {
    if (!clickable) return;
    if (isReminder) {
      onEditReminder(ev);
    } else if (ev.caseId) {
      onSelectCase(ev.caseId);
    }
  }
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        handleMainClick();
      }}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleMainClick();
        }
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cn(
        'group flex w-full min-w-0 max-w-full items-start gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
        style.cardClass,
        clickable ? 'cursor-pointer' : 'cursor-default',
      )}
      title={`${style.label}${ev.caseNumber ? ' · ' + ev.caseNumber : ''}${ev.customerName ? ' · ' + ev.customerName : ''}${ev.notes && !ev.caseNumber ? ' · ' + ev.notes : ''}`}
    >
      <Icon size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-mono font-semibold">{formatHM(dt)}</span>
          {ev.caseNumber ? (
            <span className="truncate font-mono opacity-80">{ev.caseNumber}</span>
          ) : (
            ev.notes && <span className="truncate opacity-90">{ev.notes}</span>
          )}
        </div>
        {!compact && ev.customerName && (
          <div className="truncate opacity-80">{ev.customerName}</div>
        )}
      </div>
      {showOpenCaseAction && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectCase(ev.caseId!);
          }}
          title="Vakayı aç"
          className={cn(
            'shrink-0 rounded p-1 opacity-70 transition-opacity hover:bg-violet-200 hover:opacity-100 dark:hover:bg-violet-800',
            compact && 'p-0.5',
          )}
        >
          <ExternalLink size={compact ? 11 : 12} />
          {!compact && <span className="sr-only">Aç</span>}
        </button>
      )}
    </div>
  );
}

// --- Daily View ------------------------------------------------------------

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00..20:00

function DailyView({
  currentDate,
  events,
  onSelectCase,
  onEditReminder,
  onAddReminder,
  onSelectSlot,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectCase: (id: string) => void;
  onEditReminder: (ev: CalendarEvent) => void;
  onAddReminder: () => void;
  /** Boş saat slot'una tıklayınca o tarihi pre-fill ile modal açar. */
  onSelectSlot: (date: Date) => void;
}) {
  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(new Date(e.date), currentDate)),
    [events, currentDate],
  );

  if (dayEvents.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Calendar size={22} />}
          title="Bugün için planlanmış etkinlik yok"
          description="Hatırlatıcı ekleyerek vakalarını takvime al."
          action={
            <Button size="sm" leftIcon={<Plus size={12} />} onClick={onAddReminder}>
              Yeni Hatırlatıcı Ekle
            </Button>
          }
        />
      </div>
    );
  }

  // Saat bucket'larına dağıt — 08'den önce / 20'den sonra olanlar uç saatlere düşer.
  const byHour = new Map<number, CalendarEvent[]>();
  for (const ev of dayEvents) {
    const h = Math.max(8, Math.min(20, new Date(ev.date).getHours()));
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(ev);
  }

  // Slot'a tıklanınca o saatte hatırlatıcı modal'ı aç (vakasız → mesaj zorunlu).
  function makeSlotDate(hour: number): Date {
    const d = new Date(currentDate);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  return (
    <div className="divide-y divide-slate-100 dark:divide-ndark-border/60">
      {HOURS.map((h) => {
        const items = byHour.get(h) ?? [];
        return (
          <div key={h} className="grid grid-cols-[60px_1fr] gap-3 px-4 py-2">
            <div className="pt-1 text-xs font-mono text-slate-400 dark:text-ndark-muted">
              {String(h).padStart(2, '0')}:00
            </div>
            <div className="min-h-[36px]">
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectSlot(makeSlotDate(h))}
                  className="group block h-full w-full border-t border-dashed border-slate-200 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-ndark-border/40 dark:hover:border-brand-700 dark:hover:bg-brand-950/20"
                  title="Hatırlatıcı ekle"
                />
              ) : (
                <div className="space-y-1.5">
                  {items.map((ev) => (
                    <EventCard
                      key={ev.id}
                      ev={ev}
                      onSelectCase={onSelectCase}
                      onEditReminder={onEditReminder}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Weekly View -----------------------------------------------------------

function WeeklyView({
  currentDate,
  events,
  onSelectCase,
  onEditReminder,
  onPickDay,
  onSelectSlot,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectCase: (id: string) => void;
  onEditReminder: (ev: CalendarEvent) => void;
  onPickDay: (d: Date) => void;
  onSelectSlot: (date: Date) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = useMemo(() => {
    const { from } = rangeForView(currentDate, 'weekly');
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  // Day×hour bucket
  const grid = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.date);
      const key = `${d.toDateString()}|${Math.max(8, Math.min(20, d.getHours()))}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(ev);
    }
    return m;
  }, [events]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        {/*
          Day header row.
          minmax(0, 1fr) — content'in kolon genişliğini büyütmesini engelle;
          uzun reminder mesajları kolon dışına taşıyordu (issue #ui-overflow).
        */}
        <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
          <div />
          {days.map((d) => {
            const isToday = isSameDay(d, today);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onPickDay(d)}
                className={cn(
                  'border-l border-slate-200 px-2 py-1.5 text-center text-xs transition-colors hover:bg-slate-100 dark:border-ndark-border dark:hover:bg-ndark-bg',
                  isToday
                    ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                    : 'text-slate-600 dark:text-ndark-muted',
                )}
              >
                <div className="text-[10px] uppercase tracking-wide">{TR_DAY_SHORT[(d.getDay() + 6) % 7]}</div>
                <div className="text-sm font-semibold">{d.getDate()}</div>
              </button>
            );
          })}
        </div>

        {HOURS.map((h) => (
          <div key={h} className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-t border-slate-100 dark:border-ndark-border/60">
            <div className="px-2 py-1 text-[10px] font-mono text-slate-400 dark:text-ndark-muted">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map((d) => {
              const items = grid.get(`${d.toDateString()}|${h}`) ?? [];
              const slotDate = new Date(d);
              slotDate.setHours(h, 0, 0, 0);
              return (
                <div
                  key={d.toISOString() + h}
                  // overflow-hidden: uzun reminder içerikleri komşu kolonlara taşamasın.
                  // min-w-0: grid 1fr daraltma izni.
                  className="min-h-[40px] min-w-0 overflow-hidden border-l border-slate-100 dark:border-ndark-border/60"
                >
                  {items.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => onSelectSlot(slotDate)}
                      className="block h-full min-h-[40px] w-full transition-colors hover:bg-brand-50/40 dark:hover:bg-brand-950/20"
                      title="Hatırlatıcı ekle"
                    />
                  ) : (
                    <div className="space-y-1 px-1 py-0.5">
                      {items.map((ev) => (
                        <EventCard
                          key={ev.id}
                          ev={ev}
                          onSelectCase={onSelectCase}
                          onEditReminder={onEditReminder}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Monthly View ----------------------------------------------------------

function MonthlyView({
  currentDate,
  events,
  onPickDay,
  onSelectSlot,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onPickDay: (d: Date) => void;
  /**
   * Boş gün hücresine tıklayınca o gün 09:00 ile pre-fill modal açar.
   * Olay varsa onPickDay tetiklenir (daily view'a geçer) — bu davranış spec'te.
   */
  onSelectSlot: (date: Date) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells = useMemo(() => {
    const { from } = rangeForView(currentDate, 'monthly');
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  // Day → events
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const k = new Date(ev.date).toDateString();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(ev);
    }
    return m;
  }, [events]);

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
        {TR_DAY_SHORT.map((d) => (
          <div
            key={d}
            className="border-l border-slate-200 px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 first:border-l-0 dark:border-ndark-border dark:text-ndark-muted"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((d, idx) => {
          const inMonth = d.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(d, today);
          const dayEvents = byDay.get(d.toDateString()) ?? [];
          // Type başına 1 nokta — max 3 farklı renk.
          const types = Array.from(new Set(dayEvents.map((e) => e.type))).slice(0, 3);
          const more = dayEvents.length - types.length;
          // Olay varsa daily view'a geç (spec); boş günde 09:00 ile reminder pre-fill.
          const handleClick = () => {
            if (dayEvents.length > 0) {
              onPickDay(d);
            } else {
              const slot = new Date(d);
              slot.setHours(9, 0, 0, 0);
              onSelectSlot(slot);
            }
          };
          return (
            <button
              key={idx}
              type="button"
              onClick={handleClick}
              title={dayEvents.length > 0 ? 'Günlük görünüme geç' : 'Hatırlatıcı ekle'}
              className={cn(
                'flex min-h-[80px] flex-col items-start gap-1 border-b border-l border-slate-100 px-2 py-1.5 text-left transition-colors hover:bg-slate-50 dark:border-ndark-border/60 dark:hover:bg-ndark-bg',
                idx % 7 === 0 && 'border-l-0',
                idx >= 35 && 'border-b-0',
                !inMonth && 'bg-slate-50/50 text-slate-400 dark:bg-ndark-bg/30 dark:text-ndark-dim',
                isToday && inMonth && 'bg-brand-50/40 dark:bg-brand-950/20',
              )}
            >
              <div
                className={cn(
                  'text-xs font-semibold',
                  isToday && inMonth ? 'text-brand-700 dark:text-brand-300' : '',
                  inMonth ? '' : 'text-slate-400 dark:text-ndark-dim',
                )}
              >
                {d.getDate()}
              </div>
              {types.length > 0 && (
                <div className="mt-auto flex items-center gap-1">
                  {types.map((t) => (
                    <span key={t} className={cn('inline-block h-1.5 w-1.5 rounded-full', EVENT_STYLE[t].dotClass)} />
                  ))}
                  {more > 0 && (
                    <span className="text-[10px] font-medium text-slate-500 dark:text-ndark-muted">
                      +{more}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
