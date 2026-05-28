import { useState } from 'react';
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  Clock,
  Eye,
  Info,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TextArea } from '@/components/ui/Field';
import { formatRowTime } from '@/lib/format';
import {
  actionCenterService,
  emitActionCenterChanged,
  type ActionItem,
  type ActionItemKind,
  type ActionCenterView,
} from '@/services/actionCenterService';
import { approvalService } from '@/services/approvalService';

/**
 * WR-ACTION-CENTER Phase 1 + WR-NOTIFICATION-CENTER UX redesign.
 *
 * Row anatomy (top-down, single column to stay wrap-safe at 420px):
 *
 *   icon/avatar  primary line  (kind label · case badge)
 *                secondary     (case title)
 *                preview       (reasonLabel, clamp-2)
 *                meta          (relative time · status pill)
 *
 *   actions row  (wrap-friendly; primary fill, outline, ghost)
 *
 * Mini-actions per kind preserved verbatim from the previous version.
 * Inline reject/dismiss/snooze sub-cards expand below actions.
 */

interface KindStyle {
  icon: LucideIcon;
  label: string;
  /** Icon container classes — bg + text + ring */
  iconBox: string;
}

const KIND_STYLE: Record<ActionItemKind, KindStyle> = {
  approval_pending: {
    icon: ShieldCheck,
    label: 'Çözüm onayı bekliyor',
    iconBox:
      'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40',
  },
  case_returned_to_assignee: {
    icon: ShieldX,
    label: 'Revizyon gerekiyor',
    iconBox:
      'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40',
  },
  approval_decided: {
    icon: CheckCircle2,
    label: 'Çözüm onayı sonuçlandı',
    iconBox:
      'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40',
  },
  mention: {
    icon: AtSign,
    label: 'Senden bahsedildi',
    iconBox:
      'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/40',
  },
  watcher_event: {
    icon: Eye,
    label: 'Vakada hareket',
    iconBox:
      'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900/40',
  },
  system_alert: {
    icon: AlertTriangle,
    label: 'Sistem uyarısı',
    iconBox:
      'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40',
  },
};

// Monogram palette — stable hash. Random color forbidden.
const MONOGRAM_PALETTE = [
  'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-900/50',
  'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-900/50',
  'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-900/50',
  'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-900/50',
  'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-ndark-bg dark:text-ndark-muted dark:ring-ndark-border',
] as const;

function stableHashIndex(seed: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % mod;
}

/** Extract actor display from mention reasonLabel.
 *  Template: `@${actorDisplay} ${caseNumber} yorumunda senden bahsetti: "..."` */
function extractActorSeed(item: ActionItem): { seed: string; initials: string } | null {
  const match = item.reasonLabel?.match(/^@([^\s]+(?:\s[^\s]+)?)\s/);
  if (match && match[1]) {
    const display = match[1];
    const parts = display.split(/\s+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('');
    if (initials) {
      const seed = item.generatedBy?.startsWith('user:')
        ? item.generatedBy.slice('user:'.length)
        : display;
      return { seed, initials };
    }
  }
  if (item.generatedBy?.startsWith('user:')) {
    return { seed: item.generatedBy.slice('user:'.length), initials: '' };
  }
  return null;
}

function isRecent(item: ActionItem): boolean {
  if (!item.createdAt) return false;
  const ageMs = Date.now() - new Date(item.createdAt).getTime();
  return ageMs >= 0 && ageMs < 30 * 60 * 1000;
}

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

  const style = KIND_STYLE[item.kind] ?? {
    icon: Info,
    label: item.kind,
    iconBox: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  };
  const Icon = style.icon;
  const titleLabel = style.label;
  const isMention = item.kind === 'mention';
  const isAction = item.actionRequired && (view === 'action' || view === 'snoozed');
  const recent = isRecent(item);

  // Mention monogram (stable hash; falls back to AtSign tint when actor
  // info is missing entirely).
  const monogram = isMention ? extractActorSeed(item) : null;
  const monogramClass =
    monogram && monogram.initials
      ? MONOGRAM_PALETTE[stableHashIndex(monogram.seed, MONOGRAM_PALETTE.length)]
      : null;

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

  // WR-NOTIFICATION-CENTER Phase 2C P0 — manual unsnooze.
  async function handleUnsnooze() {
    setBusy(true);
    const r = await actionCenterService.unsnooze(item.id);
    setBusy(false);
    if (r) {
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
      const day = target.getDay(); // 0 = Sun
      const daysUntilMonday = (8 - day) % 7 || 7;
      target.setDate(target.getDate() + daysUntilMonday);
      target.setHours(9, 0, 0, 0);
    }
    void handleSnooze(target);
  }

  // Container background — calm, kind-aware.
  // Amber tint for action-required rows; very subtle rose for fresh
  // system_alert (Pending/InProgress) so it draws the eye without
  // shouting; otherwise neutral.
  const containerBg = isAction
    ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30'
    : item.kind === 'system_alert' && (item.state === 'Pending' || item.state === 'InProgress')
      ? 'border-rose-200 bg-rose-50/30 hover:bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/15 dark:hover:bg-rose-950/25'
      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-bg/20 dark:hover:bg-ndark-bg/40';

  // Recent left border — subtle, no pulse. Kind-aware:
  //   action  → amber-300
  //   mention → violet-300
  //   system_alert (fresh) → rose-300
  //   others  → no recent border (low-signal kinds don't need it)
  let recentBorder = '';
  if (recent) {
    if (isAction) recentBorder = 'border-l-2 !border-l-amber-300';
    else if (isMention) recentBorder = 'border-l-2 !border-l-violet-300';
    else if (item.kind === 'system_alert' && (item.state === 'Pending' || item.state === 'InProgress'))
      recentBorder = 'border-l-2 !border-l-rose-300';
  }

  // Status pill — only when meaningful.
  let statusPill: { tint: 'amber' | 'emerald' | 'slate'; label: string } | null = null;
  if (item.state === 'Snoozed') statusPill = { tint: 'amber', label: 'ertelendi' };
  else if (item.state === 'Done') statusPill = { tint: 'emerald', label: 'tamamlandı' };
  else if (item.state === 'Dismissed') statusPill = { tint: 'slate', label: 'yok sayıldı' };
  else if (item.state === 'Expired') statusPill = { tint: 'slate', label: 'geçersiz' };
  else if (item.state === 'InProgress') statusPill = { tint: 'slate', label: 'çalışıyor' };

  const openLabel = isMention ? 'Yorumu Aç' : 'Vakayı Aç';

  return (
    <div className={`rounded-md border px-3 py-2.5 transition-colors ${containerBg} ${recentBorder}`}>
      <div className="flex items-start gap-3">
        {/* ── Icon / Avatar ── */}
        {isMention && monogram && monogram.initials ? (
          <span
            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset ${monogramClass}`}
            aria-hidden
          >
            {monogram.initials}
          </span>
        ) : (
          <span
            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.iconBox}`}
            aria-hidden
          >
            <Icon size={13} />
          </span>
        )}

        {/* ── Main column ── */}
        <div className="min-w-0 flex-1">
          {/* Primary line */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-semibold leading-5 text-slate-900 dark:text-ndark-text">
              {titleLabel}
            </span>
            {item.caseNumber && (
              <Badge tint="slate" className="font-mono text-[10.5px]">
                {item.caseNumber}
              </Badge>
            )}
          </div>

          {/* Secondary — case title */}
          {item.caseTitle && (
            <div className="mt-0.5 truncate text-[12px] text-slate-600 dark:text-ndark-muted">
              {item.caseTitle}
            </div>
          )}

          {/* Preview — clamp 2 lines */}
          {item.reasonLabel && (
            <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-slate-600 dark:text-ndark-muted">
              {item.reasonLabel}
            </div>
          )}

          {/* Optional closeNote — only when present (done/dismissed) */}
          {item.closeNote && (
            <div className="mt-1 line-clamp-2 text-[11px] italic leading-snug text-slate-500 dark:text-ndark-muted">
              Not: {item.closeNote}
            </div>
          )}

          {/* Meta strip — relative time + optional status pill */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
            <span className="tabular-nums">{formatRowTime(item.createdAt)}</span>
            {statusPill && (
              <Badge tint={statusPill.tint} className="text-[10px]">
                {statusPill.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Action zone — view-aware ── */}
      {(view === 'action' || view === 'fyi') && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {/* Primary action(s) first — most prominent */}
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
          {item.kind === 'case_returned_to_assignee' && (
            <Button
              size="sm"
              leftIcon={<CheckCircle2 size={11} />}
              onClick={() => void handleMarkDone()}
              disabled={busy}
            >
              Tamamlandı
            </Button>
          )}

          {/* Open case / open comment */}
          {item.caseId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCaseOpen(item.caseId!)}
              disabled={busy}
            >
              {openLabel}
            </Button>
          )}

          {/* Read acknowledge — FYI rows */}
          {(item.kind === 'mention' ||
            item.kind === 'approval_decided' ||
            item.kind === 'watcher_event' ||
            item.kind === 'system_alert') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleMarkDone()}
              disabled={busy}
            >
              Okundu
            </Button>
          )}

          {/* Tertiary — secondary controls */}
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Clock size={11} />}
            onClick={() => setSnoozeOpen((v) => !v)}
            disabled={busy}
          >
            Ertele
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<XCircle size={11} />}
            onClick={() => setDismissOpen((v) => !v)}
            disabled={busy}
          >
            Yok Say
          </Button>
        </div>
      )}

      {/* Snoozed view — manual unsnooze. */}
      {view === 'snoozed' && item.state === 'Snoozed' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {item.caseId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCaseOpen(item.caseId!)}
              disabled={busy}
            >
              {openLabel}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            leftIcon={<RotateCcw size={11} />}
            onClick={() => void handleUnsnooze()}
            disabled={busy}
          >
            Ertelemeyi Kaldır
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<XCircle size={11} />}
            onClick={() => setDismissOpen((v) => !v)}
            disabled={busy}
          >
            Yok Say
          </Button>
        </div>
      )}

      {/* Done view — passive, only navigation. No state change. */}
      {view === 'done' && item.caseId && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCaseOpen(item.caseId!)}
            disabled={busy}
          >
            {openLabel}
          </Button>
        </div>
      )}

      {/* Snooze preset inline */}
      {snoozeOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] dark:border-blue-900/50 dark:bg-blue-950/30">
          <span className="text-blue-900 dark:text-blue-200">Ne kadar?</span>
          <button
            type="button"
            className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-ndark-bg dark:text-blue-200 dark:hover:bg-blue-900/40"
            onClick={() => presetSnooze('hour')}
            disabled={busy}
          >
            1 saat
          </button>
          <button
            type="button"
            className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-ndark-bg dark:text-blue-200 dark:hover:bg-blue-900/40"
            onClick={() => presetSnooze('tomorrow')}
            disabled={busy}
          >
            Yarın 09:00
          </button>
          <button
            type="button"
            className="rounded border border-blue-200 bg-white px-1.5 py-0.5 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-ndark-bg dark:text-blue-200 dark:hover:bg-blue-900/40"
            onClick={() => presetSnooze('monday')}
            disabled={busy}
          >
            Pazartesi 09:00
          </button>
          <button
            type="button"
            className="rounded border border-transparent px-1.5 py-0.5 text-blue-900 hover:underline dark:text-blue-200"
            onClick={() => setSnoozeOpen(false)}
            disabled={busy}
          >
            vazgeç
          </button>
        </div>
      )}

      {/* Reject inline panel */}
      {rejectOpen && (
        <div className="mt-2 space-y-2 rounded-md border border-rose-200 bg-rose-50/50 px-3 py-2 text-xs dark:border-rose-900/50 dark:bg-rose-950/20">
          <div className="font-medium text-rose-900 dark:text-rose-200">Red gerekçesi</div>
          <TextArea
            rows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Neden reddediyorsun? — submitter görür."
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button size="sm" onClick={() => void handleReject()} disabled={busy || !rejectReason.trim()}>
              {busy ? 'Reddediliyor…' : 'Reddet'}
            </Button>
          </div>
        </div>
      )}

      {/* Dismiss inline panel */}
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
            <Button size="sm" variant="ghost" onClick={() => setDismissOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button size="sm" onClick={() => void handleDismiss()} disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Yok Say'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ActionItemRow;
