import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Info,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TextArea } from '@/components/ui/Field';
import {
  actionCenterService,
  emitActionCenterChanged,
  type ActionItem,
  type ActionCenterView,
} from '@/services/actionCenterService';
import { approvalService } from '@/services/approvalService';

/**
 * WR-ACTION-CENTER Phase 1 — Single inbox row.
 *
 * Mini-actions per kind:
 *   - approval_pending           → [Vakayı Aç] [Onayla] [Reddet]
 *   - approval_decided           → [Vakayı Aç] [Okundu]
 *   - case_returned_to_assignee  → [Vakayı Aç]
 *
 * Snooze + Dismiss available as secondary controls.
 */

const KIND_ICON = {
  approval_pending: ShieldCheck,
  approval_decided: Info,
  case_returned_to_assignee: ShieldX,
} as const;

const KIND_LABEL = {
  approval_pending: 'Çözüm Onayı Bekliyor',
  approval_decided: 'Onay sonuçlandı',
  case_returned_to_assignee: 'Reddedildi — revize',
} as const;

export function ActionItemRow({
  item,
  view,
  onCaseOpen,
  onChanged,
}: {
  item: ActionItem;
  view: ActionCenterView;
  onCaseOpen: (caseId: string) => void;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');

  const Icon = KIND_ICON[item.kind] ?? Info;
  const titleLabel = KIND_LABEL[item.kind] ?? item.kind;

  async function handleApprove() {
    if (!item.objectId) return;
    setBusy(true);
    const r = await approvalService.approve(item.objectId);
    setBusy(false);
    if (r) {
      emitActionCenterChanged();
      onChanged?.();
    }
  }

  async function handleReject() {
    if (!item.objectId || !rejectReason.trim()) return;
    setBusy(true);
    const r = await approvalService.reject(item.objectId, {
      rejectionReason: rejectReason.trim(),
    });
    setBusy(false);
    if (r) {
      setRejectOpen(false);
      setRejectReason('');
      emitActionCenterChanged();
      onChanged?.();
    }
  }

  async function handleMarkDone() {
    setBusy(true);
    const r = await actionCenterService.markDone(item.id, { outcome: 'acknowledged' });
    setBusy(false);
    if (r) {
      emitActionCenterChanged();
      onChanged?.();
    }
  }

  async function handleSnooze(snoozedUntil: Date) {
    setBusy(true);
    const r = await actionCenterService.snooze(item.id, {
      snoozedUntil: snoozedUntil.toISOString(),
    });
    setBusy(false);
    if (r) {
      setSnoozeOpen(false);
      emitActionCenterChanged();
      onChanged?.();
    }
  }

  async function handleDismiss() {
    setBusy(true);
    const r = await actionCenterService.dismiss(item.id, {
      closeNote: closeNote.trim() || undefined,
    });
    setBusy(false);
    if (r) {
      setDismissOpen(false);
      setCloseNote('');
      emitActionCenterChanged();
      onChanged?.();
    }
  }

  function presetSnooze(presetKey: 'hour' | 'tomorrow' | 'monday') {
    const now = new Date();
    let target: Date;
    if (presetKey === 'hour') {
      target = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (presetKey === 'tomorrow') {
      target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
    } else {
      target = new Date(now);
      // Next Monday at 9am
      const day = target.getDay(); // 0 = Sun
      const daysUntilMonday = (8 - day) % 7 || 7;
      target.setDate(target.getDate() + daysUntilMonday);
      target.setHours(9, 0, 0, 0);
    }
    void handleSnooze(target);
  }

  const isAction = item.actionRequired && (view === 'action' || view === 'snoozed');

  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        isAction
          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/20'
          : 'border-slate-200 bg-slate-50/40 dark:border-ndark-border dark:bg-ndark-bg/30'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className={isAction ? 'mt-0.5 text-amber-600' : 'mt-0.5 text-slate-500'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="font-medium text-slate-800 dark:text-ndark-text">{titleLabel}</span>
            {item.caseNumber && <Badge tint="slate">{item.caseNumber}</Badge>}
            {item.state === 'InProgress' && <Badge tint="slate">çalışıyor</Badge>}
            {item.state === 'Snoozed' && <Badge tint="amber">ertelendi</Badge>}
            {item.state === 'Done' && <Badge tint="emerald">yapıldı</Badge>}
            {item.state === 'Dismissed' && <Badge tint="slate">yok sayıldı</Badge>}
            {item.state === 'Expired' && <Badge tint="slate">geçersiz</Badge>}
          </div>
          {item.caseTitle && (
            <div className="mt-0.5 truncate text-[12px] text-slate-600 dark:text-ndark-muted">
              {item.caseTitle}
            </div>
          )}
          <div className="mt-1 flex items-start gap-1 text-[11px] text-slate-500 dark:text-ndark-muted">
            <Info size={10} className="mt-0.5 shrink-0" />
            <span>{item.reasonLabel}</span>
          </div>
          {item.closeNote && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-ndark-muted">
              Not: {item.closeNote}
            </div>
          )}
          {/* Mini actions (only in active views) */}
          {(view === 'action' || view === 'fyi') && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.caseId && (
                <Button size="sm" variant="outline" onClick={() => onCaseOpen(item.caseId!)} disabled={busy}>
                  Vakayı Aç
                </Button>
              )}
              {item.kind === 'approval_pending' && item.objectId && (
                <>
                  <Button
                    size="sm"
                    leftIcon={<CheckCircle2 size={11} />}
                    onClick={() => void handleApprove()}
                    disabled={busy}
                  >
                    Onayla
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<ShieldX size={11} />}
                    onClick={() => setRejectOpen(true)}
                    disabled={busy}
                  >
                    Reddet
                  </Button>
                </>
              )}
              {item.kind === 'approval_decided' && (
                <Button size="sm" variant="outline" onClick={() => void handleMarkDone()} disabled={busy}>
                  Okundu
                </Button>
              )}
              <Button size="sm" variant="ghost" leftIcon={<Clock size={11} />} onClick={() => setSnoozeOpen((v) => !v)} disabled={busy}>
                Ertele
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<XCircle size={11} />} onClick={() => setDismissOpen((v) => !v)} disabled={busy}>
                Yok Say
              </Button>
            </div>
          )}

          {/* Snooze preset row */}
          {snoozeOpen && (
            <div className="mt-2 flex flex-wrap gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] dark:border-blue-800 dark:bg-blue-950/30">
              <span className="text-blue-900 dark:text-blue-200">Ne kadar?</span>
              <button type="button" className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100" onClick={() => presetSnooze('hour')} disabled={busy}>1 saat</button>
              <button type="button" className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100" onClick={() => presetSnooze('tomorrow')} disabled={busy}>Yarın 09:00</button>
              <button type="button" className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100" onClick={() => presetSnooze('monday')} disabled={busy}>Pazartesi 09:00</button>
              <button type="button" className="rounded border border-transparent px-1.5 py-0.5 text-blue-900 hover:underline" onClick={() => setSnoozeOpen(false)} disabled={busy}>vazgeç</button>
            </div>
          )}

          {/* Reject modal-like inline */}
          {rejectOpen && (
            <div className="mt-2 space-y-2 rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2 text-xs dark:border-rose-900/50 dark:bg-rose-950/20">
              <div className="font-medium text-rose-900 dark:text-rose-200">Red gerekçesi</div>
              <TextArea
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Neden reddediyorsun? — submitter görür."
              />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy}>Vazgeç</Button>
                <Button size="sm" onClick={() => void handleReject()} disabled={busy || !rejectReason.trim()}>
                  {busy ? 'Reddediliyor…' : 'Reddet'}
                </Button>
              </div>
            </div>
          )}

          {/* Dismiss inline */}
          {dismissOpen && (
            <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-ndark-border dark:bg-ndark-bg/40">
              <div className="font-medium text-slate-800 dark:text-ndark-text">Yok say</div>
              <TextArea
                rows={2}
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                placeholder="Not (opsiyonel) — neden yok saydığını yazabilirsin."
              />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setDismissOpen(false)} disabled={busy}>Vazgeç</Button>
                <Button size="sm" onClick={() => void handleDismiss()} disabled={busy}>
                  {busy ? 'Kaydediliyor…' : 'Yok Say'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ActionItemRow;
