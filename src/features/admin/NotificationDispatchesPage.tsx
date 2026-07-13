import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, History, Info } from 'lucide-react';
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
                      <StateBadge dispatch={d} />
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
            {(viewer.state === 'Failed' || viewer.state === 'Pending') && (() => {
              const reason = resolveDispatchReason(viewer);
              if (!reason) return null;
              const label = viewer.state === 'Failed' ? 'Hata Sebebi' : 'Beklemede Kalma Nedeni';
              const boxClass = viewer.state === 'Failed'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-amber-200 bg-amber-50 text-amber-900';
              return (
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className={`rounded-md border px-3 py-2 text-xs whitespace-pre-wrap break-words ${boxClass}`}>
                    {reason}
                  </div>
                </div>
              );
            })()}
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

/**
 * Failed → SMTP/gönderim hatası (failureReason'dan okunur).
 * Pending → audienceIdentifier deseni + kanaldan çıkarım (kuyruk / adres yok / SMS beklemede).
 * Sent / Suppressed → neden gösterilmez (Suppressed reason'ı zaten metin olarak yanında basılıyor).
 */
function resolveDispatchReason(d: NotificationDispatch): string | null {
  if (d.state === 'Failed') {
    return d.failureReason?.trim() || 'Hata sebebi kaydedilmemiş.';
  }
  if (d.state === 'Pending') {
    const id = (d.audienceIdentifier ?? '').trim().toLowerCase();
    if (id === 'manual' || id === 'unresolved') {
      return 'Alıcı adresi çözülemedi — vakada müşteri iletişim bilgisi yok, otomatik gönderim yapılamıyor.';
    }
    if (id === 'phone') {
      return 'SMS kanalı bu ortamda aktif değil; bildirim beklemede.';
    }
    // Codex P2 — Manual/LogOnly Pending, operatör aksiyonu beklenen kayıttır;
    // "kuyrukta bekliyor" metni yanıltıcı. Yalnız mode=Active'de gönderici
    // pipeline'ının işleyeceği anlamda "kuyrukta" ifadesi geçerli.
    if (d.mode === 'Manual') {
      return 'Operatör manuel onay bekliyor — vaka detayından "Manuel Olarak Hallettim" ile kapatılabilir.';
    }
    if (d.mode === 'LogOnly') {
      return 'Yalnızca kayıt (LogOnly) modu — otomatik gönderim yapılmayacak; kayıt denetim için tutuluyor.';
    }
    if (d.channel === 'Email' && id.includes('@')) {
      return 'Gönderim kuyruğunda, henüz denenmedi.';
    }
    return 'Beklemede.';
  }
  return null;
}

function StateBadge({ dispatch: d }: { dispatch: NotificationDispatch }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const reason = resolveDispatchReason(d);

  // Dışına tıklama / ESC ile kapat. Popover fixed pozisyonlu (portal) —
  // scroll'da yerinde kalmayacak; kapatarak çakışmayı engelliyoruz.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function togglePopover() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Popover'ı ikonun altına yasla; sağa dar ekranda taşarsa max-w ile
    // kendini sıkıştırır. z-[100] modal katmanının üstünde değil (Modal
    // zaten üstte); liste tablosu için yeterli.
    setCoords({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }

  if (d.state === 'Sent') return <Badge tint="emerald">Sent</Badge>;
  if (d.state === 'Suppressed') {
    return (
      <span>
        <Badge tint="slate">Suppressed</Badge>
        {d.suppressionReason && (
          <span className="ml-1 text-[10px] text-slate-400">{d.suppressionReason}</span>
        )}
      </span>
    );
  }
  if (d.state === 'Pending' || d.state === 'Failed') {
    const tint = d.state === 'Pending' ? 'amber' : 'rose';
    const label = d.state === 'Pending' ? 'Beklemede kalma nedeni' : 'Hata sebebi';
    return (
      <span className="inline-flex items-center gap-1">
        <Badge tint={tint}>{d.state}</Badge>
        {reason && (
          <>
            <button
              ref={btnRef}
              type="button"
              title={`${label}: ${reason}`}
              aria-label={`${label}: ${reason}`}
              aria-expanded={open}
              onClick={togglePopover}
              className="inline-flex cursor-pointer items-center text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300 rounded dark:text-ndark-dim dark:hover:text-ndark-fg"
            >
              <Info size={12} aria-hidden="true" />
            </button>
            {open && coords && createPortal(
              <div
                ref={popRef}
                role="tooltip"
                style={{ top: coords.top, left: coords.left }}
                className="fixed z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-fg"
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </div>
                <div className="whitespace-pre-wrap break-words">
                  {reason}
                </div>
              </div>,
              document.body,
            )}
          </>
        )}
      </span>
    );
  }
  return <Badge tint="slate">{d.state}</Badge>;
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
