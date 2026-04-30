import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

interface AccordionItemProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  tint?: 'default' | 'violet' | 'rose';
}

const TINTS = {
  default: '',
  violet:  'bg-violet-50/30 dark:bg-violet-950/20',
  rose:    'bg-rose-50/30 dark:bg-rose-950/20',
};

export function AccordionItem({
  title,
  subtitle,
  badge,
  defaultOpen = true,
  children,
  icon,
  tint = 'default',
}: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn('overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-ndark-border', TINTS[tint])}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-ndark-card"
      >
        {icon && <span className="text-slate-500 dark:text-ndark-muted">{icon}</span>}
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-800 dark:text-ndark-text">{title}</span>
          {subtitle && <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-ndark-muted">{subtitle}</span>}
        </span>
        {badge}
        <ChevronDown
          size={16}
          className={cn('text-slate-400 transition-transform dark:text-ndark-muted', open ? 'rotate-180' : 'rotate-0')}
        />
      </button>
      {open && <div className="border-t border-slate-200 bg-white px-4 py-4 dark:border-ndark-border dark:bg-ndark-surface">{children}</div>}
    </section>
  );
}

export function Accordion({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-2', className)}>{children}</div>;
}
