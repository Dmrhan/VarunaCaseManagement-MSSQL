import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkey } from '@/lib/useHotkey';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Inbox,
  Plus,
  RotateCw,
  Search,
  SearchX,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { caseService, lookupService } from '@/services/caseService';
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
import { NewCaseForm } from './NewCaseForm';
import { QuickCaseModal } from './QuickCaseModal';

interface CasesListPageProps {
  onSelectCase: (caseId: string) => void;
  onShowCustomer?: (accountId: string) => void;
  onOpenCustomerSearch?: () => void;
  /** App seviyesinden gelen account ID — varsa QuickCaseModal pre-fill ile açılır */
  pendingQuickPrefill?: string | null;
  onQuickPrefillConsumed?: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
}: CasesListPageProps) {
  const [allFiltered, setAllFiltered] = useState<Case[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CaseFilters>(initialFilters);
  const [newOpen, setNewOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefillAccount, setQuickPrefillAccount] = useState<string | null>(null);
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
    const { items } = await caseService.list(filters);
    setAllFiltered(items);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    setPage(1); // filtre değişince ilk sayfaya dön
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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

  // Sıralama — kolon başlığı tıklaması ve dropdown ile senkronize
  const sortedFiltered = useMemo(() => {
    const arr = [...allFiltered];
    arr.sort((a, b) => {
      const cmp = compareCases(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [allFiltered, sortKey, sortDir]);

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

  function handleAccountClick(e: React.MouseEvent, account: { id: string; name: string }) {
    e.stopPropagation();
    // Spec: müşteri linki → müşteri kartı. Tam modül FAZ 1+ kapsamında; FAZ 0 önizleme modali.
    onShowCustomer?.(account.id);
  }

  return (
    <div className="space-y-4">
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
                Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} cols={10} />)}
              {!loading && allFiltered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4">
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
                pageItems.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCase(c.id)}
                    className="cursor-pointer text-sm hover:bg-slate-50"
                  >
                    <Td className="font-mono text-xs text-slate-600">{c.caseNumber}</Td>
                    <Td className="max-w-[360px] truncate font-medium text-slate-800">{c.title}</Td>
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
                ))}
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
