import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ExternalLink,
  Phone,
  Plus,
  Search,
  UserCircle2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, CaseTypeBadge } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { caseService, lookupService } from '@/services/caseService';
import type { Case } from '@/features/cases/types';
import { formatRelative } from '@/lib/format';

interface CustomerSearchModalProps {
  open: boolean;
  onClose: () => void;
  onShowCase: (caseId: string) => void;
  onNewCase: (accountId: string) => void;
}

export function CustomerSearchModal({ open, onClose, onShowCase, onNewCase }: CustomerSearchModalProps) {
  const accounts = useMemo(() => lookupService.accounts(), []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openCases, setOpenCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedId(null);
      setOpenCases([]);
      // Modal açıldığında arama input'una otomatik focus
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setOpenCases([]);
      return;
    }
    setLoading(true);
    void caseService
      .findByAccount(selectedId, { statusNotIn: ['Çözüldü', 'İptalEdildi'] })
      .then((items) => {
        if (alive) {
          setOpenCases(items);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '').toLowerCase();
    return accounts.filter((a) => {
      const phoneNorm = norm(a.phone);
      return (
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (phoneNorm && phoneNorm.includes(norm(q))) ||
        (a.contactPerson && a.contactPerson.toLowerCase().includes(q)) ||
        (a.email && a.email.toLowerCase().includes(q))
      );
    });
  }, [accounts, query]);

  const selectedAccount = accounts.find((a) => a.id === selectedId);

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
        {/* Sol sütun — 380px sabit */}
        <div className="flex w-[380px] shrink-0 flex-col border-r border-slate-200">
          {/* Arama input — sabit, scroll etmez */}
          <div className="shrink-0 border-b border-slate-100 bg-white p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                ref={inputRef}
                placeholder="İsim, telefon (ör. 212 555), e-posta veya yetkili adı…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="mt-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sonuçlar ({results.length})
            </div>
          </div>

          {/* Sonuç listesi — kalan alanı doldurur, kendi içinde scroll */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
            {results.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title="Sonuç bulunamadı"
                description="Farklı arama terimi deneyin."
              />
            ) : (
              <ul className="space-y-1">
                {results.map((a) => {
                  const active = a.id === selectedId;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(a.id)}
                        className={`w-full rounded-md px-3 py-2 text-left ring-1 ring-inset transition ${
                          active
                            ? 'bg-brand-50 ring-brand-300'
                            : 'bg-white ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Building2 size={14} className="text-slate-400" />
                          <span className="flex-1 truncate text-sm font-medium text-slate-800">
                            {a.name}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">{a.id}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Phone size={11} />
                            {a.phone}
                          </span>
                          {a.contactPerson && (
                            <span className="inline-flex items-center gap-1">
                              <UserCircle2 size={11} />
                              {a.contactPerson}
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

          {/* Yeni vaka butonu — sticky bottom, scroll dışı */}
          {selectedAccount && (
            <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-3">
              <Button
                className="w-full justify-center"
                leftIcon={<Plus size={14} />}
                onClick={() => {
                  onNewCase(selectedAccount.id);
                  onClose();
                }}
              >
                Bu müşteri için yeni vaka aç
              </Button>
            </div>
          )}
        </div>

        {/* Sağ sütun — flex-1 */}
        <div className="flex flex-1 min-w-0 flex-col">
          {!selectedAccount ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                icon={<Building2 size={22} />}
                title="Listeden bir müşteri seçin"
                description="Açık vakaları ve hızlı aksiyonlar burada görünür."
              />
            </div>
          ) : (
            <>
              {/* Müşteri başlığı + Açık Vakalar header — sabit */}
              <div className="shrink-0 border-b border-slate-100 bg-white p-4">
                <div className="text-base font-semibold text-slate-900">{selectedAccount.name}</div>
                <div className="font-mono text-[11px] text-slate-500">{selectedAccount.id}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <Phone size={12} />
                    {selectedAccount.phone}
                  </span>
                  {selectedAccount.contactPerson && (
                    <span className="inline-flex items-center gap-1">
                      <UserCircle2 size={12} />
                      {selectedAccount.contactPerson}
                    </span>
                  )}
                  {selectedAccount.email && (
                    <span className="truncate text-slate-500">{selectedAccount.email}</span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Açık Vakalar
                  </h3>
                  {!loading && (
                    <Badge tint={openCases.length > 0 ? 'amber' : 'slate'}>{openCases.length}</Badge>
                  )}
                </div>
              </div>

              {/* Vaka listesi — kalan alanı doldurur, kendi içinde scroll */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin">
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton height={56} />
                    <Skeleton height={56} />
                    <Skeleton height={56} />
                  </div>
                ) : openCases.length === 0 ? (
                  <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                    Bu müşterinin açık vakası yok.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {openCases.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-slate-500">{c.caseNumber}</span>
                          <span className="flex-1 truncate text-sm font-medium text-slate-800">
                            {c.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onShowCase(c.id);
                              onClose();
                            }}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                            title="Vakayı detaydan aç"
                          >
                            <ExternalLink size={11} /> Aç
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <CaseTypeBadge type={c.caseType} />
                          <StatusPill status={c.status} />
                          <span className="ml-auto text-[10px] text-slate-500">
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
