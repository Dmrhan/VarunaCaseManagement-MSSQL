/**
 * L1WorkbenchPanel — Phase 2F.
 *
 * Operational workbench for the L1 Case Resolution Console. Sections
 * are now a mix of read-only previews (Şu an / Sorun / Bağlantılar)
 * and fully wired reuses (Statü ve Kapanış / Çalışma / Kanıt). Every
 * mutation flows through the same backend endpoints CaseDetailPage
 * already uses — no second state machine, no second notes/files
 * system.
 *
 * Sections (top → bottom):
 *   1. Şu an              — current operational state snapshot
 *   2. Statü ve Kapanış   — StatusTransitionPanel (reused) — state
 *                            machine + required fields + AI draft
 *   3. Sorun              — problem definition (read-only)
 *   4. Çalışma            — full Notes experience (composer + thread)
 *   5. Kanıt / Dosyalar   — full Files experience (upload + list)
 *   6. Bağlantılar / Çağrı — linked cases + call log compact preview
 *
 * After a successful status transition the panel calls `onItemUpdate`
 * which flows up to L1CaseResolutionConsole → setItem; CommandBar +
 * DecisionRail re-render with the new status automatically.
 */

import {
  Activity,
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  MessageSquare,
  PhoneCall,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, PriorityBadge } from '@/components/ui/StatusPill';
import { formatRelative, formatDateTime } from '@/lib/format';
import type { Case } from '../types';
import { StatusTransitionPanel } from '../StatusTransitionPanel';
import { CaseNotesSection } from '../components/CaseNotes';
import { FilesTab } from '../components/CaseFiles';


function Section({
  title,
  icon,
  rightSlot,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 dark:border-ndark-border/60">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
          <span className="text-slate-500 dark:text-ndark-muted">{icon}</span>
          {title}
        </div>
        {rightSlot}
      </header>
      <div className="px-3 py-2.5 text-sm text-slate-700 dark:text-ndark-text">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] italic text-slate-500 dark:text-ndark-muted">{children}</p>;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-0.5">
      <span className="w-28 shrink-0 text-[11.5px] uppercase tracking-wide text-slate-400 dark:text-ndark-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-slate-700 dark:text-ndark-text">{value}</span>
    </div>
  );
}

export function L1WorkbenchPanel({
  item,
  onItemUpdate,
}: {
  item: Case;
  onItemUpdate: (next: Case) => void;
}) {
  // Notes preview lives inside the embedded <CaseNotesSection /> which
  // owns its own state. Section 3 ("Çalışma") shows the full experience
  // now, so the standalone preview slice was removed.
  // Codex P2 fix — history is appended newest-last by caseService (mock:
  // `[...prev.history, entry]`), so `history[0]` is the oldest event
  // (typically "Vaka oluşturuldu"). Sort explicitly by `at` desc so the
  // workbench shows the actual latest activity regardless of upstream
  // order.
  const latestActivity = item.history?.length
    ? [...item.history].sort(
        (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
      )[0]
    : undefined;
  // Phase 2E — files preview removed; the embedded <FilesTab /> below
  // owns the full list. linkCount stays for Section 5.
  const linkCount = item.linkCount ?? 0;
  const callLogCount = item.callLogs?.length ?? 0;
  const latestCall = item.callLogs?.[0];

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      {/* ─── 1. Şu an ─── */}
      <Section
        title="Şu an"
        icon={<Activity size={13} />}
        rightSlot={
          item.updatedAt && (
            <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
              güncellendi {formatRelative(item.updatedAt)}
            </span>
          )
        }
      >
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          <MetaRow
            label="Statü"
            value={<StatusPill status={item.status} />}
          />
          <MetaRow
            label="Öncelik"
            value={<PriorityBadge priority={item.priority} />}
          />
          <MetaRow
            label="Takım"
            value={item.assignedTeamName ?? <span className="text-slate-400">—</span>}
          />
          <MetaRow
            label="Sorumlu"
            value={item.assignedPersonName ?? <span className="text-slate-400">—</span>}
          />
          <MetaRow
            label="SLA"
            value={
              item.slaViolation ? (
                <Badge tint="rose" icon={<ShieldAlert size={11} />}>SLA İhlali</Badge>
              ) : item.slaPausedAt ? (
                <Badge tint="amber">Duraklatıldı</Badge>
              ) : item.slaResolutionDueAt ? (
                <span className="text-slate-700 dark:text-ndark-text">
                  <Clock size={11} className="mr-1 inline" />
                  Çözüm {formatRelative(item.slaResolutionDueAt)}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )
            }
          />
          {item.escalationLevel && item.escalationLevel !== 'Yok' && (
            <MetaRow
              label="Eskalasyon"
              value={<Badge tint="amber">{item.escalationLevel}</Badge>}
            />
          )}
        </div>
      </Section>

      {/* ─── 2. Statü ve Kapanış — StatusTransitionPanel reused ─── */}
      <Section title="Statü ve Kapanış" icon={<CheckCircle2 size={13} />}>
        <StatusTransitionPanel item={item} onApplied={onItemUpdate} />
      </Section>

      {/* ─── 3. Sorun ─── */}
      <Section title="Sorun" icon={<Sparkles size={13} />}>
        {item.description ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-ndark-text">
            {item.description}
          </p>
        ) : (
          <EmptyLine>Açıklama girilmemiş.</EmptyLine>
        )}
        <div className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-2">
          <MetaRow
            label="Kategori"
            value={
              item.subCategory
                ? `${item.category} › ${item.subCategory}`
                : item.category || <span className="text-slate-400">—</span>
            }
          />
          <MetaRow
            label="Talep Türü"
            value={item.requestType || <span className="text-slate-400">—</span>}
          />
          <MetaRow
            label="Vaka Türü"
            value={item.caseType}
          />
          <MetaRow
            label="Kanal"
            value={
              item.communicationChannelOverride ||
              item.origin ||
              <span className="text-slate-400">—</span>
            }
          />
          {(item.productGroup || item.productName) && (
            <MetaRow
              label="Ürün"
              value={
                [item.productGroup, item.productName].filter(Boolean).join(' › ') ||
                <span className="text-slate-400">—</span>
              }
            />
          )}
          {item.packageName && <MetaRow label="Paket" value={item.packageName} />}
        </div>
      </Section>

      {/* ─── 3. Çalışma — full Notes experience (reused) ─── */}
      <Section title="Çalışma" icon={<MessageSquare size={13} />}>
        {latestActivity && (
          <div className="mb-3 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11.5px] text-slate-500 dark:border-ndark-border/60 dark:bg-ndark-bg/30 dark:text-ndark-muted">
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              Son aktivite:
            </span>{' '}
            {latestActivity.action}{' '}
            <span className="text-slate-400">· {formatRelative(latestActivity.at)}</span>
          </div>
        )}
        <CaseNotesSection item={item} onItemUpdate={onItemUpdate} />
      </Section>

      {/* ─── 4. Kanıt / Dosyalar — full Files experience (reused) ─── */}
      <Section title="Kanıt / Dosyalar" icon={<FileText size={13} />}>
        <FilesTab item={item} onItemUpdated={onItemUpdate} />
      </Section>

      {/* ─── 5. Bağlantılar / Çağrı ─── */}
      <Section title="Bağlantılar / Çağrı" icon={<Link2 size={13} />}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center gap-2 text-[12.5px]">
            <Link2 size={12} className="text-slate-400" />
            <span className="text-slate-500 dark:text-ndark-muted">Bağlı vaka:</span>
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              {linkCount}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12.5px]">
            <PhoneCall size={12} className="text-slate-400" />
            <span className="text-slate-500 dark:text-ndark-muted">Çağrı:</span>
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              {callLogCount}
            </span>
          </div>
        </div>
        {latestCall && (
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12.5px] dark:border-ndark-border/60 dark:bg-ndark-bg/30">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-700 dark:text-ndark-text">
                Son çağrı — {latestCall.callerName}
              </span>
              <span
                className="text-[11px] text-slate-400 dark:text-ndark-muted"
                title={formatDateTime(latestCall.callDate)}
              >
                {formatRelative(latestCall.callDate)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[11.5px] text-slate-500 dark:text-ndark-muted">
              <span>{latestCall.callDisposition}</span>
              <span>·</span>
              <span>{latestCall.callOutcome}</span>
              <span>·</span>
              <span>{latestCall.durationMin} dk</span>
            </div>
            {latestCall.description && (
              <p className="mt-1 line-clamp-2 text-[12px] text-slate-700 dark:text-ndark-text">
                {latestCall.description}
              </p>
            )}
          </div>
        )}
        {linkCount === 0 && callLogCount === 0 && (
          <EmptyLine>Henüz bağlantı veya çağrı yok.</EmptyLine>
        )}
      </Section>
    </div>
  );
}

export default L1WorkbenchPanel;
