import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export type MetricTone = 'neutral' | 'good' | 'warn' | 'danger' | 'info';

interface MetricTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: MetricTone;
  delta?: { value: number; label?: string; positiveIsGood?: boolean };
}

const TONES: Record<MetricTone, string> = {
  neutral: 'bg-white ring-slate-200',
  good:    'bg-emerald-50/60 ring-emerald-200',
  warn:    'bg-amber-50/60 ring-amber-200',
  danger:  'bg-rose-50/60 ring-rose-200',
  info:    'bg-blue-50/60 ring-blue-200',
};

const TONE_LABEL: Record<MetricTone, string> = {
  neutral: 'text-slate-500',
  good:    'text-emerald-700',
  warn:    'text-amber-800',
  danger:  'text-rose-700',
  info:    'text-blue-700',
};

export function MetricTile({ label, value, hint, icon, tone = 'neutral', delta }: MetricTileProps) {
  return (
    <div className={cn('rounded-xl p-4 ring-1 ring-inset shadow-sm', TONES[tone])}>
      <div className={cn('flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide', TONE_LABEL[tone])}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {(hint || delta) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          {hint}
          {delta && (
            <span
              className={cn(
                'rounded px-1 font-medium',
                (delta.positiveIsGood ?? true)
                  ? delta.value >= 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-700'
                  : delta.value >= 0
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700',
              )}
            >
              {delta.value > 0 ? '+' : ''}
              {delta.value.toFixed(0)}%
              {delta.label && <span className="ml-1 text-[10px] font-normal">{delta.label}</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
