import type { CasePriority, CaseStatus, CaseType } from '@/features/cases/types';
import { CASE_TYPE_LABELS } from '@/features/cases/types';
import { Badge, type BadgeTint } from './Badge';

const STATUS_TINT: Record<CaseStatus, BadgeTint> = {
  'Açık':                'sky',
  'İncelemede':          'indigo',
  '3rdPartyBekleniyor':  'amber',
  'Eskalasyon':          'violet',
  'Çözüldü':             'emerald',
  'YenidenAcildi':       'blue',
  'İptalEdildi':         'slate',
};

const STATUS_DOT: Record<CaseStatus, string> = {
  'Açık':                'bg-sky-500',
  'İncelemede':          'bg-indigo-500',
  '3rdPartyBekleniyor':  'bg-amber-500',
  'Eskalasyon':          'bg-violet-500',
  'Çözüldü':             'bg-emerald-500',
  'YenidenAcildi':       'bg-blue-500',
  'İptalEdildi':         'bg-slate-400',
};

const PRIORITY_TINT: Record<CasePriority, BadgeTint> = {
  'Düşük':    'slate',
  'Orta':     'blue',
  'Yüksek':   'amber',
  'Critical': 'rose',
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
  return <Badge tint={PRIORITY_TINT[priority]}>{priority}</Badge>;
}

export function CaseTypeBadge({ type }: { type: CaseType }) {
  return <Badge tint={TYPE_TINT[type]}>{CASE_TYPE_LABELS[type]}</Badge>;
}
