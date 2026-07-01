import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Search,
  UserX,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, TextInput } from '@/components/ui/Field';
import {
  accountService,
  validateTcknRemote,
  type AccountListItem,
  type AccountSearchField,
} from '@/services/accountService';

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

interface AccountSearchPickerProps {
  open: boolean;
  /** Mevcut seçim — modal açıldığında highlight için. */
  selectedAccountId?: string | null;
  /** Picker'da "müşterisiz devam" seçeneğine izin verilsin mi (Agent için case create). */
  allowNullSelection?: boolean;
  /** Filtre: yalnız bu companyId'lere bağlı müşterileri göster. */
  companyId?: string | null;
  onClose: () => void;
  onSelect: (account: AccountListItem | null) => void;
}

const PAGE_SIZE = 20;

/**
 * Yeni vaka / vaka detay akışlarında müşteri seçici.
 *
 * - GET /api/accounts ile gerçek zamanlı arama (bootstrap cache değil).
 * - Debounce 300ms, min 2 karakter.
 * - Disambiguation: company chip + dış müşteri kodu + maskeli VKN + telefon + email
 *   + isActive + openCaseCount + totalCaseCount.
 * - "Müşterisiz devam et" — Agent vaka açabilsin diye explicit null seçim.
 */
export function AccountSearchPicker({
  open,
  selectedAccountId,
  allowNullSelection = false,
  companyId,
  onClose,
  onSelect,
}: AccountSearchPickerProps) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchFields, setSearchFields] = useState<AccountSearchField[]>(['name']);
  const [items, setItems] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PR-4b — 11 haneli sayısal sorgu için TCKN format ipucu. Validation
  // backend'de zaten yapılır (pepper yoksa branch sessizce skip); buradaki
  // hint sadece UX feedback: "rakam doğru ama TCKN değil" olduğunda kullanıcı
  // anlasın. Search çağrısı buna bağlı değil — backend her zaman güvenli.
  const [tcknHint, setTcknHint] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setSearchFields(['name']);
      setItems([]);
      setError(null);
      setTcknHint(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebounced(search.trim().length >= 2 ? search.trim() : '');
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [search]);

  function toggleSearchField(field: AccountSearchField) {
    setSearchFields((prev) => {
      const has = prev.includes(field);
      if (has && prev.length === 1) return prev;
      return has ? prev.filter((f) => f !== field) : [...prev, field];
    });
  }

  const searchPlaceholder = searchFields.length === 1
    ? FIELD_PLACEHOLDER[searchFields[0]]
    : searchFields.length === SEARCH_FIELD_CHIPS.length
      ? 'Ünvan, VKN, telefon veya müşteri kodu yazın…'
      : `${searchFields.map((f) => SEARCH_FIELD_CHIPS.find((c) => c.value === f)?.label ?? f).join(' / ')} içinde ara…`;

  const load = useCallback(async () => {
    if (!debounced) {
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const out = await accountService.list({
      search: debounced,
      searchFields,
      companyId: companyId ?? undefined,
      page: 1,
      limit: PAGE_SIZE,
    });
    setLoading(false);
    if (!out) {
      setError('Arama başarısız.');
      return;
    }
    setItems(out.accounts);
  }, [debounced, searchFields, companyId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // PR-4b — Debounced query 11 hane rakamsa TCKN format'ı kontrol et.
  // Geçersizse "TCKN geçersiz" hint, geçerliyse "TCKN ile aranıyor" hint.
  // Aksi halde temizle. Backend search bu hint'ten bağımsız: hash branch
  // sadece valid + pepper available iken eklenir, aksi durumda diğer
  // alanlarda (name/vkn/code/phone/email) arama devam eder.
  useEffect(() => {
    let cancelled = false;
    if (!debounced || !/^\d{11}$/.test(debounced)) {
      setTcknHint(null);
      return;
    }
    void validateTcknRemote(debounced).then((r) => {
      if (cancelled) return;
      if (!r) {
        setTcknHint(null);
        return;
      }
      setTcknHint(r.valid ? 'TCKN ile aranıyor.' : 'TCKN geçersiz.');
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      height="80vh"
      title={
        <div className="flex items-center gap-2">
          <Search size={14} />
          <span>Müşteri Ara</span>
        </div>
      }
      bodyClassName="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-ndark-border">
        <Field label="">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-ndark-muted"
            />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 pr-9"
              autoFocus
              aria-label="Müşteri ara"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Temizle"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {tcknHint && (
            <div
              className={`mt-1 text-[11px] ${
                tcknHint === 'TCKN geçersiz.'
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-slate-500 dark:text-ndark-muted'
              }`}
            >
              {tcknHint}
            </div>
          )}
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {SEARCH_FIELD_CHIPS.map((chip) => {
            const active = searchFields.includes(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => toggleSearchField(chip.value)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-ndark-border dark:bg-ndark-surface dark:text-ndark-muted dark:hover:text-ndark-text'
                }`}
              >
                {active && <Check size={10} />}
                {chip.label}
              </button>
            );
          })}
        </div>
        {allowNullSelection && (
          <Button
            type="button"
            variant="outline"
            leftIcon={<UserX size={12} />}
            onClick={() => onSelect(null)}
            className="w-full justify-center sm:w-auto"
          >
            Müşterisiz devam et
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {debounced.length < 2 ? (
          <EmptyState
            size="sm"
            icon={<Search size={16} />}
            title="Aramaya başla"
            description="En az 2 karakter yaz. Ad, VKN, TCKN (tam 11 hane), telefon, e-posta veya müşteri kodu üzerinde arama yapılır."
          />
        ) : error ? (
          <EmptyState
            size="sm"
            icon={<UserX size={16} />}
            title={error}
            action={
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Tekrar dene
              </Button>
            }
          />
        ) : loading && items.length === 0 ? (
          <ul className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <li
                key={i}
                className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-ndark-surface"
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<UserX size={16} />}
            title="Sonuç bulunamadı"
            description={
              allowNullSelection
                ? 'Müşteri sistemde kayıtlı değilse vakayı "Müşterisiz devam et" ile aç.'
                : 'Farklı bir arama dene.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id}>
                <AccountResultRow
                  account={a}
                  selected={a.id === selectedAccountId}
                  onClick={() => onSelect(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function AccountResultRow({
  account,
  selected,
  onClick,
}: {
  account: AccountListItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/20'
          : 'border-slate-200 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-ndark-text">
              {account.name}
            </span>
            {!account.isActive && <Badge tint="slate">Pasif</Badge>}
            {selected && (
              <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 dark:text-brand-300">
                <CheckCircle2 size={11} /> seçili
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {account.companies.map((c) => (
              <CompanyChip
                key={c.accountCompanyId ?? c.companyId}
                name={c.companyName ?? c.companyId}
                color={c.companyColor}
                code={c.externalCustomerCode}
              />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-ndark-muted">
            {account.vknMasked && (
              <span className="font-mono">VKN {account.vknMasked}</span>
            )}
            {account.tcknMasked && (
              <span className="font-mono">TCKN {account.tcknMasked}</span>
            )}
            {account.phone && <span>{account.phone}</span>}
            {account.email && <span className="truncate">{account.email}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-500 dark:text-ndark-muted">
          <div>
            <span
              className={
                account.openCaseCount > 0
                  ? 'font-semibold text-rose-700 dark:text-rose-300'
                  : ''
              }
            >
              {account.openCaseCount}
            </span>{' '}
            açık
          </div>
          <div>{account.totalCaseCount} toplam</div>
        </div>
      </div>
    </button>
  );
}

function CompanyChip({
  name,
  color,
  code,
}: {
  name: string;
  color?: string | null;
  code?: string | null;
}) {
  // Backend Company.color verirse onu kullanırız; aksi halde neutral.
  if (color) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset"
        style={{
          backgroundColor: `${color}22`,
          color,
          borderColor: `${color}55`,
        }}
      >
        <Building2 size={10} />
        <span className="max-w-[120px] truncate">{name}</span>
        {code && <span className="ml-1 font-mono opacity-80">{code}</span>}
      </span>
    );
  }
  return (
    <Badge tint="blue" icon={<Building2 size={10} />}>
      <span className="max-w-[120px] truncate">{name}</span>
      {code && <span className="ml-1 font-mono opacity-80">{code}</span>}
    </Badge>
  );
}
