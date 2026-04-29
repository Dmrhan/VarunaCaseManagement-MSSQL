import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
}

const WIDTHS = {
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

export function Drawer({ open, onClose, title, subtitle, width = 'lg', children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-40 transition-opacity',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-white shadow-drawer transition-transform duration-200',
          WIDTHS[width],
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            {title && <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50 px-6 py-3">{footer}</div>}
      </aside>
    </div>
  );
}
