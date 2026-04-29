import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  children: ReactNode;
  footer?: ReactNode;
}

const SIZES = {
  sm:    'max-w-md',
  md:    'max-w-lg',
  lg:    'max-w-2xl',
  xl:    'max-w-3xl',
  '2xl': 'max-w-5xl',
};

export function Modal({ open, onClose, title, size = 'lg', children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className={cn('relative w-full rounded-xl bg-white shadow-2xl ring-1 ring-slate-200', SIZES[size])}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
