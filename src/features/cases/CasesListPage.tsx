import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkey } from '@/lib/useHotkey';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Flag,
  Inbox,
  Plus,
  RotateCw,
  Search,
  SearchX,
  Tag,
  Trash2,
  Users2,
  User,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { apiFetch, caseService, lookupService } from '@/services/caseService';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableRowSkeleton } from '@/components/ui/Skeleton';
import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_STATUSES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseFilters,
  type CasePriority,
  type CaseStatus,
} from './types';
import { formatDateTime, formatRelative } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { NewCaseForm } from './NewCaseForm';
import { QuickCaseModal } from './QuickCaseModal';

// Bulk action — kullanıcının açabileceği alan tipi (4 buton).
type BulkField = 'priority' | 'status' | 'assignedPersonId' | 'assignedTeamId';

// Bulk status'te kapatma yasak — backend de reddediyor, UI baştan göstermesin.
const BULK_STATUSES: CaseStatus[] = ['Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon', 'YenidenAcildi'];

interface CasesListPageProps {
  onSelectCase: (caseId: string) => void;
  onShowCustomer?: (accountId: string) => void;
  onOpenCustomerSearch?: () => void;
  /** App seviyesinden gelen account ID — varsa QuickCaseModal pre-fill ile açılır */
  pendingQuickPrefill?: string | null;
  onQuickPrefillConsumed?: () => void;
  /**
   * Örüntü alarmından gelen vaka filtresi (Faz 1.5 Madde 5).
   * Verilirse liste yalnızca bu caseId'leri gösterir + üstte sarı banner.
   */
  patternCasesFilter?: { caseIds: string[]; label: string } | null;
  onClearPatternFilter?: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Inbox sekmesi — Açık/Later/Kapalı.
// Açık (default): aktif statüler, snoozed gizli (BE filter).
// Later: GET /api/cases/snoozed (me) — assignedPersonId = current user.
// Kapalı: status IN (Çözüldü, İptalEdildi).
type InboxTab = 'open' | 'later' | 'closed';
const OPEN_STATUSES: CaseStatus[] = ['Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon', 'YenidenAcildi'];
const CLOSED_STATUSES: CaseStatus[] = ['Çözüldü', 'İptalEdildi'];

// ----------------------------------------------------------------
// Sıralama
// ----------------------------------------------------------------
type SortKey =
  | 'caseNumber'
  | 'title'
  | 'accountName'
  | 'caseType'
  | 'status'
  | 'priority'
  | 'assignment'
  | 'sla'
  | 'createdAt'
  | 'updatedAt';
type SortDir = 'asc' | 'desc';

const TYPE_ORDER: Record<string, number> = { GeneralSupport: 0, ProactiveTracking: 1, Churn: 2 };
const STATUS_ORDER: Record<string, number> = {
  'Açık': 0,
  'İncelemede': 1,
  '3rdPartyBekleniyor': 2,
  'Eskalasyon': 3,
  'Çözüldü': 4,
  'YenidenAcildi': 5,
  'İptalEdildi': 6,
};
// Spec: Critical → High → Medium → Low (kritik önce)
const PRIORITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function compareCases(a: Case, b: Case, key: SortKey): number {
  switch (key) {
    case 'caseNumber':
      return a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true });
    case 'title':
      return a.title.localeCompare(b.title, 'tr');
    case 'accountName':
      return a.accountName.localeCompare(b.accountName, 'tr');
    case 'caseType':
      return (TYPE_ORDER[a.caseType] ?? 99) - (TYPE_ORDER[b.caseType] ?? 99);
    case 'status':
      return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    case 'priority':
      return (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    case 'assignment': {
      // Atanmamışlar her durumda en sona — desc'te de sonda kalır
      const av = a.assignedPersonName ?? a.assignedTeamName ?? '';
      const bv = b.assignedPersonName ?? b.assignedTeamName ?? '';
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv, 'tr');
    }
    case 'sla': {
      const av = a.slaResolutionDueAt ? new Date(a.slaResolutionDueAt).getTime() : Infinity;
      const bv = b.slaResolutionDueAt ? new Date(b.slaResolutionDueAt).getTime() : Infinity;
      return av - bv;
    }
    case 'createdAt':
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case 'updatedAt':
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
}

const SORT_DROPDOWN_OPTIONS: Array<{ key: SortKey; dir: SortDir; label: string }> = [
  { key: 'updatedAt', dir: 'desc', label: 'Son Güncelleme (yeni → eski)' },
  { key: 'updatedAt', dir: 'asc', label: 'Son Güncelleme (eski → yeni)' },
  { key: 'createdAt', dir: 'desc', label: 'Açılış Tarihi (yeni → eski)' },
  { key: 'createdAt', dir: 'asc', label: 'Açılış Tarihi (eski → yeni)' },
  { key: 'sla', dir: 'asc', label: 'SLA (yaklaşan önce)' },
  { key: 'priority', dir: 'asc', label: 'Öncelik (kritik önce)' },
  { key: 'caseNumber', dir: 'asc', label: 'Vaka No (A→Z)' },
];

const STATUS_LABELS_SHORT: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3.Parti',
  'Eskalasyon':          'Eskalasyon',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden',
  'İptalEdildi':         'İptal',
};

const initialFilters: CaseFilters = {
  search: '',
  statuses: [],
  caseType: 'Tümü',
  priorities: [],
  teamId: '',
  personId: '',
  dateFrom: '',
  dateTo: '',
};

export function CasesListPage({
  onSelectCase,
  onShowCustomer,
  onOpenCustomerSearch,
  pendingQuickPrefill,
  onQuickPrefillConsumed,
  patternCasesFilter,
  onClearPatternFilter,
}: CasesListPageProps) {
  const [allFiltered, setAllFiltered] = useState<Case[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CaseFilters>(initialFilters);
  const [inboxTab, setInboxTab] = useState<InboxTab>('open');
  const [newOpen, setNewOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefillAccount, setQuickPrefillAccount] = useState<string | null>(null);
  // Bulk select state — Set<string> performans için (kontrol O(1)).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // App seviyesi pendingQuickPrefill geldiğinde QuickCaseModal'ı aç
  useEffect(() => {
    if (pendingQuickPrefill) {
      setQuickPrefillAccount(pendingQuickPrefill);
      setQuickOpen(true);
      onQuickPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuickPrefill]);

  // Klavye kısayolları
  useHotkey('/', (e) => {
    e.preventDefault();
    searchInputRef.current?.focus();
  });
  useHotkey('n', () => setNewOpen(true));
  useHotkey('q', () => {
    setQuickPrefillAccount(null);
    setQuickOpen(true);
  });

  const teams = useMemo(() => lookupService.teams(), []);
  const personsAll = useMemo(() => lookupService.persons(), []);
  const personsForFilter = useMemo(
    () => (filters.teamId ? personsAll.filter((p) => p.teamId === filters.teamId) : personsAll),
    [filters.teamId, personsAll],
  );

  const load = async () => {
    setLoading(true);
    // Filtre/tab değişikliği veya manuel refresh — selection temizlensin.
    setSelected(new Set());
    if (inboxTab === 'later') {
      // Later sekmesi — kullanıcının ertelediği aktif vakalar.
      const data = await apiFetch<{ value: Case[]; '@odata.count': number }>(
        '/api/cases/snoozed',
        undefined,
        'Ertelenmiş vakalar yüklenemedi',
      );
      setAllFiltered(data?.value ?? []);
    } else {
      // Açık/Kapalı — chip seçimi varsa onu, yoksa tab default statüsünü kullan.
      const tabDefault = inboxTab === 'open' ? OPEN_STATUSES : CLOSED_STATUSES;
      const effectiveStatuses = filters.statuses?.length ? filters.statuses : tabDefault;
      const { items } = await caseService.list({ ...filters, statuses: effectiveStatuses });
      setAllFiltered(items);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    setPage(1); // filtre değişince ilk sayfaya dön
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inboxTab,
    filters.search,
    filters.statuses,
    filters.caseType,
    filters.priorities,
    filters.teamId,
    filters.personId,
    filters.dateFrom,
    filters.dateTo,
  ]);

  const stats = useMemo(() => {
    const total = allFiltered.length;
    const open = allFiltered.filter((c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi').length;
    const slaBreach = allFiltered.filter((c) => c.slaViolation).length;
    const critical = allFiltered.filter((c) => c.priority === 'Critical').length;
    return { total, open, slaBreach, critical };
  }, [allFiltered]);

  // Sıralama — kolon başlığı tıklaması ve dropdown ile senkronize.
  // "Ertelendi" sekmesinde BE zaten "expired önce, snoozeUntil ASC" sırasını
  // verdiği için frontend sort'u devre dışı (kullanıcı kafa karışıklığı olmasın).
  const sortedFiltered = useMemo(() => {
    // Örüntü alarmından gelen filter — sadece o caseId'ler kalır.
    let base = allFiltered;
    if (patternCasesFilter?.caseIds?.length) {
      const allowed = new Set(patternCasesFilter.caseIds);
      base = base.filter((c) => allowed.has(c.id));
    }
    if (inboxTab === 'later') return base;
    const arr = [...base];
    arr.sort((a, b) => {
      const cmp = compareCases(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [allFiltered, sortKey, sortDir, inboxTab, patternCasesFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      // Aynı kolona tıkla → yön değiş (asc ↔ desc)
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      // Yeni kolon → varsayılan yön (tarih kolonları için desc daha mantıklı)
      setSortKey(key);
      setSortDir(key === 'updatedAt' || key === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  }

  // Pagination — client-side slice (FAZ 0; FAZ 2'de service pagination gerçek BFF üzerinden gelir)
  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => sortedFiltered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedFiltered, safePage, pageSize],
  );
  const startIdx = sortedFiltered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(safePage * pageSize, sortedFiltered.length);

  const hasActiveFilters =
    Boolean(filters.search) ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.priorities?.length ?? 0) > 0 ||
    (filters.caseType && filters.caseType !== 'Tümü') ||
    Boolean(filters.teamId) ||
    Boolean(filters.personId) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  function toggleStatus(s: CaseStatus) {
    setFilters((f) => {
      const cur = f.statuses ?? [];
      const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      return { ...f, statuses: next };
    });
  }

  function togglePriority(p: CasePriority) {
    setFilters((f) => {
      const cur = f.priorities ?? [];
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      return { ...f, priorities: next };
    });
  }

  function clearFilters() {
    setFilters(initialFilters);
  }

  // Bulk select helpers
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAllVisible(check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pageItems) {
        if (check) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function applyBulk(field: BulkField, value: string) {
    const ids = Array.from(selected);
    if (ids.length === 0 || !value) return;
    setBulkSubmitting(true);
    const result = await caseService.bulkUpdate(ids, { [field]: value } as Parameters<typeof caseService.bulkUpdate>[1]);
    setBulkSubmitting(false);
    setBulkField(null);
    if (!result) return; // apiFetch toast gösterdi

    if (result.failed > 0) {
      toast({
        type: 'warn',
        title: 'Kısmi başarı',
        message: `${result.updated} vaka güncellendi, ${result.failed} başarısız.`,
        duration: 5000,
      });
    } else {
      toast({ type: 'success', message: `${result.updated} vaka güncellendi.` });
    }
    clearSelection();
    void load();
  }

  function handleAccountClick(e: React.MouseEvent, account: { id: string; name: string }) {
    e.stopPropagation();
    // Spec: müşteri linki → müşteri kartı. Tam modül FAZ 1+ kapsamında; FAZ 0 önizleme modali.
    onShowCustomer?.(account.id);
  }

  return (
    <div className="space-y-4">
      {patternCasesFilter && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div>
            <strong>Örüntü filtresi:</strong> {patternCasesFilter.label} —{' '}
            <span className="font-mono">{patternCasesFilter.caseIds.length}</span> vaka
          </div>
          {onClearPatternFilter && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<X size={12} />}
              onClick={onClearPatternFilter}
            >
              Filtreyi Kaldır
            </Button>
          )}
        </div>
      )}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Vakalar</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Müşteri talep, şikayet ve olaylarını tek listeden yönetin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" leftIcon={<RotateCw size={14} />} onClick={() => void load()}>
            Yenile
          </Button>
          {onOpenCustomerSearch && (
            <Button
              variant="outline"
              leftIcon={<Search size={14} />}
              onClick={onOpenCustomerSearch}
              title="Telefon veya isim ile müşteri ara"
            >
              Müşteri Ara
            </Button>
          )}
          <Button
            variant="outline"
            leftIcon={<Zap size={14} className="text-amber-500" />}
            onClick={() => {
              setQuickPrefillAccount(null);
              setQuickOpen(true);
            }}
            title="Hızlı vaka aç (q)"
          >
            Hızlı Vaka
          </Button>
          <Button leftIcon={<Plus size={14} />} onClick={() => setNewOpen(true)}>
            Yeni Vaka
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Toplam Vaka" value={stats.total}    tint="bg-slate-50 ring-slate-200 text-slate-700" />
        <KpiTile label="Açık Vaka"   value={stats.open}     tint="bg-blue-50 ring-blue-200 text-blue-700" />
        <KpiTile label="SLA İhlali"  value={stats.slaBreach} tint="bg-rose-50 ring-rose-200 text-rose-700" />
        <KpiTile label="Critical"    value={stats.critical} tint="bg-amber-50 ring-amber-200 text-amber-800" />
      </div>

      <Card>
        {/* Inbox sekmeleri — Açık / Later / Kapalı */}
        <div className="flex items-center gap-1 border-b border-slate-200 px-3 pt-2">
          <InboxTabButton
            label="Açık"
            icon={<Inbox size={13} />}
            active={inboxTab === 'open'}
            onClick={() => setInboxTab('open')}
          />
          <InboxTabButton
            label="Ertelendi"
            icon={<Clock3 size={13} />}
            active={inboxTab === 'later'}
            onClick={() => setInboxTab('later')}
          />
          <InboxTabButton
            label="Kapalı"
            icon={<Check size={13} />}
            active={inboxTab === 'closed'}
            onClick={() => setInboxTab('closed')}
          />
        </div>

        {/* Filter bar — Spec 11.1 */}
        <div className="space-y-3 border-b border-slate-200 px-4 py-3">
          {/* Row 1 — search + type + clear */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                ref={searchInputRef}
                placeholder="Vaka no, başlık veya müşteri ara... (/ ile odak)"
                value={filters.search ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="pl-8 pr-12"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                /
              </kbd>
            </div>
            <FilterSelect
              label="Tip"
              value={filters.caseType ?? 'Tümü'}
              onChange={(v) => setFilters((f) => ({ ...f, caseType: v as CaseFilters['caseType'] }))}
              options={['Tümü', ...CASE_TYPES]}
              renderOption={(o) =>
                o === 'Tümü' ? 'Tümü' : CASE_TYPE_LABELS[o as keyof typeof CASE_TYPE_LABELS]
              }
            />
            <Badge tint="slate" icon={<Filter size={12} />}>
              {allFiltered.length} sonuç
            </Badge>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs text-slate-500 underline hover:text-slate-700"
              >
                <X size={12} /> Filtreleri Temizle
              </button>
            )}
          </div>

          {/* Row 2 — status + priority chips */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Statü:</span>
              {CASE_STATUSES.map((s) => {
                const active = filters.statuses?.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition ${
                      active
                        ? 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700'
                        : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {STATUS_LABELS_SHORT[s]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Öncelik:</span>
              {CASE_PRIORITIES.map((p) => {
                const active = filters.priorities?.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePriority(p)}
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition ${
                      active
                        ? 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700'
                        : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {CASE_PRIORITY_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3 — team + person + date range */}
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              label="Takım"
              value={filters.teamId ?? ''}
              onChange={(v) =>
                setFilters((f) => ({ ...f, teamId: v, personId: v && f.personId ? '' : f.personId }))
              }
              options={['', ...teams.map((t) => t.id)]}
              renderOption={(id) => (id === '' ? 'Tümü' : teams.find((t) => t.id === id)?.name ?? id)}
            />
            <FilterSelect
              label="Kişi"
              value={filters.personId ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, personId: v }))}
              options={['', ...personsForFilter.map((p) => p.id)]}
              renderOption={(id) =>
                id === '' ? 'Tümü' : personsForFilter.find((p) => p.id === id)?.name ?? id
              }
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Tarih:</span>
              <TextInput
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                className="h-8 py-1"
              />
              <span className="text-xs text-slate-400">→</span>
              <TextInput
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                className="h-8 py-1"
              />
            </div>

            {/* Sırala — kolon başlığı tıklamasıyla senkron */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Sırala:</span>
              <Select
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split(':');
                  setSortKey(k as SortKey);
                  setSortDir(d as SortDir);
                  setPage(1);
                }}
                className="h-8 py-1 text-xs"
              >
                {SORT_DROPDOWN_OPTIONS.map((opt) => (
                  <option key={`${opt.key}:${opt.dir}`} value={`${opt.key}:${opt.dir}`}>
                    {opt.label}
                  </option>
                ))}
                {/* Eğer aktif kolon dropdown'da yoksa, mevcut seçimi koruyabilen bir görünüm */}
                {!SORT_DROPDOWN_OPTIONS.some((o) => o.key === sortKey && o.dir === sortDir) && (
                  <option value={`${sortKey}:${sortDir}`}>
                    Özel: {sortKey} ({sortDir === 'asc' ? 'artan' : 'azalan'})
                  </option>
                )}
              </Select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={pageItems.length > 0 && pageItems.every((c) => selected.has(c.id))}
                    ref={(el) => {
                      if (!el) return;
                      const someSel = pageItems.some((c) => selected.has(c.id));
                      const allSel = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));
                      el.indeterminate = someSel && !allSel;
                    }}
                    onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-brand-600"
                    title="Görünen sayfayı seç / kaldır"
                  />
                </th>
                <SortableTh label="Vaka No"        sortKey="caseNumber"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Başlık"         sortKey="title"       currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Müşteri"        sortKey="accountName" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Tip"            sortKey="caseType"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Statü"          sortKey="status"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Öncelik"        sortKey="priority"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Atama"          sortKey="assignment"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="SLA"            sortKey="sla"         currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Açılış"         sortKey="createdAt"   currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Son Güncelleme" sortKey="updatedAt"   currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading &&
                Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} cols={11} />)}
              {!loading && allFiltered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4">
                    {hasActiveFilters ? (
                      <EmptyState
                        icon={<SearchX size={22} />}
                        title="Filtrelere uyan vaka bulunamadı"
                        description="Daha geniş bir arama için filtreleri gözden geçirebilirsin."
                        action={
                          <Button size="sm" variant="outline" leftIcon={<X size={12} />} onClick={clearFilters}>
                            Filtreleri Temizle
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState
                        icon={<Inbox size={22} />}
                        title="Henüz vaka yok"
                        description="İlk vakayı oluşturarak başlayın."
                        action={
                          <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setNewOpen(true)}>
                            Yeni Vaka
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
              {!loading &&
                pageItems.map((c) => {
                  // Later sekmesinde BE'den gelen expired flag'i ve snoozeUntil
                  // ile satır rengi + alt etiket kararı ver. Diğer sekmelerde
                  // expired her zaman false olarak ele alınır.
                  const snoozeMeta = inboxTab === 'later'
                    ? (c as Case & { expired?: boolean })
                    : null;
                  const expired = Boolean(snoozeMeta?.expired);
                  const isSelected = selected.has(c.id);
                  // Öncelik: expired (amber) > selected (brand) > default
                  const rowBg = expired
                    ? 'bg-amber-50 hover:bg-amber-100'
                    : isSelected
                    ? 'bg-brand-50/60 hover:bg-brand-50 dark:bg-brand-950/30'
                    : 'hover:bg-slate-50';
                  return (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCase(c.id)}
                    className={`cursor-pointer text-sm ${rowBg}`}
                  >
                    <Td className="w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(c.id)}
                        className="h-4 w-4 cursor-pointer accent-brand-600"
                        aria-label={`${c.caseNumber} seç`}
                      />
                    </Td>
                    <Td className="font-mono text-xs text-slate-600">{c.caseNumber}</Td>
                    <Td className="max-w-[360px] font-medium text-slate-800">
                      <div className="truncate">{c.title}</div>
                      {snoozeMeta?.snoozeUntil && (
                        <div
                          className={`mt-0.5 text-xs font-normal ${
                            expired ? 'text-amber-700' : 'text-slate-500'
                          }`}
                        >
                          {expired
                            ? `⏰ ${formatSnoozeAgo(snoozeMeta.snoozeUntil)}`
                            : `🕐 ${formatSnoozeIn(snoozeMeta.snoozeUntil)}`}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={(e) => handleAccountClick(e, { id: c.accountId, name: c.accountName })}
                        className="text-left text-slate-700 underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        {c.accountName}
                      </button>
                    </Td>
                    <Td>
                      <CaseTypeBadge type={c.caseType} />
                    </Td>
                    <Td>
                      <StatusPill status={c.status} />
                    </Td>
                    <Td>
                      <PriorityBadge priority={c.priority} />
                    </Td>
                    <Td className="text-slate-700">
                      {c.assignedPersonName ?? c.assignedTeamName ?? <span className="text-slate-400">—</span>}
                    </Td>
                    <Td>
                      {c.slaViolation ? (
                        <Badge tint="rose">İhlal</Badge>
                      ) : c.slaPausedAt ? (
                        <Badge tint="amber">Duraklatıldı</Badge>
                      ) : c.slaResolutionDueAt ? (
                        <span className="text-xs text-slate-600">{formatRelative(c.slaResolutionDueAt)}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</Td>
                    <Td className="text-xs text-slate-500">
                      <span title={formatDateTime(c.updatedAt)}>{formatRelative(c.updatedAt)}</span>
                    </Td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && allFiltered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>
                {startIdx}–{endIdx} / {allFiltered.length}
              </span>
              <span className="text-slate-400">·</span>
              <span>Sayfa başına:</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-7 py-0.5 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<ChevronLeft size={14} />}
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Önceki
              </Button>
              <span className="text-xs text-slate-600">
                Sayfa <strong>{safePage}</strong> / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                rightIcon={<ChevronRight size={14} />}
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Sonraki
              </Button>
            </div>
          </div>
        )}
      </Card>

      <NewCaseForm
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(c) => {
          setNewOpen(false);
          void load();
          onSelectCase(c.id);
          toast({
            type: 'success',
            title: 'Vaka oluşturuldu',
            message: `${c.caseNumber} — ${c.title}`,
          });
        }}
        onShowExisting={(id) => {
          setNewOpen(false);
          onSelectCase(id);
        }}
      />

      <QuickCaseModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        prefillAccountId={quickPrefillAccount}
        onCreated={(c) => {
          void load();
          onSelectCase(c.id);
        }}
      />

      {/* Bulk action bar — 1+ vaka seçiliyken görünür */}
      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          onClear={clearSelection}
          onAction={(field) => setBulkField(field)}
          submitting={bulkSubmitting}
        />
      )}

      {/* Bulk action modal — field bazlı seçim + onay */}
      {bulkField && (
        <BulkActionModal
          field={bulkField}
          count={selected.size}
          teams={teams}
          persons={personsAll}
          submitting={bulkSubmitting}
          onClose={() => setBulkField(null)}
          onApply={(value) => void applyBulk(bulkField, value)}
        />
      )}
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`group cursor-pointer select-none whitespace-nowrap px-4 py-2.5 transition-colors ${
        isActive
          ? 'bg-blue-50 text-brand-700'
          : 'hover:bg-slate-100 hover:text-slate-700'
      }`}
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive ? (
          currentDir === 'asc' ? (
            <ArrowUp size={11} className="text-brand-600" />
          ) : (
            <ArrowDown size={11} className="text-brand-600" />
          )
        ) : (
          <ArrowUpDown size={11} className="text-slate-300 group-hover:text-slate-400" />
        )}
      </div>
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-4 py-3 ${className ?? ''}`}>{children}</td>;
}

// Snooze rozetleri için TR-özel relative format. formatRelative'i kullanmadık
// çünkü "x dakika önce" gibi muğlak çıktılar yerine "uyandı / uyanacak" sonekli
// netlik istiyoruz.
function formatSnoozeAgo(when: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 60000));
  if (diffMin < 1) return 'şimdi uyandı';
  if (diffMin < 60) return `${diffMin} dakika önce uyandı`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} saat önce uyandı`;
  return `${Math.round(diffHr / 24)} gün önce uyandı`;
}

function formatSnoozeIn(when: string): string {
  const diffMin = Math.max(0, Math.round((new Date(when).getTime() - Date.now()) / 60000));
  if (diffMin < 1) return 'birazdan uyanacak';
  if (diffMin < 60) return `${diffMin} dakika sonra uyanacak`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} saat sonra uyanacak`;
  return `${Math.round(diffHr / 24)} gün sonra uyanacak`;
}

// Floating action bar — selection > 0 iken bottom-center'da render edilir.
// Kullanıcı 4 alandan birini seçer; modal o alana göre açılır.
function BulkActionBar({
  count,
  onClear,
  onAction,
  submitting,
}: {
  count: number;
  onClear: () => void;
  onAction: (field: BulkField) => void;
  submitting: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Toplu işlem barı"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-2xl ring-1 ring-slate-900/5 dark:border-ndark-border dark:bg-ndark-card dark:ring-white/5"
    >
      <span className="px-1 text-sm font-medium text-slate-700 dark:text-ndark-text">
        <span className="font-semibold text-brand-700 dark:text-brand-400">{count}</span> vaka seçildi
      </span>
      <span className="h-5 w-px bg-slate-200 dark:bg-ndark-border" />
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Users2 size={12} />}
        disabled={submitting}
        onClick={() => onAction('assignedTeamId')}
      >
        Takım Değiştir
      </Button>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<User size={12} />}
        disabled={submitting}
        onClick={() => onAction('assignedPersonId')}
      >
        Kişi Değiştir
      </Button>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Flag size={12} />}
        disabled={submitting}
        onClick={() => onAction('priority')}
      >
        Öncelik Değiştir
      </Button>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Tag size={12} />}
        disabled={submitting}
        onClick={() => onAction('status')}
      >
        Durum Değiştir
      </Button>
      <span className="h-5 w-px bg-slate-200 dark:bg-ndark-border" />
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Trash2 size={12} />}
        disabled={submitting}
        onClick={onClear}
      >
        Temizle
      </Button>
    </div>
  );
}

// Bulk action modal — kullanıcı tıkladığı alana göre Select + Uygula.
// 10'dan fazla vaka için ek confirmation gösterir.
function BulkActionModal({
  field,
  count,
  teams,
  persons,
  submitting,
  onClose,
  onApply,
}: {
  field: BulkField;
  count: number;
  teams: ReturnType<typeof lookupService.teams>;
  persons: ReturnType<typeof lookupService.persons>;
  submitting: boolean;
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [value, setValue] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(count <= 10); // <=10 ise direkt apply
  const needsConfirm = count > 10 && !confirmed;

  const config: Record<BulkField, { title: string; label: string; options: { value: string; label: string }[] }> = {
    priority: {
      title: 'Toplu — Öncelik Değiştir',
      label: 'Yeni öncelik',
      options: CASE_PRIORITIES.map((p) => ({ value: p, label: CASE_PRIORITY_LABELS[p] })),
    },
    status: {
      title: 'Toplu — Durum Değiştir',
      label: 'Yeni statü',
      options: BULK_STATUSES.map((s) => ({ value: s, label: s })),
    },
    assignedTeamId: {
      title: 'Toplu — Takım Değiştir',
      label: 'Yeni takım',
      options: teams.map((t) => ({ value: t.id, label: t.name })),
    },
    assignedPersonId: {
      title: 'Toplu — Atanan Kişi Değiştir',
      label: 'Yeni atanan kişi',
      options: persons.map((p) => ({ value: p.id, label: p.name })),
    },
  };

  const c = config[field];

  return (
    <Modal
      open
      onClose={onClose}
      title={c.title}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          {needsConfirm ? (
            <Button onClick={() => setConfirmed(true)}>Anladım, devam et</Button>
          ) : (
            <Button onClick={() => onApply(value)} disabled={!value || submitting}>
              {submitting ? 'Uygulanıyor…' : 'Uygula'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
          <strong>{count}</strong> vaka üzerinde işlem yapılacak.
        </div>

        {needsConfirm ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-medium">Dikkat — büyük toplu işlem</div>
            <p className="mt-1 text-xs">
              10'dan fazla vaka tek seferde değişecek. İşlem geri alınamaz; her vaka için ayrı
              activity log yazılır. Yine de devam etmek istiyor musun?
            </p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-ndark-text">
              {c.label}
            </label>
            <Select value={value} onChange={(e) => setValue(e.target.value)} autoFocus>
              <option value="">— Seçiniz —</option>
              {c.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </Modal>
  );
}

function InboxTabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-brand-600 font-medium text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function KpiTile({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className={`rounded-xl p-4 ring-1 ring-inset ${tint}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  renderOption,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  renderOption?: (o: string) => string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}:</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 py-1">
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o || 'Tümü'}
          </option>
        ))}
      </Select>
    </div>
  );
}
