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
 * WR-ACTION-CENTER Phase 1 + WR-NOTIFICATION-CENTER Phase 2A — Single
 * inbox row.
 *
 * Mini-actions per kind:
 *   - approval_pending           → [Vakayı Aç] [Onayla] [Reddet]
 *   - approval_decided           → [Vakayı Aç] [Okundu]
 *   - case_returned_to_assignee  → [Vakayı Aç] [Tamamlandı]
 *   - mention                    → [Yorumu Aç] [Okundu]
 *
 * Snooze + Dismiss available as secondary controls.
 *
 * L3 (planning card §D.2-F + Phase 2A): rows created within the last
 * 30 minutes get a subtle left border (amber for action-required,
 * violet for mention/FYI). No animation; purely CSS.
 *
 * L5 (Phase 2A): mention rows render a deterministic monogram avatar
 * instead of the AtSign icon (Lucide icon is fallback when actor info
 * is fully missing).
 */

const KIND_ICON = {
  approval_pending: ShieldCheck,
  approval_decided: Info,
  case_returned_to_assignee: ShieldX,
  mention: AtSign,
  // WR-NOTIFICATION-CENTER Phase 2B — generic CaseNotification kinds.
  watcher_event: Eye,
  system_alert: AlertTriangle,
} as const;

const KIND_LABEL = {
  approval_pending: 'Çözüm onayı bekliyor',
  approval_decided: 'Çözüm onayı sonuçlandı',
  case_returned_to_assignee: 'Revizyon gerekiyor',
  mention: 'Sözü geçti',
  // Phase 2B labels. reasonLabel (taken verbatim from
  // CaseNotification.payload.message) carries the per-event detail;
  // this title is the calm category header.
  watcher_event: 'Vakada hareket',
  system_alert: 'Sistem uyarısı',
} as const;

// L5 monogram palette — stable hash → index. Random color YASAK; tek
// renk fallback YASAK (yalnız actor info hiç yoksa AtSign icon'a düşer).
const MONOGRAM_PALETTE = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-slate-100 text-slate-700',
] as const;

function stableHashIndex(seed: string, mod: number): number {
  // djb2 — küçük, deterministik, dependency-free.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % mod;
}

/** Extract `actorDisplay` from a mention reasonLabel. Falls back to
 *  generated-by hint if reasonLabel doesn't follow the L4 template. */
function extractActorSeed(item: ActionItem): { seed: string; initials: string } | null {
  // L4 template: `@${actorDisplay} ${caseNumber} yorumunda seni andı: "..."`
  const match = item.reasonLabel?.match(/^@([^\s]+(?:\s[^\s]+)?)\s/);
  if (match && match[1]) {
    const display = match[1];
    const parts = display.split(/\s+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('');
    if (initials) {
      // seed = generatedBy if available (stable per actor user id), else display
      const seed = item.generatedBy?.startsWith('user:')
        ? item.generatedBy.slice('user:'.length)
        : display;
      return { seed, initials };
    }
  }
  // Last resort: generatedBy user id as seed; no initials.
  if (item.generatedBy?.startsWith('user:')) {
    return { seed: item.generatedBy.slice('user:'.length), initials: '' };
  }
  return null;
}

/** Was this row created within the last 30 minutes? */
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

  const Icon = KIND_ICON[item.kind] ?? Info;
  const titleLabel = KIND_LABEL[item.kind] ?? item.kind;
  const isMention = item.kind === 'mention';
  // L5 — mention monogram avatar (stable hash; AtSign fallback if actor
  // info missing entirely).
  const monogram = isMention ? extractActorSeed(item) : null;
  const monogramClass =
    monogram && monogram.initials
      ? MONOGRAM_PALETTE[stableHashIndex(monogram.seed, MONOGRAM_PALETTE.length)]
      : null;
  // L3 — 30-minute "recent" highlight (subtle left border).
  const recent = isRecent(item);

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

  // WR-NOTIFICATION-CENTER Phase 2C P0 — manual unsnooze. Pulls the
  // row back into the active queue without waiting for snoozedUntil to
  // lapse. Drawer event invalidates other surfaces; row's onChanged
  // triggers a silent local refresh (no flicker).
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
      // Next Monday at 9am
      const day = target.getDay(); // 0 = Sun
      const daysUntilMonday = (8 - day) % 7 || 7;
      target.setDate(target.getDate() + daysUntilMonday);
      target.setHours(9, 0, 0, 0);
    }
    void handleSnooze(target);
  }

  const isAction = item.actionRequired && (view === 'action' || view === 'snoozed');

  // L3 recent highlight — applied as an extra left border on top of the
  // existing surface border. Kind-aware color: amber for action,
  // violet for mention/FYI.
  const recentBorder = recent
    ? isAction
      ? 'border-l-2 !border-l-amber-300'
      : 'border-l-2 !border-l-violet-300'
    : '';

  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        isAction
          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/20'
          : 'border-slate-200 bg-slate-50/40 dark:border-ndark-border dark:bg-ndark-bg/30'
      } ${recentBorder}`}
    >
      <div className="flex items-start gap-2">
        {isMention && monogram && monogram.initials ? (
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${monogramClass}`}
            aria-hidden
          >
            {monogram.initials}
          </span>
        ) : (
          <Icon
            size={14}
            className={
              isMention
                ? 'mt-0.5 text-violet-500'
                : isAction
                  ? 'mt-0.5 text-amber-600'
                  : 'mt-0.5 text-slate-500'
            }
          />
        )}
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
                  {isMention ? 'Yorumu Aç' : 'Vakayı Aç'}
                </Button>
              )}
              {isMention && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleMarkDone()}
                  disabled={busy}
                >
                  Okundu
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
              {item.kind === 'case_returned_to_assignee' && (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<CheckCircle2 size={11} />}
                  onClick={() => void handleMarkDone()}
                  disabled={busy}
                >
                  Tamamlandı
                </Button>
              )}
              {/* WR-NOTIFICATION-CENTER Phase 2B — FYI rows migrated
                  from CaseNotification get "Okundu" alongside the
                  shared "Vakayı Aç" button. Same markDone endpoint as
                  approval_decided FYI. */}
              {(item.kind === 'watcher_event' || item.kind === 'system_alert') && (
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

          {/* WR-NOTIFICATION-CENTER Phase 2C P0 — Ertelenen sekmesi
              için ayrı mini-aksiyon bloğu. Kullanıcı snoozedUntil
              gelmeden satırı manuel olarak geri çekebilsin diye
              "Ertelemeyi Kaldır" burada görünür. "Ertele" YOK
              (zaten ertelenmiş satır), "Onayla / Reddet / Okundu /
              Tamamlandı" YOK (ertelenirken aksiyona girilemez —
              önce unsnooze, sonra İşler/Bildirimler'de eylem). */}
          {view === 'snoozed' && item.state === 'Snoozed' && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.caseId && (
                <Button size="sm" variant="outline" onClick={() => onCaseOpen(item.caseId!)} disabled={busy}>
                  {isMention ? 'Yorumu Aç' : 'Vakayı Aç'}
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
