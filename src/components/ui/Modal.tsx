import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  children: ReactNode;
  footer?: ReactNode;
  /** Verilirse modal sabit yükseklikte olur, içerik flex column ile sığar (örn. '85vh') */
  height?: string;
  /** Body wrapper className'i (varsayılan p-5 py-4 yerine kendi padding/scroll yönetimi) */
  bodyClassName?: string;
}

const SIZES = {
  sm:    'max-w-md',
  md:    'max-w-lg',
  lg:    'max-w-2xl',
  xl:    'max-w-3xl',
  '2xl': 'max-w-5xl',
  '3xl': 'max-w-6xl',
  '4xl': 'max-w-[1280px]',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'lg',
  children,
  footer,
  height,
  bodyClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fixedHeight = Boolean(height);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-slate-900/40 p-4 sm:p-8 dark:bg-black/60',
        fixedHeight ? 'items-center' : 'items-start overflow-y-auto',
      )}
    >
      <div
        className={cn(
          'relative w-full rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-ndark-card dark:text-ndark-text dark:ring-ndark-border',
          fixedHeight && 'flex flex-col overflow-hidden',
          SIZES[size],
        )}
        style={fixedHeight ? { height } : undefined}
      >
        <header
          className={cn(
            'flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-ndark-border',
            fixedHeight && 'shrink-0',
          )}
        >
          {title && <h2 className="text-base font-semibold text-slate-900 dark:text-ndark-text">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-card dark:hover:text-ndark-text"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div
          className={cn(
            fixedHeight ? 'flex-1 min-h-0' : '',
            bodyClassName ?? (fixedHeight ? '' : 'px-5 py-4'),
          )}
        >
          {children}
        </div>
        {footer && (
          <div
            className={cn(
              'border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-ndark-border dark:bg-ndark-card',
              fixedHeight && 'shrink-0',
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
