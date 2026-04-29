import { useMemo } from 'react';
import { Building2, ExternalLink, Inbox, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { caseService, lookupService } from '@/services/caseService';
import { useEffect, useState } from 'react';
import type { Case } from '@/features/cases/types';
import { CASE_TYPE_LABELS } from '@/features/cases/types';

interface CustomerCardModalProps {
  open: boolean;
  accountId: string | null;
  onClose: () => void;
  onShowCase?: (caseId: string) => void;
}

export function CustomerCardModal({ open, accountId, onClose, onShowCase }: CustomerCardModalProps) {
  const accounts = useMemo(() => lookupService.accounts(), []);
  const account = accounts.find((a) => a.id === accountId);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (open && accountId) {
      setLoading(true);
      void caseService.list().then(({ items }) => {
        if (alive) {
          setCases(items.filter((c) => c.accountId === accountId));
          setLoading(false);
        }
      });
    } else {
      setCases([]);
    }
    return () => {
      alive = false;
    };
  }, [open, accountId]);

  const openCount = cases.filter((c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi').length;
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
          <Badge tint="amber">FAZ 0 — Önizleme</Badge>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Sparkles size={12} />
            Tam Müşteri Kartı modülü FAZ 1+ ile gelecek.
          </span>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      }
    >
      {!account ? (
        <p className="text-sm text-slate-600">Müşteri bulunamadı.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">{account.name}</div>
            <div className="font-mono text-xs text-slate-500">{account.id}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Toplam Vaka" value={cases.length} loading={loading} />
            <SummaryTile label="Açık"        value={openCount}    loading={loading} tone="info" />
            <SummaryTile label="SLA İhlal"   value={slaBreach}    loading={loading} tone={slaBreach > 0 ? 'danger' : 'neutral'} />
          </div>

          {Object.keys(byType).length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Inbox size={12} />
                Son Vakalar
              </h4>
              <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
                {cases.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-mono text-[11px] text-slate-500">{c.caseNumber}</span>
                    <span className="flex-1 truncate text-slate-800">{c.title}</span>
                    {onShowCase && (
                      <button
                        type="button"
                        onClick={() => onShowCase(c.id)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                      >
                        <ExternalLink size={11} /> Aç
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {cases.length > 5 && (
                <p className="mt-1 text-[11px] text-slate-400">+{cases.length - 5} daha…</p>
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
    tone === 'info'   ? 'bg-blue-50 ring-blue-200 text-blue-800' :
    tone === 'danger' ? 'bg-rose-50 ring-rose-200 text-rose-800' :
                         'bg-slate-50 ring-slate-200 text-slate-700';
  return (
    <div className={`rounded-md p-2.5 ring-1 ring-inset ${cls}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      {loading ? (
        <div className="mt-1 h-6 w-8 animate-pulse rounded bg-slate-200" />
      ) : (
        <div className="mt-0.5 text-xl font-semibold">{value}</div>
      )}
    </div>
  );
}
