import { useEffect, useState } from 'react';
import { Building2, Copy, ExternalLink, Inbox, Mail, Phone, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { notify } from '@/components/ui/Toast';
import { listAccountPhones } from '@/utils/phone';
import { caseService } from '@/services/caseService';
import { accountService, type AccountDetail } from '@/services/accountService';
import type { Case } from '@/features/cases/types';
import { CASE_TYPE_LABELS } from '@/features/cases/types';

interface CustomerCardModalProps {
  open: boolean;
  accountId: string | null;
  onClose: () => void;
  onShowCase?: (caseId: string) => void;
}

/**
 * Müşteri kartı önizleme — Phase C2 sonrası:
 *  - Müşteri bilgisi: accountService.get (Phase A API)
 *  - Vaka listesi: /api/cases/by-account (tüm vaka tablosunu çekmez)
 *
 * Önceden caseService.list() tüm vakaları çekip client'te filtreliyordu —
 * büyük tenant'larda yük problemi vardı; düzeltildi.
 */
export function CustomerCardModal({ open, accountId, onClose, onShowCase }: CustomerCardModalProps) {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!open || !accountId) {
      setAccount(null);
      setCases([]);
      return;
    }
    setLoading(true);
    void Promise.all([
      accountService.get(accountId),
      caseService.findByAccount(accountId),
    ]).then(([acc, list]) => {
      if (!alive) return;
      setAccount(acc ?? null);
      setCases(list ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, accountId]);

  const openCount = cases.filter(
    (c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi',
  ).length;
  const slaBreach = cases.filter((c) => c.slaViolation).length;
  const byType = cases.reduce<Record<string, number>>((acc, c) => {
    acc[c.caseType] = (acc[c.caseType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-brand-600" />
          <span>Müşteri Kartı</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
            <Sparkles size={12} />
            Detay için Müşteriler sayfasını aç.
          </span>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      }
    >
      {!account && !loading ? (
        <p className="text-sm text-slate-600 dark:text-ndark-muted">Müşteri bulunamadı.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-ndark-text">
              {account?.name ?? '…'}
            </div>
            {/* Vergi Dairesi — yalnız kurumsal/dolu iken, VKN'den önce. */}
            {account?.customerType !== 'Individual' && account?.taxOffice && (
              <div className="text-xs text-slate-500 dark:text-ndark-muted">
                Vergi Dairesi: <span className="text-slate-700 dark:text-ndark-text">{account.taxOffice}</span>
              </div>
            )}
            {account?.vknMasked && (
              <div className="font-mono text-xs text-slate-500 dark:text-ndark-muted">
                VKN {account.vknMasked}
              </div>
            )}
            {account?.id && <SystemCustomerIdLine id={account.id} />}
          </div>

          {account?.companies && account.companies.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {account.companies.map((c) => (
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
          )}

          {(() => {
            // Phase 3 — Account 3 telefon slot. Birincil ilk, kalanlar arkasında.
            const phones = account
              ? listAccountPhones({
                  phone: account.phone,
                  phoneType: account.phoneType,
                  phoneExtension: account.phoneExtension,
                  phone2: account.phone2,
                  phone2Type: account.phone2Type,
                  phone2Extension: account.phone2Extension,
                  phone3: account.phone3,
                  phone3Type: account.phone3Type,
                  phone3Extension: account.phone3Extension,
                  primaryPhoneSlot: account.primaryPhoneSlot,
                })
              : [];
            if (phones.length === 0 && !account?.email) return null;
            return (
              <div className="flex flex-col gap-1 text-xs text-slate-600 dark:text-ndark-muted">
                {phones.map((p) => (
                  <span key={p.slot} className="inline-flex items-center gap-1">
                    <Phone size={11} />
                    {p.text}
                  </span>
                ))}
                {account?.email && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Mail size={11} /> <span className="truncate">{account.email}</span>
                  </span>
                )}
              </div>
            );
          })()}

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Toplam Vaka" value={cases.length} loading={loading} />
            <SummaryTile label="Açık" value={openCount} loading={loading} tone="info" />
            <SummaryTile
              label="SLA İhlal"
              value={slaBreach}
              loading={loading}
              tone={slaBreach > 0 ? 'danger' : 'neutral'}
            />
          </div>

          {Object.keys(byType).length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                Tip Dağılımı
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(byType).map(([t, n]) => (
                  <Badge key={t} tint="slate">
                    {CASE_TYPE_LABELS[t as keyof typeof CASE_TYPE_LABELS]}: {n}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {cases.length > 0 && (
            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                <Inbox size={12} />
                Son Vakalar
              </h4>
              <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200 dark:divide-ndark-border/60 dark:ring-ndark-border">
                {cases.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm dark:bg-ndark-card"
                  >
                    <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                      {c.caseNumber}
                    </span>
                    <span className="flex-1 truncate text-slate-800 dark:text-ndark-text">
                      {c.title}
                    </span>
                    {onShowCase && (
                      <button
                        type="button"
                        onClick={() => onShowCase(c.id)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                      >
                        <ExternalLink size={11} /> Aç
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {cases.length > 5 && (
                <p className="mt-1 text-[11px] text-slate-400 dark:text-ndark-dim">
                  +{cases.length - 5} daha…
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SummaryTile({
  label,
  value,
  loading,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  loading?: boolean;
  tone?: 'neutral' | 'info' | 'danger';
}) {
  const cls =
    tone === 'info'
      ? 'bg-blue-50 ring-blue-200 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-900/40'
      : tone === 'danger'
        ? 'bg-rose-50 ring-rose-200 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-900/40'
        : 'bg-slate-50 ring-slate-200 text-slate-700 dark:bg-ndark-surface dark:text-ndark-text dark:ring-ndark-border';
  return (
    <div className={`rounded-md p-2.5 ring-1 ring-inset ${cls}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      {loading ? (
        <div className="mt-1 h-6 w-8 animate-pulse rounded bg-slate-200 dark:bg-ndark-border" />
      ) : (
        <div className="mt-0.5 text-xl font-semibold">{value}</div>
      )}
    </div>
  );
}

/**
 * Sistem Müşteri ID satırı — Account.id Varuna'nın global stabil
 * müşteri kimliği. Kart modal kompakt olduğu için mono küçük + copy
 * icon ile gösterilir, label "Sistem Müşteri ID".
 */
function SystemCustomerIdLine({ id }: { id: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      notify({ type: 'success', message: 'Müşteri ID kopyalandı.', duration: 2500 });
    } catch {
      // sessiz no-op
    }
  }
  return (
    <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
      <span className="text-slate-400 dark:text-ndark-dim">Sistem Müşteri ID</span>
      <span className="max-w-[180px] truncate">{id}</span>
      <button
        type="button"
        onClick={copy}
        title="Sistem Müşteri ID'yi kopyala"
        aria-label="Sistem Müşteri ID'yi kopyala"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
      >
        <Copy size={10} />
      </button>
    </div>
  );
}
