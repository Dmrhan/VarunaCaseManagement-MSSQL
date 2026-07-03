import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Clock,
  ExternalLink,
  Mail,
  Phone,
  Plus,
  Search,
  UserPlus,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, CaseTypeBadge } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { caseService } from '@/services/caseService';
import { accountService, type AccountListItem, type AccountSearchField } from '@/services/accountService';
import { useAuth } from '@/services/AuthContext';
import { AccountFormModal } from '@/features/accounts/AccountFormModal';
import type { Case } from '@/features/cases/types';
import { formatRelative } from '@/lib/format';

interface CustomerSearchModalProps {
  open: boolean;
  onClose: () => void;
  onShowCase: (caseId: string) => void;
  onNewCase: (accountId: string) => void;
  /**
   * C2: caller'a "yeni müşteri oluştur" CTA'yı görünür yapma izni verir.
   * Default `false` — mevcut header çağrısı dahil tüm geri uyumluluk korunur.
   * CTA yalnız `allowCreate=true && results.length === 0 && query.length >= 2`
   * durumunda görünür.
   */
  allowCreate?: boolean;
  /**
   * C2: yeni müşteri başarıyla oluşturulduktan sonra ne olacağını caller'a
   * bildirir. Modal kendi içinde NewCaseForm açmaz; sadece çağrı kontratını
   * şekillendirir.
   *  - `'select'` (default): yeni müşteri sol panelde seçili olarak görünür
   *    (arama query'si yeni isme set edilir; standart akışa döner).
   *  - `'openCase'`: yeni müşteriyle vakaya geçme niyeti — modal `onNewCase`
   *    ile yeni accountId'yi gönderir ve kapanır.
   */
  afterCreate?: 'select' | 'openCase';
}

const SEARCH_FIELD_CHIPS: { value: AccountSearchField; label: string }[] = [
  { value: 'name',    label: 'Ünvan' },
  { value: 'vkn',     label: 'VKN / TCKN' },
  { value: 'phone',   label: 'Telefon' },
  { value: 'code',    label: 'Müşteri kodu' },
  { value: 'contact', label: 'Kontak' },
];

const FIELD_PLACEHOLDER: Record<AccountSearchField, string> = {
  name:    'Müşteri ünvanı yazın…',
  vkn:     'VKN veya TCKN yazın…',
  phone:   'Telefon numarası yazın…',
  code:    'Müşteri kodu yazın…',
  contact: 'Kontak e-posta veya telefonu yazın…',
};

const PAGE_SIZE = 20;
const RECENT_MAX = 10;
const RECENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RECENT_KEY_BASE = 'varuna.recentAccounts';

/**
 * localStorage'da yalnız id + lastSeenAt tutulur. C2 review fix (P2):
 * Account name, company chips ve VKN gibi PII'lar stale cache'ten doğrudan
 * render edilmez. Panel açılışında server `accountService.list({ ids })`
 * ile revalidate edilir; tenant scope dış WHERE'de zorunlu olduğundan
 * yetkisiz id'ler dönmez → görünmez + cache'ten temizlenir.
 */
interface RecentPointer {
  id: string;
  lastSeenAt: number;
}

function recentStorageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${RECENT_KEY_BASE}.${userId}`;
}

function readRecentPointers(userId: string | null | undefined): RecentPointer[] {
  const k = recentStorageKey(userId);
  if (!k || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - RECENT_TTL_MS;
    return arr
      .filter((r) => r && typeof r.id === 'string' && typeof r.lastSeenAt === 'number' && r.lastSeenAt >= cutoff)
      .map((r) => ({ id: r.id, lastSeenAt: r.lastSeenAt }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecentPointers(userId: string | null | undefined, pointers: RecentPointer[]) {
  const k = recentStorageKey(userId);
  if (!k || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(k, JSON.stringify(pointers.slice(0, RECENT_MAX)));
  } catch {
    /* non-fatal */
  }
}

function pushRecentPointer(userId: string | null | undefined, accountId: string) {
  if (!userId || !accountId) return;
  const existing = readRecentPointers(userId);
  const filtered = existing.filter((r) => r.id !== accountId);
  const next: RecentPointer[] = [{ id: accountId, lastSeenAt: Date.now() }, ...filtered].slice(0, RECENT_MAX);
  writeRecentPointers(userId, next);
}

/**
 * Müşteri arama modal'ı — C2 sonrası.
 *
 * Backend: `/api/accounts` search dimensions:
 *   name (contains) · vkn (startsWith) · AccountCompany.externalCustomerCode
 *   (contains) · contact phone/email (contains). Tenant scope (allowedCompanyIds)
 *   server-side zorunlu, hiçbir prop bunu etkilemez.
 *
 * UI: klavye nav (↑/↓/Enter/Esc), son bakılanlar paneli (boş query'de),
 * opsiyonel "Yeni müşteri oluştur" CTA (caller `allowCreate` ile etkinleştirir).
 */
export function CustomerSearchModal({
  open,
  onClose,
  onShowCase,
  onNewCase,
  allowCreate = false,
  afterCreate = 'select',
}: CustomerSearchModalProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchFields, setSearchFields] = useState<AccountSearchField[]>(['name']);
  const [results, setResults] = useState<AccountListItem[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [selected, setSelected] = useState<AccountListItem | null>(null);
  const [openCases, setOpenCases] = useState<Case[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);
  // Recents are revalidated via the server on each modal open; the in-memory
  // list is full AccountListItem rows so display logic shares the search
  // branch's components. localStorage holds only id+timestamp.
  const [recents, setRecents] = useState<AccountListItem[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
      setSearchFields(['name']);
      setResults([]);
      setSelected(null);
      setOpenCases([]);
      setHighlightIdx(0);
      setCreateOpen(false);
      setRecents([]);
      setLoadingRecents(false);
      return;
    }
    // C2 review fix (P2): server-side revalidate recents. Stale ids the
    // user can no longer see are dropped both from the panel render AND
    // from localStorage. PII (name, company chips) renders only from the
    // server response — never from cache.
    const pointers = readRecentPointers(userId);
    if (pointers.length === 0) {
      setRecents([]);
    } else {
      setLoadingRecents(true);
      const ids = pointers.map((p) => p.id);
      void accountService.list({ ids, limit: RECENT_MAX }).then((resp) => {
        const validRows = resp?.accounts ?? [];
        const validIds = new Set(validRows.map((r) => r.id));
        // Preserve the operator's recency order (server response order is
        // by createdAt or similar; we want the localStorage order).
        const byId = new Map(validRows.map((r) => [r.id, r]));
        const ordered = pointers
          .filter((p) => validIds.has(p.id))
          .map((p) => byId.get(p.id))
          .filter((x): x is AccountListItem => !!x);
        setRecents(ordered);
        setLoadingRecents(false);
        // Cleanup: any pointer whose id didn't come back is out of scope
        // or deleted — drop it from localStorage so future opens are fast
        // and the cache doesn't keep growing dead entries.
        const survivors = pointers.filter((p) => validIds.has(p.id));
        if (survivors.length !== pointers.length) {
          writeRecentPointers(userId, survivors);
        }
      });
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, userId]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebounced(query.trim().length >= 2 ? query.trim() : '');
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const fetchResults = useCallback(async () => {
    if (!debounced) {
      setResults([]);
      setHighlightIdx(0);
      return;
    }
    setLoadingResults(true);
    const out = await accountService.list({ search: debounced, searchFields, page: 1, limit: PAGE_SIZE });
    setLoadingResults(false);
    setResults(out?.accounts ?? []);
    setHighlightIdx(0);
  }, [debounced, searchFields]);

  useEffect(() => {
    if (open) void fetchResults();
  }, [open, fetchResults]);

  // Seçili müşterinin açık vakaları — /api/cases/by-account.
  useEffect(() => {
    let alive = true;
    if (!selected) {
      setOpenCases([]);
      return;
    }
    setLoadingCases(true);
    void caseService
      .findByAccount(selected.id, { statusNotIn: ['Çözüldü', 'İptalEdildi'] })
      .then((items) => {
        if (alive) {
          setOpenCases(items);
          setLoadingCases(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Recent-vs-results panel switch: boş query → recent listesi gösterilir,
  // dolu query → arama sonuçları. Recents server'dan revalidate edildiği
  // için doğrudan AccountListItem olarak render edilir.
  const showingRecents = !debounced;
  const listItems: AccountListItem[] = showingRecents ? recents : results;

  function toggleSearchField(field: AccountSearchField) {
    setSearchFields((prev) => {
      const has = prev.includes(field);
      if (has && prev.length === 1) return prev; // son chip kapatılamaz
      return has ? prev.filter((f) => f !== field) : [...prev, field];
    });
  }

  const searchPlaceholder = searchFields.length === 1
    ? FIELD_PLACEHOLDER[searchFields[0]]
    : searchFields.length === SEARCH_FIELD_CHIPS.length
      ? 'Ünvan, VKN, telefon veya müşteri kodu yazın…'
      : `${searchFields.map((f) => SEARCH_FIELD_CHIPS.find((c) => c.value === f)?.label ?? f).join(' / ')} içinde ara…`;

  function selectAccount(account: AccountListItem) {
    setSelected(account);
    pushRecentPointer(userId, account.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const count = listItems.length;
    if (count === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = listItems[highlightIdx] ?? listItems[0];
      if (target) selectAccount(target);
    }
  }

  function handleCreatedAccount(newAccount: { id: string; name: string; vknMasked?: string | null; companies?: AccountListItem['companies'] } | undefined) {
    setCreateOpen(false);
    if (!newAccount) return;
    // C2 review fix (P2): only id stored; PII renders on next open from
    // server revalidation, not from this snapshot.
    pushRecentPointer(userId, newAccount.id);
    if (afterCreate === 'openCase') {
      // Caller will receive accountId via the existing onNewCase contract and
      // is responsible for pivoting into NewCaseForm.
      onNewCase(newAccount.id);
      onClose();
      return;
    }
    // afterCreate === 'select': drive the modal back into search mode with
    // the new account surfaced. Setting the query to its name re-runs the
    // standard fetch path; the new row appears at the top.
    setQuery(newAccount.name);
  }

  const showCreateCta =
    allowCreate && debounced.length >= 2 && !loadingResults && results.length === 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="3xl"
        height="85vh"
        bodyClassName=""
        title={
          <div className="flex items-center gap-2">
            <Search size={16} className="text-brand-600" />
            <span>Müşteri Ara</span>
          </div>
        }
      >
        <div className="flex h-full min-h-0">
          {/* Sol sütun — arama + sonuç listesi */}
          <div className="flex w-[420px] shrink-0 flex-col border-r border-slate-200 dark:border-ndark-border">
            <div className="shrink-0 border-b border-slate-100 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
              <div className="mb-2 flex flex-wrap gap-1">
                {SEARCH_FIELD_CHIPS.map((chip) => {
                  const active = searchFields.includes(chip.value);
                  const isLast = active && searchFields.length === 1;
                  return (
                    <button
                      key={chip.value}
                      type="button"
                      aria-pressed={active}
                      title={isLast ? 'En az bir alan açık kalmalı' : undefined}
                      onClick={() => toggleSearchField(chip.value)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted dark:hover:text-ndark-text'
                      }`}
                    >
                      {active && <Check size={10} />}
                      {chip.label}
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-ndark-muted"
                />
                <TextInput
                  ref={inputRef}
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-8"
                  aria-controls="customer-search-listbox"
                  aria-activedescendant={
                    listItems.length > 0 ? `customer-search-item-${highlightIdx}` : undefined
                  }
                />
              </div>
              <div className="mt-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                {showingRecents
                  ? recents.length > 0
                    ? `Son bakılanlar (${recents.length})`
                    : 'En az 2 karakter yazın'
                  : `Sonuçlar (${results.length})`}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
              {showingRecents && loadingRecents ? (
                <div className="space-y-2">
                  <Skeleton height={70} />
                  <Skeleton height={70} />
                  <Skeleton height={70} />
                </div>
              ) : showingRecents && recents.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<Search size={18} />}
                  title="Aramaya başla"
                  description={
                    searchFields.length === SEARCH_FIELD_CHIPS.length
                      ? 'Tüm desteklenen alanlarda aranır.'
                      : `Aranan alanlar: ${searchFields.map((f) => SEARCH_FIELD_CHIPS.find((c) => c.value === f)?.label ?? f).join(', ')}.`
                  }
                />
              ) : !showingRecents && loadingResults && results.length === 0 ? (
                <div className="space-y-2">
                  <Skeleton height={70} />
                  <Skeleton height={70} />
                  <Skeleton height={70} />
                </div>
              ) : !showingRecents && results.length === 0 ? (
                <div className="space-y-3">
                  <EmptyState
                    size="sm"
                    icon={<Search size={18} />}
                    title="Sonuç yok"
                    description="Farklı arama terimi veya farklı bir alan chip'i deneyin."
                  />
                  {showCreateCta && (
                    <Button
                      className="w-full justify-center"
                      leftIcon={<UserPlus size={14} />}
                      onClick={() => setCreateOpen(true)}
                    >
                      Yeni müşteri oluştur
                    </Button>
                  )}
                </div>
              ) : (
                <ul
                  id="customer-search-listbox"
                  role="listbox"
                  aria-label={showingRecents ? 'Son bakılan müşteriler' : 'Arama sonuçları'}
                  className="space-y-1.5"
                >
                  {showingRecents && (
                    <li className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-ndark-muted">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} /> Son bakılanlar
                      </span>
                    </li>
                  )}
                  {listItems.map((a, idx) => {
                    const active = a.id === selected?.id;
                    const highlighted = idx === highlightIdx;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          id={`customer-search-item-${idx}`}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          onClick={() => selectAccount(a)}
                          className={`w-full rounded-md px-3 py-2 text-left ring-1 ring-inset transition ${
                            active
                              ? 'bg-brand-50 ring-brand-300 dark:bg-brand-900/20 dark:ring-brand-700'
                              : highlighted
                                ? 'bg-slate-50 ring-slate-300 dark:bg-ndark-surface dark:ring-ndark-accent'
                                : 'bg-white ring-slate-200 hover:bg-slate-50 dark:bg-ndark-card dark:ring-ndark-border dark:hover:bg-ndark-surface'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                              {a.name}
                            </span>
                            {!a.isActive && <Badge tint="slate">Pasif</Badge>}
                            {a.openCaseCount > 0 && (
                              <Badge tint="rose">{a.openCaseCount} açık</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {a.companies.map((c) => (
                              <Badge
                                key={c.accountCompanyId ?? c.companyId}
                                tint="blue"
                                icon={<Building2 size={10} />}
                              >
                                <span className="max-w-[110px] truncate">
                                  {c.companyName ?? c.companyId}
                                </span>
                                {c.externalCustomerCode && (
                                  <span className="ml-1 font-mono opacity-80">
                                    {c.externalCustomerCode}
                                  </span>
                                )}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                            {a.vknMasked && <span className="font-mono">VKN {a.vknMasked}</span>}
                            {a.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone size={10} /> {a.phone}
                              </span>
                            )}
                            {a.email && (
                              <span className="inline-flex items-center gap-1 truncate">
                                <Mail size={10} /> <span className="truncate">{a.email}</span>
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selected && (
              <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-3 dark:border-ndark-border dark:bg-ndark-surface">
                <Button
                  className="w-full justify-center"
                  leftIcon={<Plus size={14} />}
                  onClick={() => {
                    onNewCase(selected.id);
                    onClose();
                  }}
                >
                  Bu müşteri için yeni vaka aç
                </Button>
              </div>
            )}
          </div>

          {/* Sağ sütun — seçili müşteri detayı + açık vakalar */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8">
                <EmptyState
                  icon={<Building2 size={22} />}
                  title="Listeden bir müşteri seçin"
                  description="Açık vakalar ve hızlı aksiyonlar burada görünür."
                />
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-slate-100 bg-white p-4 dark:border-ndark-border dark:bg-ndark-card">
                  <div className="text-base font-semibold text-slate-900 dark:text-ndark-text">
                    {selected.name}
                  </div>
                  {selected.vknMasked && (
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                      VKN {selected.vknMasked}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-ndark-muted">
                    {selected.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={12} />
                        {selected.phone}
                      </span>
                    )}
                    {selected.email && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Mail size={12} />
                        <span className="truncate">{selected.email}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.companies.map((c) => (
                      <Badge
                        key={c.accountCompanyId ?? c.companyId}
                        tint="blue"
                        icon={<Building2 size={10} />}
                      >
                        <span className="max-w-[140px] truncate">
                          {c.companyName ?? c.companyId}
                        </span>
                        {c.externalCustomerCode && (
                          <span className="ml-1 font-mono opacity-80">{c.externalCustomerCode}</span>
                        )}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                      Açık Vakalar
                    </h3>
                    {!loadingCases && (
                      <Badge tint={openCases.length > 0 ? 'amber' : 'slate'}>
                        {openCases.length}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
                  {loadingCases ? (
                    <div className="space-y-2">
                      <Skeleton height={56} />
                      <Skeleton height={56} />
                      <Skeleton height={56} />
                    </div>
                  ) : openCases.length === 0 ? (
                    <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-900/40">
                      Bu müşterinin açık vakası yok.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {openCases.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-slate-500 dark:text-ndark-muted">
                              {c.caseNumber}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                              {c.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onShowCase(c.id);
                                onClose();
                              }}
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                              title="Vakayı detaydan aç"
                            >
                              <ExternalLink size={11} /> Aç
                            </button>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <CaseTypeBadge type={c.caseType} />
                            <StatusPill status={c.status} />
                            <span className="ml-auto text-[10px] text-slate-500 dark:text-ndark-muted">
                              {formatRelative(c.createdAt)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* C2: nested create-flow. Only mounted when caller opted into allowCreate. */}
      {allowCreate && (
        <AccountFormModal
          open={createOpen}
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={(acc) =>
            handleCreatedAccount(
              acc
                ? {
                    id: acc.id,
                    name: acc.name,
                    // AccountDetail may not surface a masked VKN; recents
                    // just renders whatever is present, so null is fine.
                    vknMasked: (acc as { vknMasked?: string | null }).vknMasked ?? null,
                    // AccountCompanyDetail extends AccountCompanyChip, so it
                    // already satisfies the chip shape used by recents.
                    companies: (acc.companies ?? []) as AccountListItem['companies'],
                  }
                : undefined,
            )
          }
        />
      )}
    </>
  );
}
