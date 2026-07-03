import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
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
  type AccountListProjectItem,
  type AccountSearchField,
} from '@/services/accountService';

export interface PickedProject {
  id: string;
  name: string;
  code: string | null;
  companyId: string;
}

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
  /** projectsEnabled=true ise her müşteri satırında proje alt listesi gösterilir. */
  projectsEnabled?: boolean;
  /** projectsRequired=true ise projesi olan müşteride "Projesiz devam et" gizlenir. */
  projectsRequired?: boolean;
  /**
   * Proje seçimiyle birlikte müşteri seçimi.
   * project=null → projesiz seçim.
   * Sağlandığında projectsEnabled=true akışı devreye girer; sağlanmadığında
   * mevcut onSelect davranışı korunur (diğer caller'lar etkilenmez).
   */
  onSelectWithProject?: (account: AccountListItem, project: PickedProject | null) => void;
}

const PAGE_SIZE = 20;

const SEARCH_FIELD_CHIPS: { value: AccountSearchField; label: string }[] = [
  { value: 'name',    label: 'Ünvan' },
  { value: 'vkn',     label: 'VKN / TCKN' },
  { value: 'phone',   label: 'Telefon' },
  { value: 'code',    label: 'Müşteri kodu' },
  { value: 'contact', label: 'Kontak' },
];

const FIELD_PLACEHOLDER: Record<AccountSearchField, string> = {
  name:    'Müşteri adı',
  vkn:     'VKN veya TCKN',
  phone:   'Telefon numarası',
  code:    'Müşteri kodu',
  contact: 'Kontak adı, telefon veya e-posta',
};

/**
 * Yeni vaka / vaka detay akışlarında müşteri seçici.
 *
 * - GET /api/accounts ile gerçek zamanlı arama (bootstrap cache değil).
 * - Debounce 300ms, min 2 karakter.
 * - Disambiguation: company chip + dış müşteri kodu + maskeli VKN + telefon + email
 *   + isActive + openCaseCount + totalCaseCount.
 * - "Müşterisiz devam et" — Agent vaka açabilsin diye explicit null seçim.
 * - projectsEnabled=true: her müşteri satırında inline proje sub-listesi.
 */
export function AccountSearchPicker({
  open,
  selectedAccountId,
  allowNullSelection = false,
  companyId,
  onClose,
  onSelect,
  projectsEnabled = false,
  projectsRequired = false,
  onSelectWithProject,
}: AccountSearchPickerProps) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tcknHint, setTcknHint] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Codex P2 R1 fix (2026-07-03) — Default BOŞ (tüm alanlar aranır).
  // Önceden default ['name'] idi; kullanıcı bir TCKN/telefon/müşteri kodu
  // yapıştırdığında backend yalnız name predicate'ini aradığı için sonuç
  // dönmüyordu (chip'i keşfedip toggle etmeleri beklenir hale gelmişti).
  // Backend `searchFields=[]` gelirse tüm alanları arar (accountRepository:308
  // `Array.isArray(searchFields) && searchFields.length > 0` guard'ı).
  const [searchFields, setSearchFields] = useState<AccountSearchField[]>([]);
  const debounceRef = useRef<number | null>(null);

  const useProjectFlow = projectsEnabled && !!onSelectWithProject;

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setItems([]);
      setError(null);
      setTcknHint(null);
      setExpandedId(null);
      setSearchFields(['name']);
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
  }, [debounced, companyId, searchFields]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Proje araması: query ile eşleşen projesi olan müşteriyi otomatik aç.
  useEffect(() => {
    if (!useProjectFlow || !debounced) {
      setExpandedId(null);
      return;
    }
    const q = debounced.toLowerCase();
    const matched = items.find((a) =>
      getAllProjects(a).some(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q),
      ),
    );
    if (matched) setExpandedId(matched.id);
  }, [debounced, items, useProjectFlow]);

  useEffect(() => {
    let cancelled = false;
    if (!debounced || !/^\d{11}$/.test(debounced)) {
      setTcknHint(null);
      return;
    }
    void validateTcknRemote(debounced).then((r) => {
      if (cancelled) return;
      if (!r) { setTcknHint(null); return; }
      setTcknHint(r.valid ? 'TCKN ile aranıyor.' : 'TCKN geçersiz.');
    });
    return () => { cancelled = true; };
  }, [debounced]);

  function toggleSearchField(field: AccountSearchField) {
    setSearchFields((prev) => {
      if (prev.includes(field)) {
        const next = prev.filter((f) => f !== field);
        return next.length === 0 ? [field] : next;
      }
      return [...prev, field];
    });
  }

  const searchPlaceholder = (() => {
    // Codex P2 R1 fix — length===0 durumu (default "tüm alanlar aranır")
    // eklendi. Chip seçimi = arama daraltma; hiç seçilmezse hepsi.
    const base =
      searchFields.length === 0 || searchFields.length === SEARCH_FIELD_CHIPS.length
        ? 'Müşteri adı, VKN, TCKN, telefon veya müşteri kodu'
        : searchFields.length === 1
          ? FIELD_PLACEHOLDER[searchFields[0]]
          : searchFields.map((f) => SEARCH_FIELD_CHIPS.find((c) => c.value === f)?.label ?? f).join(', ');
    return useProjectFlow ? `${base} veya proje adı/kodu…` : `${base}…`;
  })();

  function handleAccountClick(account: AccountListItem) {
    if (!useProjectFlow) {
      onSelect(account);
      return;
    }
    const projects = getAllProjects(account);
    if (projects.length === 0) {
      // Projesi yok → projesiz seç (projectsRequired olsa bile izin ver)
      onSelectWithProject!(account, null);
      return;
    }
    // Projesi var → sub-listeyi aç/kapat
    setExpandedId((prev) => (prev === account.id ? null : account.id));
  }

  function handleProjectClick(account: AccountListItem, project: AccountListProjectItem, projectCompanyId: string) {
    onSelectWithProject!(account, { id: project.id, name: project.name, code: project.code, companyId: projectCompanyId });
  }

  function handleSelectWithoutProject(account: AccountListItem) {
    onSelectWithProject!(account, null);
  }

  const searchQuery = debounced.toLowerCase();

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
        <div className="flex flex-wrap items-center gap-1.5">
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
          {/* Codex P2 R1 fix — Hiç chip seçili değilse kullanıcı "arama alanı
              yok mu" diye tereddüt etmesin: davranış "tüm alanlarda ara"dır. */}
          {searchFields.length === 0 && (
            <span className="text-[11px] italic text-slate-400 dark:text-ndark-muted">
              seçim yok — tüm alanlarda aranır
            </span>
          )}
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
            description="En az 2 karakter yaz. Üstteki etiketleri kullanarak arama alanını daraltabilirsin."
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
                  useProjectFlow={useProjectFlow}
                  projectsRequired={projectsRequired}
                  expanded={expandedId === a.id}
                  searchQuery={searchQuery}
                  onAccountClick={() => handleAccountClick(a)}
                  onProjectClick={(p, cId) => handleProjectClick(a, p, cId)}
                  onSelectWithoutProject={() => handleSelectWithoutProject(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function getAllProjects(account: AccountListItem): (AccountListProjectItem & { companyId: string })[] {
  return (account.companies ?? []).flatMap((c) =>
    (c.projects ?? []).map((p) => ({ ...p, companyId: c.companyId })),
  );
}

function projectCountLabel(count: number): string {
  if (count === 0) return 'proje yok';
  if (count === 1) return '1 proje';
  return `${count} proje`;
}

function AccountResultRow({
  account,
  selected,
  useProjectFlow,
  projectsRequired,
  expanded,
  searchQuery,
  onAccountClick,
  onProjectClick,
  onSelectWithoutProject,
}: {
  account: AccountListItem;
  selected: boolean;
  useProjectFlow: boolean;
  projectsRequired: boolean;
  expanded: boolean;
  searchQuery: string;
  onAccountClick: () => void;
  onProjectClick: (project: AccountListProjectItem & { companyId: string }, companyId: string) => void;
  onSelectWithoutProject: () => void;
}) {
  const allProjects = useProjectFlow ? getAllProjects(account) : [];
  const hasProjects = allProjects.length > 0;

  const borderClass = selected
    ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/20'
    : 'border-slate-200 dark:border-ndark-border';

  return (
    <div className={`rounded-lg border ${borderClass} overflow-hidden`}>
      <button
        type="button"
        onClick={onAccountClick}
        className={`w-full px-3 py-2 text-left transition-colors ${
          selected
            ? 'hover:bg-brand-100 dark:hover:bg-brand-900/30'
            : 'hover:bg-slate-50 dark:hover:bg-ndark-surface'
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
              {useProjectFlow && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    hasProjects
                      ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/40'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  <FolderOpen size={9} />
                  {projectCountLabel(allProjects.length)}
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
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="text-right text-[11px] text-slate-500 dark:text-ndark-muted">
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
            {useProjectFlow && hasProjects && (
              <span className="text-slate-400 dark:text-ndark-muted">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Proje alt listesi */}
      {useProjectFlow && expanded && hasProjects && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-ndark-border/60 dark:bg-ndark-surface/40">
          <ul className="space-y-1">
            {allProjects.map((p) => {
              const isMatch =
                searchQuery.length >= 2 &&
                (p.name.toLowerCase().includes(searchQuery) ||
                  (p.code ?? '').toLowerCase().includes(searchQuery));
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onProjectClick(p, p.companyId)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      isMatch
                        ? 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-200 dark:ring-violet-900/40'
                        : 'text-slate-700 hover:bg-white dark:text-ndark-text dark:hover:bg-ndark-card'
                    }`}
                  >
                    <FolderOpen size={12} className="shrink-0 text-slate-400 dark:text-ndark-muted" />
                    <span className="font-medium">{p.name}</span>
                    {p.code && (
                      <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                        {p.code}
                      </span>
                    )}
                    {isMatch && (
                      <span className="ml-auto text-[10px] font-semibold text-violet-600 dark:text-violet-300">
                        eşleşti
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {/* "Projesiz devam et" — sadece projectsRequired=false ise */}
            {!projectsRequired && (
              <li>
                <button
                  type="button"
                  onClick={onSelectWithoutProject}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-slate-500 transition-colors hover:bg-white dark:text-ndark-muted dark:hover:bg-ndark-card"
                >
                  <UserX size={11} className="shrink-0" />
                  Projesiz devam et
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
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
