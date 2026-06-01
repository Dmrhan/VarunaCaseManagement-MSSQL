/**
 * L1WorkbenchPanel — Phase 2B.
 *
 * Read-only workbench shell for the L1 Case Resolution Console. Five
 * operational sections, each one a calm summary of an existing case
 * field — no composer, no upload, no transition action wiring yet.
 * Real interactive content (notes composer, file upload, status
 * actions) lands in later phases via component reuse, not rewrite.
 *
 * Sections:
 *   1. Şu an              — current operational state snapshot
 *   2. Sorun              — problem definition
 *   3. Çalışma            — latest notes + activity preview
 *   4. Kanıt / Dosyalar   — latest files preview
 *   5. Bağlantılar / Çağrı — linked cases + call log compact preview
 *
 * Empty states stay short and matter-of-fact so they don't shout in
 * the operational view.
 */

import {
  Activity,
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
import { formatRelative, formatBytes, formatDateTime } from '@/lib/format';
import type { Case } from '../types';

const NOTE_PREVIEW_COUNT = 3;
const FILE_PREVIEW_COUNT = 3;

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

export function L1WorkbenchPanel({ item }: { item: Case }) {
  const latestNotes = item.notes
    .filter((n) => !n.parentNoteId)
    .slice(0, NOTE_PREVIEW_COUNT);
  const totalNoteCount = item.notes.filter((n) => !n.parentNoteId).length;
  const latestActivity = item.history?.[0];
  const latestFiles = item.files.slice(-FILE_PREVIEW_COUNT).reverse();
  const totalFileCount = item.files.length;
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

      {/* ─── 2. Sorun ─── */}
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

      {/* ─── 3. Çalışma ─── */}
      <Section
        title="Çalışma"
        icon={<MessageSquare size={13} />}
        rightSlot={
          totalNoteCount > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
              {totalNoteCount} not
            </span>
          )
        }
      >
        {latestNotes.length === 0 ? (
          <EmptyLine>Henüz not eklenmemiş.</EmptyLine>
        ) : (
          <ul className="space-y-2">
            {latestNotes.map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-ndark-border/60 dark:bg-ndark-bg/30"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px]">
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {n.authorName}
                  </span>
                  <span className="text-slate-400 dark:text-ndark-muted">
                    {formatRelative(n.createdAt)} ·{' '}
                    {n.visibility === 'Internal' ? 'İç Not' : 'Müşteriye Görünür'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-slate-700 dark:text-ndark-text">
                  {n.content}
                </p>
              </li>
            ))}
          </ul>
        )}
        {latestActivity && (
          <div className="mt-3 border-t border-slate-100 pt-2 text-[11.5px] text-slate-500 dark:border-ndark-border/60 dark:text-ndark-muted">
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              Son aktivite:
            </span>{' '}
            {latestActivity.action}{' '}
            <span className="text-slate-400">· {formatRelative(latestActivity.at)}</span>
          </div>
        )}
        <p className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11.5px] italic text-slate-500 dark:border-ndark-border/60 dark:bg-ndark-bg/30 dark:text-ndark-muted">
          Notlar burada mevcut bileşen reuse edilerek gelecek.
        </p>
      </Section>

      {/* ─── 4. Kanıt / Dosyalar ─── */}
      <Section
        title="Kanıt / Dosyalar"
        icon={<FileText size={13} />}
        rightSlot={
          totalFileCount > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
              {totalFileCount} dosya
            </span>
          )
        }
      >
        {latestFiles.length === 0 ? (
          <EmptyLine>Henüz dosya eklenmemiş.</EmptyLine>
        ) : (
          <ul className="space-y-1.5">
            {latestFiles.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[12.5px] dark:border-ndark-border/60 dark:bg-ndark-bg/30"
              >
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-ndark-text">
                  {f.fileName}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-ndark-muted">
                  {formatBytes(f.fileSize)} · {formatRelative(f.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11.5px] italic text-slate-500 dark:border-ndark-border/60 dark:bg-ndark-bg/30 dark:text-ndark-muted">
          Dosya yükleme mevcut Dosyalar bileşeni reuse edilerek gelecek.
        </p>
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
