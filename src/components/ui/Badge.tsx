import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTint = 'slate' | 'blue' | 'indigo' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'teal';

const TINTS: Record<BadgeTint, string> = {
  slate:   'bg-slate-100 text-slate-700 ring-slate-200',
  blue:    'bg-blue-50 text-blue-700 ring-blue-200',
  indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  sky:     'bg-sky-50 text-sky-700 ring-sky-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber:   'bg-amber-50 text-amber-800 ring-amber-200',
  rose:    'bg-rose-50 text-rose-700 ring-rose-200',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200',
  teal:    'bg-teal-50 text-teal-700 ring-teal-200',
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
