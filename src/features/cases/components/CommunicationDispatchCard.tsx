import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  History,
  Info,
  Mail,
  MessageSquare,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { HelpDrawer, HelpButton } from '@/components/ui/HelpDrawer';
import {
  notificationService,
  type NotificationDispatch,
} from '@/services/notificationService';
import { CASE_DETAIL_COMMUNICATION_HELP } from '@/features/admin/helpContents';
import type { Case } from '../types';

/**
 * WR-D4/D3 Phase 2 — CaseDetail communication dispatch card.
 *
 * Renders the per-case NotificationDispatch list. For each Pending row:
 *  - Copy subject+body to clipboard
 *  - Open mailto: draft (when audienceIdentifier looks like an email)
 *  - "Handled externally" — manual-confirm modal with REQUIRED delivery note
 *
 * Card is silent (returns null) when there are no dispatches for this
 * case — most cases without a matching rule produce zero rows.
 *
 * Hard rules from the planning card + product decisions:
 *  - No "Send now" surface anywhere (Phase 2 = no active delivery)
 *  - Delivery note is REQUIRED before manual-confirm (audit integrity)
 *  - Snapshot subject + body are immutable; UI displays as read-only
 */

export function CommunicationDispatchCard({
  item,
  onChanged,
}: {
  item: Case;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [dispatches, setDispatches] = useState<NotificationDispatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<NotificationDispatch | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await notificationService.listForCase(item.id);
    setLoading(false);
    setDispatches(r?.value ?? []);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  if (loading || !dispatches || dispatches.length === 0) return null;

  const pending = dispatches.filter((d) => d.state === 'Pending');
  const past = dispatches.filter((d) => d.state !== 'Pending');

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
            İletişim Bildirimleri
          </h3>
          {pending.length > 0 && <Badge tint="amber">{pending.length} bekliyor</Badge>}
          <Badge tint="slate">otomatik gönderim yok</Badge>
        </div>
        <HelpButton onClick={() => setHelpOpen((v) => !v)} active={helpOpen} />
      </div>

      {pending.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <Info size={12} className="mt-0.5 shrink-0 text-blue-500" />
          <span>
            Varuna mesajı kendiliğinden göndermez. Aşağıdaki butonlarla mesajı
            iletip <strong>Manuel Olarak Hallettim</strong> ile audit kaydını kapatın;
            Teslimat notu zorunludur.
          </span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((d) => (
            <PendingDispatchRow
              key={d.id}
              dispatch={d}
              onConfirmClick={() => setConfirmTarget(d)}
              onCopied={() => toast({ type: 'success', message: 'Mesaj kopyalandı.', duration: 1500 })}
            />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-500 dark:text-ndark-muted">
            Geçmiş ({past.length}) <History size={12} className="inline" />
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((d) => (
              <li key={d.id} className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-ndark-border dark:bg-ndark-bg/40">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1">
                    <StateBadge state={d.state} />
                    <span className="text-slate-600">{d.ruleNameSnapshot}</span>
                    <Badge tint="slate">{d.channel}</Badge>
                  </span>
                  <span className="text-slate-400">{fmtDate(d.confirmedAt ?? d.createdAt)}</span>
                </div>
                {d.deliveryNote && (
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    <strong>Not:</strong> {d.deliveryNote}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirmTarget && (
        <ManualConfirmModal
          dispatch={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onConfirmed={async () => {
            setConfirmTarget(null);
            await refresh();
            onChanged?.();
          }}
        />
      )}

      <HelpDrawer
        open={helpOpen}
        title={CASE_DETAIL_COMMUNICATION_HELP.title}
        sections={CASE_DETAIL_COMMUNICATION_HELP.sections}
        onClose={() => setHelpOpen(false)}
      />
    </section>
  );
}

function PendingDispatchRow({
  dispatch,
  onConfirmClick,
  onCopied,
}: {
  dispatch: NotificationDispatch;
  onConfirmClick: () => void;
  onCopied: () => void;
}) {
  const isEmailAddress = /@/.test(dispatch.audienceIdentifier);
  const isUnresolved = dispatch.audienceIdentifier === 'unresolved';
  const mailtoHref = isEmailAddress && dispatch.channel === 'Email'
    ? `mailto:${encodeURIComponent(dispatch.audienceIdentifier)}?subject=${encodeURIComponent(dispatch.snapshotSubject)}&body=${encodeURIComponent(dispatch.snapshotBody)}`
    : null;

  async function copyMessage() {
    const combined = `${dispatch.snapshotSubject}\n\n${dispatch.snapshotBody}`;
    try {
      await navigator.clipboard.writeText(combined);
      onCopied();
    } catch {
      // Fallback: select + execCommand is gone; just notify of failure.
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tint="amber">Bekliyor</Badge>
            <Badge tint="slate">{dispatch.channel}</Badge>
            <Badge tint={dispatch.mode === 'Manual' ? 'amber' : 'slate'}>{dispatch.mode}</Badge>
            <span className="text-slate-500">{dispatch.ruleNameSnapshot}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-ndark-muted">
            Alıcı: {dispatch.audienceType}
            {!isUnresolved && (
              <span className="ml-1 font-mono">{dispatch.audienceIdentifier}</span>
            )}
            {isUnresolved && <span className="ml-1 text-rose-600">çözülemedi</span>}
          </div>
        </div>
      </div>

      <div className="mb-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-ndark-border dark:bg-ndark-card">
        <div className="mb-1 font-semibold text-slate-800 dark:text-ndark-text">{dispatch.snapshotSubject}</div>
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-slate-700 dark:text-ndark-muted">{dispatch.snapshotBody}</pre>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button size="sm" variant="outline" leftIcon={<Copy size={11} />} onClick={() => void copyMessage()}>
          Mesajı Kopyala
        </Button>
        {mailtoHref && (
          <a
            href={mailtoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            <Mail size={11} /> Mail Taslağı Aç
            <ExternalLink size={10} className="text-slate-400" />
          </a>
        )}
        <Button size="sm" leftIcon={<CheckCircle2 size={11} />} onClick={onConfirmClick}>
          Manuel Olarak Hallettim
        </Button>
      </div>
    </div>
  );
}

function ManualConfirmModal({
  dispatch,
  onClose,
  onConfirmed,
}: {
  dispatch: NotificationDispatch;
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!note.trim()) return;
    setSaving(true);
    const r = await notificationService.manualConfirm(dispatch.id, {
      deliveryNote: note.trim(),
    });
    setSaving(false);
    if (r) await onConfirmed();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/60">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Send size={16} className="text-violet-600" />
          Manuel Onay
        </h2>
        <p className="mb-3 text-xs text-slate-600 dark:text-ndark-muted">
          Bu mesajı operatör olarak <strong>{dispatch.audienceType}</strong> alıcısına ulaştırdığını
          onayla. Audit kalıcı tutar; sonradan değiştirilemez.
        </p>
        <Field label="Teslimat notu" required hint="Örn. &quot;Telefonla aradım, müşteri kabul etti.&quot; / &quot;14:32 e-posta gönderildi.&quot;">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Vazgeç</Button>
          <Button onClick={() => void handleConfirm()} disabled={saving || !note.trim()}>
            {saving ? 'Kaydediliyor…' : 'Onayla ve Kaydet'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === 'Sent') return <Badge tint="emerald">Sent</Badge>;
  if (state === 'Failed') return <Badge tint="rose">Failed</Badge>;
  if (state === 'Suppressed') return <Badge tint="slate">Suppressed</Badge>;
  return <Badge tint="slate">{state}</Badge>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
