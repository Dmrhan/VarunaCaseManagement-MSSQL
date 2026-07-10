import { useEffect, useMemo, useState } from 'react';
import { Eye, History } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  notificationService,
  type DispatchState,
  type NotificationDispatch,
  type NotificationEvent,
} from '@/services/notificationService';
import { lookupService } from '@/services/caseService';
import { AdminListLayout } from './AdminListLayout';
import { NOTIFICATION_DISPATCHES_HELP } from './helpContents';

/**
 * WR-D4 Phase 2 — Dispatch viewer (read-only audit).
 *
 * Audience: Supervisor/CSM/Admin/SystemAdmin (per product decision).
 * Filters: company, event, state.
 * Click row → snapshot subject + body modal.
 *
 * No mutation surfaces here — manual-confirm lives on CaseDetail.
 */

const EVENT_OPTIONS: NotificationEvent[] = [
  'resolution_submitted',
  'resolution_approved',
  'resolution_rejected',
  'case_closed',
  'case_reopened',
];

const STATE_OPTIONS: DispatchState[] = ['Pending', 'Sent', 'Failed', 'Suppressed'];

export function NotificationDispatchesPage({ initialState = '' }: {
  /** Sistem Sağlığı drill-down'ı — sayfa bu state filtresiyle açılır (opsiyonel, geri uyumlu). */
  initialState?: DispatchState | '';
} = {}) {
  const [items, setItems] = useState<NotificationDispatch[]>([]);
  const [total, setTotal] = useState(0);
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [filterEvent, setFilterEvent] = useState<NotificationEvent | ''>('');
  const [filterState, setFilterState] = useState<DispatchState | ''>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<NotificationDispatch | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const r = await notificationService.listDispatches({
      companyId: filterCompanyId ?? undefined,
      event: filterEvent || undefined,
      state: filterState || undefined,
      limit: 200,
    });
    if (r) {
      setItems(r.value);
      setTotal(r.total);
    } else {
      setError('Bildirim kayıtları yüklenemedi.');
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCompanyId, filterEvent, filterState]);

  const companies = useMemo(() => lookupService.companies(), []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <AdminListLayout
        title="Bildirim Kayıtları"
        description="Her olay tetiklenmesinde yazılan kalıcı denetim satırları. Snapshot Konu/Gövde değiştirilemez."
        count={total}
        searchEnabled={false}
        helpTitle={NOTIFICATION_DISPATCHES_HELP.title}
        helpSections={NOTIFICATION_DISPATCHES_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <CompanySelector value={filterCompanyId} onChange={setFilterCompanyId} allowAll label="Şirket" />
            </div>
            <div className="w-52">
              <Field label="Event">
                <Select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value as NotificationEvent | '')}>
                  <option value="">Tümü</option>
                  {EVENT_OPTIONS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-52">
              <Field label="State">
                <Select value={filterState} onChange={(e) => setFilterState(e.target.value as DispatchState | '')}>
                  <option value="">Tümü</option>
                  {STATE_OPTIONS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        }
      >
        {items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<History size={28} />}
              title="Kayıt yok"
              description="Henüz hiç event tetiklenmedi veya filtrelere uyan satır bulunamadı."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-dim">
                <tr>
                  <th className="px-3 py-2">Zaman</th>
                  <th className="px-3 py-2">Şirket</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Kural</th>
                  <th className="px-3 py-2">Audience</th>
                  <th className="px-3 py-2">Kanal / Mode</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2 text-right">Görüntüle</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 dark:border-ndark-border/60">
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(d.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-600">{companyName(d.companyId)}</td>
                    <td className="px-3 py-2"><Badge tint="slate">{d.event}</Badge></td>
                    <td className="px-3 py-2 text-xs text-slate-600">{d.ruleNameSnapshot}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-slate-600">{d.audienceType}</div>
                      <div className="text-[11px] text-slate-400">{maskIdentifier(d.audienceIdentifier, d.audienceType)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tint="slate">{d.channel}</Badge>
                      <Badge tint={d.mode === 'Manual' ? 'amber' : 'slate'}>{d.mode}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <StateBadge state={d.state} reason={d.suppressionReason} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setViewer(d)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-bg"
                      >
                        <Eye size={12} /> Görüntüle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {viewer && (
        <Modal
          open
          onClose={() => setViewer(null)}
          title={`Snapshot — ${viewer.ruleNameSnapshot}`}
          size="lg"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><strong>Event:</strong> {viewer.event}</div>
              <div><strong>Audience:</strong> {viewer.audienceType} — {maskIdentifier(viewer.audienceIdentifier, viewer.audienceType)}</div>
              <div><strong>Kanal:</strong> {viewer.channel}</div>
              <div><strong>Mode:</strong> {viewer.mode}</div>
              <div><strong>State:</strong> {viewer.state} {viewer.suppressionReason ? `(${viewer.suppressionReason})` : ''}</div>
              <div><strong>Template:</strong> {viewer.templateKeySnapshot} v{viewer.templateVersionSnapshot}</div>
              <div><strong>Oluşturulma:</strong> {fmtDate(viewer.createdAt)}</div>
              <div><strong>Karar:</strong> {viewer.confirmedAt ? fmtDate(viewer.confirmedAt) : '—'}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Konu</div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium dark:border-ndark-border dark:bg-ndark-bg/40">
                {viewer.snapshotSubject}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gövde</div>
              <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-sans text-xs dark:border-ndark-border dark:bg-ndark-bg/40">
                {viewer.snapshotBody}
              </pre>
            </div>
            {viewer.deliveryNote && (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teslimat notu</div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {viewer.deliveryNote}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function StateBadge({ state, reason }: { state: DispatchState; reason: string | null }) {
  if (state === 'Sent') return <Badge tint="emerald">Sent</Badge>;
  if (state === 'Pending') return <Badge tint="amber">Pending</Badge>;
  if (state === 'Failed') return <Badge tint="rose">Failed</Badge>;
  if (state === 'Suppressed') {
    return (
      <span>
        <Badge tint="slate">Suppressed</Badge>
        {reason && <span className="ml-1 text-[10px] text-slate-400">{reason}</span>}
      </span>
    );
  }
  return <Badge tint="slate">{state}</Badge>;
}

function maskIdentifier(id: string, type: string): string {
  if (id === 'unresolved') return 'çözülemedi';
  if (type === 'customer_primary_contact' || type === 'static_email') {
    // Mask middle of email/phone
    if (id.includes('@')) {
      const [a, b] = id.split('@');
      return `${a.slice(0, 2)}***@${b}`;
    }
    if (id.length > 4) return `${id.slice(0, 2)}***${id.slice(-2)}`;
  }
  return id;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
