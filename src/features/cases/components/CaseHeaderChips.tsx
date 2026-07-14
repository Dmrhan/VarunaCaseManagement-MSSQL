/**
 * Shared operational chip block for case headers.
 *
 * Renders status / priority / worst-SLA / case-type in a single
 * flex-wrap row. Only the WORST SLA badge is rendered (violation >
 * paused > upcoming due > none) so a single chip carries the SLA
 * signal — no triplication.
 *
 * Phase 2H Layout Hygiene PR1 — used by L1CommandBar only. Plan is
 * for CaseDetailPage to adopt the same component in a future
 * drift-prevention PR so the chip block has a single source of
 * truth across V1 and V2.
 */

import { Clock, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { StatusPill, PriorityBadge, CaseTypeBadge } from '@/components/ui/StatusPill';
import { formatRelative, formatSlaRemaining } from '@/lib/format';
import type { Case } from '../types';

export function CaseHeaderChips({ item }: { item: Case }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill status={item.status} />
      <PriorityBadge priority={item.priority} />
      {item.slaViolation ? (
        <Badge tint="rose" icon={<ShieldAlert size={12} />}>
          SLA İhlali
        </Badge>
      ) : item.slaPausedAt ? (
        <Badge tint="amber">SLA Duraklatıldı</Badge>
      ) : item.slaCustomerWaitStartedAt ? (
        <Badge tint="amber">SLA Duraklatıldı · müşteri yanıtı bekleniyor</Badge>
      ) : item.slaResolutionDueAt ? (
        <Badge tint="slate" icon={<Clock size={12} />}>
          Çözüm SLA{' '}
          {formatSlaRemaining(item.slaResolutionRemainingMin, item.slaBusinessTime, item.slaDayMinutes)
            ?? formatRelative(item.slaResolutionDueAt)}
        </Badge>
      ) : null}
      <CaseTypeBadge type={item.caseType} />
    </div>
  );
}

export default CaseHeaderChips;
