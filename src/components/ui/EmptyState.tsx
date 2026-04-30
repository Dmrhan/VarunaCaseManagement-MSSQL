import type { ReactNode } from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 py-6' : 'gap-3 py-12',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-ndark-card dark:text-ndark-muted',
            size === 'sm' ? 'h-10 w-10' : 'h-14 w-14',
          )}
        >
          {icon}
        </div>
      )}
      <div className={cn('font-medium text-slate-700 dark:text-ndark-text', size === 'sm' ? 'text-sm' : 'text-base')}>
        {title}
      </div>
      {description && <div className="max-w-sm text-xs text-slate-500 dark:text-ndark-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
