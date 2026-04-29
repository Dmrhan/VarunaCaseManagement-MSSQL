import type { CasePriority, CaseStatus, CaseType } from '@/features/cases/types';
import { CASE_PRIORITY_LABELS, CASE_TYPE_LABELS } from '@/features/cases/types';
import { Badge, type BadgeTint } from './Badge';

// Spec 11.1 renk paleti
const STATUS_TINT: Record<CaseStatus, BadgeTint> = {
  'Açık':                'blue',
  'İncelemede':          'amber',
  '3rdPartyBekleniyor':  'slate',
  'Eskalasyon':          'rose',
  'Çözüldü':             'emerald',
  'YenidenAcildi':       'violet',
  'İptalEdildi':         'slate',
};

const STATUS_DOT: Record<CaseStatus, string> = {
  'Açık':                'bg-blue-500',
  'İncelemede':          'bg-amber-500',
  '3rdPartyBekleniyor':  'bg-slate-500',
  'Eskalasyon':          'bg-rose-500',
  'Çözüldü':             'bg-emerald-500',
  'YenidenAcildi':       'bg-violet-500',
  'İptalEdildi':         'bg-slate-300',
};

const PRIORITY_TINT: Record<CasePriority, BadgeTint> = {
  Low:      'slate',
  Medium:   'blue',
  High:     'amber',
  Critical: 'rose',
};

const TYPE_TINT: Record<CaseType, BadgeTint> = {
  GeneralSupport:    'teal',
  ProactiveTracking: 'violet',
  Churn:             'rose',
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3. Parti Bekleniyor',
  'Eskalasyon':          'Eskalasyon',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden Açıldı',
  'İptalEdildi':         'İptal Edildi',
};

export function StatusPill({ status }: { status: CaseStatus }) {
  return (
    <Badge tint={STATUS_TINT[status]}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: CasePriority }) {
  return <Badge tint={PRIORITY_TINT[priority]}>{CASE_PRIORITY_LABELS[priority]}</Badge>;
}

export function CaseTypeBadge({ type }: { type: CaseType }) {
  return <Badge tint={TYPE_TINT[type]}>{CASE_TYPE_LABELS[type]}</Badge>;
}
