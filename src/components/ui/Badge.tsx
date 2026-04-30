import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTint = 'slate' | 'blue' | 'indigo' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'teal';

const TINTS: Record<BadgeTint, string> = {
  slate:   'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700',
  blue:    'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:ring-blue-800',
  indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:ring-indigo-800',
  sky:     'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:ring-sky-800',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800',
  amber:   'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800',
  rose:    'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:ring-rose-800',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-800',
  teal:    'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:ring-teal-800',
};

interface BadgeProps {
  tint?: BadgeTint;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

export function Badge({ tint = 'slate', children, className, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TINTS[tint],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
