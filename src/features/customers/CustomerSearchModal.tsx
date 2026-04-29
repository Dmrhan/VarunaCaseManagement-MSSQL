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
    const norm = (s: string) => s.replace(/\s/g, '').toLowerCase();
    return accounts.filter((a) => {
      const phoneNorm = norm(a.phone);
      return (
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        phoneNorm.includes(norm(q)) ||
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
      size="lg"
      title={
        <div className="flex items-center gap-2">
          <Search size={16} className="text-brand-600" />
          <span>Müşteri Ara</span>
        </div>
      }
    >
      <div className="space-y-4">
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Sol — sonuç listesi */}
          <div>
            <h4 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Sonuçlar ({results.length})</span>
            </h4>
            {results.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title="Sonuç bulunamadı"
                description="Farklı arama terimi deneyin."
              />
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
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

          {/* Sağ — seçili müşterinin açık vakaları */}
          <div>
            {!selectedAccount ? (
              <EmptyState
                size="sm"
                icon={<Building2 size={18} />}
                title="Müşteri seçin"
                description="Açık vakaları ve hızlı aksiyonlar burada görünür."
              />
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{selectedAccount.name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{selectedAccount.id}</div>
                </div>

                <div>
                  <h4 className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>Açık Vakalar</span>
                    {!loading && (
                      <Badge tint={openCases.length > 0 ? 'amber' : 'slate'}>{openCases.length}</Badge>
                    )}
                  </h4>
                  {loading ? (
                    <div className="space-y-1.5">
                      <Skeleton height={36} />
                      <Skeleton height={36} />
                    </div>
                  ) : openCases.length === 0 ? (
                    <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
                      Bu müşterinin açık vakası yok.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {openCases.slice(0, 5).map((c) => (
                        <li
                          key={c.id}
                          className="rounded-md bg-white px-2.5 py-1.5 ring-1 ring-slate-200"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-slate-500">
                              {c.caseNumber}
                            </span>
                            <span className="flex-1 truncate text-xs font-medium text-slate-800">
                              {c.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onShowCase(c.id);
                                onClose();
                              }}
                              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
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
                      {openCases.length > 5 && (
                        <li className="text-[11px] text-slate-500">
                          +{openCases.length - 5} vaka daha…
                        </li>
                      )}
                    </ul>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-3">
                  <Button
                    leftIcon={<Plus size={14} />}
                    onClick={() => {
                      onNewCase(selectedAccount.id);
                      onClose();
                    }}
                  >
                    Bu müşteri için yeni vaka aç
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
