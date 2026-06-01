/**
 * L1CommandBar — Phase 2A.
 *
 * Top command bar for the L1 Case Resolution Console. Visual parity
 * with CaseDetailPage's header so an operator switching between V1
 * and V2 has zero cognitive load.
 *
 * Active in Phase 2A:
 *   - Back navigation (wired to parent's `onBack`)
 *   - Case number + title + customer chip
 *   - Status / Priority / SLA / Case-type chips
 *   - Assigned team + person meta line
 *
 * Disabled placeholders (Phase 2B+):
 *   - Kaydet           — inline drafts not yet ported; no state to save
 *   - Çağrı Başlat     — call session state + ActiveCallBanner not ported
 *   - Durum Raporu     — StatusReportModal lives inside CaseDetailPage
 *                        body (~lines 2481-2620); needs extraction
 *   - Devret           — TransferModal hoist + AI suggest wiring TBD
 *   - Ertele           — SnoozeModal hoist TBD
 *   - More menu        — Jira / Yazdır / İptal — same modal hoist gap
 *
 * Each disabled button keeps its label + icon visible so V2 testers
 * can verify the action surface is complete; `title` attribute
 * explains the deferred wiring.
 */

import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Clock,
  Clock3,
  MoreHorizontal,
  Phone,
  Save,
  ShieldAlert,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, PriorityBadge, CaseTypeBadge } from '@/components/ui/StatusPill';
import { formatRelative } from '@/lib/format';
import type { Case } from '../types';

const PLACEHOLDER_TITLE = 'Sonraki L1 fazında bağlanacak (Phase 2B+).';

export function L1CommandBar({
  item,
  onBack,
  onShowCustomer,
}: {
  item: Case;
  onBack: () => void;
  onShowCustomer?: (accountId: string) => void;
}) {
  const isSnoozeActive = !!item.slaPausedAt;
  return (
    <header className="border-b border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      <div className="flex flex-wrap items-start gap-4 px-6 py-3">
        {/* Back */}
        <button
          type="button"
          onClick={onBack}
          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg"
          title="Vakalar listesine dön"
          aria-label="Geri"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Identity + chips */}
        <div className="min-w-0 flex-1">
          <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-ndark-muted">
            <button type="button" onClick={onBack} className="hover:text-brand-700 hover:underline">
              Vakalar
            </button>
            <ChevronRight size={11} className="text-slate-400" />
            <span className="font-mono text-slate-700 dark:text-ndark-text">{item.caseNumber}</span>
            {item.accountName && (
              <>
                <span className="text-slate-400">—</span>
                <span className="truncate text-slate-600 dark:text-ndark-muted">{item.accountName}</span>
              </>
            )}
          </nav>
          <h1 className="mt-0.5 truncate text-lg font-semibold text-slate-900 dark:text-ndark-text">
            {item.title}
          </h1>

          {/* Operational chips */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {item.accountId && onShowCustomer && (
              <button
                type="button"
                onClick={() => onShowCustomer(item.accountId)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:border-brand-500 dark:hover:bg-brand-950/30"
                title="Müşteri kartını aç"
              >
                <Building2 size={11} />
                {item.accountName}
              </button>
            )}
            <StatusPill status={item.status} />
            <PriorityBadge priority={item.priority} />
            {item.slaViolation && (
              <Badge tint="rose" icon={<ShieldAlert size={12} />}>
                SLA İhlali
              </Badge>
            )}
            {item.slaPausedAt && <Badge tint="amber">SLA Duraklatıldı</Badge>}
            {item.slaResolutionDueAt && !item.slaViolation && !item.slaPausedAt && (
              <Badge tint="slate" icon={<Clock size={12} />}>
                Çözüm SLA {formatRelative(item.slaResolutionDueAt)}
              </Badge>
            )}
            <CaseTypeBadge type={item.caseType} />
          </div>

          {/* Assignment meta line — read-only display */}
          {(item.assignedTeamName || item.assignedPersonName) && (
            <div className="mt-1 text-[11.5px] text-slate-500 dark:text-ndark-muted">
              {item.assignedTeamName && (
                <span>
                  Takım: <span className="text-slate-700 dark:text-ndark-text">{item.assignedTeamName}</span>
                </span>
              )}
              {item.assignedTeamName && item.assignedPersonName && (
                <span className="mx-2 text-slate-400">·</span>
              )}
              {item.assignedPersonName && (
                <span>
                  Sorumlu: <span className="text-slate-700 dark:text-ndark-text">{item.assignedPersonName}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions — disabled placeholders in Phase 2A. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Save size={12} />}
            disabled
            title={`Kaydet — ${PLACEHOLDER_TITLE} (draft state Workbench fazıyla gelecek)`}
          >
            Kaydet
          </Button>
          <Button
            size="sm"
            leftIcon={<Phone size={12} />}
            disabled
            title={`Çağrı Başlat — ${PLACEHOLDER_TITLE} (ActiveCallBanner + modal hoist edilecek)`}
          >
            Çağrı Başlat
          </Button>
          <button
            type="button"
            disabled
            title={`Durum Raporu — ${PLACEHOLDER_TITLE} (StatusReportModal CaseDetailPage'den ayıklanacak)`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-300 bg-white px-3 text-xs font-medium text-violet-500 opacity-60 dark:border-violet-900/60 dark:bg-ndark-card dark:text-violet-400"
          >
            <Sparkles size={12} />
            Durum Raporu
          </button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<UserPlus size={12} />}
            disabled
            title={`Devret — ${PLACEHOLDER_TITLE} (TransferModal + AI suggest hoist edilecek)`}
          >
            Devret
          </Button>
          {!isSnoozeActive && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Clock3 size={12} />}
              disabled
              title={`Ertele — ${PLACEHOLDER_TITLE} (SnoozeModal hoist edilecek)`}
            >
              Ertele
            </Button>
          )}
          <button
            type="button"
            disabled
            title={`Daha fazla aksiyon — ${PLACEHOLDER_TITLE}`}
            aria-label="Daha fazla aksiyon"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-400 opacity-60 dark:border-ndark-border dark:bg-ndark-card"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default L1CommandBar;
