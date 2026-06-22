import type { CasePriority, CaseStatus, CaseType } from '@/features/cases/types';
import { CASE_PRIORITY_LABELS, CASE_TYPE_LABELS } from '@/features/cases/types';
import { Badge, type BadgeTint } from './Badge';
import { cn } from './cn';

// Renk kuralı: yalnızca anlamlı durumlar renkli (Eskalasyon/Yeniden Açıldı → AMBER,
// Çözüldü → GREEN). Diğer statüler nötr slate. Tip rozetleri outline-only —
// sayfada renk gürültüsü çıkarmasınlar.
const STATUS_TINT: Record<CaseStatus, BadgeTint> = {
  'Açık':                'slate',
  'İncelemede':          'slate',
  '3rdPartyBekleniyor':  'slate',
  'Eskalasyon':          'amber',
  'Çözüldü':             'emerald',
  'YenidenAcildi':       'amber',
  'İptalEdildi':         'slate',
};

const STATUS_DOT: Record<CaseStatus, string> = {
  'Açık':                'bg-slate-500',
  'İncelemede':          'bg-slate-500',
  '3rdPartyBekleniyor':  'bg-slate-500',
  'Eskalasyon':          'bg-amber-500',
  'Çözüldü':             'bg-emerald-500',
  'YenidenAcildi':       'bg-amber-500',
  'İptalEdildi':         'bg-slate-300',
};

const PRIORITY_TINT: Record<CasePriority, BadgeTint> = {
  Low:      'slate',
  Medium:   'slate',
  High:     'amber',
  Critical: 'rose',
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3. Parti Bekleniyor',
  // LBD A9 — display rename (enum identifier 'Eskalasyon' korunur)
  'Eskalasyon':          'Eskale Edildi',
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

// Outline-only — fill yok, sadece kenarlık. Type bilgisi alıcı/atayan/SLA'dan
// daha az önemli; zayıf kontrast bilinçli tercih.
export function CaseTypeBadge({ type }: { type: CaseType }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        'border-slate-300 text-slate-600',
        'dark:border-slate-600 dark:text-slate-400',
      )}
    >
      {CASE_TYPE_LABELS[type]}
    </span>
  );
}
