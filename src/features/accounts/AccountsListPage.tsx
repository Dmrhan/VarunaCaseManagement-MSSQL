import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Copy,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { notify } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  accountService,
  canReadAccounts,
  canWriteAccounts,
  type AccountListItem,
  type AccountListResponse,
  type AccountListParams,
} from '@/services/accountService';
import { lookupService } from '@/services/caseService';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { TableRowSkeleton } from '@/components/ui/Skeleton';
import { AccountFormModal } from './AccountFormModal';

const PAGE_SIZE = 25;

interface AccountsListPageProps {
  onSelectAccount: (accountId: string) => void;
}

const STATUS_FILTERS = [
  { value: '', label: 'Tüm Durumlar' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Pasif' },
  { value: 'churn', label: 'Churn' },
  { value: 'prospect', label: 'Aday' },
];

/**
 * Müşteriler listesi.
 *
 * - Search: 300ms debounce; min 2 char gönderir.
 * - Filter: company (lookup) + status (AccountCompany.status).
 * - Pagination: offset-based, limit 25.
 * - Role: Agent/Backoffice rolleri buraya gelmemeli (App.tsx guard). Buradaki
 *   `canWriteAccounts` butonları sadece Admin/SystemAdmin için açar.
 * - Mobile: kart görünümü md altında; tablo md ve üstünde.
 */
export function AccountsListPage({ onSelectAccount }: AccountsListPageProps) {
  const { user } = useAuth();
  const isReader = canReadAccounts(user?.role);
  const isWriter = canWriteAccounts(user?.role);

  const companies = useMemo(() => lookupService.companies(), []);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AccountListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search input
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      // 2 char altı boş bırak — BFF tarafında da min 2 zorunlu.
      setSearchQuery(searchInput.trim().length >= 2 ? searchInput.trim() : '');
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const fetchList = useCallback(async () => {
    if (!isReader) return;
    setLoading(true);
    setError(null);
    const params: AccountListParams = {
      page,
      limit: PAGE_SIZE,
      search: searchQuery || undefined,
      companyId: companyFilter || undefined,
      status: statusFilter || undefined,
    };
    const out = await accountService.list(params);
    setLoading(false);
    if (out === undefined) {
      setError('Müşteri listesi yüklenemedi. Tekrar dene.');
      return;
    }
    setData(out);
  }, [isReader, page, searchQuery, companyFilter, statusFilter]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  if (!isReader) {
    return (
      <EmptyState
        icon={<AlertTriangle size={24} />}
        title="Bu sayfaya erişim yetkin yok"
        description="Müşteriler modülü Supervisor, CSM, Admin ve SystemAdmin rolleri içindir."
      />
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    // Full-width grid: parent app shell zaten genişliği yönetir
    // (`max-w-7xl` daha önce sayfayı 1280px'te ortalıyordu, böylece
    // 1920px ekranlarda dar kart gibi görünüyordu). CasesListPage
    // pattern'i ile aynı: tek başına `space-y-4`.
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">Müşteriler</h1>
          <p className="text-sm text-slate-500 dark:text-ndark-muted">
            Şirket ilişkileri, iletişim bilgileri ve vaka geçmişi
          </p>
        </div>
        {isWriter && (
          <Button
            variant="primary"
            leftIcon={<Plus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            Yeni Müşteri
          </Button>
        )}
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 min-w-0">
            <Field label="Ara">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-ndark-muted"
                />
                <TextInput
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Ad, VKN, telefon veya e-posta ile ara…"
                  className="pl-9"
                  aria-label="Müşteri ara"
                />
              </div>
            </Field>
          </div>
          {companies.length > 0 && (
            <div className="w-full md:w-56">
              <Field label="Şirket">
                <Select
                  value={companyFilter}
                  onChange={(e) => {
                    setCompanyFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tüm Şirketler</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <div className="w-full md:w-44">
            <Field label="Durum">
              <Select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {data && (
            <div className="hidden md:flex md:items-end md:pb-2 text-[11px] text-slate-500 dark:text-ndark-muted whitespace-nowrap">
              <span><strong className="text-slate-700 dark:text-ndark-text">{data.total.toLocaleString('tr-TR')}</strong> müşteri</span>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-6 py-8 text-center dark:border-rose-900/40 dark:bg-rose-900/20">
          <AlertTriangle size={20} className="text-rose-600 dark:text-rose-300" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw size={12} />}
            onClick={() => void fetchList()}
          >
            Tekrar dene
          </Button>
        </div>
      ) : (
        <AccountsTable
          loading={loading}
          rows={data?.accounts ?? []}
          isWriter={isWriter}
          onSelect={onSelectAccount}
        />
      )}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-ndark-muted">
          <span>
            {(data.page - 1) * data.limit + 1}–
            {Math.min(data.page * data.limit, data.total)} / {data.total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Önceki
            </Button>
            <span>
              {data.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}

      <AccountFormModal
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        onSaved={(account) => {
          setCreateOpen(false);
          if (account) {
            void fetchList();
            onSelectAccount(account.id);
          }
        }}
      />
    </div>
  );
}

interface AccountsTableProps {
  loading: boolean;
  rows: AccountListItem[];
  isWriter: boolean;
  onSelect: (id: string) => void;
}

function AccountsTable({ loading, rows, isWriter, onSelect }: AccountsTableProps) {
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <th className="px-3 py-2.5">Müşteri</th>
                <th className="px-3 py-2.5">Tip</th>
                <th className="px-3 py-2.5">VKN</th>
                <th className="px-3 py-2.5">V.D.</th>
                <th className="px-3 py-2.5">Şirketler</th>
                <th className="px-3 py-2.5">İletişim</th>
                <th className="px-3 py-2.5">Açık</th>
                <th className="px-3 py-2.5">Toplam</th>
                <th className="px-3 py-2.5">Durum</th>
                {isWriter && <th className="px-3 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              <TableRowSkeleton cols={isWriter ? 10 : 9} />
              <TableRowSkeleton cols={isWriter ? 10 : 9} />
              <TableRowSkeleton cols={isWriter ? 10 : 9} />
            </tbody>
          </table>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          <div className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-ndark-surface" />
          <div className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-ndark-surface" />
        </div>
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-2 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
        <EmptyState
          icon={<Users size={20} />}
          title="Müşteri bulunamadı"
          description="Filtreleri temizlemeyi deneyin veya yeni bir müşteri ekleyin."
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-ndark-border dark:bg-ndark-card">
      {/* Desktop / tablet. overflow-x-auto: dar viewport'ta yatay scroll;
          1440-1920px'te tek bakışta tüm kolonlar. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
              <th className="px-3 py-2.5 font-medium">Müşteri Adı</th>
              <th className="px-3 py-2.5 font-medium">Tip</th>
              <th className="px-3 py-2.5 font-medium">VKN</th>
              <th className="px-3 py-2.5 font-medium">V.D.</th>
              <th className="px-3 py-2.5 font-medium">Şirketler</th>
              <th className="px-3 py-2.5 font-medium">İletişim</th>
              <th className="px-3 py-2.5 text-right font-medium">Açık</th>
              <th className="px-3 py-2.5 text-right font-medium">Toplam</th>
              <th className="px-3 py-2.5 font-medium">Durum</th>
              {isWriter && <th className="px-3 py-2.5 w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 last:border-b-0 dark:border-ndark-border/60 dark:hover:bg-ndark-surface"
              >
                <td className="px-3 py-2.5 min-w-[220px]">
                  <div className="font-medium text-slate-900 dark:text-ndark-text">
                    {row.name}
                  </div>
                  <AccountIdInline id={row.id} />
                </td>
                <td className="px-3 py-2.5">
                  <CustomerTypeBadge type={row.customerType} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-700 dark:text-ndark-text whitespace-nowrap">
                  {row.vknMasked ?? <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-700 dark:text-ndark-text">
                  {row.taxOffice ? (
                    <span className="block max-w-[140px] truncate" title={row.taxOffice}>{row.taxOffice}</span>
                  ) : (
                    <span className="text-slate-400 dark:text-ndark-dim">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 max-w-[340px]">
                  <CompanyChips companies={row.companies} />
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-700 dark:text-ndark-text max-w-[220px]">
                  <ContactCell phone={row.phone} email={row.email} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span
                    className={
                      row.openCaseCount > 0
                        ? 'font-semibold text-rose-700 dark:text-rose-300'
                        : 'text-slate-500 dark:text-ndark-muted'
                    }
                  >
                    {row.openCaseCount}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-ndark-text">
                  {row.totalCaseCount}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tint={row.isActive ? 'emerald' : 'slate'}>
                    {row.isActive ? 'Aktif' : 'Pasif'}
                  </Badge>
                </td>
                {isWriter && (
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(row.id);
                      }}
                      title="Düzenle"
                      aria-label={`${row.name} müşterisini düzenle`}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
                    >
                      <Pencil size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-ndark-border/60">
        {rows.map((row) => (
          <li
            key={row.id}
            onClick={() => onSelect(row.id)}
            className="cursor-pointer p-4 hover:bg-slate-50 dark:hover:bg-ndark-surface"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900 dark:text-ndark-text">
                  {row.name}
                </div>
                {row.vknMasked && (
                  <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                    VKN {row.vknMasked}
                  </div>
                )}
                <AccountIdInline id={row.id} />
              </div>
              <Badge tint={row.isActive ? 'emerald' : 'slate'}>
                {row.isActive ? 'Aktif' : 'Pasif'}
              </Badge>
            </div>
            <div className="mt-2">
              <CompanyChips companies={row.companies} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-ndark-muted">
              {row.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone size={11} /> {row.phone}
                </span>
              )}
              {row.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail size={11} /> <span className="truncate">{row.email}</span>
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-ndark-muted">
              <span>Açık vaka: <strong className={row.openCaseCount > 0 ? 'text-rose-600 dark:text-rose-300' : ''}>{row.openCaseCount}</strong></span>
              <span>Toplam: {row.totalCaseCount}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Account.id inline display — Account.id Varuna'nın global müşteri
 * kimliğidir; UI'da müşteri sistem ID'si olarak surface'lenir. Kopyala
 * aksiyonu ile destek/operasyon ekipleri ID'yi clipboard'a alabilir.
 * Tek satır mono small slate-tone; row click'i tetiklemesin diye
 * stopPropagation uygulanır.
 */
function AccountIdInline({ id }: { id: string }) {
  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      notify({ type: 'success', message: 'Müşteri ID kopyalandı.', duration: 2500 });
    } catch {
      // Clipboard erişimi reddedildiyse sessiz no-op; konsola da yazılmaz.
    }
  }
  return (
    <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
      <span className="text-slate-400 dark:text-ndark-dim">ID:</span>
      <span className="truncate">{id}</span>
      <button
        type="button"
        onClick={handleCopy}
        title="Müşteri ID'sini kopyala"
        aria-label="Müşteri ID'sini kopyala"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
      >
        <Copy size={10} />
      </button>
    </div>
  );
}

function CustomerTypeBadge({ type }: { type: AccountListItem['customerType'] }) {
  // Customer 360 import sonrası gelen Türkçe enum'lar (Bireysel/Kurumsal/
  // Kamu/Vakıf-STK) + legacy English ('Individual'/'Corporate') ve
  // 'individual'/'corporate' lowercase varyantları için kısaltma + tint.
  // Backend datasını DEĞİŞTİRMİYORUZ; sadece görüntü.
  const map: Record<string, { short: string; tint: 'blue' | 'amber' | 'violet' | 'slate' }> = {
    Bireysel: { short: 'Bir', tint: 'amber' },
    Kurumsal: { short: 'Kur', tint: 'blue' },
    Kamu: { short: 'Kam', tint: 'violet' },
    'Vakıf-STK': { short: 'Vak', tint: 'violet' },
    Individual: { short: 'Bir', tint: 'amber' },
    Corporate: { short: 'Kur', tint: 'blue' },
    individual: { short: 'Bir', tint: 'amber' },
    corporate: { short: 'Kur', tint: 'blue' },
  };
  const key = String(type ?? '');
  const cfg = map[key] ?? { short: key.slice(0, 3) || '—', tint: 'slate' };
  return (
    <span title={key} className="inline-block">
      <Badge tint={cfg.tint}>{cfg.short}</Badge>
    </span>
  );
}

function CompanyChips({ companies }: { companies: AccountListItem['companies'] }) {
  if (companies.length === 0) {
    return <span className="text-xs text-slate-400 dark:text-ndark-dim">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {companies.map((c) => (
        <Badge
          key={c.companyId}
          tint={c.status === 'churn' ? 'rose' : c.status === 'prospect' ? 'amber' : 'blue'}
          icon={<Building2 size={10} />}
        >
          <span className="truncate max-w-[120px]">{c.companyName ?? c.companyId}</span>
          {c.externalCustomerCode && (
            <span className="ml-1 rounded bg-white/30 px-1 font-mono text-[10px] dark:bg-black/20">
              {c.externalCustomerCode}
            </span>
          )}
        </Badge>
      ))}
    </div>
  );
}

function ContactCell({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) {
    return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {phone && (
        <span className="inline-flex items-center gap-1 truncate">
          <Phone size={11} className="shrink-0 text-slate-400 dark:text-ndark-muted" />
          <span className="truncate">{phone}</span>
        </span>
      )}
      {email && (
        <span className="inline-flex items-center gap-1 truncate">
          <Mail size={11} className="shrink-0 text-slate-400 dark:text-ndark-muted" />
          <span className="truncate">{email}</span>
        </span>
      )}
    </div>
  );
}
