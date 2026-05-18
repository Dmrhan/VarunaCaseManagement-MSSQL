import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  ExternalLink,
  Mail,
  Phone,
  Plus,
  Search,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, CaseTypeBadge } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { caseService } from '@/services/caseService';
import { accountService, type AccountListItem } from '@/services/accountService';
import type { Case } from '@/features/cases/types';
import { formatRelative } from '@/lib/format';

interface CustomerSearchModalProps {
  open: boolean;
  onClose: () => void;
  onShowCase: (caseId: string) => void;
  onNewCase: (accountId: string) => void;
}

const PAGE_SIZE = 20;

/**
 * Müşteri arama modal'ı — Phase C2 sonrası Account API'sini kullanır
 * (bootstrap cache değil). Sol panel arama, sağ panel seçili müşterinin
 * açık vakaları (/api/cases/by-account).
 *
 * Disambiguation: company chips, externalCustomerCode, masked VKN,
 * phone, email, isActive, openCaseCount, totalCaseCount.
 */
export function CustomerSearchModal({
  open,
  onClose,
  onShowCase,
  onNewCase,
}: CustomerSearchModalProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<AccountListItem[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [selected, setSelected] = useState<AccountListItem | null>(null);
  const [openCases, setOpenCases] = useState<Case[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
      setResults([]);
      setSelected(null);
      setOpenCases([]);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

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
      return;
    }
    setLoadingResults(true);
    const out = await accountService.list({ search: debounced, page: 1, limit: PAGE_SIZE });
    setLoadingResults(false);
    setResults(out?.accounts ?? []);
  }, [debounced]);

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

  return (
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
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-ndark-muted"
              />
              <TextInput
                ref={inputRef}
                placeholder="Ad, VKN, telefon veya e-posta ile ara…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="mt-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              {debounced ? `Sonuçlar (${results.length})` : 'En az 2 karakter yazın'}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
            {!debounced ? (
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title="Aramaya başla"
                description="Ad, VKN, telefon veya e-posta üzerinde arama yapılır."
              />
            ) : loadingResults && results.length === 0 ? (
              <div className="space-y-2">
                <Skeleton height={70} />
                <Skeleton height={70} />
                <Skeleton height={70} />
              </div>
            ) : results.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title="Sonuç yok"
                description="Farklı arama terimi dene."
              />
            ) : (
              <ul className="space-y-1.5">
                {results.map((a) => {
                  const active = a.id === selected?.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(a)}
                        className={`w-full rounded-md px-3 py-2 text-left ring-1 ring-inset transition ${
                          active
                            ? 'bg-brand-50 ring-brand-300 dark:bg-brand-900/20 dark:ring-brand-700'
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
  );
}
