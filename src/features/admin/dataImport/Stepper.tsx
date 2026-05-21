import { Check } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { STEP_LABELS, STEP_ORDER, type Step } from './types';

interface StepperProps {
  current: Step;
  /** Tamamlanmış adımlar (görsel state için) */
  completed: Set<Step>;
  /** Bir adıma tıklanabilir mi (tamamlanmışlar geri gidilebilir) */
  onGo?: (s: Step) => void;
}

export function Stepper({ current, completed, onGo }: StepperProps) {
  return (
    <ol className="flex w-full items-center gap-2">
      {STEP_ORDER.map((s, i) => {
        const isCurrent = s === current;
        const isDone = completed.has(s);
        const isClickable = !!onGo && (isDone || isCurrent);
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onGo?.(s)}
              className={cn(
                'group flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                isCurrent
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:border-ndark-accent dark:text-ndark-text'
                  : isDone
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted',
                isClickable ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                  isCurrent
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : isDone
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 bg-white text-slate-500 dark:border-ndark-border dark:bg-ndark-surface',
                )}
              >
                {isDone ? <Check size={12} /> : i + 1}
              </span>
              <span className="truncate font-medium">{STEP_LABELS[s]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
