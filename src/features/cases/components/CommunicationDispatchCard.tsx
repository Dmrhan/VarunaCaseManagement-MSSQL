import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  History,
  Info,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { HelpDrawer, HelpButton } from '@/components/ui/HelpDrawer';
import { caseService } from '@/services/caseService';
import {
  notificationService,
  type CustomerChannelResolution,
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
  const [channelResolution, setChannelResolution] = useState<CustomerChannelResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<NotificationDispatch | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    const [d, ch] = await Promise.all([
      notificationService.listForCase(item.id),
      notificationService.getCustomerChannel(item.id),
    ]);
    setLoading(false);
    setDispatches(d?.value ?? []);
    setChannelResolution(ch ?? null);
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

      {/* WR-D4/D3 Phase 3 — Cevap Kanalı badge + override */}
      {channelResolution && (
        <ChannelBanner
          resolution={channelResolution}
          onOpenOverride={() => setOverrideOpen(true)}
          canOverride={!!item.accountId}
        />
      )}

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

      {overrideOpen && (
        <ChannelOverrideModal
          caseId={item.id}
          currentOverride={item.communicationChannelOverride ?? null}
          resolution={channelResolution}
          onClose={() => setOverrideOpen(false)}
          onSaved={async () => {
            setOverrideOpen(false);
            await refresh();
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}

function ChannelBanner({
  resolution,
  onOpenOverride,
  canOverride,
}: {
  resolution: CustomerChannelResolution;
  onOpenOverride: () => void;
  canOverride: boolean;
}) {
  if (resolution.suppressionReason === 'customer_opted_out') {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
        <div className="flex items-center gap-2">
          <AlertTriangle size={12} className="text-rose-500" />
          <span>
            <strong>Müşteri otomatik bildirim almak istemiyor.</strong> Müşteri-facing
            dispatchler "Suppressed/customer_opted_out" olarak kaydedilir.
          </span>
        </div>
      </div>
    );
  }

  const channelLabel =
    resolution.channel === 'email' ? 'E-posta'
    : resolution.channel === 'phone' ? 'Telefon'
    : resolution.channel === 'portal' ? 'Portal'
    : 'Manuel';
  const Icon = resolution.channel === 'email' ? Mail
    : resolution.channel === 'phone' ? Phone
    : MessageSquare;

  const sourceLabel =
    resolution.source === 'case_override' ? 'vakaya özel override'
    : resolution.source === 'account_company' ? 'şirket tercihi'
    : resolution.source === 'account_contact' ? 'kontak tercihi'
    : resolution.source === 'account_fallback' ? 'müşteri kaydı'
    : 'tanımsız';

  const noChannel = resolution.suppressionReason === 'no_channel_available';

  return (
    <div
      className={`mb-3 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
        noChannel
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon size={12} className="mt-0.5 text-slate-500" />
        <div>
          <div>
            <strong>Cevap Kanalı:</strong> {channelLabel}
            {resolution.identifier && (
              <span className="ml-1 font-mono text-[11px] text-slate-500">
                ({resolution.identifier})
              </span>
            )}
            <span className="ml-1 text-[11px] text-slate-500">— kaynak: {sourceLabel}</span>
          </div>
          {noChannel && (
            <div className="mt-0.5 text-[11px]">
              Yapılandırılmış bir e-posta/telefon yok; operatör mesajı manuel olarak iletir.
            </div>
          )}
        </div>
      </div>
      {canOverride && (
        <button
          type="button"
          onClick={onOpenOverride}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          title="Bu vaka için cevap kanalını değiştir"
        >
          <Pencil size={10} /> Override
        </button>
      )}
    </div>
  );
}

function ChannelOverrideModal({
  caseId,
  currentOverride,
  resolution,
  onClose,
  onSaved,
}: {
  caseId: string;
  currentOverride: string | null;
  resolution: CustomerChannelResolution | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [channel, setChannel] = useState(currentOverride ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const r = await caseService.update(caseId, {
      communicationChannelOverride: channel || null,
    });
    setSaving(false);
    if (r !== undefined) await onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/60">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border">
        <h2 className="mb-2 text-base font-semibold">Cevap Kanalı Override</h2>
        <p className="mb-3 text-xs text-slate-600 dark:text-ndark-muted">
          Bu vaka için müşteri ile hangi kanaldan iletişim kurulacağını değiştir. Override
          yalnız bu vakaya etki eder; AccountCompany tercihini değiştirmez.
        </p>
        {resolution && resolution.source !== 'case_override' && (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
            Şu anki kanal: <strong>{resolution.channel ?? '—'}</strong> ({resolution.source})
          </div>
        )}
        <Field label="Override kanalı">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Override yok (zincire bırak)</option>
            <option value="email">E-posta</option>
            <option value="phone">Telefon</option>
            <option value="manual">Manuel</option>
          </Select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Vazgeç</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </div>
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
